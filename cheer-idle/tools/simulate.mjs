// Balance check: plays the game with a simple greedy bot and prints how long
// each competition takes to win. Run from the repo root:
//
//   node cheer-idle/tools/simulate.mjs            (active player, 3 drills/sec)
//   node cheer-idle/tools/simulate.mjs 0          (pure idle after the first purchase)
//
// It loads the same data.js and game.js the browser does, so retuning numbers in
// data.js and rerunning this shows the effect on pacing straight away.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
for (const file of ['data.js', 'game.js']) {
  vm.runInThisContext(readFileSync(join(here, '..', 'js', file), 'utf8'), { filename: file });
}
const D = globalThis.CheerData;
const G = globalThis.CheerGame;

const drillsPerSecond = process.argv[2] === undefined ? 3 : Number(process.argv[2]);
const MAX_SECONDS = 60 * 60 * 24 * 30;

function clock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Cheapest untrained level on the current division's scoresheet. */
function cheapestSkill(state) {
  let best = null;
  for (const category of D.CATEGORIES) {
    const cost = G.skillCost(state, state.division, category.id);
    if (cost !== null && (!best || cost < best.cost)) best = { category, cost };
  }
  return best;
}

/** Program upgrade that pays for itself fastest. */
function bestGenerator(state) {
  const multiplier = G.globalMultiplier(state);
  let best = null;
  for (const generator of D.GENERATORS) {
    if (!G.generatorUnlocked(state, generator)) continue;
    const cost = G.generatorCost(state, generator);
    const payback = cost / (generator.rate * multiplier);
    if (!best || payback < best.payback) best = { generator, cost, payback };
  }
  return best;
}

/** Spend until nothing sensible is affordable. Returns any competition results. */
function spend(state) {
  const wins = [];
  for (let guard = 0; guard < 1000; guard++) {
    if (G.canWin(state)) {
      wins.push(G.compete(state));
      continue;
    }
    const boost = D.BOOSTS.find((b) => !state.boosts[b.id] && G.boostUnlocked(state, b) && state.spirit >= b.cost);
    if (boost) {
      G.buyBoost(state, boost);
      continue;
    }
    const rate = G.spiritPerSecond(state) + drillsPerSecond * G.drillPower(state);
    const skill = cheapestSkill(state);
    const gen = bestGenerator(state);
    const skillIsCheap = skill && skill.cost <= rate * 45;
    if (skill && state.spirit >= skill.cost && (skillIsCheap || !gen || gen.payback > 600)) {
      G.trainSkill(state, state.division, skill.category.id);
      continue;
    }
    if (gen && state.spirit >= gen.cost && gen.payback <= 900) {
      G.buyGenerator(state, gen.generator);
      continue;
    }
    if (skill && state.spirit >= skill.cost && (!gen || gen.payback > 900)) {
      G.trainSkill(state, state.division, skill.category.id);
      continue;
    }
    break;
  }
  return wins;
}

const state = G.newState(0);
let seconds = 0;
let lastWin = 0;
console.log(`Bot: ${drillsPerSecond} drills/sec\n`);
console.log('time'.padEnd(10), 'split'.padEnd(10), 'division'.padEnd(16), 'competition'.padEnd(26), 'rate/sec');

while (!state.champion && seconds < MAX_SECONDS) {
  // Bigger steps late in the run keep the simulation quick.
  const dt = seconds < 3600 ? 1 : seconds < 36000 ? 5 : 30;
  seconds += dt;
  G.tick(state, dt);
  // With no upgrades there is no passive income, so even the idle bot drills until its first purchase.
  const drills = drillsPerSecond > 0 ? drillsPerSecond * dt : G.spiritPerSecond(state) === 0 ? dt : 0;
  if (drills > 0) {
    const power = G.drillPower(state);
    state.spirit += power * drills;
    state.lifetimeSpirit += power * drills;
  }
  for (const win of spend(state)) {
    console.log(
      clock(seconds).padEnd(10),
      clock(seconds - lastWin).padEnd(10),
      win.division.name.padEnd(16),
      win.competition.name.padEnd(26),
      G.formatNumber(G.spiritPerSecond(state)),
    );
    lastWin = seconds;
  }
}

console.log(state.champion ? `\nWorld champions after ${clock(seconds)}.` : `\nNot finished after ${clock(seconds)}.`);
