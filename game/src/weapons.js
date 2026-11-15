// Senjata hitscan: defs, view model, recoil/bloom, reload, granat, dan tracer.
// Main.js yang menembakkan ray dan menghitung damage; modul ini memegang angka,
// animasi, dan efek. Ditulis dari nol; tanpa alokasi per tembakan di hot loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const defs = {
  p9: { name: 'P9 Sidearm', price: 300, auto: false, rpm: 320, mag: 12, reserve: 36, damage: 28, headMult: 2, spreadStill: 0.003, spreadMove: 0.02, reload: 1.2, range: 40 },
  kestrel: { name: 'Kestrel-9', price: 1500, auto: true, rpm: 750, mag: 30, reserve: 90, damage: 22, headMult: 2, spreadStill: 0.004, spreadMove: 0.03, reload: 1.8, range: 28 },
  vk7: { name: 'VK-7 Repeater', price: 2700, auto: true, rpm: 600, mag: 30, reserve: 90, damage: 34, headMult: 4, spreadStill: 0.0022, spreadMove: 0.028, reload: 1.9, range: 60 },
  longshot: { name: 'Longshot .50', price: 4750, auto: false, rpm: 55, mag: 5, reserve: 15, damage: 110, headMult: 4, spreadStill: 0.001, spreadMove: 0.05, reload: 2.8, range: 90, ads: true },
  surge: { name: 'Surge HE', price: 300, kind: 'grenade' },
  veil: { name: 'Veil Smoke', price: 300, kind: 'grenade' },
};

const MUZZLE_TIME = 0.06;
const BLOOM_SHOT = 0.004;
const BLOOM_MAX = 0.05;
const HE_RADIUS = 6;
const HE_MAX = 110;
const SMOKE_RADIUS = 5;
const SMOKE_TIME = 18;
const FUSE = 2;
const TRACERS = 8;

// Posisi view model (relatif kamera): hip dan ADS (tengah, untuk Longshot).
const HIP = { x: 0.24, y: -0.2, z: -0.42 };
const ADS_POS = { x: 0, y: -0.148, z: -0.34 };

