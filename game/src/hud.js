// DOM HUD for Foundry Line. Every setter caches its last value and skips the
// DOM write when nothing changed. Killfeed caps at 5 items, fades after 4 s.
// The buy menu is built from SHOP (economy.js); main.js supplies the buy handler.
import { SHOP } from './economy.js';

const COPY = {
  start: {
    title: 'FOUNDRY LINE',
    copy: 'Ember attack. Plant the charge at Site A or Site B — or eliminate Vanguard. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Paused',
    copy: 'Click to resume the round.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: 'Round over',
    copy: '',
    action: 'Continue',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const el = {
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    health: $('health'),
    healthNum: $('health-num'),
    healthFill: $('health-fill'),
    armorNum: $('armor-num'),
    ammo: $('ammo'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weapon: $('ammo-weapon'),
    money: $('money'),
    timer: $('timer'),
    scoreE: $('score-ember'),
    scoreV: $('score-vanguard'),
    round: $('round'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    bomb: $('bomb'),
    bombLabel: $('bomb-label'),
    bombFill: $('bomb-fill'),
    vignette: $('vignette'),
    overlay: $('overlay'),
    oTitle: $('overlay-title'),
    oCopy: $('overlay-copy'),
    play: $('play'),
    restart: $('restart'),
    buy: $('buy'),
    buyGrid: $('buy-grid'),
    buyMoney: $('buy-money'),
  };
  let lastHealth = -1;
  let lastArmor = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScoreE = -1;
  let lastScoreV = -1;
  let lastRound = -1;
  let lastWeapon = '';
  let lastSpread = -1;
  let lastBombState = '';
  let lastBombFrac = -1;
  let hitTimer = 0;
  let bannerTimer = 0;
  let flashTimer = 0;
  let onBuyHandler = null;

  el.buyGrid.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row || row.disabled || !onBuyHandler) return;
    onBuyHandler(row.dataset.id);
  });

  return {
    setHealth(hp) {
      const v = Math.max(0, Math.ceil(hp));
      if (v === lastHealth) return;
      lastHealth = v;
      el.healthNum.textContent = String(v);
      el.healthFill.style.width = `${v}%`;
      el.health.classList.toggle('low', v <= 30);
    },
    setArmor(a) {
      const v = Math.max(0, Math.round(a));
      if (v === lastArmor) return;
      lastArmor = v;
      el.armorNum.textContent = String(v);
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      el.ammoMag.textContent = String(mag);
      el.ammoReserve.textContent = `/ ${reserve}`;
      el.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(m) {
      if (m === lastMoney) return;
      lastMoney = m;
      el.money.textContent = `$${m}`;
    },
    setTimer(sec) {
      const s = Math.max(0, Math.ceil(sec));
      const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (t === lastTimer) return;
      lastTimer = t;
      el.timer.textContent = t;
    },
    setScore(ember, vanguard) {
      if (ember === lastScoreE && vanguard === lastScoreV) return;
      lastScoreE = ember;
      lastScoreV = vanguard;
      el.scoreE.textContent = String(ember);
      el.scoreV.textContent = String(vanguard);
    },
    setRound(n) {
      if (n === lastRound) return;
      lastRound = n;
      el.round.textContent = `ROUND ${n}`;
    },
    setWeaponName(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      el.weapon.textContent = name;
    },
    setCrosshairSpread(px) {
      const p = Math.round(px);
      if (p === lastSpread) return;
      lastSpread = p;
      el.crosshair.style.setProperty('--gap', `${p}px`);
    },
    killfeed(text) {
      const item = document.createElement('div');
      item.className = 'kf-item';
      item.textContent = text;
      el.killfeed.prepend(item);
      while (el.killfeed.children.length > 5) el.killfeed.removeChild(el.killfeed.lastChild);
      setTimeout(() => item.classList.add('fade'), 4000);
      setTimeout(() => item.remove(), 4600);
    },
    hitMarker(kill, holdMs = 120) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      el.vignette.style.opacity = '0.55';
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { el.vignette.style.opacity = '0'; }, 130);
    },
    showBanner(title, sub = '', holdMs = 3500) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.classList.add('show');
      clearTimeout(bannerTimer);
      if (holdMs > 0) bannerTimer = setTimeout(() => el.banner.classList.remove('show'), holdMs);
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode] || COPY.start;
      let title = data.title || text.title;
      if (mode === 'matchEnd' && data.win !== undefined) title = data.win ? 'MATCH WON' : 'MATCH LOST';
      el.oTitle.textContent = title;
      let copy = data.copy || text.copy;
      if (data.score && typeof data.score === 'object') {
        copy += ` Final score ${data.score.ember} — ${data.score.vanguard}.`;
      } else if (data.score) {
        copy += ` Score ${data.score}.`;
      }
      el.oCopy.textContent = copy;
      el.play.textContent = data.action || text.action;
      el.restart.hidden = mode !== 'matchEnd';
      el.overlay.hidden = false;
      el.play.focus();
    },
    hideOverlay() {
      el.overlay.hidden = true;
    },
    showBuy(money, owned) {
      el.buyMoney.textContent = `$${money}`;
      el.buyGrid.innerHTML = SHOP.map((item) => {
        const name = item.name || String(item.id).toUpperCase();
        const has = !!(owned && owned[item.id]);
        const afford = money >= item.price;
        const tag = has ? 'OWNED' : `$${item.price}`;
        const cls = has ? ' owned' : afford ? '' : ' poor';
        const dis = has || !afford ? ' disabled' : '';
        return `<button type="button" class="buy-row${cls}" data-id="${item.id}"${dis}>` +
          `<span class="buy-name">${name}</span><span class="buy-tag">${tag}</span></button>`;
      }).join('');
      el.buy.hidden = false;
    },
    hideBuy() {
      el.buy.hidden = true;
    },
    setBomb(state, frac) {
      const f = Math.max(0, Math.min(1, frac || 0));
      const s = state || 'none';
      if (s === lastBombState && Math.abs(f - lastBombFrac) < 0.01) return;
      lastBombState = s;
      lastBombFrac = f;
      if (s === 'none') {
        el.bomb.hidden = true;
        return;
      }
      el.bomb.hidden = false;
      el.bombLabel.textContent = s === 'planting' ? 'PLANTING CHARGE…'
        : s === 'defusing' ? 'DEFUSING…' : 'CHARGE PLANTED';
      el.bombFill.style.width = `${Math.round(f * 100)}%`;
      el.bomb.classList.toggle('danger', s === 'planted');
    },
    onPlay(handler) {
      el.play.addEventListener('click', handler);
    },
    onBuy(handler) {
      onBuyHandler = handler;
    },
    onRestart(handler) {
      el.restart.addEventListener('click', handler);
    },
  };
}
