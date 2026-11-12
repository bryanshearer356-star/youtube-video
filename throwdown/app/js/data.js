// Card database: turns the compact data file into battle-ready card templates.

export const SHOWS = {
  1: 'Family Guy', 2: 'American Dad', 3: "Bob's Burgers", 4: 'King of the Hill',
  5: 'Futurama', 6: 'Generic', 7: 'Archer',
};
export const RARITY = ['', 'Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
export const KIND = { c: 'Character', o: 'Item', p: 'Power card', x: 'Combo', h: 'Hero' };
export const TRAITS = [
  'addicted', 'animal', 'armed', 'artistic', 'athletic', 'disguised', 'drunk', 'educated',
  'fighter', 'food', 'hyper', 'musical', 'rich', 'toy', 'vehicle',
];

// Internal skill id -> in-game name, and the game's own per-point "power" weight
// for each skill (used for the quick card rating; the simulator has the last word).
export const SKILLS = {
  strike: ['Punch', 4], pierce: ['Jab', 1], armored: ['Sturdy', 2], counter: ['Payback', 2],
  weaken: ['Cripple', 2], weakenall: ['Cripple All', 10], poison: ['Gas', 3],
  barrier: ['Shield', 2], barrierall: ['Shield All', 10], invigorate: ['Boost', 4],
  outlast: ['Recover', 3], rally: ['Cheer', 3], rallyall: ['Cheer All', 15],
  heal: ['Heal', 2], healall: ['Heal All', 10], leech: ['Leech', 2], inspire: ['Motivate', 4],
  shrapnel: ['Bomb', 5], berserk: ['Crazed', 4], hijack: ['Hijack', 3],
  bodyguard: ['Bodyguard', 2], give: ['Give', 4], giveall: ['Give All', 12],
  enlarge: ['Enlarge', 2], bunker: ['Bunker', 2], burn: ['Burn', 3],
  backslap: ['Backslap', 2], enrage: ['Enrage', 3], globalhealth: ['Hero Health', 0],
  fast: ['Fast', 5],
};
const DEFENSIVE = new Set(['armored', 'counter', 'barrier', 'barrierall', 'heal', 'healall',
  'bunker', 'bodyguard', 'backslap', 'enrage', 'outlast', 'enlarge']);

export const skillName = (id) => (SKILLS[id] ? SKILLS[id][0] : id);
const yVal = (y) => (y === 0 || y === undefined || y === '' ? 0 : /^\d+$/.test(String(y)) ? Number(y) : y);

export function createDb(raw) {
  const db = {
    meta: raw.meta,
    cards: new Map(raw.cards.map((c) => [c.i, c])),
    heroes: new Map(raw.heroes.map((c) => [c.i, c])),
    combos: raw.combos,
    charSet: raw.charSet,
    recipe: raw.recipeSets.map((set) => {
      const m = new Map();
      for (const [out, objs] of Object.entries(set)) for (const o of objs) m.set(o, Number(out));
      return m;
    }),
    bge: null,
    base: new Map(),
    live: new Map(),
    comboCache: new Map(),
  };
  return db;
}

/** Switch the active battleground effect (null for none). Clears derived caches. */
export function setBge(db, bge) {
  db.bge = bge && bge.effects && bge.effects.length ? bge : null;
  db.live.clear();
  db.comboCache.clear();
}

export const maxLevel = (card) => card.a.length;

function skillsAt(card, lvl) {
  for (let i = lvl - 1; i >= 0; i--) if (card.s[i]) return card.s[i];
  return [];
}

function template(id, name, kind, type, traits, atk, hp, level) {
  return { id, name, kind, type, traits, atk, hp, level, sk: {}, sy: {}, give: null, power: 0, value: 0, dvalue: 0 };
}

function addSkill(t, id, x, y, s) {
  if (id === 'give' || id === 'giveall') {
    (t.give ||= []).push({ s, x, all: id === 'giveall' });
    return;
  }
  if (x <= 0 && id !== 'fast') return;
  t.sk[id] = x;
  if (y) t.sy[id] = y;
}

function rate(t) {
  t.power = 3 * t.atk + t.hp;
  let off = t.power, def = 2 * t.atk + 1.6 * t.hp;
  for (const id in t.sk) {
    const w = (SKILLS[id] ? SKILLS[id][1] : 2) * t.sk[id];
    off += w;
    def += DEFENSIVE.has(id) ? w * 1.4 : w * 0.9;
  }
  if (t.give) for (const g of t.give) { const w = (g.all ? 12 : 4) * g.x; off += w; def += w; }
  t.value = off;
  t.dvalue = def;
  return t;
}

function matches(t, e) {
  if (e.trait && !t.traits.includes(e.trait)) return false;
  if (e.show && t.type !== e.show) return false;
  return true;
}

function withBge(db, t) {
  if (!db.bge) return t;
  let out = null;
  for (const e of db.bge.effects) {
    if (!matches(t, e)) continue;
    const n = Number(e.n) || 0;
    if (!n) continue;
    if (!out) out = { ...t, sk: { ...t.sk }, sy: { ...t.sy } };
    if (e.kind === 'hp') out.hp = Math.round(out.hp * (1 + n / 100));
    else if (e.kind === 'atk') out.atk = Math.round(out.atk * (1 + n / 100));
    else if (e.kind === 'skill') { if (out.sk[e.skill]) out.sk[e.skill] += n; }
    else if (e.kind === 'grant') out.sk[e.skill] = Math.max(out.sk[e.skill] || 0, n);
  }
  return out ? rate(out) : t;
}

function baseUnit(db, id, lvl) {
  const key = id * 32 + lvl;
  let t = db.base.get(key);
  if (t) return t;
  const hero = db.heroes.get(id);
  const c = hero || db.cards.get(id);
  if (!c) return null;
  lvl = Math.max(1, Math.min(lvl || maxLevel(c), maxLevel(c)));
  t = template(id, c.n, hero ? 'h' : c.k, c.t, c.tr, c.a[lvl - 1], c.h[lvl - 1], lvl);
  t.rarity = c.r || 0;
  for (const s of skillsAt(c, lvl)) addSkill(t, s[0], s[1], yVal(s[2]), s[3]);
  rate(t);
  db.base.set(key, t);
  return t;
}

/** A deck card (or hero) at a level, with the active BGE applied. Level 0 = max. */
export function makeUnit(db, id, lvl = 0) {
  const c = db.heroes.get(id) || db.cards.get(id);
  if (!c) return null;
  if (!lvl || lvl > maxLevel(c)) lvl = maxLevel(c);
  const key = id * 32 + lvl;
  let t = db.live.get(key);
  if (!t) {
    const b = baseUnit(db, id, lvl);
    t = withBge(db, b);
    if (t !== b) t.base = b;
    db.live.set(key, t);
  }
  return t;
}

export function comboId(db, charId, itemId) {
  const s = db.charSet[charId];
  return s === undefined ? 0 : db.recipe[s].get(itemId) || 0;
}

/**
 * The combo made by a character and an item (either order). Returns null when
 * the pair does not combine. Stats follow the community-documented formula:
 * combined stats scale with both cards' power, so higher-level inputs give a
 * stronger combo.
 */
export function makeCombo(db, a, b) {
  let ch = a, it = b;
  if (a.kind === 'o' && b.kind === 'c') { ch = b; it = a; }
  else if (!(a.kind === 'c' && b.kind === 'o')) return null;
  const key = ((ch.id * 32 + ch.level) * 4194304) + (it.id * 32 + it.level);
  const hit = db.comboCache.get(key);
  if (hit !== undefined) return hit;
  let res = null;
  const out = comboId(db, ch.id, it.id);
  const def = out && db.combos[out];
  if (def) {
    const cb = ch.base || ch, ib = it.base || it;
    const mix = (x, y, m) => Math.max(x, y, Math.ceil(1.1 * (x + y) * m));
    const t = template(out, def.n, 'x', def.t, def.tr, mix(cb.atk, ib.atk, def.am), mix(cb.hp, ib.hp, def.hm), 1);
    const power = 1.1 * (cb.power + ib.power);
    for (const s of def.s) {
      const p = s[1], v = s[2];
      const x = p >= 100 ? v : Math.floor(((v - 1) * (power - p)) / (100 - p) + 1);
      addSkill(t, s[0], x, yVal(s[3]));
    }
    t.from = [ch, it];
    res = withBge(db, rate(t));
    if (res !== t) res.from = t.from;
  }
  db.comboCache.set(key, res);
  return res;
}

/** Human-readable skill list, e.g. "Punch 6, Cheer All 4 (Drunk)". */
export function describeSkills(t) {
  const parts = [];
  for (const id in t.sk) {
    const y = t.sy[id];
    const who = y ? ` (${typeof y === 'number' ? SHOWS[y] || y : cap(y)})` : '';
    parts.push(id === 'fast' ? 'Fast' : `${skillName(id)} ${t.sk[id]}${who}`);
  }
  if (t.give) for (const g of t.give) parts.push(`${g.all ? 'Give All' : 'Give'} ${skillName(g.s)} ${g.x}`);
  return parts.join(', ');
}
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Level 14 of 18 (2 fusions)"-style label for a card level. */
export function levelLabel(card, lvl) {
  const max = maxLevel(card);
  const per = max / 3;
  if (!Number.isInteger(per)) return `Lv ${lvl}/${max}`;
  const stage = Math.min(2, Math.floor((lvl - 1) / per));
  return `${'★'.repeat(stage)}${stage ? ' ' : ''}Lv ${lvl - stage * per}/${per}`;
}
