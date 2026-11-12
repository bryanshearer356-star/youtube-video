// Battle simulator. An approximation of the game's rules built from the
// in-game skill descriptions; see README for the assumptions it makes.
import { makeCombo } from './data.js';

export const RULES = {
  slots: 5,       // cards each side can have in play
  hand: 5,        // hand size (start full, draw one per turn)
  turnLimit: 50,  // attacker loses if the defender's hero survives this many rounds
};

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit(t) {
  return {
    t, sk: t.sk, sy: t.sy, give: t.give, atk: t.atk, hp: t.hp, max: t.hp,
    tmp: 0, hj: 0, crip: 0, poison: 0, shield: 0, burn: 0,
    ready: t.sk.fast !== undefined, done: false,
  };
}

function side(spec, rand) {
  const deck = spec.deck.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const x = deck[i]; deck[i] = deck[j]; deck[j] = x;
  }
  const hero = spec.hero;
  return {
    hero: { sk: hero ? hero.sk : {}, sy: hero ? hero.sy : {}, give: hero ? hero.give : null, isHero: true },
    hp: hero ? hero.hp : 50,
    hand: deck.splice(0, RULES.hand), deck, board: [], policy: spec.policy || 'smart',
  };
}

const fits = (u, y) => !y || (typeof y === 'number' ? u.t.type === y : u.t.traits.includes(y));
const pick = (list, rand) => (list.length ? list[(rand() * list.length) | 0] : null);

// Attack increases can be partly stolen by a Hijack card standing opposite.
function gain(me, foe, u, x, temp) {
  const opp = foe.board[me.board.indexOf(u)];
  if (opp && opp.sk.hijack) {
    const st = Math.min(opp.sk.hijack, x);
    x -= st; opp.hj += st;
  }
  if (temp) u.tmp += x; else u.atk += x;
}

function hurt(owner, u, dmg, foe) {
  if (dmg <= 0) return 0;
  u.hp -= dmg;
  if (u.hp > 0 && u.sk.enrage) gain(owner, foe, u, u.sk.enrage, false);
  return dmg;
}

// Damage from a skill: reduced by the best Bodyguard nearby, then by shields.
function skillHit(owner, u, x, foe) {
  const i = owner.board.indexOf(u);
  let bg = u.sk.bodyguard || 0;
  const l = owner.board[i - 1], r = owner.board[i + 1];
  if (l && l.sk.bodyguard > bg) bg = l.sk.bodyguard;
  if (r && r.sk.bodyguard > bg) bg = r.sk.bodyguard;
  x -= bg;
  if (x <= 0) return 0;
  const sh = Math.min(u.shield, x);
  u.shield -= sh;
  return hurt(owner, u, x - sh, foe);
}

const reap = (s) => { if (s.board.some((u) => u.hp <= 0)) s.board = s.board.filter((u) => u.hp > 0); };

function backslap(me, foe, src, target) {
  if (target.sk.backslap && !src.isHero && target.hp > 0) skillHit(me, src, target.sk.backslap, foe);
}

