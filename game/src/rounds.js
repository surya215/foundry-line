// rounds.js — round + match state machine for Foundry Line.
// Freeze (buy) 8 s -> live 100 s -> round end (4 s banner) -> next round.
// First to 8 rounds wins the match. Money moves only here, via economy.js;
// banners/stingers go through game.hud / game.audio (never imported).
// Kill economy: whoever detects a kill calls onKill(killerTeam) exactly once
// (bots.js for bot kills, main.js for player kills) — main.js must NOT call
// it again when draining the {type:'kill'} event.
import { ECONOMY, lossBonus } from './economy.js';

const FREEZE_T = 8;
const ROUND_T = 100;
const BOMB_T = 40;
const END_DELAY = 4;
const WIN_ROUNDS = 8;

const BANNER_SUB = {
  elimination: ['Enemy team eliminated', 'Your team was eliminated'],
  detonation: ['Charge detonated — site lost', 'Charge detonated — site lost'],
  defused: ['Charge defused', 'Charge defused'],
  time: ['Time expired — charge never planted', 'Time expired — charge never planted'],
};

export function createRounds(game) {
  const state = {
    round: 1,
    phase: 'freeze',
    freezeT: FREEZE_T,
    roundT: ROUND_T,
    winner: null,
    reason: '',
  };
  let lossStreak = 0; // consecutive Ember losses banked before this round
  let endT = 0;
  let bombT = 0;

  function aliveCount(team) {
    let n = game.bots ? game.bots.aliveCount(team) : 0;
    if (team === 'ember' && game.player && game.player.state && game.player.state.alive) n += 1;
    return n;
  }

  // Refill the player's current weapon (mag + reserve from defs). Prefers a
  // weapons.refill() if W2 provides one; otherwise refills in place.
  function refillWeapons() {
    const w = game.weapons;
    if (!w) return;
    if (typeof w.refill === 'function') { w.refill(); return; }
    const st = w.state;
    const defs = w.defs;
    if (!st || !defs) return;
    const d = defs[st.current];
    if (d && d.mag) { st.mag = d.mag; st.reserve = d.reserve; }
    st.reloadLeft = 0;
    st.cooldown = 0;
  }

  function startMatch() {
    game.score.ember = 0;
    game.score.vanguard = 0;
    game.money = ECONOMY.startMoney;
    lossStreak = 0;
    state.round = 1;
    startRound();
  }

  function startRound() {
    if (game.bots) game.bots.reset();
    if (game.player && typeof game.player.reset === 'function' && game.world) {
      // Player takes ember spawn 0 (bots take ember spawns 1-4); yaw 0 faces
      // north (-z), toward the Vanguard spawn.
      game.player.reset(game.world.spawns.ember[0], 0);
    }
    refillWeapons();
    state.phase = 'freeze';
    state.freezeT = FREEZE_T;
    state.roundT = ROUND_T;
    state.winner = null;
    state.reason = '';
    bombT = 0;
    if (game.bomb) {
      game.bomb.state = 'carried';
      game.bomb.site = null;
      game.bomb.plantT = 0;
      game.bomb.defuseT = 0;
    }
    game.phase = 'freeze';
    game.roundTime = FREEZE_T;
    const hud = game.hud;
    if (hud) {
      if (hud.setScore) hud.setScore(game.score.ember, game.score.vanguard);
      if (hud.setRound) hud.setRound(state.round);
      if (hud.setMoney) hud.setMoney(game.money);
      if (hud.setBomb) hud.setBomb(null);
    }
  }

  function endRound(winner, reason) {
    if (state.phase !== 'live') return;
    state.phase = 'roundEnd';
    state.winner = winner;
    state.reason = reason;
    game.phase = 'roundEnd';
    game.roundTime = 0;
    endT = END_DELAY;
    const emberWon = winner === 'ember';
    if (emberWon) {
      game.score.ember += 1;
      game.money += ECONOMY.win;
      lossStreak = 0;
    } else {
      game.score.vanguard += 1;
      game.money += lossBonus(lossStreak);
      lossStreak += 1;
    }
    game.events.push({ type: 'roundEnd', winner, reason, round: state.round });
    const hud = game.hud;
    if (hud) {
      if (hud.setScore) hud.setScore(game.score.ember, game.score.vanguard);
      if (hud.showBanner) {
        const sub = BANNER_SUB[reason] || ['', ''];
        hud.showBanner(emberWon ? 'ROUND WON' : 'ROUND LOST', sub[emberWon ? 0 : 1]);
      }
    }
    if (game.audio && game.audio.roundEnd) game.audio.roundEnd(emberWon);
  }

  function step(dt) {
    if (state.phase === 'freeze') {
      state.freezeT -= dt;
      game.roundTime = Math.max(0, state.freezeT);
      if (state.freezeT <= 0) {
        state.phase = 'live';
        game.phase = 'live';
        state.roundT = ROUND_T;
        game.roundTime = ROUND_T;
      }
      return;
    }
    if (state.phase === 'live') {
      if (game.bomb && game.bomb.state === 'planted') {
        bombT -= dt;
        game.roundTime = Math.max(0, bombT);
        if (bombT <= 0) {
          game.bomb.state = 'exploded';
          game.events.push({ type: 'explode', site: game.bomb.site });
          endRound('ember', 'detonation');
          return;
        }
      } else {
        state.roundT -= dt;
        game.roundTime = Math.max(0, state.roundT);
        if (state.roundT <= 0) { endRound('vanguard', 'time'); return; }
      }
      // Elimination ends the round at once, even with the bomb planted:
      // nobody is left to stop the detonation.
      if (aliveCount('ember') === 0) { endRound('vanguard', 'elimination'); return; }
      if (aliveCount('vanguard') === 0) { endRound('ember', 'elimination'); return; }
      return;
    }
    if (state.phase === 'roundEnd') {
      endT -= dt;
      if (endT <= 0) {
        if (game.score.ember >= WIN_ROUNDS || game.score.vanguard >= WIN_ROUNDS) {
          state.phase = 'matchEnd';
          game.phase = 'matchEnd';
          const win = game.score.ember > game.score.vanguard;
          if (game.hud && game.hud.showOverlay) {
            game.hud.showOverlay('matchEnd', { win, score: { ember: game.score.ember, vanguard: game.score.vanguard } });
          }
          if (game.audio && game.audio.roundEnd) game.audio.roundEnd(win);
        } else {
          state.round += 1;
          startRound();
        }
      }
      return;
    }
    // matchEnd: nothing to do.
  }

  // Called exactly once per kill by whoever detected it. Team economy is
  // tracked as the player's money; only Ember kills pay out.
  function onKill(killerTeam) {
    if (killerTeam === 'ember') game.money += ECONOMY.kill;
  }

  function onPlant(site) {
    if (!game.bomb) return;
    game.bomb.state = 'planted';
    game.bomb.site = site;
    game.bomb.plantT = 0;
    game.bomb.defuseT = 0;
    if (!game.bomb.pos && game.world && game.world.sites && game.world.sites[site]) {
      game.bomb.pos = game.world.sites[site].centre.clone();
    }
    bombT = BOMB_T;
    game.money += ECONOMY.plant;
    game.events.push({ type: 'plant', site });
  }

  function onDefuse() {
    if (state.phase !== 'live') return;
    if (game.bomb) game.bomb.state = 'defused';
    endRound('vanguard', 'defused');
  }

  return { state, step, startMatch, startRound, endRound, onKill, onPlant, onDefuse };
}
