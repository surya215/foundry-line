// All sounds synthesized with WebAudio: one shared noise buffer plus
// oscillators through filter/gain envelopes. No audio files, no network.
// The context is created lazily (first gesture or first sound call); every
// call before the context exists is a no-op, so shot mode renders silently.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  const unlock = () => ensure();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // Noise burst, `when` seconds from now, through a filter at `freq`.
  function noise(dur, type, freq, peak, when) {
    if (!ctx) return;
    const t = ctx.currentTime + (when || 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // Oscillator blip with an optional pitch slide from f0 to f1.
  function tone(kind, f0, f1, dur, peak, when) {
    if (!ctx) return;
    const t = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    o.type = kind;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  const SHOTS = {
    p9: () => {
      noise(0.09, 'highpass', 1500, 0.5);
      tone('square', 170, 55, 0.07, 0.25);
    },
    kestrel: () => {
      noise(0.07, 'bandpass', 2600, 0.45);
      tone('square', 220, 70, 0.05, 0.18);
    },
    vk7: () => {
      noise(0.12, 'bandpass', 1400, 0.6);
      tone('square', 140, 45, 0.12, 0.3);
    },
    longshot: () => {
      noise(0.32, 'lowpass', 900, 0.85);
      tone('sine', 95, 32, 0.38, 0.8);
    },
  };

  return {
    shot(id) {
      if (!ensure()) return;
      (SHOTS[id] || SHOTS.vk7)();
    },
    dryFire() {
      if (!ensure()) return;
      tone('square', 1300, 900, 0.03, 0.12);
    },
    reload() {
      if (!ensure()) return;
      tone('square', 700, 500, 0.04, 0.15);
      tone('square', 950, 700, 0.04, 0.15, 0.16);
    },
    hit(kill) {
      if (!ensure()) return;
      tone('sine', 1250, 1250, 0.05, 0.2);
      if (kill) tone('sine', 1750, 1750, 0.08, 0.22, 0.06);
    },
    step() {
      // Reserved: footsteps stay silent by design; bot hearing uses events.
    },
    plantBeep() {
      if (!ensure()) return;
      tone('sine', 880, 880, 0.09, 0.2);
    },
    explosion() {
      if (!ensure()) return;
      noise(1.1, 'lowpass', 700, 0.9);
      tone('sine', 60, 26, 1.0, 0.85);
    },
    roundEnd(win) {
      if (!ensure()) return;
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => tone('sine', f, f, 0.22, 0.22, i * 0.13));
    },
    buy() {
      if (!ensure()) return;
      tone('sine', 1320, 1320, 0.06, 0.18);
      tone('sine', 1760, 1760, 0.09, 0.18, 0.07);
    },
    bounce() {
      if (!ensure()) return;
      noise(0.06, 'lowpass', 420, 0.2);
      tone('sine', 120, 65, 0.07, 0.15);
    },
    setMuted(m) {
      muted = !!m;
      if (master) master.gain.value = muted ? 0 : 0.9;
    },
  };
}
