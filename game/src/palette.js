// Foundry Line palette: charcoal steel, molten amber, teal defender trim.
// Same names as the CSS vars in index.html — one source of truth for colour.
export const PALETTE = {
  canvas: '#12100e', // floor / sky / fog
  surface: '#1e1a16', // walls, platforms
  hairline: '#33291f', // crates, containers
  ink: '#ece5d8', // bright text / key-light tint
  muted: '#9a8f7d', // dim steel, secondary text
  accent: '#f0a030', // molten amber (furnace glow, UI highlight)
  ember: '#ff9a2e', // Ember attackers
  vanguard: '#2ec4b6', // Vanguard defenders
  danger: '#e5484d', // damage / bomb
};

export function shade(name) {
  return PALETTE[name];
}
