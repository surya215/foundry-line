// bots.js — 9 AI combatants for Foundry Line: 4 Ember attackers (the human
// player's team) + 5 Vanguard defenders. Waypoint routes, vision cone + line
// of sight, hearing, burst fire, bomb plant/defuse, retreat when hurt.
//
// Damage note (W2): combatant.damage(amount, part) applies no weapon
// headshot multiplier itself (legs 0.8x, head/torso 1x), so the caller must
// multiply the weapon's headMult into the amount for head hits — done in
// shoot() below. Kills call game.rounds.onKill(killerTeam) exactly once
// here; main.js must NOT call it again when draining the kill event.
//
// No per-frame allocation in the hot loop: shared raycaster + scratch
// vectors. A Vector3 is only cloned for a shot/kill event (a few per
// second, drained by main.js in the same tick).
import * as THREE from 'three';
import { createCombatant } from './combatant.js';
import { losClear } from './world.js';
import { PALETTE } from './palette.js';

const VISION_DT = 0.15; // seconds between vision scans, per bot (staggered)
const VISION_RANGE = 42; // metres
const FOV_COS = 0.6428; // cos(50 deg) — half-angle of the vision cone
const HEAR_RANGE = 26; // gunshots heard inside this radius
const REACT_MIN = 0.35; // reaction delay before first shot (s)
const REACT_MAX = 0.6;
const RETREAT_HP = 35;
const PLANT_TIME = 4; // seconds standing still to plant
const DEFUSE_TIME = 5; // seconds standing still to defuse
const DEFUSE_RANGE = 2.2; // metres from the charge to start defusing
const WP_ARRIVE = 0.7; // metres: close enough to a waypoint
const TURN_RATE = 6; // rad/s the bot can turn
const EYE_CHEST = 1.15; // aim height above feet (torso centre)
const EYE_HEAD = 1.5;
const MOVE_IDLE = { forward: 0, strafe: 0, jump: false, crouch: false };
const MOVE_FWD = { forward: 1, strafe: 0, jump: false, crouch: false };
// Waypoint coords at each site (floor, NOT the platform centre at +-16).
const SITE_WP = { A: { x: -12, z: -12 }, B: { x: 12, z: -12 } };
// Fallback weapon stats (live values come from game.weapons.defs).
const FALLBACK = {
  vk7: { damage: 34, headMult: 4, rpm: 600 },
  kestrel: { damage: 22, headMult: 2, rpm: 750 },
  p9: { damage: 28, headMult: 2, rpm: 320 },
};

// Shared scratch: raycaster + vectors, reused by every bot every tick.
const _ray = new THREE.Raycaster();
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _seg = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _hits = []; // reused intersect-object list (target meshes only)

