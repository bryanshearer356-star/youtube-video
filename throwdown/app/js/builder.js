// Deck recommendation: a fast rating narrows the field, then simulated battles
// decide between the finalists.
import { makeUnit, makeCombo, maxLevel } from './data.js';
import { battle, rng } from './engine.js';

/**
 * The cards available to build from.
 * source 'all': every card at max level, `copies` of each.
 * source 'mine': collection = { cardId: { n: copies, l: level } }.
 */
export function buildPool(db, { source, collection, copies = 1 }) {
  const pool = [];
  if (source === 'mine') {
    for (const [id, own] of Object.entries(collection || {})) {
      const c = db.cards.get(Number(id));
      if (!c || !own.n) continue;
      pool.push({ t: makeUnit(db, c.i, own.l || maxLevel(c)), n: own.n });
    }
  } else {
    for (const c of db.cards.values()) pool.push({ t: makeUnit(db, c.i, 0), n: copies });
  }
  return pool;
}

const top = (arr, n, f) => arr.slice().sort((a, b) => f(b) - f(a)).slice(0, n);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Shortlist the strongest cards and precompute every combo between them. */
export function shortlist(db, pool, key, limits = { c: 36, o: 60, p: 60 }) {
  const chars = pool.filter((e) => e.t.kind === 'c');
  const items = pool.filter((e) => e.t.kind === 'o');
  const pcs = top(pool.filter((e) => e.t.kind === 'p'), limits.p, (e) => e.t[key]);
  const comboVal = (a, b) => { const x = makeCombo(db, a.t, b.t); return x ? x[key] : 0; };
  const bestWith = (e, others) => mean(top(others.map((o) => comboVal(e, o)).filter(Boolean), 8, (v) => v));
  const itemsA = top(items, 140, (e) => e.t[key]);
  const charsB = top(chars, limits.c, (e) => e.t[key] * 0.3 + bestWith(e, itemsA) * 0.5);
  const itemsB = top(items, limits.o, (e) => e.t[key] * 0.3 + bestWith(e, charsB) * 0.5);
  const cands = [...charsB, ...itemsB, ...pcs].map((e, i) => ({ ...e, i, solo: e.t[key] }));
  const n = cands.length;
  const M = new Float64Array(n * n);
  for (const a of cands) {
    if (a.t.kind !== 'c') continue;
    for (const b of cands) {
      if (b.t.kind !== 'o') continue;
      const v = comboVal(a, b);
      M[a.i * n + b.i] = v; M[b.i * n + a.i] = v;
    }
  }
  return { cands, M, n };
}

// Quick rating of a whole deck: each card is worth its share of the combos it
// is likely to find a partner for, or its own strength when it is not.
function proxy(sl, counts, size, noise) {
  const { cands, M, n } = sl;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const ci = counts[i];
    if (!ci) continue;
    const a = cands[i];
    const solo = a.solo * (noise ? noise[i] : 1);
    if (a.t.kind === 'p') { total += ci * solo; continue; }
    let m = 0, sum = 0;
    for (let j = 0; j < n; j++) {
      const v = M[i * n + j];
      if (!counts[j] || !v) continue;
      m += counts[j]; sum += counts[j] * v * (noise ? noise[j] : 1);
    }
    const p = m ? 1 - Math.pow(1 - m / size, 4) : 0;
    total += ci * (p * (sum / (m || 1)) * 0.5 + (1 - p) * solo * 0.8);
  }
  return total;
}

function proxyDeck(sl, size, noise) {
  const { cands, n } = sl;
  const counts = new Int16Array(n);
  let filled = 0;
  // Seed with the best character/item pair so greedy fill sees combo value.
  let bi = -1, bj = -1, bv = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (sl.M[i * n + j] > bv) { bv = sl.M[i * n + j]; bi = i; bj = j; }
  if (bi >= 0 && size >= 2) { counts[bi]++; counts[bj]++; filled = 2; }
  let score = proxy(sl, counts, size, noise);
  while (filled < size) {
    let best = -1, bestS = -Infinity;
    for (let i = 0; i < n; i++) {
      if (counts[i] >= cands[i].n) continue;
      counts[i]++;
      const s = proxy(sl, counts, size, noise);
      counts[i]--;
      if (s > bestS) { bestS = s; best = i; }
    }
    if (best < 0) break;
    counts[best]++; filled++; score = bestS;
  }
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let out = 0; out < n; out++) {
      if (!counts[out]) continue;
      counts[out]--;
      let best = out, bestS = score;
      for (let i = 0; i < n; i++) {
        if (i === out || counts[i] >= cands[i].n) continue;
        counts[i]++;
        const s = proxy(sl, counts, size, noise);
        counts[i]--;
        if (s > bestS + 1e-9) { bestS = s; best = i; }
      }
      counts[best]++;
      if (best !== out) { score = bestS; improved = true; }
    }
    if (!improved) break;
  }
  return counts;
}

const expand = (sl, counts) => {
  const deck = [];
  for (let i = 0; i < sl.n; i++) for (let k = 0; k < counts[i]; k++) deck.push(sl.cands[i].t);
  return deck;
};

