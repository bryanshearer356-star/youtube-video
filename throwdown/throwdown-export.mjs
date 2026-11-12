#!/usr/bin/env node

// tools/export-account.mjs
import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";

// app/js/convert.js
var DECK_SETS = /* @__PURE__ */ new Set(["1", "2", "3", "7000", "7001", "7002", "7003"]);
var PC_SETS = /* @__PURE__ */ new Set(["3001", "3002", "3004"]);
var num = (v) => v === void 0 || v === "" ? void 0 : Number(v);
var clean = (s) => String(s).replace(/&amp;/g, "&").trim();
function skill(s) {
  const o = [s.id, num(s.x) ?? 0];
  if (s.y !== void 0 || s.s !== void 0) o.push(s.y ?? 0);
  if (s.s !== void 0) o.push(s.s);
  return o;
}
function levels(u) {
  const a = [], h = [], s = {};
  let atk = num(u.attack) ?? 0, hp = num(u.health) ?? 0;
  const cur = new Map((u.skill || []).map((k) => [k.id, skill(k)]));
  a.push(atk);
  h.push(hp);
  s[0] = [...cur.values()];
  (u.upgrade || []).forEach((up, i) => {
    if (up.attack !== void 0) atk = num(up.attack);
    if (up.health !== void 0) hp = num(up.health);
    if (up.skill) {
      for (const k of up.skill) cur.set(k.id, skill(k));
      s[i + 1] = [...cur.values()];
    }
    a.push(atk);
    h.push(hp);
  });
  return { a, h, s };
}
function convert(raw, rawCombos) {
  const cards = [], heroes = [], combos = {};
  let maxRelease = 0;
  for (const u of Object.values(raw)) {
    if (u.release_time) maxRelease = Math.max(maxRelease, Number(u.release_time));
    const base = { i: num(u.id), n: clean(u.name), t: num(u.type), tr: u.trait || [] };
    if (u.commander) {
      if (u.defense_card_id) heroes.push({ ...base, ...levels(u) });
    } else if (u.attack_multiplier) {
      combos[u.id] = {
        n: base.n,
        t: base.t,
        tr: base.tr,
        am: Number(u.attack_multiplier),
        hm: Number(u.health_multiplier),
        s: (u.skill || []).map((k) => {
          const o = [k.id, num(k.p) ?? 0, num(k.v) ?? 0];
          if (k.y !== void 0) o.push(k.y);
          return o;
        })
      };
    } else if (!u.hidden && (DECK_SETS.has(u.set) || PC_SETS.has(u.set))) {
      const k = PC_SETS.has(u.set) ? "p" : u.card_type === "character" ? "c" : "o";
      cards.push({ ...base, k, r: num(u.rarity), ...levels(u) });
    }
  }
  const kind = new Map(cards.map((c) => [c.i, c.k]));
  const perChar = /* @__PURE__ */ new Map();
  let skipped = 0;
  for (const [key, val] of Object.entries(rawCombos)) {
    const [x, y] = key.split("~").map(Number);
    const outId = Number(val.split("|")[0]);
    let ch, ob;
    if (kind.get(x) === "c" && kind.get(y) === "o") [ch, ob] = [x, y];
    else if (kind.get(y) === "c" && kind.get(x) === "o") [ch, ob] = [y, x];
    else {
      skipped++;
      continue;
    }
    if (!combos[outId]) {
      skipped++;
      continue;
    }
    if (!perChar.has(ch)) perChar.set(ch, /* @__PURE__ */ new Map());
    const m = perChar.get(ch);
    if (!m.has(outId)) m.set(outId, []);
    m.get(outId).push(ob);
  }
  const sets = [], setIndex = /* @__PURE__ */ new Map(), charSet = {};
  for (const [ch, m] of perChar) {
    const obj = {};
    for (const [o, list] of [...m].sort((p, q) => p[0] - q[0])) obj[o] = list.sort((p, q) => p - q);
    const sig = JSON.stringify(obj);
    if (!setIndex.has(sig)) {
      setIndex.set(sig, sets.length);
      sets.push(obj);
    }
    charSet[ch] = setIndex.get(sig);
  }
  const used = new Set(sets.flatMap((s) => Object.keys(s)));
  for (const id of Object.keys(combos)) if (!used.has(id)) delete combos[id];
  cards.sort((p, q) => p.i - q.i);
  heroes.sort((p, q) => p.i - q.i);
  return {
    meta: {
      newestCard: new Date(maxRelease * 1e3).toISOString().slice(0, 10),
      built: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
    },
    cards,
    heroes,
    combos,
    recipeSets: sets,
    charSet
  };
}