export function createBots(scene, game) {
  const world = game.world;
  const colliders = world.colliders;
  const rng = typeof game.rng === 'function' ? game.rng : Math.random;

  const MAT = {
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.6, metalness: 0.2 }),
    emberDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember).multiplyScalar(0.6), roughness: 0.6, metalness: 0.2 }),
    vanguard: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.vanguard), roughness: 0.6, metalness: 0.2 }),
    vanguardDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.vanguard).multiplyScalar(0.6), roughness: 0.6, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.85, metalness: 0.1 }),
  };
  const GEO = {
    torso: new THREE.BoxGeometry(0.52, 0.62, 0.3),
    head: new THREE.BoxGeometry(0.26, 0.26, 0.26),
    leg: new THREE.BoxGeometry(0.16, 0.5, 0.18),
    gun: new THREE.BoxGeometry(0.09, 0.13, 0.6),
  };

  const list = [];
  const hitMeshes = [];

  function makeBot(team, slot, weapon, site, holdXZ) {
    // Ember bots take spawns 1-4; spawn 0 is the human player.
    const spawn = team === 'ember' ? world.spawns.ember[slot + 1] : world.spawns.vanguard[slot];
    const bot = {
      name: team === 'ember' ? 'Ember-' + (slot + 2) : 'Vanguard-' + (slot + 1),
      team, slot, weapon, site,
      role: team === 'ember' ? 'attack' : 'defend',
      combatant: null, mesh: null, hitMeshes: [],
      state: 'spawn', path: [], pathI: 0, goal: 'site',
      hold: holdXZ ? { x: holdXZ[0], z: holdXZ[1] } : null,
      spawnPos: spawn.clone(),
      target: null, targetPlayer: false,
      lastSeen: new THREE.Vector3(), lastSeenT: -99,
      reactT: 0, burstLeft: 0, burstPauseT: 0, fireT: 0,
      visionT: rng() * VISION_DT,
      accuracy: 0.75 + rng() * 0.25,
      hasCharge: false, plantT: 0, defuseT: 0, plantWaitT: 0, resumeT: 0,
      lastHp: 100, deadT: 0, scanD: Infinity, scanTarget: null, scanPlayer: false,
    };
    bot.combatant = createCombatant(colliders, { spawn, yaw: team === 'ember' ? 0 : Math.PI, team });

    // Humanoid from boxes. Every mesh carries userData.bot + userData.part;
    // only torso/head/legs go into hitMeshes (the gun is visual only).
    const g = new THREE.Group();
    const suit = team === 'ember' ? MAT.ember : MAT.vanguard;
    const suitDark = team === 'ember' ? MAT.emberDark : MAT.vanguardDark;
    const torso = new THREE.Mesh(GEO.torso, suit);
    torso.position.y = 0.95; torso.userData.part = 'torso';
    const head = new THREE.Mesh(GEO.head, suitDark);
    head.position.y = 1.42; head.userData.part = 'head';
    const legL = new THREE.Mesh(GEO.leg, MAT.dark);
    legL.position.set(-0.12, 0.25, 0); legL.userData.part = 'legs';
    const legR = new THREE.Mesh(GEO.leg, MAT.dark);
    legR.position.set(0.12, 0.25, 0); legR.userData.part = 'legs';
    const gun = new THREE.Mesh(GEO.gun, MAT.dark);
    gun.position.set(0.18, 1.05, -0.28); gun.userData.part = 'torso';
    for (const m of [torso, head, legL, legR, gun]) {
      m.castShadow = true;
      m.userData.bot = bot;
      g.add(m);
    }
    g.position.copy(spawn);
    scene.add(g);
    bot.mesh = g;
    bot.hitMeshes = [torso, head, legL, legR];
    for (const m of bot.hitMeshes) hitMeshes.push(m);
    return bot;
  }

  // 4 Ember attackers: two per site. 5 Vanguard defenders: two hold A, two
  // hold B, one holds mid.
  const emberWeapons = ['vk7', 'vk7', 'kestrel', 'p9'];
  const emberSites = ['A', 'A', 'B', 'B'];
  for (let i = 0; i < 4; i++) list.push(makeBot('ember', i, emberWeapons[i], emberSites[i], null));
  const vanWeapons = ['vk7', 'vk7', 'kestrel', 'kestrel', 'p9'];
  const vanHolds = [[-12, -12], [-10, -6], [12, -12], [10, -6], [0, -4]];
  const vanSites = ['A', 'A', 'B', 'B', null];
  for (let i = 0; i < 5; i++) list.push(makeBot('vanguard', i, vanWeapons[i], vanSites[i], vanHolds[i]));

  function defFor(bot) {
    const defs = game.weapons && game.weapons.defs;
    if (defs && defs[bot.weapon]) return defs[bot.weapon];
    return FALLBACK[bot.weapon];
  }

  // path() returns a shared scratch array — always copy before storing.
  function setPath(bot, tx, tz) {
    const wps = world.waypoints;
    const from = wps.nearest(bot.combatant.state.position.x, bot.combatant.state.position.z);
    bot.path = [...wps.path(from, wps.nearest(tx, tz))];
    bot.pathI = 0;
  }

  function faceToward(bot, tx, tz, dt) {
    const s = bot.combatant.state;
    const want = Math.atan2(-(tx - s.position.x), -(tz - s.position.z));
    let d = want - s.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const maxTurn = TURN_RATE * dt;
    s.yaw += d > maxTurn ? maxTurn : d < -maxTurn ? -maxTurn : d;
  }

  // Walk the waypoint path; true once the last node is reached.
  function followPath(bot, dt) {
    if (bot.pathI >= bot.path.length) return true;
    const node = world.waypoints.byId.get(bot.path[bot.pathI]);
    if (!node) { bot.pathI++; return bot.pathI >= bot.path.length; }
    const s = bot.combatant.state;
    const dx = node.x - s.position.x;
    const dz = node.z - s.position.z;
    if (dx * dx + dz * dz < WP_ARRIVE * WP_ARRIVE) {
      bot.pathI++;
      return bot.pathI >= bot.path.length;
    }
    faceToward(bot, node.x, node.z, dt);
    bot.combatant.step(dt, MOVE_FWD);
    return false;
  }

  // True if the segment a->b passes through any live smoke cloud.
  function smokeBlocks(a, b) {
    const smokes = game.smoke;
    if (!smokes || smokes.length === 0) return false;
    for (let i = 0; i < smokes.length; i++) {
      const sm = smokes[i];
      if (game.time > sm.until) continue;
      _seg.subVectors(b, a);
      const lenSq = _seg.lengthSq();
      if (lenSq < 1e-9) continue;
      _rel.subVectors(sm.pos, a);
      let t = _rel.dot(_seg) / lenSq;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      _closest.copy(a).addScaledVector(_seg, t);
      if (_closest.distanceToSquared(sm.pos) < sm.radius * sm.radius) return true;
    }
    return false;
  }

  // One vision candidate: chest point (ex, feetY + EYE_CHEST, ez). Keeps the
  // nearest visible enemy in bot.scanTarget / bot.scanPlayer / bot.lastSeen.
  function testEnemy(bot, ex, feetY, ez, other, isPlayer) {
    _aim.set(ex, feetY + EYE_CHEST, ez);
    _to.subVectors(_aim, _eye);
    const d = _to.length();
    if (d > VISION_RANGE || d >= bot.scanD) return;
    _to.multiplyScalar(1 / d);
    if (_to.dot(_fwd) < FOV_COS) return;
    if (!losClear(world, _eye, _aim)) return;
    if (smokeBlocks(_eye, _aim)) return;
    bot.scanD = d;
    bot.scanTarget = other;
    bot.scanPlayer = isPlayer;
    bot.lastSeen.copy(_aim);
  }

  function scanVision(bot) {
    const s = bot.combatant.state;
    _eye.set(s.position.x, s.position.y + s.eye, s.position.z);
    _fwd.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
    bot.scanD = Infinity;
    bot.scanTarget = null;
    bot.scanPlayer = false;
    // The human player is an enemy only for Vanguard bots.
    if (bot.team === 'vanguard' && game.player && game.player.state.alive) {
      const ps = game.player.state;
      testEnemy(bot, ps.position.x, ps.position.y, ps.position.z, null, true);
    }
    for (const other of list) {
      if (other.team === bot.team || !other.combatant.state.alive) continue;
      const os = other.combatant.state;
      testEnemy(bot, os.position.x, os.position.y, os.position.z, other, false);
    }
    if (bot.scanTarget !== null || bot.scanPlayer) {
      const isNew = bot.target !== bot.scanTarget || bot.targetPlayer !== bot.scanPlayer;
      bot.target = bot.scanTarget;
      bot.targetPlayer = bot.scanPlayer;
      bot.lastSeenT = game.time;
      if (isNew) bot.reactT = REACT_MIN + rng() * (REACT_MAX - REACT_MIN);
    }
  }

  function targetState(bot) {
    if (bot.targetPlayer) return game.player ? game.player.state : null;
    return bot.target ? bot.target.combatant.state : null;
  }

  // Closest approach of the ray to the player's vertical axis; returns the
  // hit part or null, and sets _end to the hit point.
  function rayVsPlayer(o, d, ps) {
    const dx = d.x;
    const dz = d.z;
    const denom = dx * dx + dz * dz;
    let t = denom > 1e-6
      ? ((ps.position.x - o.x) * dx + (ps.position.z - o.z) * dz) / denom : 0;
    t = Math.max(0, Math.min(60, t));
    const cx = o.x + dx * t;
    const cy = o.y + d.y * t;
    const cz = o.z + dz * t;
    const h = Math.hypot(cx - ps.position.x, cz - ps.position.z);
    if (h > 0.38) return null;
    const feet = ps.position.y;
    _end.set(cx, cy, cz);
    if (cy > feet + 1.32 && h < 0.24) return 'head';
    if (cy > feet + 0.35 && cy < feet + 1.72) return 'torso';
    if (cy > feet && cy <= feet + 0.35) return 'legs';
    return null;
  }

  function handleKill(killer, headshot) {
    const victimBot = killer.targetPlayer ? null : killer.target;
    const victimName = killer.targetPlayer ? 'You' : victimBot.name;
    game.events.push({
      type: 'kill', killer: killer.name, victim: victimName,
      weapon: killer.weapon, headshot,
      killerTeam: killer.team, victimTeam: killer.team === 'ember' ? 'vanguard' : 'ember',
    });
    if (game.rounds && game.rounds.onKill) game.rounds.onKill(killer.team);
    if (victimBot) {
      victimBot.state = 'dead';
      victimBot.deadT = 0;
      victimBot.target = null;
      victimBot.targetPlayer = false;
      if (victimBot.hasCharge) {
        // The charge passes to the nearest living Ember bot.
        victimBot.hasCharge = false;
        let best = null;
        let bestD = Infinity;
        for (const b of list) {
          if (b.team !== 'ember' || !b.combatant.state.alive) continue;
          const d = b.combatant.state.position.distanceToSquared(victimBot.combatant.state.position);
          if (d < bestD) { bestD = d; best = b; }
        }
        if (best) best.hasCharge = true;
      }
    }
    killer.target = null;
    killer.targetPlayer = false;
  }

  function shoot(bot) {
    const def = defFor(bot);
    const s = bot.combatant.state;
    _eye.set(s.position.x, s.position.y + s.eye, s.position.z);
    const ts = targetState(bot);
    if (!ts || !ts.alive) return;
    const head = rng() < 0.3;
    _aim.set(ts.position.x, ts.position.y + (head ? EYE_HEAD : EYE_CHEST), ts.position.z);
    // No wall-banging: only shoot while the aim point is actually visible.
    if (!losClear(world, _eye, _aim)) return;
    if (smokeBlocks(_eye, _aim)) return;
    const dist = _eye.distanceTo(_aim);
    const tSpeed = Math.hypot(ts.velocity.x, ts.velocity.z);
    const err = (0.02 + dist * 0.0009 + tSpeed * 0.004) * (2 - bot.accuracy);
    _dir.subVectors(_aim, _eye).normalize();
    _right.set(-_dir.z, 0, _dir.x).normalize();
    _up.crossVectors(_dir, _right).normalize();
    _dir.addScaledVector(_right, (rng() * 2 - 1) * err);
    _dir.addScaledVector(_up, (rng() * 2 - 1) * err);
    _dir.normalize();
    _muzzle.copy(_eye).addScaledVector(_dir, 0.5);
    _muzzle.y -= 0.05;
    _end.copy(_muzzle).addScaledVector(_dir, dist + 2);
    let hitPart = null;
    if (bot.targetPlayer) {
      hitPart = rayVsPlayer(_muzzle, _dir, ts);
    } else {
      _ray.set(_muzzle, _dir);
      _ray.far = dist + 3;
      _hits.length = 0;
      for (const m of bot.target.hitMeshes) _hits.push(m);
      const hits = _ray.intersectObjects(_hits, false);
      if (hits.length > 0) {
        hitPart = hits[0].object.userData.part;
        _end.copy(hits[0].point);
      }
    }
    if (hitPart) {
      // Head multiplier is applied by the caller (see header note).
      let amount = def.damage;
      if (hitPart === 'head') amount = def.damage * def.headMult;
      const tc = bot.targetPlayer ? game.player : bot.target.combatant;
      if (tc.damage(amount, hitPart)) handleKill(bot, hitPart === 'head');
    }
    if (game.weapons && game.weapons.fireTracer) {
      game.weapons.fireTracer(_muzzle.clone(), _end.clone());
    }
    game.events.push({ type: 'shot', pos: _muzzle.clone(), team: bot.team });
  }

  function completePlant(bot) {
    bot.hasCharge = false;
    bot.state = 'hold';
    bot.plantT = 0;
    // A bot already channelling when the player plants must not plant twice:
    // the +$300, the 40 s timer and the event all belong to the first plant.
    if (!game.bomb || game.bomb.state !== 'carried') return;
    if (game.bomb && game.bomb.pos) game.bomb.pos.copy(bot.combatant.state.position);
    if (game.rounds && game.rounds.onPlant) game.rounds.onPlant(bot.site);
    game.events.push({ type: 'plant', site: bot.site, bot: bot.name });
  }

  function completeDefuse(bot) {
    bot.state = 'hold';
    bot.defuseT = 0;
    if (game.rounds && game.rounds.onDefuse) game.rounds.onDefuse();
    game.events.push({ type: 'defuse', bot: bot.name });
  }

  // Back to the assigned objective after investigating a sound.
  function resumePost(bot) {
    if (bot.role === 'attack') {
      const w = SITE_WP[bot.site];
      setPath(bot, w.x, w.z);
      bot.goal = 'site';
    } else if (bot.hold) {
      setPath(bot, bot.hold.x, bot.hold.z);
      bot.goal = 'holdPos';
    }
    bot.state = 'advance';
  }

  function syncMesh(bot, dt) {
    const s = bot.combatant.state;
    bot.mesh.position.copy(s.position);
    if (s.alive) {
      bot.mesh.rotation.set(0, s.yaw, 0);
    } else {
      bot.deadT += dt;
      const f = Math.min(1, bot.deadT / 0.4);
      bot.mesh.rotation.x = -f * 1.45;
      bot.mesh.position.y = -f * 0.08;
    }
  }

  function step(dt) {
    const live = game.phase === 'live';
    // Nearest living Vanguard to the planted charge is the defuser.
    let defuser = null;
    if (live && game.bomb && game.bomb.state === 'planted' && game.bomb.pos) {
      let bd = Infinity;
      for (const b of list) {
        if (b.team !== 'vanguard' || !b.combatant.state.alive) continue;
        const d = b.combatant.state.position.distanceToSquared(game.bomb.pos);
        if (d < bd) { bd = d; defuser = b; }
      }
    }
    for (const bot of list) {
      syncMesh(bot, dt);
      if (!live) continue;
      const s = bot.combatant.state;
      if (!s.alive) continue;
      // Damage poll: interrupts plant/defuse, triggers retreat.
      if (s.hp < bot.lastHp) {
        if (bot.state === 'plant') { bot.state = 'hold'; bot.plantT = 0; bot.plantWaitT = 4; }
        else if (bot.state === 'defuse') { bot.state = 'hold'; bot.defuseT = 0; }
      }
      bot.lastHp = s.hp;
      if (bot.plantWaitT > 0) bot.plantWaitT -= dt;
      // Drop a dead target.
      if (bot.target && !bot.target.combatant.state.alive) { bot.target = null; bot.targetPlayer = false; }
      if (bot.targetPlayer && (!game.player || !game.player.state.alive)) { bot.target = null; bot.targetPlayer = false; }
      // Staggered vision scan.
      bot.visionT -= dt;
      if (bot.visionT <= 0) { bot.visionT = VISION_DT; scanVision(bot); }
      // Target lost for a while: go look where it was last seen.
      if ((bot.target || bot.targetPlayer) && game.time - bot.lastSeenT > 1.5) {
        bot.target = null;
        bot.targetPlayer = false;
        if (bot.state === 'engage') {
          setPath(bot, bot.lastSeen.x, bot.lastSeen.z);
          bot.goal = 'investigate';
          bot.state = 'advance';
        }
      }
      // Hurt: fall back toward the own spawn.
      if (s.hp < RETREAT_HP && bot.state !== 'retreat') {
        bot.state = 'retreat';
        bot.goal = 'retreat';
        setPath(bot, bot.spawnPos.x, bot.spawnPos.z);
      }
      // Reaction countdown, then engage. Plant aborts the moment a target
      // is seen, even before the reaction delay is over.
      const hasTarget = bot.target !== null || bot.targetPlayer;
      if (hasTarget && bot.reactT > 0) bot.reactT -= dt;
      if (hasTarget && bot.reactT <= 0 && bot.state !== 'engage' && bot.state !== 'retreat' && bot.state !== 'defuse') {
        if (bot.state === 'plant') bot.plantT = 0;
        bot.state = 'engage';
        bot.burstLeft = 3 + ((rng() * 3) | 0);
        bot.fireT = 0;
        bot.burstPauseT = 0;
      }
      if (hasTarget && bot.state === 'plant') {
        bot.state = 'engage';
        bot.plantT = 0;
        bot.burstLeft = 3 + ((rng() * 3) | 0);
        bot.fireT = 0;
        bot.burstPauseT = 0;
      }
      // Defuser steering: nearest Vanguard walks to the charge.
      if (defuser === bot && bot.state !== 'defuse' && bot.state !== 'engage' && bot.state !== 'retreat') {
        const d = s.position.distanceTo(game.bomb.pos);
        if (d < DEFUSE_RANGE) { bot.state = 'defuse'; bot.defuseT = 0; }
        else if (bot.state !== 'advance' || bot.goal !== 'defuse') {
          setPath(bot, game.bomb.pos.x, game.bomb.pos.z);
          bot.goal = 'defuse';
          bot.state = 'advance';
        }
      } else if (game.bomb && game.bomb.state === 'planted' && bot.team === 'vanguard' && bot !== defuser && bot.state === 'hold') {
        const site = SITE_WP[game.bomb.site];
        if (site && bot.goal !== 'guard') {
          setPath(bot, site.x, site.z);
          bot.goal = 'guard';
          bot.state = 'advance';
        }
      }

      switch (bot.state) {
        case 'spawn': {
          if (bot.role === 'attack') {
            const w = SITE_WP[bot.site];
            setPath(bot, w.x, w.z);
            bot.goal = 'site';
          } else if (bot.hold) {
            setPath(bot, bot.hold.x, bot.hold.z);
            bot.goal = 'holdPos';
          }
          bot.state = 'advance';
          break;
        }
        case 'advance': {
          if (followPath(bot, dt)) {
            if (bot.goal === 'defuse') {
              const d = game.bomb && game.bomb.pos ? s.position.distanceTo(game.bomb.pos) : Infinity;
              if (d < DEFUSE_RANGE) { bot.state = 'defuse'; bot.defuseT = 0; }
              else bot.state = 'hold';
            } else if (bot.goal === 'investigate') {
              bot.state = 'hold';
              bot.resumeT = 2.5;
            } else {
              bot.state = 'hold';
            }
          }
          break;
        }
        case 'hold': {
          bot.combatant.step(dt, MOVE_IDLE);
          // Slow scan of the surroundings while holding.
          s.yaw += Math.sin(game.time * 0.6 + bot.slot * 1.7) * 0.25 * dt;
          if (bot.resumeT > 0) {
            bot.resumeT -= dt;
            if (bot.resumeT <= 0) resumePost(bot);
          } else if (bot.hasCharge && bot.team === 'ember' && !hasTarget && bot.plantWaitT <= 0
            && (!game.bomb || game.bomb.state === 'carried')) {
            bot.state = 'plant';
            bot.plantT = 0;
          }
          break;
        }
        case 'engage': {
          const ts = targetState(bot);
          if (!ts || !ts.alive) { bot.target = null; bot.targetPlayer = false; bot.state = 'hold'; break; }
          faceToward(bot, ts.position.x, ts.position.z, dt);
          bot.combatant.step(dt, MOVE_IDLE); // stop to aim: firing on the move spreads
          if (bot.reactT > 0) break;
          if (bot.burstPauseT > 0) { bot.burstPauseT -= dt; break; }
          if (bot.burstLeft <= 0) { bot.burstLeft = 3 + ((rng() * 3) | 0); break; }
          bot.fireT -= dt;
          if (bot.fireT <= 0) {
            shoot(bot);
            bot.burstLeft -= 1;
            bot.fireT = 60 / defFor(bot).rpm;
            if (bot.burstLeft <= 0) bot.burstPauseT = 0.5 + rng() * 0.7;
          }
          break;
        }
        case 'retreat': {
          if (followPath(bot, dt)) bot.state = 'hold';
          break;
        }
        case 'plant': {
          bot.combatant.step(dt, MOVE_IDLE);
          bot.plantT += dt;
          if (game.bomb) game.bomb.plantT = bot.plantT;
          if (bot.plantT >= PLANT_TIME) completePlant(bot);
          break;
        }
        case 'defuse': {
          bot.combatant.step(dt, MOVE_IDLE);
          bot.defuseT += dt;
          if (game.bomb) game.bomb.defuseT = bot.defuseT;
          if (bot.defuseT >= DEFUSE_TIME) completeDefuse(bot);
          break;
        }
        default: break; // 'dead' is skipped by the alive check above
      }
    }
  }

  function reset() {
    for (const bot of list) {
      const spawn = bot.team === 'ember' ? world.spawns.ember[bot.slot + 1] : world.spawns.vanguard[bot.slot];
      bot.combatant.reset(spawn, bot.team === 'ember' ? 0 : Math.PI);
      bot.spawnPos.copy(spawn);
      bot.state = 'spawn';
      bot.path.length = 0;
      bot.pathI = 0;
      bot.goal = 'site';
      bot.target = null;
      bot.targetPlayer = false;
      bot.reactT = 0;
      bot.burstLeft = 0;
      bot.burstPauseT = 0;
      bot.fireT = 0;
      bot.visionT = rng() * VISION_DT;
      bot.plantT = 0;
      bot.defuseT = 0;
      bot.plantWaitT = 0;
      bot.resumeT = 0;
      bot.lastHp = 100;
      bot.deadT = 0;
      bot.scanD = Infinity;
      bot.hasCharge = false;
      bot.mesh.visible = true;
      bot.mesh.rotation.set(0, 0, 0);
      bot.mesh.position.copy(spawn);
      // Opening orders: attackers route to their site, defenders to hold spots.
      if (bot.role === 'attack') {
        const w = SITE_WP[bot.site];
        setPath(bot, w.x, w.z);
        bot.goal = 'site';
      } else if (bot.hold) {
        setPath(bot, bot.hold.x, bot.hold.z);
        bot.goal = 'holdPos';
      }
      bot.state = 'advance';
    }
    list[0].hasCharge = true; // first Ember bot carries the charge
  }

  function aliveCount(team) {
    let n = 0;
    for (const b of list) if (b.team === team && b.combatant.state.alive) n++;
    return n;
  }

  // Hearing: an enemy gunshot inside 26 m pulls the bot to investigate,
  // unless it is fighting, planting, defusing or retreating.
  function onEvent(ev) {
    if (!ev || ev.type !== 'shot') return;
    for (const bot of list) {
      if (!bot.combatant.state.alive) continue;
      if (ev.team === bot.team) continue;
      if (bot.state === 'engage' || bot.state === 'plant' || bot.state === 'defuse'
        || bot.state === 'retreat' || bot.state === 'dead') continue;
      const s = bot.combatant.state;
      const dx = ev.pos.x - s.position.x;
      const dz = ev.pos.z - s.position.z;
      if (dx * dx + dz * dz > HEAR_RANGE * HEAR_RANGE) continue;
      setPath(bot, ev.pos.x, ev.pos.z);
      bot.goal = 'investigate';
      bot.state = 'advance';
    }
  }

  return { list, step, reset, aliveCount, onEvent, hitMeshes };
}