/**
 * Build a recommended deck.
 * opts: { pool, heroes: [templates], mode: 'offense'|'defense', size, effort (1-3), seed }
 * onProgress(fraction, message) is called between steps; awaiting it lets the UI breathe.
 */
export async function recommend(db, opts, onProgress = async () => {}) {
  const { pool, heroes, mode, size = 25, effort = 2, seed = 1 } = opts;
  const key = mode === 'defense' ? 'dvalue' : 'value';
  const available = pool.reduce((s, e) => s + e.n, 0);
  if (available < size) throw new Error(`Only ${available} cards available; a deck needs ${size}.`);
  if (!heroes.length) throw new Error('No hero selected.');
  const rand = rng(seed);

  await onProgress(0.02, 'Rating cards and combos');
  const sl = shortlist(db, pool, key);
  await onProgress(0.15, 'Drafting decks');
  const counts = proxyDeck(sl, size, null);

  // Sparring partners: varied strong decks from the same card pool.
  const rivals = [];
  for (let g = 0; g < 6; g++) {
    const noise = Float64Array.from({ length: sl.n }, () => 0.6 + rand() * 0.8);
    rivals.push({ deck: expand(sl, proxyDeck(sl, size, noise)), hero: heroes[(rand() * heroes.length) | 0] });
    await onProgress(0.15 + 0.1 * ((g + 1) / 6), 'Drafting sparring decks');
  }

  const score = (deck, hero, games, base) => {
    let wins = 0;
    for (let g = 0; g < games; g++) {
      const r = rivals[g % rivals.length];
      const s = base + g * 7919;
      if (mode === 'defense') {
        if (!battle(db, { hero: r.hero, deck: r.deck, policy: 'smart' }, { hero, deck, policy: 'auto' }, s)) wins++;
      } else if (battle(db, { hero, deck, policy: 'smart' }, { hero: r.hero, deck: r.deck, policy: 'auto' }, s)) wins++;
    }
    return wins / games;
  };

  // Hero: quick trial of each, then a closer look at the leaders.
  let deck = expand(sl, counts);
  let hero = heroes[0];
  if (heroes.length > 1) {
    const trial = heroes.map((h) => ({ h, s: score(deck, h, 40 * effort, 11) }));
    await onProgress(0.35, 'Trying heroes');
    const leaders = top(trial, 3, (x) => x.s).map((x) => ({ h: x.h, s: score(deck, x.h, 150 * effort, 23) }));
    hero = top(leaders, 1, (x) => x.s)[0].h;
  }
  await onProgress(0.45, 'Testing card swaps in battle');

  // Refine with simulated battles: try swaps, keep the ones that win more.
  const games = 150 * effort, rounds = 14 * effort;
  let best = score(deck, hero, games, 101);
  for (let r = 0; r < rounds; r++) {
    const inDeck = [];
    for (let i = 0; i < sl.n; i++) if (counts[i]) inDeck.push(i);
    const out = inDeck[(rand() * inDeck.length) | 0];
    counts[out]--;
    const options = [];
    for (let i = 0; i < sl.n; i++) {
      if (i === out || counts[i] >= sl.cands[i].n) continue;
      counts[i]++;
      options.push({ i, s: proxy(sl, counts, size, null) });
      counts[i]--;
    }
    const choice = top(options, 12, (o) => o.s)[(rand() * Math.min(12, options.length)) | 0];
    if (!choice) { counts[out]++; continue; }
    counts[choice.i]++;
    const trialDeck = expand(sl, counts);
    const s = score(trialDeck, hero, games, 101);
    if (s > best + 0.012) { best = s; deck = trialDeck; }
    else { counts[choice.i]--; counts[out]++; }
    await onProgress(0.45 + 0.45 * ((r + 1) / rounds), 'Testing card swaps in battle');
  }

  await onProgress(0.92, 'Final check');
  const winRate = score(deck, hero, 400 * effort, 9001);

  // Summarise: cards with counts, and the best combos the deck can make.
  const byId = new Map();
  for (const t of deck) {
    const k = `${t.id}:${t.level}`;
    if (!byId.has(k)) byId.set(k, { t, n: 0 });
    byId.get(k).n++;
  }
  const cards = [...byId.values()].sort((a, b) => 'cop'.indexOf(a.t.kind) - 'cop'.indexOf(b.t.kind) || b.t[key] - a.t[key]);
  const combos = [];
  for (const a of cards) {
    if (a.t.kind !== 'c') continue;
    for (const b of cards) {
      if (b.t.kind !== 'o') continue;
      const x = makeCombo(db, a.t, b.t);
      if (x) combos.push({ x, a: a.t, b: b.t });
    }
  }
  combos.sort((p, q) => q.x[key] - p.x[key]);
  await onProgress(1, 'Done');
  return { hero, cards, combos: combos.slice(0, 12), comboCount: combos.length, winRate, mode, size, games: 400 * effort };
}

/** Win rate of one specific deck against another, for tests and tools. */
export function duel(db, a, b, games = 200, seed = 5) {
  let wins = 0;
  for (let g = 0; g < games; g++) if (battle(db, a, b, seed + g * 7919)) wins++;
  return wins / games;
}
