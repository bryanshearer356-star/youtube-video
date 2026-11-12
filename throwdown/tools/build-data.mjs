#!/usr/bin/env node
// Converts a raw card dump (cards.json + combos.json, the game's own JSON
// layout as mirrored by community tools) into the compact file the app loads.
//
//   node tools/build-data.mjs <dir-with-cards.json-and-combos.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
  console.error('usage: build-data.mjs <dir containing cards.json and combos.json>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'data', 'cards.json');
const raw = JSON.parse(readFileSync(join(src, 'cards.json'), 'utf8'));
const rawCombos = JSON.parse(readFileSync(join(src, 'combos.json'), 'utf8'));

const DECK_SETS = new Set(['1', '2', '3', '7000', '7001', '7002', '7003']);
const PC_SETS = new Set(['3001', '3002', '3004']);
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const clean = (s) => String(s).replace(/&amp;/g, '&').trim();

function skill(s) {
  const o = [s.id, num(s.x) ?? 0];
  if (s.y !== undefined || s.s !== undefined) o.push(s.y ?? 0);
  if (s.s !== undefined) o.push(s.s);
  return o;
}

// Levels: a card lists level 1 inline, then one <upgrade> per later level
// holding only what changed. Skills are replaced per skill id.
function levels(u) {
  const a = [], h = [], s = {};
  let atk = num(u.attack) ?? 0, hp = num(u.health) ?? 0;
  const cur = new Map((u.skill || []).map((k) => [k.id, skill(k)]));
  a.push(atk); h.push(hp); s[0] = [...cur.values()];
  (u.upgrade || []).forEach((up, i) => {
    if (up.attack !== undefined) atk = num(up.attack);
    if (up.health !== undefined) hp = num(up.health);
    if (up.skill) {
      for (const k of up.skill) cur.set(k.id, skill(k));
      s[i + 1] = [...cur.values()];
    }
    a.push(atk); h.push(hp);
  });
  return { a, h, s };
}

const cards = [], heroes = [], combos = {};
let maxRelease = 0;
for (const u of Object.values(raw)) {
  if (u.release_time) maxRelease = Math.max(maxRelease, Number(u.release_time));
  const base = { i: num(u.id), n: clean(u.name), t: num(u.type), tr: u.trait || [] };
  if (u.commander) {
    if (u.defense_card_id) heroes.push({ ...base, ...levels(u) });
  } else if (u.attack_multiplier) {
    combos[u.id] = {
      n: base.n, t: base.t, tr: base.tr,
      am: Number(u.attack_multiplier), hm: Number(u.health_multiplier),
      s: (u.skill || []).map((k) => {
        const o = [k.id, num(k.p) ?? 0, num(k.v) ?? 0];
        if (k.y !== undefined) o.push(k.y);
        return o;
      }),
    };
  } else if (!u.hidden && (DECK_SETS.has(u.set) || PC_SETS.has(u.set))) {
    const k = PC_SETS.has(u.set) ? 'p' : u.card_type === 'character' ? 'c' : 'o';
    cards.push({ ...base, k, r: num(u.rarity), ...levels(u) });
  }
}

// Recipes: every pair is one character + one item. Characters that share the
// exact same recipe list (e.g. all versions of Chris) share one stored set.
const kind = new Map(cards.map((c) => [c.i, c.k]));
const perChar = new Map();
let skipped = 0;
for (const [key, val] of Object.entries(rawCombos)) {
  const [x, y] = key.split('~').map(Number);
  const outId = Number(val.split('|')[0]);
  let ch, ob;
  if (kind.get(x) === 'c' && kind.get(y) === 'o') [ch, ob] = [x, y];
  else if (kind.get(y) === 'c' && kind.get(x) === 'o') [ch, ob] = [y, x];
  else { skipped++; continue; }
  if (!combos[outId]) { skipped++; continue; }
  if (!perChar.has(ch)) perChar.set(ch, new Map());
  const m = perChar.get(ch);
  if (!m.has(outId)) m.set(outId, []);
  m.get(outId).push(ob);
}
const sets = [], setIndex = new Map(), charSet = {};
for (const [ch, m] of perChar) {
  const obj = {};
  for (const [o, list] of [...m].sort((p, q) => p[0] - q[0])) obj[o] = list.sort((p, q) => p - q);
  const sig = JSON.stringify(obj);
  if (!setIndex.has(sig)) { setIndex.set(sig, sets.length); sets.push(obj); }
  charSet[ch] = setIndex.get(sig);
}
const used = new Set(sets.flatMap((s) => Object.keys(s)));
for (const id of Object.keys(combos)) if (!used.has(id)) delete combos[id];

cards.sort((p, q) => p.i - q.i);
heroes.sort((p, q) => p.i - q.i);
const data = {
  meta: {
    newestCard: new Date(maxRelease * 1000).toISOString().slice(0, 10),
    built: new Date().toISOString().slice(0, 10),
  },
  cards, heroes, combos, recipeSets: sets, charSet,
};
writeFileSync(out, JSON.stringify(data));
console.log(`cards ${cards.length} (chars ${cards.filter((c) => c.k === 'c').length}, items ${cards.filter((c) => c.k === 'o').length}, power cards ${cards.filter((c) => c.k === 'p').length})`);
console.log(`heroes ${heroes.length}, combo results ${Object.keys(combos).length}, recipe sets ${sets.length}, recipes kept ${Object.keys(rawCombos).length - skipped}, skipped ${skipped}`);
console.log(`newest card ${data.meta.newestCard} -> ${out}`);
