// Page behaviour: tabs, collection, combo finder, battleground effects, builds.
import {
  createDb, makeUnit, makeCombo, setBge, maxLevel, describeSkills, levelLabel, ownedLevels, ownedTotal,
  SHOWS, RARITY, KIND, TRAITS, SKILLS, skillName, cap,
} from './data.js';
import { runBuild, slim } from './job.js';

const $ = (id) => document.getElementById(id);
const KEY = 'throwdown-deck-lab:v1';
const TABS = ['build', 'collection', 'combos', 'bge', 'info'];
const EXAMPLE_BGE = {
  name: 'Example: Drunk cards hit harder',
  effects: [{ trait: 'drunk', show: 0, kind: 'skill', skill: 'strike', n: 6 }, { trait: 'drunk', show: 0, kind: 'hp', n: 25 }],
};

let db, raw, worker = null, jobId = 0;
const pending = new Map();
const store = {
  collection: {}, bges: [EXAMPLE_BGE], saved: [],
  prefs: { source: 'all', mode: 'offense', bge: -1, heroId: 0, size: 25, copies: 1, effort: 2 },
};
const ui = { kind: '', shown: 40, combo: 0, draft: [], result: null, resultLabel: '', busy: false, sel: {}, custom: false };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s) return;
    if (s.collection) store.collection = s.collection;
    if (Array.isArray(s.bges)) store.bges = s.bges;
    if (Array.isArray(s.saved)) store.saved = s.saved;
    Object.assign(store.prefs, s.prefs || {});
  } catch { /* storage unavailable: run without it */ }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* ignore */ }
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const fill = (el, ...kids) => { el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const option = (value, text, selected) => h('option', { value, text, selected: selected || null });
const owns = (c) => ownedTotal(c, store.collection[c.i]);
const ownedCount = () => {
  let n = 0;
  for (const id in store.collection) { const c = db.cards.get(Number(id)); if (c) n += owns(c); }
  return n;
};
const topLevel = (c) => Math.max(0, ...Object.entries(ownedLevels(c, store.collection[c.i])).filter((e) => e[1] > 0).map((e) => Number(e[0])));

// Tidy a collection from storage, a backup or an export: known cards only,
// sensible levels and counts, always in the { lv: { level: count } } shape.
function cleanCollection(data) {
  const next = {};
  for (const [id, o] of Object.entries(data || {})) {
    const c = db.cards.get(Number(id));
    if (!c) continue;
    const lv = {};
    for (const [l, n] of Object.entries(ownedLevels(c, o))) {
      const level = Math.max(1, Math.min(maxLevel(c), Math.floor(Number(l)) || maxLevel(c)));
      const count = Math.min(99, Math.floor(Number(n)) || 0);
      if (count > 0) lv[level] = Math.min(99, (lv[level] || 0) + count);
    }
    if (Object.keys(lv).length) next[id] = { lv };
  }
  return next;
}

// The card data from a game export is kept in the browser's database, since
// it is too large for ordinary page storage.
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    let open;
    try { open = indexedDB.open('throwdown-deck-lab', 1); } catch (e) { reject(e); return; }
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

function traitsText(t) {
  const bits = [KIND[t.kind] || '', SHOWS[t.type] || ''];
  if (t.traits && t.traits.length) bits.push(t.traits.map(cap).join(', '));
  return bits.filter(Boolean).join(' · ');
}

// One card line: name, attack/health, then type and skills underneath.
function cardRow(t, opts = {}) {
  const card = db.cards.get(t.id);
  const lvl = card && t.kind !== 'x' ? ` · ${levelLabel(card, t.level)}` : '';
  return h('div', { class: 'card' },
    h('span', { class: 'name' },
      h('span', { class: `pip r${t.rarity || 0}`, title: RARITY[t.rarity] || '' }),
      opts.count ? h('i', { text: `${opts.count}×` }) : null, t.name),
    h('span', { class: 'stat', text: t.kind === 'h' ? `${t.hp} health` : `${t.atk} / ${t.hp}` }),
    h('span', { class: 'meta', text: `${traitsText(t)}${lvl}` }),
    h('span', { class: 'meta', text: describeSkills(t) || 'No skills' }),
    opts.extra || null);
}

// ---- tabs -------------------------------------------------------------------

function showTab() {
  const name = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'build';
  for (const t of TABS) $(`tab-${t}`).hidden = t !== name;
  for (const a of document.querySelectorAll('nav a')) {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  if (name === 'build') syncBuildForm();
  if (name === 'collection') renderCollection();
  if (name === 'combos') renderCombos();
  if (name === 'bge') renderBges();
  window.scrollTo(0, 0);
}

// ---- build ------------------------------------------------------------------

function syncBuildForm() {
  const p = store.prefs;
  const owned = ownedCount();
  $('src-mine-label').textContent = `My collection (${owned})`;
  $(p.source === 'mine' ? 'src-mine' : 'src-all').checked = true;
  $(p.mode === 'defense' ? 'mode-def' : 'mode-off').checked = true;
  if (p.bge >= store.bges.length) p.bge = -1;
  fill($('f-bge'), option(-1, 'No effect', p.bge === -1), store.bges.map((b, i) => option(i, b.name, p.bge === i)));
  const heroes = [...db.heroes.values()].sort((a, b) => a.n.localeCompare(b.n));
  fill($('f-hero'), option(0, 'Best fit (auto)', !p.heroId), heroes.map((x) => option(x.i, `${x.n} (${SHOWS[x.t] || ''})`, p.heroId === x.i)));
  $('f-size').value = p.size; $('f-copies').value = p.copies; $('f-effort').value = p.effort;
}

function readBuildForm() {
  const p = store.prefs;
  p.source = $('src-mine').checked ? 'mine' : 'all';
  p.mode = $('mode-def').checked ? 'defense' : 'offense';
  p.bge = Number($('f-bge').value);
  p.heroId = Number($('f-hero').value);
  p.size = Number($('f-size').value); p.copies = Number($('f-copies').value); p.effort = Number($('f-effort').value);
  save();
}

function describeJob(p) {
  const bge = p.bge >= 0 && store.bges[p.bge] ? store.bges[p.bge].name : 'No battleground effect';
  return `${cap(p.mode)} · ${p.source === 'mine' ? 'My collection' : 'Every card'} · ${bge}`;
}

function startWorker() {
  try {
    const src = $('app-js').textContent;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = (e) => {
      const m = e.data, job = pending.get(m.id);
      if (!job) return;
      if (m.type === 'progress') job.progress(m.f, m.msg);
      else { pending.delete(m.id); if (m.type === 'done') job.resolve(m.res); else job.reject(new Error(m.error)); }
    };
    w.onerror = () => {
      worker = null;
      for (const [id, job] of pending) { pending.delete(id); job.retry(); }
    };
    w.postMessage({ type: 'init', raw });
    return w;
  } catch { return null; }
}

// Runs in the background worker when the browser allows it, otherwise on the
// page itself, pausing between steps so the screen stays responsive.
function build(job, progress) {
  const local = async () => {
    try {
      return slim(await runBuild(db, job, async (f, msg) => { progress(f, msg); await new Promise((r) => setTimeout(r)); }));
    } finally { setBge(db, null); }
  };
  if (!worker) return local();
  return new Promise((resolve, reject) => {
    const id = ++jobId;
    pending.set(id, { progress, resolve, reject, retry: () => local().then(resolve, reject) });
    worker.postMessage({ type: 'build', id, job });
  });
}

async function onBuild(e) {
  if (e) e.preventDefault();
  if (ui.busy) return;
  readBuildForm();
  const p = store.prefs;
  const err = $('build-err');
  err.hidden = true;
  if (p.source === 'mine' && ownedCount() < p.size) {
    err.textContent = `Your collection has ${ownedCount()} cards and a deck needs ${p.size}. Add cards on the Collection tab, or build from every card.`;
    err.hidden = false;
    return;
  }
  ui.busy = true;
  $('build-go').disabled = true;
  $('progress').hidden = false;
  const progress = (f, msg) => { $('progress-bar').style.width = `${Math.round(f * 100)}%`; $('progress-msg').textContent = msg; };
  progress(0, 'Starting');
  const job = {
    source: p.source, collection: p.source === 'mine' ? store.collection : null, copies: p.copies,
    mode: p.mode, size: p.size, effort: p.effort, heroId: p.heroId,
    bge: p.bge >= 0 ? store.bges[p.bge] : null,
  };
  try {
    ui.result = await build(job, progress);
    ui.resultLabel = describeJob(p);
    renderResult();
  } catch (ex) {
    err.textContent = ex.message || 'The build failed.';
    err.hidden = false;
  }
  ui.busy = false;
  $('build-go').disabled = false;
  $('progress').hidden = true;
}

function deckBody(res) {
  const groups = [['c', 'Characters'], ['o', 'Items'], ['p', 'Power cards']];
  const out = [h('div', {}, h('h3', { text: 'Hero' }), h('div', { class: 'cards' }, cardRow(res.hero)))];
  for (const [k, label] of groups) {
    const list = res.cards.filter((c) => c.t.kind === k);
    if (!list.length) continue;
    const n = list.reduce((s, c) => s + c.n, 0);
    out.push(h('div', {}, h('h3', { text: `${label} · ${n}` }), h('div', { class: 'cards' }, list.map((c) => cardRow(c.t, { count: c.n })))));
  }
  if (res.combos.length) {
    out.push(h('div', {},
      h('h3', { text: `Best combos · ${res.comboCount} possible` }),
      h('div', { class: 'cards' }, res.combos.map((c) => h('div', { class: 'combo' },
        h('span', { class: 'from', text: `${c.a.name} + ${c.b.name}` }),
        cardRow(c.x))))));
  }
  return out;
}

function scoreLine(res) {
  const verb = res.mode === 'defense' ? 'defenses held' : 'battles won';
  return h('div', { class: 'score' },
    h('b', { text: `${Math.round(res.winRate * 100)}%` }),
    h('span', { text: `${verb} in ${res.games} simulated fights against other strong decks built from the same cards` }));
}

function renderResult() {
  const res = ui.result;
  if (!res) { fill($('result')); return; }
  const saveBtn = h('button', { class: 'btn', type: 'button', text: 'Save this deck', onclick: () => {
    store.saved.unshift({ label: ui.resultLabel, date: new Date().toISOString().slice(0, 10), res });
    store.saved = store.saved.slice(0, 20);
    save(); renderSaved();
    saveBtn.textContent = 'Saved'; saveBtn.disabled = true;
  } });
  fill($('result'), h('article', { class: 'panel' },
    h('p', { class: 'eyebrow', text: ui.resultLabel }),
    h('h2', { text: `Recommended ${res.size}-card deck` }),
    scoreLine(res), deckBody(res), saveBtn));
}

function renderSaved() {
  $('saved-wrap').hidden = !store.saved.length;
  fill($('saved'), store.saved.map((s, i) => h('details', { class: 'panel' },
    h('summary', { text: `${s.label} · ${Math.round(s.res.winRate * 100)}% · ${s.date}` }),
    h('div', { class: 'tab' }, scoreLine(s.res), deckBody(s.res),
      h('button', { class: 'btn danger small', type: 'button', text: 'Delete', onclick: () => { store.saved.splice(i, 1); save(); renderSaved(); } })))));
}

// ---- collection -------------------------------------------------------------

function collectionMatches() {
  const q = $('c-search').value.trim().toLowerCase();
  const rarity = Number($('c-rarity').value), show = Number($('c-show').value), owned = $('c-owned').checked;
  const out = [];
  for (const c of db.cards.values()) {
    if (ui.kind && c.k !== ui.kind) continue;
    if (rarity && c.r !== rarity) continue;
    if (show && c.t !== show) continue;
    if (owned && !owns(c)) continue;
    if (q && !c.n.toLowerCase().includes(q) && !c.tr.some((t) => t.includes(q))) continue;
    out.push(c);
  }
  return out.sort((a, b) => b.r - a.r || a.n.localeCompare(b.n));
}

function collectionRow(c) {
  const lv = { ...ownedLevels(c, store.collection[c.i]) };
  const total = owns(c);
  const held = Object.keys(lv).filter((l) => lv[l] > 0).map(Number).sort((a, b) => b - a);
  const sel = ui.sel[c.i] || held[0] || maxLevel(c);
  const t = makeUnit(db, c.i, sel);
  const commit = () => {
    for (const l in lv) if (!(lv[l] > 0)) delete lv[l];
    if (Object.keys(lv).length) store.collection[c.i] = { lv }; else delete store.collection[c.i];
    save();
    row.replaceWith(collectionRow(c));
    $('c-summary').textContent = `${ownedCount()} cards owned`;
  };
  const add = (d) => { lv[sel] = Math.max(0, Math.min(99, (lv[sel] || 0) + d)); ui.sel[c.i] = sel; commit(); };
  const pickLevel = (to) => {
    // With copies at a single level, changing the level re-levels them all.
    if (held.length === 1 && to !== held[0]) { lv[to] = lv[held[0]]; delete lv[held[0]]; }
    ui.sel[c.i] = to;
    commit();
  };
  const levels = [];
  for (let l = maxLevel(c); l >= 1; l--) levels.push(option(l, levelLabel(c, l) + (lv[l] > 0 && held.length > 1 ? ` (${lv[l]} owned)` : ''), l === sel));
  const controls = h('span', { class: 'own' },
    h('button', { class: 'btn', type: 'button', text: '−', 'aria-label': `Remove one ${c.n}`, disabled: !(lv[sel] > 0), onclick: () => add(-1) }),
    h('output', { text: String(total) }),
    h('button', { class: 'btn', type: 'button', text: '+', 'aria-label': `Add one ${c.n}`, onclick: () => add(1) }),
    total ? h('select', { 'aria-label': `Level of ${c.n}`, onchange: (e) => pickLevel(Number(e.target.value)) }, levels) : null,
    held.length > 1 ? h('span', { class: 'meta', text: `Owned: ${held.map((l) => `${lv[l]} at ${levelLabel(c, l)}`).join(', ')}. + and − change the level shown.` }) : null);
  const row = cardRow(t, { extra: controls });
  return row;
}

function renderCollection() {
  const list = collectionMatches();
  $('c-summary').textContent = `${ownedCount()} cards owned`;
  fill($('c-list'), list.length
    ? list.slice(0, ui.shown).map(collectionRow)
    : h('p', { class: 'note', text: $('c-owned').checked ? 'No owned cards match. Untick "Show only cards I own" to add some.' : 'No cards match that search.' }));
  $('c-more').hidden = list.length <= ui.shown;
  $('c-more').textContent = `Show more (${list.length - ui.shown} left)`;
  $('c-io').value = JSON.stringify(store.collection);
}

function wireCollection() {
  fill($('c-rarity'), option(0, 'Any rarity'), [5, 4, 3, 2, 1].map((r) => option(r, RARITY[r])));
  fill($('c-show'), option(0, 'Any show'), Object.entries(SHOWS).map(([k, v]) => option(k, v)));
  const reset = () => { ui.shown = 40; renderCollection(); };
  for (const id of ['c-search', 'c-rarity', 'c-show', 'c-owned']) $(id).addEventListener('input', reset);
  for (const b of $('c-kind').children) {
    b.addEventListener('click', () => {
      ui.kind = b.dataset.k;
      for (const o of $('c-kind').children) o.setAttribute('aria-pressed', String(o === b));
      reset();
    });
  }
  $('c-more').addEventListener('click', () => { ui.shown += 60; renderCollection(); });
  const msg = (t) => { $('c-io-msg').textContent = t; };
  $('c-copy').addEventListener('click', async () => {
    $('c-io').value = JSON.stringify(store.collection);
    try { await navigator.clipboard.writeText($('c-io').value); msg('Copied.'); }
    catch { $('c-io').select(); msg('Text selected. Copy it with your keyboard or the pop-up menu.'); }
  });
  $('c-load').addEventListener('click', () => {
    try {
      const next = cleanCollection(JSON.parse($('c-io').value));
      store.collection = next; ui.sel = {}; save(); renderCollection();
      msg(`Loaded ${Object.keys(next).length} different cards.`);
    } catch { msg('That text is not a collection backup. Paste the text exactly as it was copied.'); }
  });
  let armed = 0;
  $('c-clear').addEventListener('click', () => {
    if (Date.now() - armed < 4000) {
      store.collection = {}; ui.sel = {}; save(); renderCollection(); armed = 0;
      $('c-clear').textContent = 'Clear collection'; msg('Collection cleared.');
    } else { armed = Date.now(); $('c-clear').textContent = 'Tap again to clear'; }
  });
}

// ---- game export ------------------------------------------------------------

function useData(next, custom) {
  raw = next; ui.custom = custom;
  db = createDb(raw);
  if (worker) { worker.terminate(); pending.clear(); }
  worker = startWorker();
  const newest = new Date(`${raw.meta.newestCard}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', timeZone: 'UTC' });
  $('data-date').textContent = custom ? `My export ${raw.meta.exported || ''}` : `Cards to ${newest}`;
  $('info-data').textContent = custom
    ? `The app is using your game export from ${raw.meta.exported || 'an unknown date'}: ${db.cards.size.toLocaleString()} cards and ${db.heroes.size} heroes, newest from ${newest}.`
    : `The app knows ${db.cards.size.toLocaleString()} cards and ${db.heroes.size} heroes, up to ${newest}.`;
  $('c-search').placeholder = `Search ${db.cards.size.toLocaleString()} cards`;
  $('g-status').textContent = custom
    ? `Using your game export from ${raw.meta.exported || 'an unknown date'} (${db.cards.size.toLocaleString()} cards).`
    : 'Using the built-in card data.';
  $('g-reset').hidden = !custom;
  if (!db.cards.has(ui.combo)) { const p = [...db.cards.values()].find((c) => c.k === 'c'); ui.combo = p ? p.i : 0; }
  store.collection = cleanCollection(store.collection);
  ui.sel = {};
}

function wireExport() {
  const msg = (t, bad) => { $('g-msg').textContent = t; $('g-msg').className = bad ? 'err' : 'note'; };
  $('g-file').addEventListener('change', async () => {
    const file = $('g-file').files[0];
    if (!file) return;
    msg('Reading the file…');
    try {
      const x = JSON.parse(await file.text());
      const d = x && x.data;
      if (x.format !== 'deck-lab-export' || !d || !Array.isArray(d.cards) || !Array.isArray(d.heroes) || !d.combos || !Array.isArray(d.recipeSets) || !d.charSet || !d.meta) {
        throw new Error('not an export');
      }
      let kept = true;
      try { await idb('readwrite', (s) => s.put(d, 'data')); } catch { kept = false; }
      useData(d, true);
      store.collection = cleanCollection(x.collection);
      save();
      renderCollection(); syncBuildForm();
      msg(`Loaded ${db.cards.size.toLocaleString()} cards and your collection of ${ownedCount()} cards.` +
        (kept ? '' : ' This browser would not store the card data, so you will need to load the file again next time.'));
    } catch {
      msg('That file is not a Deck Lab export. Choose the deck-lab-export.json file the script created.', true);
    }
    $('g-file').value = '';
  });
  $('g-reset').addEventListener('click', async () => {
    try { await idb('readwrite', (s) => s.delete('data')); } catch { /* nothing stored */ }
    try {
      const res = await fetch('data/cards.json');
      useData(await res.json(), false);
      save(); renderCollection(); syncBuildForm();
      msg('Back on the built-in card data. Cards it does not know were removed from your collection.');
    } catch { msg('The built-in card data could not be loaded. Check your connection.', true); }
  });
}

// ---- combo finder -----------------------------------------------------------

function ownedUnit(c) {
  return makeUnit(db, c.i, topLevel(c));
}

function renderCombos() {
  const q = $('x-search').value.trim().toLowerCase();
  const pickable = [...db.cards.values()].filter((c) => c.k !== 'p');
  let matches = q ? pickable.filter((c) => c.n.toLowerCase().includes(q)) : [];
  matches = matches.sort((a, b) => b.r - a.r || a.n.localeCompare(b.n)).slice(0, 10);
  fill($('x-matches'), matches.map((c) => h('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(c.i === ui.combo),
    text: `${c.n} · ${RARITY[c.r]} ${KIND[c.k].toLowerCase()}`,
    onclick: () => { ui.combo = c.i; renderCombos(); },
  })));
  const card = db.cards.get(ui.combo);
  if (!card) { fill($('x-out')); return; }
  const me = ownedUnit(card);
  const onlyOwned = $('x-owned').checked;
  const groups = new Map();
  for (const c of db.cards.values()) {
    if (c.k === 'p' || c.k === card.k) continue;
    if (onlyOwned && !owns(c)) continue;
    const other = ownedUnit(c);
    const x = makeCombo(db, me, other);
    if (!x) continue;
    const g = groups.get(x.id);
    if (!g) groups.set(x.id, { best: x, partner: other, names: [c.n] });
    else { g.names.push(c.n); if (x.value > g.best.value) { g.best = x; g.partner = other; } }
  }
  const list = [...groups.values()].sort((a, b) => b.best.value - a.best.value);
  const partnerWord = card.k === 'c' ? 'item' : 'character';
  fill($('x-out'),
    h('div', { class: 'panel' }, h('h3', { text: 'Selected card' }), h('div', { class: 'cards' }, cardRow(me))),
    list.length
      ? h('div', { class: 'panel' },
        h('h3', { text: `${list.length} different combos` }),
        h('div', { class: 'cards' }, list.slice(0, 60).map((g) => {
          const others = [...new Set(g.names)].filter((n) => n !== g.partner.name);
          const more = others.length ? `, or ${others.length} other ${partnerWord}${others.length > 1 ? 's' : ''}: ${others.slice(0, 6).join(', ')}${others.length > 6 ? '…' : ''}` : '';
          return h('div', { class: 'combo' }, h('span', { class: 'from', text: `with ${g.partner.name}${more}` }), cardRow(g.best));
        })))
      : h('p', { class: 'note', text: onlyOwned ? `Nothing you own combines with this card yet. Untick "Only partners I own" to see every ${partnerWord}.` : 'This card has no combos in the data.' }));
}

// ---- battleground effects ---------------------------------------------------

function effectText(e) {
  const who = e.trait ? `${cap(e.trait)} cards` : e.show ? `${SHOWS[e.show]} cards` : 'All cards';
  if (e.kind === 'hp') return `${who}: +${e.n}% health`;
  if (e.kind === 'atk') return `${who}: +${e.n}% attack`;
  if (e.kind === 'grant') return `${who}: gain ${skillName(e.skill)} ${e.n}`;
  return `${who}: +${e.n} ${skillName(e.skill)}`;
}

function renderBges() {
  const active = store.prefs.bge;
  fill($('b-list'), store.bges.length
    ? store.bges.map((b, i) => h('div', { class: 'panel' },
      h('div', { class: 'split' }, h('strong', { text: b.name }), i === active ? h('span', { class: 'pill', text: 'In use' }) : null),
      h('ul', { class: 'note' }, b.effects.map((e) => h('li', { text: effectText(e) }))),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', text: i === active ? 'Stop using' : 'Use for builds',
          onclick: () => { store.prefs.bge = i === active ? -1 : i; save(); renderBges(); } }),
        h('button', { class: 'btn small danger', type: 'button', text: 'Delete', onclick: () => {
          store.bges.splice(i, 1);
          store.prefs.bge = active === i ? -1 : active > i ? active - 1 : active;
          save(); renderBges();
        } }))))
    : h('p', { class: 'note', text: 'No effects saved yet. Add the current one below.' }));
  fill($('b-effects'), ui.draft.map((e, i) => h('div', { class: 'card' },
    h('span', { class: 'name', text: effectText(e) }),
    h('button', { class: 'btn small', type: 'button', text: 'Remove', onclick: () => { ui.draft.splice(i, 1); renderBges(); } }))));
  $('b-skill-wrap').hidden = !['skill', 'grant'].includes($('b-kind').value);
}

function wireBges() {
  fill($('b-target'), option('', 'All cards'),
    TRAITS.map((t) => option(`t:${t}`, `${cap(t)} cards`)),
    Object.entries(SHOWS).map(([k, v]) => option(`s:${k}`, `${v} cards`)));
  const skills = Object.keys(SKILLS).filter((k) => !['give', 'giveall', 'globalhealth', 'fast'].includes(k))
    .sort((a, b) => skillName(a).localeCompare(skillName(b)));
  fill($('b-skill'), skills.map((k) => option(k, skillName(k), k === 'strike')));
  $('b-kind').addEventListener('change', renderBges);
  const err = (t) => { $('b-err').textContent = t; $('b-err').hidden = !t; };
  const draftEffect = () => {
    const n = Math.floor(Number($('b-n').value));
    if (!(n > 0)) { err('Enter an amount above zero.'); return null; }
    const target = $('b-target').value;
    return {
      trait: target.startsWith('t:') ? target.slice(2) : '', show: target.startsWith('s:') ? Number(target.slice(2)) : 0,
      kind: $('b-kind').value, skill: $('b-skill').value, n,
    };
  };
  $('b-add').addEventListener('click', () => {
    err('');
    const e = draftEffect();
    if (e) { ui.draft.push(e); renderBges(); }
  });
  $('b-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    err('');
    if (!ui.draft.length) { const e = draftEffect(); if (!e) return; ui.draft.push(e); }
    const name = $('b-name').value.trim() || `Effect ${store.bges.length + 1}`;
    store.bges.push({ name, effects: ui.draft });
    store.prefs.bge = store.bges.length - 1;
    ui.draft = []; $('b-name').value = '';
    save(); renderBges();
  });
}

// ---- start ------------------------------------------------------------------

export async function start() {
  load();
  let data = null, custom = false;
  try { data = await idb('readonly', (s) => s.get('data')); custom = !!data; } catch { /* no stored export */ }
  if (!data) {
    try {
      const res = await fetch('data/cards.json');
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch {
      $('boot').textContent = 'The card data could not be loaded. Check your connection and reload the page.';
      $('boot').className = 'err';
      return;
    }
  }
  const peterFirst = (d) => { const p = d.cards.find((c) => c.n === 'Peter' && c.k === 'c'); return p ? p.i : 0; };
  ui.combo = peterFirst(data);
  useData(data, custom);
  $('boot').hidden = true;
  wireCollection(); wireBges(); wireExport();
  $('build-form').addEventListener('submit', onBuild);
  $('build-form').addEventListener('change', (e) => { if (e.target.closest('#progress') == null) readBuildForm(); });
  $('x-search').addEventListener('input', renderCombos);
  $('x-owned').addEventListener('change', renderCombos);
  window.addEventListener('hashchange', showTab);
  renderSaved();
  showTab();
  // Open with a real result on screen rather than an empty form.
  if (location.hash.slice(1) === 'build' || !location.hash) onBuild();
}
