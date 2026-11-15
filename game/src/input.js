// Input mentah: keyboard, mouse, dan pointer lock. Main.js yang menafsirkan keys.
// Ditulis dari nol; pola umum (Set keys, movementX/Y) mengikuti API browser standar.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, altFiring: false, lookX: 0, lookY: 0 };

  function setKey(e, down) {
    if (down) keys.add(e.code);
    else keys.delete(e.code);
    if (e.code === 'Space') e.preventDefault(); // halaman tidak ikut scroll
  }

  window.addEventListener('keydown', (e) => setKey(e, true));
  window.addEventListener('keyup', (e) => setKey(e, false));
  window.addEventListener('blur', () => { keys.clear(); state.firing = false; state.altFiring = false; });
  window.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookX += e.movementX;
    state.lookY += e.movementY;
  });
  window.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.altFiring = true; // klik kanan = ADS
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.altFiring = false;
  });
  // Menu konteks kanan dimatikan agar ADS tidak memunculkan menu browser.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
      state.altFiring = false;
    }
    if (onLockChange) onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    // Ambil akumulasi look lalu nol-kan; dipanggil sekali per fixed step.
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
  };
}
