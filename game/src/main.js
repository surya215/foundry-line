// Foundry Line boot: renderer, fixed-step loop, shooting, plant/buy, shot mode.
// Wires one `game` object (rng -> world -> input -> player -> weapons -> bots
// -> rounds -> audio -> hud) and drains per-tick events to HUD, audio and bots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createCombatant } from './combatant.js';
import { createInput } from './input.js';
import { createWeaponSet } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { ECONOMY } from './economy.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = (Number.parseInt(params.get('seed') || '1', 10) || 1) >>> 0;
const rng = mulberry32(shotMode ? seed : ((Date.now() % 2147483647) || 1));

// ---- Renderer / scene / camera ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

// ---- One shared game object, passed to every factory ----
const game = {
  scene, camera, renderer, rng,
  world: null, input: null, player: null, weapons: null, bots: null,
  rounds: null, economy: ECONOMY, audio: null, hud: null,
  time: 0, roundTime: 0, events: [], smoke: [],
  score: { ember: 0, vanguard: 0 },
  money: ECONOMY.startMoney,
  phase: 'freeze',
  bomb: { state: 'carried', site: null, pos: new THREE.Vector3(), plantT: 0, defuseT: 0, carrier: 'player' },
  shot: shotMode,
};

game.world = createWorld(scene);
game.audio = createAudio();
game.hud = createHud();
game.input = createInput(renderer.domElement, onLockChange);
game.player = createCombatant(game.world.colliders, {
  spawn: game.world.spawns.ember[2], yaw: 0, team: 'ember',
});
game.weapons = createWeaponSet(camera, game);
game.bots = createBots(scene, game);
game.rounds = createRounds(game);
game.rounds.startMatch();

// Ray targets: world solids + bot hit meshes (built once; both arrays are stable).
const shootables = game.world.shootables.concat(game.bots.hitMeshes);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

// Scratch vectors / state reused in the hot loop — no per-frame allocation.
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _aim = new THREE.Vector3();
const move = { forward: 0, strafe: 0, jump: false, crouch: false };
const prevKeys = new Set();
const spark = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
spark.visible = false;
scene.add(spark);
let sparkUntil = 0;
let lastBeepT = -99;
let buyOpen = false;
let started = false;
let frozen = false;
let spectateTarget = null;
let accumulator = 0;
let lastTime = performance.now();

function label(x) {
  if (x === 'player') return 'You';
  if (typeof x === 'string') return x;
  if (!x) return '?';
  if (x.name) return x.name;
  if (x.combatant) return x.combatant.state.team === 'ember' ? 'Ember' : 'Vanguard';
  return '?';
}