function runSkills(me, foe, src, rand) {
  const sk = src.sk, sy = src.sy;
  const allies = (id) => me.board.filter((u) => u !== src && u.hp > 0 && fits(u, sy[id]));
  const enemies = (id) => foe.board.filter((u) => u.hp > 0 && fits(u, sy[id]));
  if (src.give) {
    for (const g of src.give) {
      const targets = g.all ? allies('give') : [pick(allies('give'), rand)];
      for (const u of targets) {
        if (!u || (u.sk[g.s] || 0) >= g.x) continue;
        u.sk = { ...u.sk, [g.s]: g.x };
      }
    }
  }
  if (sk.heal) {
    const u = pick(allies('heal').filter((a) => a.hp < a.max), rand);
    if (u) u.hp = Math.min(u.max, u.hp + sk.heal);
  }
  if (sk.healall) for (const u of allies('healall')) u.hp = Math.min(u.max, u.hp + sk.healall);
  if (sk.bunker && !src.isHero) src.shield += sk.bunker;
  if (sk.burn) {
    let best = null;
    for (const u of enemies('burn')) if (!best || u.hp > best.hp) best = u;
    if (best) {
      skillHit(foe, best, sk.burn + best.burn, me);
      best.burn = sk.burn;
      backslap(me, foe, src, best);
    }
  }
  if (sk.barrier) { const u = pick(allies('barrier'), rand); if (u) u.shield += sk.barrier; }
  if (sk.barrierall) for (const u of allies('barrierall')) u.shield += sk.barrierall;
  if (sk.rally) {
    const u = pick(allies('rally').filter((a) => !a.done), rand);
    if (u) gain(me, foe, u, sk.rally, true);
  }
  if (sk.rallyall) for (const u of allies('rallyall')) if (!u.done) gain(me, foe, u, sk.rallyall, true);
  if (sk.strike) {
    const u = pick(enemies('strike'), rand);
    if (u) { skillHit(foe, u, sk.strike, me); backslap(me, foe, src, u); }
  }
  if (sk.weaken) {
    const u = pick(enemies('weaken'), rand);
    if (u) { u.crip += sk.weaken; backslap(me, foe, src, u); }
  }
  if (sk.weakenall) for (const u of enemies('weakenall')) { u.crip += sk.weakenall; backslap(me, foe, src, u); }
  reap(foe); reap(me);
}

function attack(me, foe, u) {
  const i = me.board.indexOf(u);
  let a = u.atk + u.tmp + u.hj - u.crip;
  const l = me.board[i - 1], r = me.board[i + 1];
  if (l && l.sk.inspire && fits(u, l.sy.inspire)) a += l.sk.inspire;
  if (r && r.sk.inspire && fits(u, r.sy.inspire)) a += r.sk.inspire;
  u.done = true;
  if (a <= 0) return;
  const target = foe.board[i];
  if (!target) { foe.hp -= a; return; }
  const jab = u.sk.pierce || 0;
  const block = Math.max(0, (target.sk.armored || 0) + target.shield - jab);
  const blocked = Math.min(a, block);
  target.shield = Math.max(0, target.shield - Math.max(0, blocked - (target.sk.armored || 0)));
  const dealt = hurt(foe, target, a - blocked, me);
  if (dealt > 0) {
    if (u.sk.poison && u.sk.poison > target.poison) target.poison = u.sk.poison;
    if (u.sk.leech) u.hp = Math.min(u.max, u.hp + u.sk.leech);
    if (u.sk.berserk) gain(me, foe, u, u.sk.berserk, false);
  }
  if (u.sk.shrapnel) {
    const tl = foe.board[i - 1], tr = foe.board[i + 1];
    if (tl && fits(tl, u.sy.shrapnel)) skillHit(foe, tl, u.sk.shrapnel, me);
    if (tr && fits(tr, u.sy.shrapnel)) skillHit(foe, tr, u.sk.shrapnel, me);
  }
  if (target.hp > 0 && target.sk.counter) skillHit(me, u, target.sk.counter, foe);
}

// ---- choosing what to play -------------------------------------------------

function comboBonus(me) {
  let b = 0;
  for (const u of me.board) b += (u.sk.invigorate || 0) * 4 + (u.sk.outlast || 0) * 3;
  return b;
}

