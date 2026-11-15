// Fisika bersama player dan bot: akselerasi, friksi, gravitasi, lompat, crouch,
// dan tabrakan AABB satu sumbu demi satu sumbu. Tanpa rendering, tanpa alokasi
// per step (probe dan wish dipakai ulang). Ditulis dari nol.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const WALK = 5.2;
export const CROUCH = 2.4;
export const GROUND_ACCEL = 42;
export const AIR_ACCEL = 9;
export const FRICTION = 9;
export const GRAVITY = 20;
export const JUMP = 6.2;
const STAND_H = 1.72;
const STAND_EYE = 1.6;
const CROUCH_H = 1.12;
const CROUCH_EYE = 1.02;
const SENS = 0.0022;
const PITCH_MAX = 1.45;

export function createCombatant(colliders, opts) {
  const o = opts || {};
  const spawn = o.spawn || new THREE.Vector3(0, 0, 0);
  const state = {
    position: spawn.clone(),
    velocity: new THREE.Vector3(),
    yaw: o.yaw || 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_H,
    crouching: false,
    onGround: true,
    hp: 100,
    armor: 0,
    alive: true,
    team: o.team || 'ember',
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // lift mengangkat kaki dan ubun-ubun keluar dari tes horizontal, supaya berdiri
  // di lantai tidak terbaca sebagai menabrak dinding.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i++) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function look(dx, dy) {
    state.yaw -= dx * SENS;
    state.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, state.pitch - dy * SENS));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(PITCH_MAX, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, move) {
    if (!state.alive) return;
    const m = move || {};
    // Crouch: berdiri lagi hanya kalau ada ruang di atas kepala.
    const wantCrouch = !!m.crouch;
    if (wantCrouch && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_H;
    } else if (!wantCrouch && state.crouching &&
      !overlaps(state.position.x, state.position.y, state.position.z, STAND_H, 0.02)) {
      state.crouching = false;
      state.height = STAND_H;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    // Arah gerak relatif terhadap yaw (forward = -Z saat yaw 0).
    const fwd = m.forward || 0;
    const str = m.strafe || 0;
    wish.set(0, 0, 0);
    if (fwd || str) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * fwd + cos * str, 0, -cos * fwd - sin * str).normalize();
    }
    const speed = state.crouching ? CROUCH : WALK;
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (m.jump && state.onGround) {
      state.velocity.y = JUMP;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;

    // Resolve per sumbu: X, lalu Z, lalu Y (lantai / langit-langit).
    const nx = state.position.x + state.velocity.x * dt;
    if (!overlaps(nx, state.position.y, state.position.z, state.height, 0.04)) state.position.x = nx;
    else state.velocity.x = 0;
    const nz = state.position.z + state.velocity.z * dt;
    if (!overlaps(state.position.x, state.position.y, nz, state.height, 0.04)) state.position.z = nz;
    else state.velocity.z = 0;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = overlaps(state.position.x, state.position.y, state.position.z, state.height, 0);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y; // mendarat di atas box (platform / crate)
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height; // kepala mentok bawah box
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.velocity.y = Math.max(-30, state.velocity.y);
  }

  // amount = damage dasar (headMult senjata sudah diterapkan pemanggil).
  // Armor menyerap setengah damage sampai habis; kaki 0.8x, kepala/badan 1x.
  function damage(amount, part) {
    if (!state.alive) return false;
    let dmg = amount * (part === 'legs' ? 0.8 : 1);
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, dmg * 0.5);
      state.armor -= absorbed;
      dmg -= absorbed;
    }
    state.hp -= dmg;
    if (state.hp <= 0) {
      state.hp = 0;
      state.alive = false;
      return true;
    }
    return false;
  }

  function reset(spawnPos, yaw) {
    state.position.copy(spawnPos);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw || 0;
    state.pitch = 0;
    state.eye = STAND_EYE;
    state.height = STAND_H;
    state.crouching = false;
    state.onGround = true;
    state.hp = 100;
    state.alive = true;
  }

  return {
    state,
    step,
    look,
    recoil,
    damage,
    reset,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