function syncCamera() {
  if (!game.player.state.alive && spectateTarget) {
    const s = spectateTarget.combatant.state;
    camera.position.set(s.position.x, s.position.y + s.eye, s.position.z);
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    return;
  }
  const s = game.player.state;
  camera.position.set(s.position.x, s.position.y + s.eye, s.position.z);
  camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const s = game.player.state;
  const dx = point.x - s.position.x;
  const dy = point.y - (s.position.y + s.eye);
  const dz = point.z - s.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  s.yaw = Math.atan2(-dx, -dz);
  s.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

// One hitscan shot: spread ray vs world + bots, head multiplier applied by
// the caller (combatant.damage only knows head/torso 1x, legs 0.8x).
function shoot() {
  const w = game.weapons;
  const def = w.defs[w.state.current];
  if (!w.takeRound()) {
    game.audio.dryFire();
    return;
  }
  const spread = w.spread(game.player.groundSpeed(), w.state.ads);
  camera.getWorldDirection(_dir);
  _dir.x += (rng() * 2 - 1) * spread;
  _dir.y += (rng() * 2 - 1) * spread;
  _dir.z += (rng() * 2 - 1) * spread;
  _dir.normalize();
  raycaster.set(camera.position, _dir);
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits.length ? hits[0] : null;
  if (hit) {
    _end.copy(hit.point);
    const bot = hit.object.userData.bot;
    if (bot && bot.combatant.state.alive) {
      const part = hit.object.userData.part || 'torso';
      const amount = def.damage * (part === 'head' ? def.headMult : 1);
      const killed = bot.combatant.damage(amount, part);
      game.hud.hitMarker(killed, shotMode ? 4000 : 120);
      game.audio.hit(killed);
      if (killed) {
        // Kill economy: exactly once, here at detection (rounds.js contract).
        game.rounds.onKill('ember');
        game.events.push({ type: 'kill', killer: 'player', victim: bot, weapon: w.state.current, headshot: part === 'head' });
      }
    } else {
      spark.position.copy(hit.point);
      spark.visible = true;
      sparkUntil = game.time + 0.07;
    }
  } else {
    _end.copy(camera.position).addScaledVector(_dir, def.range || 60);
  }
  w.muzzleWorld(_muzzle);
  w.fireTracer(_muzzle, _end);
  w.pullTrigger();
  game.player.recoil(0.011 + rng() * 0.004, (rng() * 2 - 1) * 0.004);
  game.audio.shot(w.state.current);
  game.events.push({ type: 'shot', pos: _pos.copy(game.player.state.position).clone(), team: 'ember', weapon: w.state.current, byPlayer: true });
}

function nearSite(p) {
  for (const id of ['A', 'B']) {
    const s = game.world.sites[id];
    const dx = p.x - s.centre.x;
    const dz = p.z - s.centre.z;
    if (dx * dx + dz * dz < s.radius * s.radius) return id;
  }
  return null;
}

function plant(site) {
  const s = game.world.sites[site];
  game.bomb.state = 'planted';
  game.bomb.site = site;
  game.bomb.pos.copy(s.centre);
  game.bomb.plantT = 0;
  // rounds.onPlant sets the same fields, starts the 40 s timer, pays the
  // plant bonus and pushes the {type:'plant'} event — no duplicate push here.
  game.rounds.onPlant(site);
}

// Drain this tick's events: killfeed + economy, bot hearing, distant shots.
function drainEvents() {
  for (const ev of game.events) {
    if (ev.type === 'kill') {
      game.hud.killfeed(`${label(ev.killer)}  ✕  ${label(ev.victim)}${ev.headshot ? '  · headshot' : ''}`);
      // Kill economy lives with the detector only (W3 contract): shoot() pays
      // player gun kills, bots.js pays bot kills, weapons.explode() pays HE
      // grenade kills. Drain never calls onKill.
    } else if (ev.type === 'shot') {
      game.bots.onEvent(ev);
      if (!ev.byPlayer && ev.pos) {
        _aim.copy(ev.pos).sub(game.player.state.position);
        if (_aim.lengthSq() < 45 * 45) game.audio.shot(ev.weapon || 'vk7');
      }
    } else if (ev.type === 'plant') {
      // Bot plants push two plant events (bots.js + rounds.onPlant): one beep.
      if (game.time - lastBeepT > 0.25) {
        lastBeepT = game.time;
        game.audio.plantBeep();
      }
    } else if (ev.type === 'explode' && ev.site) {
      // Bomb detonation (rounds.js). HE grenades already play their own sound
      // in weapons.js, so their {type:'explode', pos} event stays silent here.
      game.audio.explosion();
    }
  }
  game.events.length = 0;
}

function syncHud() {
  const hud = game.hud;
  const w = game.weapons;
  const st = game.player.state;
  const rs = game.rounds.state;
  hud.setHealth(Math.ceil(st.hp));
  hud.setArmor(Math.round(st.armor));
  hud.setAmmo(w.state.mag, w.state.reserve);
  hud.setMoney(game.money);
  hud.setTimer(game.phase === 'freeze' ? rs.freezeT : game.phase === 'live' ? game.roundTime : 0);
  hud.setScore(game.score.ember, game.score.vanguard);
  hud.setRound(rs.round);
  hud.setWeaponName(w.defs[w.state.current].name);
  hud.setCrosshairSpread(Math.round(w.spread(game.player.groundSpeed(), w.state.ads) * 2400) + 6);
  const b = game.bomb;
  if (b.state === 'planted') {
    // game.roundTime is the bomb countdown (40 s) while planted.
    hud.setBomb(b.defuseT > 0 ? 'defusing' : 'planted', b.defuseT > 0 ? b.defuseT / 5 : Math.max(0, game.roundTime) / 40);
  } else if (b.state === 'carried' && b.plantT > 0) {
    hud.setBomb('planting', b.plantT / 4);
  } else {
    hud.setBomb('none', 0);
  }
}

function step(dt) {
  game.time += dt;
  game.rounds.step(dt);
  game.phase = game.rounds.state.phase;
  // game.roundTime is maintained by rounds.step (freezeT / roundT / bombT /
  // 0 by phase) — do not overwrite it with state.roundT here, or the timer
  // would freeze while the charge is planted (roundT stops then).
  const st = game.player.state;
  const keys = game.input.state.keys;
  if (st.alive && (game.phase === 'live' || game.phase === 'freeze')) {
    move.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    move.strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    move.jump = keys.has('Space');
    move.crouch = keys.has('ControlLeft') || keys.has('KeyC');
    game.player.step(dt, move);
  }
  game.weapons.step(dt);
  game.bots.step(dt);

  // Plant: hold E inside a site while carrying the charge (4 s).
  const b = game.bomb;
  if (game.phase === 'live' && st.alive && b.state === 'carried' &&
      (b.carrier === 'player' || b.carrier == null)) {
    const site = nearSite(st.position);
    if (site && keys.has('KeyE')) {
      b.plantT += dt;
      if (b.plantT >= 4) plant(site);
    } else {
      b.plantT = Math.max(0, b.plantT - dt * 2);
    }
  }

  // Shooting lives in the fixed step, so fire rate is deterministic.
  if (game.phase === 'live' && st.alive && game.input.state.firing &&
      (shotMode || game.input.state.locked) && game.weapons.ready()) {
    shoot();
  }

  // Dead: spectate a living Ember teammate until the round ends.
  if (spectateTarget && !spectateTarget.combatant.state.alive) spectateTarget = null;
  if (!st.alive && game.phase === 'live' && !spectateTarget) {
    spectateTarget = game.bots.list.find(
      (bot) => bot.combatant.state.team === 'ember' && bot.combatant.state.alive,
    ) || null;
  }
  if (game.phase !== 'live') spectateTarget = null;

  drainEvents();
  syncHud();
}

// ---- Buy menu (freeze time only; pointer unlocks while buying) ----
function ownedForBuy() {
  const o = Object.assign({}, game.weapons.state.owned);
  o.armor = game.weapons.state.armor >= 100;
  return o;
}

function closeBuy() {
  buyOpen = false;
  game.hud.hideBuy();
  if (!shotMode) game.input.requestLock();
}

function toggleBuy() {
  if (game.phase !== 'freeze') return;
  if (buyOpen) {
    closeBuy();
    return;
  }
  buyOpen = true;
  game.hud.showBuy(game.money, ownedForBuy());
  if (document.pointerLockElement) document.exitPointerLock();
}

function onLockChange(locked) {
  if (shotMode) return;
  if (locked) {
    started = true;
    game.hud.hideOverlay();
    if (buyOpen) {
      buyOpen = false;
      game.hud.hideBuy();
    }
  } else if (!buyOpen) {
    game.hud.showOverlay(started ? 'paused' : 'start');
  }
}

game.hud.onPlay(() => {
  if (shotMode) return;
  if (game.phase === 'matchEnd') game.rounds.startMatch();
  game.hud.hideOverlay();
  game.input.requestLock();
});
game.hud.onRestart(() => {
  if (shotMode) return;
  game.rounds.startMatch();
  game.hud.hideOverlay();
  game.input.requestLock();
});
game.hud.onBuy((id) => {
  if (game.weapons.buy(id)) {
    game.audio.buy();
    game.hud.showBuy(game.money, ownedForBuy());
    syncHud();
  }
});

// ---- Per-frame edge-triggered keys (reload / grenade / buy / weapon slots) ----
function handleEdges() {
  const keys = game.input.state.keys;
  const pressed = (code) => keys.has(code) && !prevKeys.has(code);
  if (pressed('KeyR')) {
    game.weapons.reload();
    if (game.weapons.state.reloadLeft > 0) game.audio.reload();
  }
  if (pressed('KeyG')) {
    const g = game.weapons.state.grenades;
    if (g.surge > 0) game.weapons.throwGrenade('surge');
    else if (g.veil > 0) game.weapons.throwGrenade('veil');
  }
  if (pressed('KeyB')) toggleBuy();
  const slots = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  const ids = ['p9', 'kestrel', 'vk7', 'longshot'];
  for (let i = 0; i < 4; i++) {
    if (pressed(slots[i])) game.weapons.equip(ids[i]);
  }
  prevKeys.clear();
  keys.forEach((k) => prevKeys.add(k));
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) return;
  const look = game.input.takeLook();
  if (game.player.state.alive) game.player.look(look.x, look.y);
  handleEdges();
  // ADS is Longshot-only (weapons.step sets state.ads): fov 74 -> 55.
  const targetFov = game.weapons.state.ads ? 55 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 16);
    camera.updateProjectionMatrix();
  }
  accumulator += dt;
  let n = 0;
  while (accumulator >= FIXED && n < 5) {
    step(FIXED);
    accumulator -= FIXED;
    n += 1;
  }
  if (accumulator > FIXED * 5) accumulator = 0;
  syncCamera();
  if (spark.visible && game.time > sparkUntil) spark.visible = false;
  renderer.render(scene, camera);
}

