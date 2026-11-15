// economy.js — money tables for Foundry Line. Prices mirror weapons.js defs;
// rounds.js is the only module that moves money, through these constants.
export const ECONOMY = {
  startMoney: 800,
  kill: 300,
  win: 3250,
  loss: 1900,
  lossStreakBonus: 500,
  lossMax: 3400,
  plant: 300,
  defuse: 300,
};

// Buy-menu catalogue. `kind: 'grenade'` / `kind: 'armor'` mark non-weapons;
// weapon rows mirror weapons.js defs (id, name, price).
export const SHOP = [
  { id: 'vk7', name: 'VK-7 Repeater', price: 2700 },
  { id: 'kestrel', name: 'Kestrel-9', price: 1500 },
  { id: 'longshot', name: 'Longshot .50', price: 4750 },
  { id: 'p9', name: 'P9 Sidearm', price: 300 },
  { id: 'surge', name: 'Surge HE', kind: 'grenade', price: 300 },
  { id: 'veil', name: 'Veil Smoke', kind: 'grenade', price: 300 },
  { id: 'armor', name: 'Kevlar Armor', kind: 'armor', price: 650 },
];

// Round-loss payout for the player's team. `streak` = consecutive losses
// already banked before this round (0 on the first loss): 1900 + 500 per
// streak, capped at 3400.
export function lossBonus(streak) {
  const s = Math.max(0, streak | 0);
  return Math.min(ECONOMY.lossMax, ECONOMY.loss + ECONOMY.lossStreakBonus * s);
}
