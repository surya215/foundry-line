// Foundry-9: 46 x 38 m foundry at dusk. Y-up, metres; X east (+), Z south (+).
// Ember (T) spawn south (z ~ +15), Vanguard (CT) spawn north (z ~ -15).
// Site A north-west (-16,-12), Site B north-east (16,-12), mid lane x ~ 0 with
// the furnace block at (0,-2), A-long west (x ~ -14), B lane east (x ~ +14),
// connectors at z ~ -4. All geometry is BoxGeometry + MeshStandardMaterial
// from PALETTE; no textures, no external files. Every solid box is both an
// AABB collider and a shootable mesh (floor: shootable only, y = 0 plane).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph. Nodes are open floor (checked against every collider when
// the layout was drawn up); edges are straight, unobstructed walks.
const WP = [
  // id, x, z, links
  ['tSpawnC', 0, 15, ['midS', 'tW', 'tE']],
  ['tSpawnW', -8, 15, ['tW', 'aLongS']],
  ['tSpawnE', 8, 15, ['tE', 'bLaneS']],
  ['tW', -8, 9, ['tSpawnC', 'tSpawnW', 'midS', 'aLongS']],
  ['tE', 8, 9, ['tSpawnC', 'tSpawnE', 'midS', 'bLaneS']],
  ['midS', 0, 9, ['tSpawnC', 'tW', 'tE', 'midC']],
  ['midC', 0, 5, ['midS', 'midW', 'midE']],
  ['midW', -5, -2, ['midC', 'midN', 'connA']],
  ['midE', 5, -2, ['midC', 'midN', 'connB']],
  ['midN', 0, -7, ['midW', 'midE', 'ctMid', 'aLongN', 'bLaneN', 'connA', 'connB']],
  ['aLongS', -14, 10, ['tSpawnW', 'tW', 'aLongM']],
  ['aLongM', -14, 2, ['aLongS', 'aLongN']],
  ['aLongN', -14, -8, ['aLongM', 'siteA', 'connA', 'midN']],
  ['bLaneS', 14, 10, ['tSpawnE', 'tE', 'bLaneM']],
  ['bLaneM', 14, 2, ['bLaneS', 'bLaneN']],
  ['bLaneN', 14, -8, ['bLaneM', 'siteB', 'connB', 'midN']],
  ['connA', -8, -4, ['midW', 'midN', 'aLongN']],
  ['connB', 8, -4, ['midE', 'midN', 'bLaneN']],
  ['siteA', -12, -12, ['aLongN', 'ctA']],
  ['siteB', 12, -12, ['bLaneN', 'ctB']],
  ['ctSpawnC', 0, -15, ['ctMid', 'ctSpawnW', 'ctSpawnE']],
  ['ctSpawnW', -8, -15, ['ctSpawnC', 'ctA']],
  ['ctSpawnE', 8, -15, ['ctSpawnC', 'ctB']],
  ['ctA', -10, -15.5, ['ctSpawnW', 'siteA', 'ctMid']],
  ['ctB', 10, -15.5, ['ctSpawnE', 'siteB', 'ctMid']],
  ['ctMid', 0, -10, ['midN', 'ctSpawnC', 'ctA', 'ctB']],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // One shared material per palette colour; furnace glow gets its own
  // emissive material (built from the same accent, not a new colour).
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ember' ? 0.55 : 0.9,
      metalness: name === 'surface' ? 0.25 : 0.08,
    });
  }
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.canvas),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 2.4,
    roughness: 0.6,
    metalness: 0,
  });

  const colliders = [];
  const shootables = [];

  // Solid box: collider + shootable. All boxes are axis-aligned, so the
  // Box3 is exact from centre + half-size (no setFromObject needed).
  // y is the CENTRE height; every solid box sits on the floor (min.y = 0).
  function box(w, h, d, x, y, z, mat, opts) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.solid = true;
    group.add(mesh);
    if (!opts || !opts.noCollider) {
      colliders.push(new THREE.Box3(
        new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
        new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
      ));
    }
    shootables.push(mesh);
    return mesh;
  }

  // Decor: visible but flush with a solid face, so no collider of its own.
  function decor(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  // ---- Floor (shootable only; the y = 0 plane is handled by combatants) ----
  const floor = new THREE.Mesh(new THREE.BoxGeometry(46.4, 0.4, 38.4), materials.canvas);
  floor.position.set(0, -0.2, 0);
  floor.receiveShadow = true;
  floor.userData.solid = true;
  group.add(floor);
  shootables.push(floor);

  // ---- Perimeter walls, 4.6 m high ----
  box(0.4, 4.6, 38.4, -23.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 38.4, 23.2, 2.3, 0, 'surface');
  box(46.4, 4.6, 0.4, 0, 2.3, -19.2, 'surface');
  box(46.4, 4.6, 0.4, 0, 2.3, 19.2, 'surface');

  // ---- Furnace block at (0,-2): body + chimney, glowing mouth to the south ----
  box(4.0, 3.2, 3.0, 0, 1.6, -2, 'hairline');
  box(1.2, 1.4, 1.2, 0, 3.9, -2, 'surface');
  decor(2.2, 1.0, 0.15, 0, 1.0, -0.42, glowMat); // mouth, faces mid / T
  decor(3.0, 0.18, 0.1, 0, 2.9, -0.46, glowMat); // heat strip above mouth
  // Pillars flanking the furnace split mid into two gaps.
  box(1.2, 3.2, 1.2, -3.4, 1.6, -2, 'surface');
  box(1.2, 3.2, 1.2, 3.4, 1.6, -2, 'surface');

  // ---- Mid lane crates (1.1 m = crouch cover), staggered ----
  box(1.2, 1.1, 1.2, 2.4, 0.55, 5.5, 'hairline');
  box(1.2, 1.1, 1.2, -2.4, 0.55, 3.0, 'hairline');
  box(1.2, 1.1, 1.2, 2.2, 0.55, -7.5, 'hairline');
  box(1.2, 1.1, 1.2, -2.2, 0.55, -7.5, 'hairline');
  // Low wall shielding the T exit of mid.
  box(5.0, 1.1, 0.6, 0, 0.55, 11, 'hairline');

  // ---- A-long (west) and B lane (east) ----
  box(1.2, 1.1, 1.2, -14, 0.55, 8, 'hairline');
  box(0.4, 3.2, 4.0, -17.5, 1.6, 2, 'surface');
  box(1.2, 1.1, 1.2, -12.5, 0.55, -2, 'hairline');
  box(1.2, 1.1, 1.2, 14, 0.55, 8, 'hairline');
  box(0.4, 3.2, 4.0, 17.5, 1.6, 2, 'surface');
  box(1.2, 1.1, 1.2, 12.5, 0.55, -2, 'hairline');

  // ---- Connectors at z ~ -4: two walls each form a corridor mid <-> site.
  // West wall ends at x = -6, leaving a 2 m gap past the furnace pillar.
  box(6.0, 3.2, 0.4, -9, 1.6, -6.8, 'surface');
  box(6.0, 3.2, 0.4, -9, 1.6, -1.2, 'surface');
  box(6.0, 3.2, 0.4, 9, 1.6, -6.8, 'surface');
  box(6.0, 3.2, 0.4, 9, 1.6, -1.2, 'surface');

  // ---- Site A (west) / Site B (east): 0.9 m platform (jump-on), container,
  // crates, entrance pillar. Plant zones are the open floor beside the platform.
  box(6.0, 0.9, 5.0, -16, 0.45, -12, 'surface');
  box(3.6, 2.4, 2.0, -19.5, 1.2, -16.5, 'hairline');
  box(1.2, 1.1, 1.2, -12.5, 0.55, -14, 'hairline');
  box(1.2, 1.1, 1.2, -12.5, 0.55, -10, 'hairline');
  box(1.2, 3.2, 1.2, -16, 1.6, -7.5, 'surface');
  box(6.0, 0.9, 5.0, 16, 0.45, -12, 'surface');
  box(3.6, 2.4, 2.0, 19.5, 1.2, -16.5, 'hairline');
  box(1.2, 1.1, 1.2, 12.5, 0.55, -14, 'hairline');
  box(1.2, 1.1, 1.2, 12.5, 0.55, -10, 'hairline');
  box(1.2, 3.2, 1.2, 16, 1.6, -7.5, 'surface');

  // ---- CT (north) and T (south) spawn cover ----
  box(1.2, 1.1, 1.2, -6, 0.55, -16, 'hairline');
  box(1.2, 1.1, 1.2, 6, 0.55, -16, 'hairline');
  box(1.2, 3.2, 1.2, 0, 1.6, -17, 'surface');
  box(1.2, 1.1, 1.2, -4, 0.55, 12, 'hairline');
  box(1.2, 1.1, 1.2, 4, 0.55, 12, 'hairline');
  box(5.0, 1.1, 0.6, -9, 0.55, 13, 'hairline');
  box(5.0, 1.1, 0.6, 9, 0.55, 13, 'hairline');

  // ---- Lighting: dusk. Cool sky/ground fill, warm low key sun, furnace glow ----
  scene.background = new THREE.Color(PALETTE.canvas);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);

  const sky = new THREE.HemisphereLight(
    new THREE.Color(PALETTE.ink), new THREE.Color(PALETTE.canvas), 0.9);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 2.0);
  key.position.set(14, 18, 12);
  key.target.position.set(0, 0, -3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.75);
  fill.position.set(-10, 9, -12);
  scene.add(fill);

  // Warm point lights: furnace mouth, one over each site.
  function warmLight(x, y, z, color, intensity, distance) {
    const light = new THREE.PointLight(new THREE.Color(color), intensity, distance, 2);
    light.position.set(x, y, z);
    scene.add(light);
    return light;
  }
  warmLight(0, 2.0, -0.2, PALETTE.accent, 30, 18);
  warmLight(-16, 3.5, -12, PALETTE.ember, 12, 14);
  warmLight(16, 3.5, -12, PALETTE.ember, 12, 14);

  // ---- Spawns (y = 0), sites, waypoints ----
  const spawns = {
    ember: [
      new THREE.Vector3(-8, 0, 15), new THREE.Vector3(-4, 0, 16),
      new THREE.Vector3(0, 0, 15), new THREE.Vector3(4, 0, 16),
      new THREE.Vector3(8, 0, 15),
    ],
    vanguard: [
      new THREE.Vector3(-8, 0, -15), new THREE.Vector3(-4, 0, -16),
      new THREE.Vector3(0, 0, -15), new THREE.Vector3(4, 0, -16),
      new THREE.Vector3(8, 0, -15),
    ],
  };

  const sites = {
    A: {
      centre: new THREE.Vector3(-16, 0, -12), radius: 4.5,
      box: new THREE.Box3(
        new THREE.Vector3(-20.5, 0, -16.5), new THREE.Vector3(-11.5, 3, -7.5)),
    },
    B: {
      centre: new THREE.Vector3(16, 0, -12), radius: 4.5,
      box: new THREE.Box3(
        new THREE.Vector3(11.5, 0, -16.5), new THREE.Vector3(20.5, 3, -7.5)),
    },
  };

  // Waypoint graph: index-based BFS over scratch arrays, no per-call
  // allocation except the returned path array (shared — copy to keep it).
  const nodes = WP.map(([id, x, z]) => ({ id, x, z }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const links = WP.map(([, , , ls]) => ls);
  const n = nodes.length;
  const bfsQueue = new Int32Array(n);
  const bfsPrev = new Int32Array(n);
  const bfsSeen = new Uint8Array(n);
  const pathOut = [];
  const pathRev = new Int32Array(n);

  const waypoints = {
    nodes,
    byId,
    neighbours(id) {
      return links[indexOf.get(id)];
    },
    nearest(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = nodes[i].x - x;
        const dz = nodes[i].z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      return nodes[best].id;
    },
    path(fromId, toId) {
      // BFS; pathOut is reused across calls — copy it if you hold it.
      pathOut.length = 0;
      const from = indexOf.get(fromId);
      const to = indexOf.get(toId);
      if (from === undefined || to === undefined) return pathOut;
      if (from === to) { pathOut.push(nodes[from].id); return pathOut; }
      bfsSeen.fill(0);
      bfsPrev.fill(-1);
      let head = 0;
      let tail = 0;
      bfsQueue[tail++] = from;
      bfsSeen[from] = 1;
      while (head < tail) {
        const cur = bfsQueue[head++];
        if (cur === to) break;
        for (const id of links[cur]) {
          const nxt = indexOf.get(id);
          if (!bfsSeen[nxt]) {
            bfsSeen[nxt] = 1;
            bfsPrev[nxt] = cur;
            bfsQueue[tail++] = nxt;
          }
        }
      }
      if (!bfsSeen[to]) return pathOut; // unreachable: empty path
      let revLen = 0;
      for (let c = to; c !== -1; c = bfsPrev[c]) pathRev[revLen++] = c;
      for (let i = revLen - 1; i >= 0; i--) pathOut.push(nodes[pathRev[i]].id);
      return pathOut;
    },
  };

  return {
    group, colliders, shootables, spawns, sites, waypoints,
    // losClear scratch state (owned by the world, reused per call).
    _losRay: new THREE.Raycaster(),
    _losDir: new THREE.Vector3(),
    _losDelta: new THREE.Vector3(),
  };
}

// True if segment a -> b hits no shootable. Shared Raycaster + scratch
// vectors on the world: zero allocation per call. A hit exactly at b (the
// target itself) does not block.
export function losClear(world, a, b) {
  const delta = world._losDelta.subVectors(b, a);
  const dist = delta.length();
  if (dist < 1e-6) return true;
  world._losDir.copy(delta).multiplyScalar(1 / dist);
  const ray = world._losRay;
  ray.set(a, world._losDir);
  ray.far = dist;
  const hits = ray.intersectObjects(world.shootables, false);
  return hits.length === 0 || hits[0].distance > dist - 0.01;
}