// ---- Shot mode: deterministic poses, render twice, freeze, signal ready ----
function settle(steps) {
  for (let i = 0; i < steps; i++) step(FIXED);
}

function poseBot(bot, x, z, yaw) {
  bot.combatant.state.alive = true;
  bot.combatant.state.hp = 100;
  bot.combatant.state.position.set(x, 0, z);
  bot.combatant.state.yaw = yaw;
  // A bot that died during settle is 'dead' with a fallen mesh (rotation.x):
  // revive the AI state too, or the pose stays lying down.
  bot.state = 'hold';
  bot.deadT = 0;
  if (bot.mesh) {
    bot.mesh.position.set(x, 0, z);
    bot.mesh.rotation.set(0, yaw, 0);
  }
}

function teamBots(team) {
  return game.bots.list.filter((b) => b.combatant.state.team === team);
}

function posePlayer(x, z, yaw) {
  game.player.state.alive = true;
  game.player.state.hp = 100;
  spectateTarget = null;
  game.player.state.position.set(x, 0, z);
  game.player.state.yaw = yaw;
  game.player.state.pitch = 0;
}

function runShot(name) {
  game.hud.hideOverlay();
  const ember = teamBots('ember');
  const vang = teamBots('vanguard');
  if (name === 'buy') {
    settle(20);
    posePlayer(0, 15, 0);
    if (ember[0]) poseBot(ember[0], -3, 12, 0);
    if (ember[1]) poseBot(ember[1], 3, 12, 0);
    aimAt(new THREE.Vector3(0, 1.2, 0));
    syncHud();
    game.hud.showBuy(game.money, ownedForBuy());
  } else {
    settle(540); // freeze (8 s) ends, bots advance into the lanes
    if (name === 'start' || name === 'end') {
      // Past the T-exit wall (z=11) so the cover boxes no longer fill the
      // lower frame: player at midS, teammates flanking down mid, one
      // Vanguard visible ahead. Furnace mouth stays centred.
      posePlayer(0, 10, 0);
      if (ember[0]) poseBot(ember[0], -5, 4, 0);
      if (ember[1]) poseBot(ember[1], 5, 5, 0);
      if (vang[0]) poseBot(vang[0], 5, 0, Math.PI);
      aimAt(new THREE.Vector3(0, 1.0, -0.4));
      syncHud();
      if (name === 'end') {
        game.score.ember = 1;
        game.hud.setScore(1, 0);
        game.hud.showBanner('ROUND WON', 'Site A secured — charge detonated', 60000);
      }
    } else if (name === 'play') {
      // East mid-lane sightline (x 4.5 clears the furnace block and its
      // pillar by 2.5 m): VK-7 at a Vanguard chest, furnace glow at left.
      game.weapons.state.owned.vk7 = true;
      game.weapons.equip('vk7');
      game.weapons.refill();
      posePlayer(4.5, 3, 0);
      if (vang[0]) poseBot(vang[0], 4.5, -8, Math.PI);
      if (ember[0]) poseBot(ember[0], -3, 8, 0);
      _aim.set(4.5, 1.25, -8);
      aimAt(_aim);
      syncHud();
      shoot();
      // Flash lasts 0.06 s, tracer 0.07 s: 4 fixed steps (0.067 s) expire
      // the flash plane (it would otherwise freeze dead-centre in the
      // screenshot) while the tracer is still alive for the capture.
      settle(4);
    }
  }
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    } else {
      requestAnimationFrame(paint);
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Boot ----
syncCamera();
syncHud();
if (shotMode) runShot(shotMode);
else {
  game.hud.showOverlay('start');
  requestAnimationFrame(frame);
}