// tools/export-account.mjs
var API = "https://cb-live.synapsegames.com/api.php";
var OUT = "deck-lab-export.json";
async function ask() {
  let id = process.env.AT_USER_ID, pw = process.env.AT_PASSWORD_HASH;
  if (!id || !pw) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    id = id || (await rl.question("Your user_id: ")).trim();
    pw = pw || (await rl.question("Your password value: ")).trim();
    rl.close();
  }
  if (!/^\d+$/.test(id)) throw new Error("The user_id should be a number, like 1234567.");
  if (!pw) throw new Error("The password value is empty.");
  return { id, pw };
}
async function call(message, { id, pw }) {
  const res = await fetch(`${API}?message=${message}&user_id=${id}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: pw, client_time: String(Math.floor(Date.now() / 1e3)) })
  });
  if (!res.ok) throw new Error(`The game server answered ${res.status} to "${message}".`);
  const data = await res.json();
  if (data.result === false) {
    const why = [].concat(data.result_message || []).join(" ") || "no reason given";
    throw new Error(`The game refused "${message}": ${why}. Check the user_id and password value.`);
  }
  return data;
}
async function download(url, what) {
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error(`The game did not say where the ${what} file is.`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Downloading the ${what} file failed (${res.status}).`);
  return res.json();
}
var rows = (x) => Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : [];
async function main() {
  const creds = await ask();
  console.log("Signing in\u2026");
  const user = await call("init", creds);
  const files = (await call("getStaticFiles", creds)).static_files || {};
  console.log("Downloading current cards and combos\u2026");
  let cards = await download(files.card_data, "card");
  let combos = await download(files.combo_data_compressed || files.combo_data, "combo");
  cards = cards.card_data || cards;
  combos = combos.combo_data_compressed || combos.combo_data || combos;
  if (Array.isArray(cards)) cards = Object.fromEntries(cards.map((c) => [c.id, c]));
  const owned = rows(user.user_units).map((u) => [Number(u.unit_id), Number(u.level) || 1]).filter((u) => u[0]);
  let data;
  try {
    data = convert(cards, combos);
    if (data.cards.length < 500 || !data.recipeSets.length) throw new Error("too few cards or no combos were recognised");
  } catch (err) {
    writeFileSync("deck-lab-raw-cards.json", JSON.stringify(cards));
    writeFileSync("deck-lab-raw-combos.json", JSON.stringify(combos));
    writeFileSync("deck-lab-raw-owned.json", JSON.stringify(owned));
    throw new Error(`The downloaded data is in a format this script does not understand (${err.message}).
Saved deck-lab-raw-cards.json, deck-lab-raw-combos.json and deck-lab-raw-owned.json next to this script.
They contain no login details. Send them to Claude so the script can be fixed.`);
  }
  const known = new Map(data.cards.map((c) => [c.i, c.a.length]));
  const collection = {};
  let kept = 0, other = 0;
  for (const [id, level] of owned) {
    if (!known.has(id)) {
      other++;
      continue;
    }
    const lv = Math.max(1, Math.min(known.get(id), level));
    const entry = collection[id] ||= { lv: {} };
    entry.lv[lv] = (entry.lv[lv] || 0) + 1;
    kept++;
  }
  data.meta.exported = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify({ format: "deck-lab-export", version: 1, data, collection }));
  console.log(`
Done. Wrote ${OUT}`);
  console.log(`  Game data: ${data.cards.length} cards, ${data.heroes.length} heroes, newest card ${data.meta.newestCard}`);
  console.log(`  Your collection: ${kept} cards (${Object.keys(collection).length} different)` + (other ? `; ${other} other things skipped (heroes, combos and similar)` : ""));
  console.log('\nNext: open Throwdown Deck Lab, go to Collection, and load this file under "Load my game export".');
}
main().catch((err) => {
  console.error(`
Stopped: ${err.message}`);
  process.exitCode = 1;
});