// "smart": stands in for a person playing well. Looks one move ahead.
function smartMove(db, me, key) {
  let best = null, bestScore = -Infinity;
  const seen = new Set();
  const room = me.board.length < RULES.slots;
  const bonus = comboBonus(me);
  for (let h = 0; h < me.hand.length; h++) {
    const c = me.hand[h];
    if (seen.has(c)) continue;
    seen.add(c);
    if (room) {
      let s = c[key];
      if (c.kind !== 'p') {
        // A card that will combine with something else in hand is worth setting up.
        let follow = 0;
        for (const o of me.hand) {
          if (o === c || o.kind === 'p' || o.kind === c.kind) continue;
          const x = makeCombo(db, c, o);
          if (x && x[key] > follow) follow = x[key];
        }
        s = follow ? s + 0.35 * follow : s * (c.kind === 'o' ? 0.6 : 0.8);
      }
      if (s > bestScore) { bestScore = s; best = { h, b: -1 }; }
    }
    if (c.kind === 'p') continue;
    for (let b = 0; b < me.board.length; b++) {
      const u = me.board[b];
      if (u.t.kind === 'p' || u.t.kind === 'x' || u.t.kind === c.kind) continue;
      const x = makeCombo(db, u.t, c);
      if (!x) continue;
      const s = x[key] * 1.15 - u.t[key] * (u.hp / u.max) * 0.5 + bonus;
      if (s > bestScore) { bestScore = s; best = { h, b, x }; }
    }
  }
  return best;
}

// "auto": stands in for the computer running a deck on defense. It plays a
// random card and combines it when it happens to be able to.
function autoMove(db, me, rand) {
  const order = me.hand.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const x = order[i]; order[i] = order[j]; order[j] = x;
  }
  for (const h of order) {
    const c = me.hand[h];
    if (c.kind !== 'p') {
      for (let b = 0; b < me.board.length; b++) {
        const u = me.board[b];
        if (u.t.kind === 'p' || u.t.kind === 'x' || u.t.kind === c.kind) continue;
        const x = makeCombo(db, u.t, c);
        if (x) return { h, b, x };
      }
    }
    if (me.board.length < RULES.slots) return { h, b: -1 };
  }
  return null;
}

function play(me, foe, mv) {
  const c = me.hand[mv.h];
  me.hand.splice(mv.h, 1);
  const u = unit(mv.b < 0 ? c : mv.x);
  if (u.sk.enlarge) { u.max += u.sk.enlarge * foe.board.length; u.hp = u.max; }
  if (mv.b < 0) { me.board.push(u); return; }
  me.board[mv.b] = u;
  for (const o of me.board) {
    if (o === u) continue;
    if (o.sk.invigorate) gain(me, foe, o, o.sk.invigorate, false);
    if (o.sk.outlast) { o.max += o.sk.outlast; o.hp += o.sk.outlast; }
  }
}

function turn(db, me, foe, rand, key) {
  for (const u of me.board) { u.tmp = 0; u.shield = 0; u.done = false; u.ready = true; }
  if (me.hand.length < RULES.hand && me.deck.length) me.hand.push(me.deck.pop());
  const mv = me.policy === 'auto' ? autoMove(db, me, rand) : smartMove(db, me, key);
  if (mv) play(me, foe, mv);
  runSkills(me, foe, me.hero, rand);
  for (const u of me.board.slice()) {
    if (u.hp <= 0 || !u.ready) continue;
    runSkills(me, foe, u, rand);
    if (u.hp <= 0) continue;
    attack(me, foe, u);
    reap(foe); reap(me);
    if (foe.hp <= 0) return;
  }
  for (const u of me.board) {
    if (u.poison) u.hp -= u.poison;
    u.crip = 0; u.hj = 0;
  }
  reap(me);
}

/**
 * Plays one battle. `attacker` moves first. Each side is
 * { hero, deck: [templates], policy: 'smart' | 'auto' }.
 * Returns true when the attacker wins.
 */
export function battle(db, attacker, defender, seed) {
  const rand = rng(seed);
  const a = side(attacker, rand), d = side(defender, rand);
  for (let round = 0; round < RULES.turnLimit; round++) {
    turn(db, a, d, rand, 'value');
    if (d.hp <= 0) return true;
    turn(db, d, a, rand, 'dvalue');
    if (a.hp <= 0) return false;
  }
  return false;
}
