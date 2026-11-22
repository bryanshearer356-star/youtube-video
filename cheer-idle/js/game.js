/*
 * Game rules. Pure logic over a plain state object: no DOM, no timers, no storage.
 * The UI (ui.js) and the balance simulator (tools/simulate.mjs) both drive this.
 */
(function (root) {
  'use strict';

  const D = root.CheerData;
  const T = D.TUNING;
  const SAVE_VERSION = 1;
  const LAST_DIVISION = D.DIVISIONS.length - 1;

  function newState(now) {
    return {
      version: SAVE_VERSION,
      spirit: 0,
      lifetimeSpirit: 0,
      /** Index into DIVISIONS. */
      division: 0,
      /** Index of the next competition to win in the current division. */
      competition: 0,
      /** True once the last competition of the last division is won. */
      champion: false,
      trophies: 0,
      /** skill id -> level (missing means 0, not learned). */
      skills: {},
      /** generator id -> number owned. */
      generators: {},
      /** boost id -> true once bought. */
      boosts: {},
      drills: 0,
      startedAt: now,
      lastSeen: now,
    };
  }

  // ---- Skills and the scoresheet ------------------------------------------

  function skillId(divisionIndex, categoryId) {
    return D.DIVISIONS[divisionIndex].id + '.' + categoryId;
  }

  function skillLevel(state, divisionIndex, categoryId) {
    return state.skills[skillId(divisionIndex, categoryId)] || 0;
  }

  function totalSkillLevels(state) {
    let total = 0;
    for (const id in state.skills) total += state.skills[id];
    return total;
  }

  function divisionSkillLevels(state, divisionIndex) {
    let total = 0;
    for (const category of D.CATEGORIES) total += skillLevel(state, divisionIndex, category.id);
    return total;
  }

  /** Points a single skill level adds to the routine score. */
  function pointsPerLevel() {
    return 100 / (D.CATEGORIES.length * T.maxSkillLevel);
  }

  /** Routine score out of 100 for a division's scoresheet (defaults to the current one). */
  function routineScore(state, divisionIndex) {
    const index = divisionIndex === undefined ? state.division : divisionIndex;
    return divisionSkillLevels(state, index) * pointsPerLevel();
  }

  function skillCostMultiplier(state) {
    return boostProduct(state, 'skillCost');
  }

  /** Spirit cost of the next level, or null when the skill is maxed or the division is locked. */
  function skillCost(state, divisionIndex, categoryId) {
    if (divisionIndex > state.division) return null;
    const level = skillLevel(state, divisionIndex, categoryId);
    if (level >= T.maxSkillLevel) return null;
    const base = D.DIVISIONS[divisionIndex].skillBaseCost;
    return Math.ceil(base * Math.pow(T.skillCostGrowth, level) * skillCostMultiplier(state));
  }

  function trainSkill(state, divisionIndex, categoryId) {
    const cost = skillCost(state, divisionIndex, categoryId);
    if (cost === null || state.spirit < cost) return false;
    state.spirit -= cost;
    state.skills[skillId(divisionIndex, categoryId)] = skillLevel(state, divisionIndex, categoryId) + 1;
    return true;
  }

  // ---- Income --------------------------------------------------------------

  function boostProduct(state, kind) {
    let product = 1;
    for (const boost of D.BOOSTS) {
      if (state.boosts[boost.id] && boost.effect.kind === kind) product *= boost.effect.value;
    }
    return product;
  }

  function boostSum(state, kind) {
    let sum = 0;
    for (const boost of D.BOOSTS) {
      if (state.boosts[boost.id] && boost.effect.kind === kind) sum += boost.effect.value;
    }
    return sum;
  }

  /** Multiplier applied to every source of Spirit. */
  function globalMultiplier(state) {
    return (
      (1 + T.trophyBonus * state.trophies) *
      (1 + T.skillLevelBonus * totalSkillLevels(state)) *
      boostProduct(state, 'global')
    );
  }

  function spiritPerSecond(state) {
    let base = 0;
    for (const generator of D.GENERATORS) base += (state.generators[generator.id] || 0) * generator.rate;
    return base * globalMultiplier(state);
  }

  /** Spirit earned by one manual drill. */
  function drillPower(state) {
    return (
      boostProduct(state, 'drill') * globalMultiplier(state) +
      boostSum(state, 'drillShare') * spiritPerSecond(state)
    );
  }

  function earn(state, amount) {
    state.spirit += amount;
    state.lifetimeSpirit += amount;
  }

  function drill(state) {
    const amount = drillPower(state);
    earn(state, amount);
    state.drills += 1;
    return amount;
  }

  /** Advance time by dt seconds of passive income. */
  function tick(state, dt) {
    if (!(dt > 0)) return 0;
    const amount = spiritPerSecond(state) * dt;
    earn(state, amount);
    return amount;
  }

  /** Credit time spent away (capped). Call once after loading a save. */
  function applyOffline(state, now) {
    const away = Math.max(0, (now - state.lastSeen) / 1000);
    const seconds = Math.min(away, T.offlineCapSeconds);
    const earned = tick(state, seconds);
    state.lastSeen = now;
    return { seconds, earned, capped: away > T.offlineCapSeconds };
  }

  // ---- Program upgrades and gear -------------------------------------------

  function generatorUnlocked(state, generator) {
    return generator.unlockDivision <= state.division;
  }

  function generatorCost(state, generator) {
    const owned = state.generators[generator.id] || 0;
    return Math.ceil(generator.baseCost * Math.pow(T.generatorCostGrowth, owned));
  }

  function buyGenerator(state, generator) {
    if (!generatorUnlocked(state, generator)) return false;
    const cost = generatorCost(state, generator);
    if (state.spirit < cost) return false;
    state.spirit -= cost;
    state.generators[generator.id] = (state.generators[generator.id] || 0) + 1;
    return true;
  }

  function boostUnlocked(state, boost) {
    return boost.unlockDivision <= state.division;
  }

  function buyBoost(state, boost) {
    if (state.boosts[boost.id] || !boostUnlocked(state, boost) || state.spirit < boost.cost) return false;
    state.spirit -= boost.cost;
    state.boosts[boost.id] = true;
    return true;
  }

  // ---- Competitions --------------------------------------------------------

  /** The competition the team is working toward, or null once every title is won. */
  function nextCompetition(state) {
    if (state.champion) return null;
    const division = D.DIVISIONS[state.division];
    const competition = division.competitions[state.competition];
    if (!competition) return null;
    return {
      division,
      competition,
      isChampionship: state.competition === division.competitions.length - 1,
      prize: Math.ceil(division.skillBaseCost * competition.prize),
    };
  }

  function canWin(state) {
    const next = nextCompetition(state);
    return !!next && routineScore(state) + 1e-9 >= next.competition.targetScore;
  }

  /**
   * Enter the next competition. A win pays the prize and a trophy; winning a
   * division championship moves the team up a division.
   */
  function compete(state) {
    const next = nextCompetition(state);
    if (!next) return { won: false };
    const score = routineScore(state);
    if (!canWin(state)) return { won: false, score, target: next.competition.targetScore };

    state.trophies += 1;
    earn(state, next.prize);

    const result = {
      won: true,
      score,
      competition: next.competition,
      division: next.division,
      prize: next.prize,
      promotedTo: null,
      champion: false,
    };

    if (!next.isChampionship) {
      state.competition += 1;
    } else if (state.division < LAST_DIVISION) {
      state.division += 1;
      state.competition = 0;
      result.promotedTo = D.DIVISIONS[state.division];
    } else {
      state.champion = true;
      result.champion = true;
    }
    return result;
  }

  // ---- Saving --------------------------------------------------------------

  function serialize(state) {
    return JSON.stringify(state);
  }

  function clampInt(value, min, max) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function positive(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Rebuild a state from saved text. Returns null if it can't be read. Unknown ids are dropped. */
  function deserialize(text, now) {
    let raw;
    try {
      raw = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (error) {
      return null;
    }
    if (!raw || typeof raw !== 'object') return null;

    const state = newState(now);
    state.spirit = positive(raw.spirit);
    state.lifetimeSpirit = Math.max(positive(raw.lifetimeSpirit), state.spirit);
    state.division = clampInt(raw.division, 0, LAST_DIVISION);
    state.competition = clampInt(raw.competition, 0, D.DIVISIONS[state.division].competitions.length - 1);
    state.champion = raw.champion === true && state.division === LAST_DIVISION;
    state.trophies = clampInt(raw.trophies, 0, 1e6);
    state.drills = clampInt(raw.drills, 0, Number.MAX_SAFE_INTEGER);

    const skills = raw.skills || {};
    D.DIVISIONS.forEach((division, index) => {
      if (index > state.division) return;
      for (const category of D.CATEGORIES) {
        const level = clampInt(skills[skillId(index, category.id)], 0, T.maxSkillLevel);
        if (level > 0) state.skills[skillId(index, category.id)] = level;
      }
    });
    const generators = raw.generators || {};
    for (const generator of D.GENERATORS) {
      const owned = clampInt(generators[generator.id], 0, 1e5);
      if (owned > 0) state.generators[generator.id] = owned;
    }
    const boosts = raw.boosts || {};
    for (const boost of D.BOOSTS) {
      if (boosts[boost.id] === true) state.boosts[boost.id] = true;
    }

    const startedAt = Number(raw.startedAt);
    const lastSeen = Number(raw.lastSeen);
    state.startedAt = Number.isFinite(startedAt) && startedAt <= now ? startedAt : now;
    state.lastSeen = Number.isFinite(lastSeen) && lastSeen <= now ? lastSeen : now;
    return state;
  }

  // ---- Number formatting ---------------------------------------------------

  const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx'];

  /** 950 -> "950", 15300 -> "15.3K", 2.5e9 -> "2.50B". Small fractions keep one decimal. */
  function formatNumber(value) {
    const n = Math.max(0, Number(value) || 0);
    if (n < 1000) {
      if (n < 100 && Math.abs(n - Math.round(n)) > 0.05) return (Math.floor(n * 10) / 10).toFixed(1);
      return String(Math.floor(n + 0.05));
    }
    const tier = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
    const scaled = n / Math.pow(1000, tier);
    const decimals = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    const factor = Math.pow(10, decimals);
    return (Math.floor(scaled * factor) / factor).toFixed(decimals) + SUFFIXES[tier];
  }

  root.CheerGame = {
    SAVE_VERSION,
    newState,
    skillId,
    skillLevel,
    totalSkillLevels,
    divisionSkillLevels,
    pointsPerLevel,
    routineScore,
    skillCost,
    trainSkill,
    globalMultiplier,
    spiritPerSecond,
    drillPower,
    drill,
    tick,
    applyOffline,
    generatorUnlocked,
    generatorCost,
    buyGenerator,
    boostUnlocked,
    buyBoost,
    nextCompetition,
    canWin,
    compete,
    serialize,
    deserialize,
    formatNumber,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
