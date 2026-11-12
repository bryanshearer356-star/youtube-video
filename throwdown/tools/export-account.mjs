#!/usr/bin/env node
// Downloads the current card data and YOUR card collection from the game,
// using your own login, and writes one file to load into Throwdown Deck Lab.
//
// Read-only: it makes the same two requests the game makes when it starts
// ("init" and "getStaticFiles") and then downloads the public data files they
// point to. It never plays, buys or changes anything. Your login details are
// used for those two requests only and are not written to disk.
import { createInterface } from 'node:readline/promises';
import { writeFileSync } from 'node:fs';
import { convert } from '../app/js/convert.js';

const API = 'https://cb-live.synapsegames.com/api.php';
const OUT = 'deck-lab-export.json';

async function ask() {
  let id = process.env.AT_USER_ID, pw = process.env.AT_PASSWORD_HASH;
  if (!id || !pw) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    id = id || (await rl.question('Your user_id: ')).trim();
    pw = pw || (await rl.question('Your password value: ')).trim();
    rl.close();
  }
  if (!/^\d+$/.test(id)) throw new Error('The user_id should be a number, like 1234567.');
  if (!pw) throw new Error('The password value is empty.');
  return { id, pw };
}

async function call(message, { id, pw }) {
  const res = await fetch(`${API}?message=${message}&user_id=${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: pw, client_time: String(Math.floor(Date.now() / 1000)) }),
  });
  if (!res.ok) throw new Error(`The game server answered ${res.status} to "${message}".`);
  const data = await res.json();
  if (data.result === false) {
    const why = [].concat(data.result_message || []).join(' ') || 'no reason given';
    throw new Error(`The game refused "${message}": ${why}. Check the user_id and password value.`);
  }
  return data;
}

async function download(url, what) {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error(`The game did not say where the ${what} file is.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading the ${what} file failed (${res.status}).`);
  return res.json();
}

const rows = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);

async function main() {
  const creds = await ask();
  console.log('Signing in…');
  const user = await call('init', creds);
  const files = (await call('getStaticFiles', creds)).static_files || {};
  console.log('Downloading current cards and combos…');
  let cards = await download(files.card_data, 'card');
  let combos = await download(files.combo_data_compressed || files.combo_data, 'combo');
  cards = cards.card_data || cards;
  combos = combos.combo_data_compressed || combos.combo_data || combos;
  if (Array.isArray(cards)) cards = Object.fromEntries(cards.map((c) => [c.id, c]));

  const owned = rows(user.user_units).map((u) => [Number(u.unit_id), Number(u.level) || 1]).filter((u) => u[0]);

  let data;
  try {
    data = convert(cards, combos);
    if (data.cards.length < 500 || !data.recipeSets.length) throw new Error('too few cards or no combos were recognised');
  } catch (err) {
    // Keep what was downloaded so the format problem can be fixed without
    // signing in again. These files hold game data and card ids only.
    writeFileSync('deck-lab-raw-cards.json', JSON.stringify(cards));
    writeFileSync('deck-lab-raw-combos.json', JSON.stringify(combos));
    writeFileSync('deck-lab-raw-owned.json', JSON.stringify(owned));
    throw new Error(`The downloaded data is in a format this script does not understand (${err.message}).\n` +
      'Saved deck-lab-raw-cards.json, deck-lab-raw-combos.json and deck-lab-raw-owned.json next to this script.\n' +
      'They contain no login details. Send them to Claude so the script can be fixed.');
  }

  const known = new Map(data.cards.map((c) => [c.i, c.a.length]));
  const collection = {};
  let kept = 0, other = 0;
  for (const [id, level] of owned) {
    if (!known.has(id)) { other++; continue; }
    const lv = Math.max(1, Math.min(known.get(id), level));
    const entry = (collection[id] ||= { lv: {} });
    entry.lv[lv] = (entry.lv[lv] || 0) + 1;
    kept++;
  }
  data.meta.exported = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify({ format: 'deck-lab-export', version: 1, data, collection }));
  console.log(`\nDone. Wrote ${OUT}`);
  console.log(`  Game data: ${data.cards.length} cards, ${data.heroes.length} heroes, newest card ${data.meta.newestCard}`);
  console.log(`  Your collection: ${kept} cards (${Object.keys(collection).length} different)` + (other ? `; ${other} other things skipped (heroes, combos and similar)` : ''));
  console.log('\nNext: open Throwdown Deck Lab, go to Collection, and load this file under "Load my game export".');
}

main().catch((err) => { console.error(`\nStopped: ${err.message}`); process.exitCode = 1; });
