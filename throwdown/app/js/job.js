// One deck-building job, shared by the page and the background worker.
import { makeUnit, setBge } from './data.js';
import { buildPool, recommend } from './builder.js';

export async function runBuild(db, job, onProgress) {
  setBge(db, job.bge);
  const pool = buildPool(db, job);
  const ids = job.heroId ? [job.heroId] : [...db.heroes.keys()];
  const heroes = ids.map((i) => makeUnit(db, i, job.heroLevel || 0));
  return recommend(db, { pool, heroes, mode: job.mode, size: job.size, effort: job.effort, seed: job.seed || 1 }, onProgress);
}

// Results are stored and sent between threads as plain data.
export function slim(res) {
  const t = (u) => ({ id: u.id, name: u.name, kind: u.kind, type: u.type, traits: u.traits, atk: u.atk, hp: u.hp, level: u.level, sk: u.sk, sy: u.sy, give: u.give, rarity: u.rarity || 0 });
  return {
    winRate: res.winRate, mode: res.mode, size: res.size, games: res.games, comboCount: res.comboCount,
    hero: t(res.hero),
    cards: res.cards.map((c) => ({ n: c.n, t: t(c.t) })),
    combos: res.combos.map((c) => ({ x: t(c.x), a: t(c.a), b: t(c.b) })),
  };
}