export function createWeaponSet(camera, game) {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const amber = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.4 });

  function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }

  // Siluet berbeda per senjata, semua dari kotak.
  function buildModel(id) {
    const g = new THREE.Group();
    if (id === 'p9') {
      box(0.07, 0.09, 0.26, metal, 0, 0, -0.05, g); // receiver pendek
      box(0.04, 0.04, 0.12, dark, 0, 0.01, -0.22, g); // laras pendek
      box(0.06, 0.12, 0.07, dark, 0, -0.09, 0.06, g); // grip
    } else if (id === 'kestrel') {
      box(0.09, 0.1, 0.34, metal, 0, 0, -0.02, g);
      box(0.045, 0.045, 0.3, dark, 0, 0.025, -0.3, g); // laras SMG
      box(0.05, 0.16, 0.06, dark, 0, -0.12, -0.05, g); // mag vertikal
      box(0.07, 0.07, 0.14, dark, 0, -0.01, 0.2, g); // stock pendek
    } else if (id === 'vk7') {
      box(0.09, 0.1, 0.42, metal, 0, 0, -0.05, g); // receiver panjang
      box(0.045, 0.045, 0.4, dark, 0, 0.025, -0.42, g); // laras panjang
      box(0.05, 0.1, 0.16, amber, 0, 0.07, -0.12, g); // sight amber
      box(0.075, 0.08, 0.22, dark, 0, -0.02, 0.28, g); // stock
      box(0.05, 0.14, 0.06, dark, 0, -0.11, 0.02, g); // grip + mag
    } else { // longshot: laras sangat panjang + scope
      box(0.09, 0.11, 0.5, metal, 0, 0, -0.1, g);
      box(0.04, 0.04, 0.62, dark, 0, 0.03, -0.62, g);
      box(0.06, 0.06, 0.3, dark, 0, 0.09, -0.15, g); // scope
      box(0.05, 0.05, 0.1, amber, 0, 0.09, -0.32, g); // lensa depan
      box(0.075, 0.08, 0.24, dark, 0, -0.02, 0.32, g); // stock
      box(0.05, 0.16, 0.06, dark, 0, -0.12, 0.05, g); // mag
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, id === 'p9' ? -0.3 : id === 'kestrel' ? -0.48 : id === 'vk7' ? -0.66 : -0.96);
    g.add(muzzle);
    g.visible = false;
    camera.add(g);
    return { group: g, muzzle };
  }

  const models = { p9: buildModel('p9'), kestrel: buildModel('kestrel'), vk7: buildModel('vk7'), longshot: buildModel('longshot') };

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  camera.add(flashLight);

  // Pool tracer: 8 mesh dipakai ulang, tanpa alokasi per tembakan.
  const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i++) {
    const t = new THREE.Mesh(tracerGeo, tracerMat);
    t.visible = false;
    game.scene.add(t);
    tracers.push({ mesh: t, life: 0 });
  }
  let tracerI = 0;

  // Granat: mesh + material dipakai bersama; entitas dilempar masuk ke `thrown`.
  const nadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const nadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.5 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.vanguard), roughness: 0.6, metalness: 0.5 });
  const thrown = [];
  const probe = new THREE.Box3();
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();

  // Amunisi per senjata, dipertahankan saat ganti senjata.
  const ammo = {};
  for (const id of ['p9', 'kestrel', 'vk7', 'longshot']) {
    ammo[id] = { mag: defs[id].mag, reserve: defs[id].reserve };
  }

  const state = {
    current: 'p9', mag: defs.p9.mag, reserve: defs.p9.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloom: 0, ads: false,
    owned: { p9: true }, grenades: { surge: 0, veil: 0 }, armor: 0,
  };
  models.p9.group.visible = true;

  function updateViewModel() {
    for (const id in models) models[id].group.visible = id === state.current;
    state.kick = 0;
  }

  function equip(name) {
    if (!state.owned[name] || !defs[name] || defs[name].kind === 'grenade') return false;
    if (name === state.current) return true;
    ammo[state.current] = { mag: state.mag, reserve: state.reserve };
    state.current = name;
    state.mag = ammo[name].mag;
    state.reserve = ammo[name].reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.bloom = 0;
    updateViewModel();
    return true;
  }

  function ready() {
    return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
  }

  function pullTrigger() {
    const d = defs[state.current];
    state.cooldown = 60 / d.rpm;
    state.flash = MUZZLE_TIME;
    state.kick = state.current === 'longshot' ? 0.11 : state.current === 'p9' ? 0.04 : 0.055;
    state.bloom = Math.min(BLOOM_MAX, state.bloom + BLOOM_SHOT);
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    return true;
  }

  function reload() {
    const d = defs[state.current];
    if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return;
    state.reloadLeft = d.reload;
  }

  // Spread: diam + gerak + bloom; ADS Longshot memangkas jadi 35%.
  function spread(speed, ads) {
    const d = defs[state.current];
    const s = d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove + state.bloom;
    return ads ? s * 0.35 : s;
  }

  function buy(name) {
    const d = defs[name];
    if (!d) return false;
    if (name === 'armor') {
      if (state.armor >= 100 || game.money < 650) return false;
      game.money -= 650;
      state.armor = 100;
      if (game.player) game.player.state.armor = 100;
      return true;
    }
    if (game.money < d.price) return false;
    if (d.kind === 'grenade') {
      game.money -= d.price;
      state.grenades[name] += 1;
      return true;
    }
    if (state.owned[name]) return false; // sudah punya; beli ulang tidak isi ulang
    game.money -= d.price;
    state.owned[name] = true;
    ammo[name] = { mag: d.mag, reserve: d.reserve };
    equip(name);
    return true;
  }

  // Posisi ujung laras di dunia, ditulis ke `out` (tanpa alokasi).
  function muzzleWorld(out) {
    const m = models[state.current].muzzle;
    return m.getWorldPosition(out);
  }

  function fireTracer(from, to) {
    const t = tracers[tracerI];
    tracerI = (tracerI + 1) % TRACERS;
    tmpA.copy(to).sub(from);
    const len = tmpA.length();
    if (len < 0.05) return;
    t.mesh.position.copy(from).addScaledVector(tmpA, 0.5);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = 0.07;
  }

  function throwGrenade(kind) {
    if (state.grenades[kind] <= 0 || !game.player) return false;
    state.grenades[kind] -= 1;
    const mesh = new THREE.Mesh(nadeGeo, kind === 'veil' ? smokeMat : nadeMat);
    mesh.position.copy(muzzleWorld(tmpA));
    game.scene.add(mesh);
    // Arah pandang kamera + sedikit ke atas, plus kecepatan gerak pelempar.
    // Satu alokasi Vector3 per lemparan (bukan per frame) — vel milik granat ini.
    const vel = new THREE.Vector3();
    game.camera.getWorldDirection(vel);
    vel.multiplyScalar(14);
    vel.y += 3.5;
    vel.add(game.player.state.velocity);
    thrown.push({ mesh, vel, fuse: FUSE, kind, radius: 0.09 });
    if (game.audio) game.audio.bounce();
    return true;
  }

  function nadeOverlaps(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (let i = 0; i < game.world.colliders.length; i++) {
      if (probe.intersectsBox(game.world.colliders[i])) return game.world.colliders[i];
    }
    return null;
  }

  function explode(g) {
    const pos = g.mesh.position;
    if (g.kind === 'veil') {
      if (!game.smoke) game.smoke = [];
      game.smoke.push({ pos: pos.clone(), radius: SMOKE_RADIUS, until: game.time + SMOKE_TIME });
      return;
    }
    // HE: damage jatuh dengan jarak, radius 6 m. Kepala/badan sama; kaki 0.8x.
    const victims = [];
    if (game.player && game.player.state.alive) victims.push({ c: game.player, who: 'player' });
    if (game.bots) {
      for (const b of game.bots.list) {
        if (b.combatant.state.alive) victims.push({ c: b.combatant, who: b });
      }
    }
    for (const v of victims) {
      tmpB.copy(v.c.state.position);
      tmpB.y += v.c.state.eye;
      const d = tmpB.distanceTo(pos);
      if (d > HE_RADIUS) continue;
      const dmg = Math.max(15, HE_MAX * (1 - d / HE_RADIUS));
      const killed = v.c.damage(dmg, 'torso');
      if (killed) {
        // Grenade kills are detected here, so the $300 pays here too:
        // main.js drain never calls onKill (W3 contract), exactly once.
        if (v.who !== 'player' && game.rounds && game.rounds.onKill) game.rounds.onKill('ember');
        if (game.events) game.events.push({ type: 'kill', killer: 'player', victim: v.who, weapon: 'surge', headshot: false });
      }
    }
    if (game.audio) game.audio.explosion();
    if (game.events) game.events.push({ type: 'explode', pos: pos.clone() });
  }

  function stepGrenades(dt) {
    for (let i = thrown.length - 1; i >= 0; i--) {
      const g = thrown[i];
      g.vel.y -= 20 * dt;
      // Gerak per sumbu; pantul saat menabrak collider atau lantai.
      const p = g.mesh.position;
      const nx = p.x + g.vel.x * dt;
      if (!nadeOverlaps(nx, p.y, p.z)) p.x = nx;
      else g.vel.x *= -0.45;
      const nz = p.z + g.vel.z * dt;
      if (!nadeOverlaps(p.x, p.y, nz)) p.z = nz;
      else g.vel.z *= -0.45;
      const ny = p.y + g.vel.y * dt;
      if (ny > g.radius && !nadeOverlaps(p.x, ny, p.z)) p.y = ny;
      else {
        if (ny <= g.radius) { p.y = g.radius; g.vel.y *= -0.45; }
        else g.vel.y *= -0.45;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      g.fuse -= dt;
      if (g.fuse <= 0) {
        explode(g);
        game.scene.remove(g.mesh);
        thrown.splice(i, 1);
      }
    }
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.03);
    // ADS hanya untuk Longshot, saat klik kanan dan tidak reload.
    state.ads = !!(game.input && game.input.state.altFiring && state.current === 'longshot' && state.reloadLeft === 0);

    const model = models[state.current].group;
    const d = defs[state.current];
    // Posisi view model: geser ke tengah saat ADS.
    const tx = state.ads ? ADS_POS.x : HIP.x;
    const ty = state.ads ? ADS_POS.y : HIP.y;
    const tz = state.ads ? ADS_POS.z : HIP.z;
    model.position.x += (tx - model.position.x) * Math.min(1, dt * 14);
    model.position.y += (ty - model.position.y) * Math.min(1, dt * 14);
    model.position.z = tz + state.kick;
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const prog = 1 - state.reloadLeft / d.reload; // 0..1
      model.rotation.x = -0.55 * Math.sin(prog * Math.PI);
      model.position.y -= 0.08 * Math.sin(prog * Math.PI);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    // Muzzle flash mengikuti ujung laras senjata aktif.
    muzzleWorld(tmpC);
    flash.position.copy(camera.worldToLocal(tmpC));
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 30;
    flashLight.position.copy(flash.position);
    flashLight.intensity = state.flash > 0 ? 18 : 0;

    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    stepGrenades(dt);
  }

  return {
    defs,
    state,
    grenades: thrown, // entitas granat aktif (state.grenades = jumlah di tangan)
    equip,
    step,
    ready,
    pullTrigger,
    takeRound,
    reload,
    spread,
    buy,
    throwGrenade,
    updateViewModel,
    fireTracer,
    muzzleWorld,
    refill() {
      for (const id in ammo) {
        ammo[id] = { mag: defs[id].mag, reserve: defs[id].reserve };
      }
      state.mag = ammo[state.current].mag;
      state.reserve = ammo[state.current].reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
