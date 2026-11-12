import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, makeUnit, makeCombo, setBge, comboId } from '../app/js/data.js';
import { battle } from '../app/js/engine.js';
import { buildPool, recommend, duel } from '../app/js/builder.js';

const raw = JSON.parse(readFileSync(new URL('../app/data/cards.json', import.meta.url), 'utf8'));
const db = createDb(raw);
const byName = (n, k) => [...db.cards.values()].find((c) => c.n === n && (!k || c.k === k));

test('data loads with every kind of card', () => {
  const kinds = { c: 0, o: 0, p: 0 };
  for (const c of db.cards.values()) kinds[c.k]++;
  assert.ok(kinds.c > 100 && kinds.o > 500 && kinds.p > 500);
  assert.equal(db.heroes.size, 50);
});

test('card stats grow with level', () => {
  const peter = byName('Peter', 'c');
  const lo = makeUnit(db, peter.i, 1), hi = makeUnit(db, peter.i, 0);
  assert.equal(lo.atk, 6); assert.equal(lo.hp, 36);
  assert.ok(hi.power > lo.power);
  assert.equal(lo.sk.armored, 2);
});

test('combos resolve in either order and scale with input level', () => {
  const chris = byName('Chris', 'c');
  const item = [...db.cards.values()].find((c) => c.k === 'o' && comboId(db, chris.i, c.i));
  const lo = makeCombo(db, makeUnit(db, chris.i, 1), makeUnit(db, item.i, 1));
  const hi = makeCombo(db, makeUnit(db, item.i, 0), makeUnit(db, chris.i, 0));
  assert.ok(lo && hi);
  assert.equal(lo.id, hi.id);
  assert.ok(hi.power > lo.power);
  assert.equal(makeCombo(db, makeUnit(db, chris.i, 1), makeUnit(db, chris.i, 1)), null);
});

test('a battleground effect changes matching cards only', () => {
  const drunk = [...db.cards.values()].find((c) => c.tr.includes('drunk') && c.k === 'o');
  const other = [...db.cards.values()].find((c) => !c.tr.includes('drunk') && c.k === 'o');
  const before = makeUnit(db, drunk.i, 0).hp, plain = makeUnit(db, other.i, 0).hp;
  setBge(db, { effects: [{ trait: 'drunk', kind: 'hp', n: 50 }] });
  assert.equal(makeUnit(db, drunk.i, 0).hp, Math.round(before * 1.5));
  assert.equal(makeUnit(db, other.i, 0).hp, plain);
  setBge(db, null);
  assert.equal(makeUnit(db, drunk.i, 0).hp, before);
});

const deckOf = (lvl) => {
  const ids = [...db.cards.values()].filter((c) => c.r === 4 && c.k !== 'p').slice(0, 25);
  return ids.map((c) => makeUnit(db, c.i, lvl));
};
const hero = () => makeUnit(db, [...db.heroes.keys()][0], 0);

test('battles are repeatable and a max-level deck beats a level-1 copy', () => {
  const strong = { hero: hero(), deck: deckOf(0), policy: 'smart' };
  const weak = { hero: hero(), deck: deckOf(1), policy: 'smart' };
  assert.equal(battle(db, strong, weak, 42), battle(db, strong, weak, 42));
  assert.ok(duel(db, strong, weak, 200) > 0.9);
  assert.ok(duel(db, weak, strong, 200) < 0.1);
});

test('recommend returns a legal deck from a small collection', async () => {
  const collection = {};
  for (const c of [...db.cards.values()].filter((c) => c.r >= 3).slice(0, 90)) collection[c.i] = { n: 1, l: 0 };
  const pool = buildPool(db, { source: 'mine', collection });
  const res = await recommend(db, { pool, heroes: [hero()], mode: 'offense', size: 25, effort: 1 });
  assert.equal(res.cards.reduce((s, c) => s + c.n, 0), 25);
  for (const c of res.cards) assert.ok(c.n <= collection[c.t.id].n);
  assert.ok(res.winRate >= 0 && res.winRate <= 1);
});
