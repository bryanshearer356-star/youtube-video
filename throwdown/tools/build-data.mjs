#!/usr/bin/env node
// Converts a raw card dump (cards.json + combos.json, the game's own JSON
// layout as mirrored by community tools) into the compact file the app loads.
//
//   node tools/build-data.mjs <dir-with-cards.json-and-combos.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../app/js/convert.js';

const src = process.argv[2];
if (!src) {
  console.error('usage: build-data.mjs <dir containing cards.json and combos.json>');
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'data', 'cards.json');
const raw = JSON.parse(readFileSync(join(src, 'cards.json'), 'utf8'));
const rawCombos = JSON.parse(readFileSync(join(src, 'combos.json'), 'utf8'));

const data = convert(raw, rawCombos);
const { cards, heroes, combos } = data;
const sets = data.recipeSets;
writeFileSync(out, JSON.stringify(data));
console.log(`cards ${cards.length} (chars ${cards.filter((c) => c.k === 'c').length}, items ${cards.filter((c) => c.k === 'o').length}, power cards ${cards.filter((c) => c.k === 'p').length})`);
console.log(`heroes ${heroes.length}, combo results ${Object.keys(combos).length}, recipe sets ${sets.length}, recipes read ${Object.keys(rawCombos).length}`);
console.log(`newest card ${data.meta.newestCard} -> ${out}`);
