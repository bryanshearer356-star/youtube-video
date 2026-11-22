/*
 * Browser layer: draws the game, handles input, runs the clock and saves.
 * All rules live in game.js; this file only calls into it.
 */
(function () {
  'use strict';

  const D = window.CheerData;
  const G = window.CheerGame;
  const SAVE_KEY = 'hit-zero-save-v1';
  const TICK_MS = 100;
  const SAVE_MS = 10000;

  let state;
  let lastTick = 0;
  let storageWorks = true;
  let skillRefs = [];
  let genRefs = [];
  let boostRefs = [];

  const $ = (id) => document.getElementById(id);
  const fmt = G.formatNumber;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const key in attrs) node.setAttribute(key, attrs[key]);
    if (children !== undefined) {
      for (const child of [].concat(children)) node.append(child);
    }
    return node;
  }

  /** Write text only when it changed, so the 10-times-a-second refresh stays cheap. */
  function setText(node, text) {
    if (node._text !== text) {
      node._text = text;
      node.textContent = text;
    }
  }

  function setDisabled(button, disabled) {
    if (button.disabled !== disabled) button.disabled = disabled;
  }

  // ---- Saving --------------------------------------------------------------

  function load(carried) {
    const now = Date.now();
    if (carried && carried.save) {
      const restored = G.deserialize(carried.save, now);
      if (restored) return restored;
    }
    try {
      const text = window.localStorage.getItem(SAVE_KEY);
      if (text) {
        const restored = G.deserialize(text, now);
        if (restored) return restored;
      }
    } catch (error) {
      storageWorks = false;
    }
    return G.newState(now);
  }

  function save() {
    state.lastSeen = Date.now();
    try {
      window.localStorage.setItem(SAVE_KEY, G.serialize(state));
      storageWorks = true;
    } catch (error) {
      storageWorks = false;
    }
    setText(
      $('save-status'),
      storageWorks
        ? 'Progress saves in this browser.'
        : "This browser is blocking storage, so progress won't be kept after you close the page.",
    );
  }

  // ---- Division ladder -----------------------------------------------------

  function buildLadder() {
    const ladder = $('ladder');
    ladder.textContent = '';
    D.DIVISIONS.forEach((division, index) => {
      const status = index < state.division ? 'done' : index === state.division ? 'current' : 'locked';
      const step = el('li', { class: 'ladder__step is-' + status, title: division.name }, division.short);
      if (status === 'current') step.setAttribute('aria-current', 'step');
      ladder.append(step);
    });
  }

  // ---- Scoresheet ----------------------------------------------------------

  function skillRow(divisionIndex, category) {
    const skill = D.DIVISIONS[divisionIndex].skills[category.id];
    const pipWrap = el('div', { class: 'pips', 'aria-hidden': 'true' });
    const pips = [];
    for (let i = 0; i < D.TUNING.maxSkillLevel; i++) {
      const pip = el('i');
      pips.push(pip);
      pipWrap.append(pip);
    }
    const level = el('span', { class: 'skill__lvl' });
    const label = el('span', { class: 'btn__label' });
    const cost = el('span', { class: 'btn__cost' });
    const button = el('button', { class: 'btn', type: 'button' }, [label, cost]);
    button.addEventListener('click', () => {
      if (G.trainSkill(state, divisionIndex, category.id)) refresh();
    });
    skillRefs.push({ divisionIndex, categoryId: category.id, name: skill.name, pipWrap, pips, level, label, cost, button, shown: -1 });
    return el('li', { class: 'skill' }, [
      el('div', { class: 'skill__info' }, [
        el('span', { class: 'eyebrow' }, category.name),
        el('span', { class: 'skill__name' }, skill.name),
        el('div', { class: 'skill__meter' }, [pipWrap, level]),
      ]),
      button,
    ]);
  }

  function buildSkills() {
    skillRefs = [];
    const division = D.DIVISIONS[state.division];
    setText($('sheet-division'), division.name + ' division');
    setText($('sheet-blurb'), division.blurb);

    const list = $('skills');
    list.textContent = '';
    for (const category of D.CATEGORIES) list.append(skillRow(state.division, category));

    // Earlier divisions stay trainable: their levels no longer score, but still add Spirit.
    const past = $('past');
    const pastList = $('past-list');
    pastList.textContent = '';
    past.hidden = state.division === 0;
    for (let index = state.division - 1; index >= 0; index--) {
      const rows = el('ul', { class: 'skills' });
      for (const category of D.CATEGORIES) rows.append(skillRow(index, category));
      const total = el('span');
      total.dataset.pastTotal = String(index);
      pastList.append(
        el('div', { class: 'past__division' }, [
          el('div', { class: 'past__name' }, [el('span', null, D.DIVISIONS[index].name), total]),
          rows,
        ]),
      );
    }
  }

  function refreshSkills() {
    const max = D.TUNING.maxSkillLevel;
    for (const ref of skillRefs) {
      const level = G.skillLevel(state, ref.divisionIndex, ref.categoryId);
      if (level !== ref.shown) {
        ref.shown = level;
        ref.pips.forEach((pip, i) => pip.classList.toggle('is-on', i < level));
        ref.pipWrap.classList.toggle('is-max', level >= max);
        setText(ref.level, level === 0 ? 'Not learned' : level >= max ? 'Mastered' : 'Level ' + level + ' of ' + max);
        setText(ref.label, level === 0 ? 'Learn' : level >= max ? 'Mastered' : 'Train');
      }
      const cost = G.skillCost(state, ref.divisionIndex, ref.categoryId);
      setText(ref.cost, cost === null ? '' : fmt(cost));
      setDisabled(ref.button, cost === null || state.spirit < cost);
    }
    setText($('sheet-score'), G.routineScore(state).toFixed(1));
    for (const node of document.querySelectorAll('[data-past-total]')) {
      const index = Number(node.dataset.pastTotal);
      setText(node, G.divisionSkillLevels(state, index) + ' of ' + D.CATEGORIES.length * max + ' levels');
    }
  }

  // ---- Program and gear ----------------------------------------------------

  function buildProgram() {
    genRefs = [];
    const gens = $('gens');
    gens.textContent = '';
    let teased = false;
    for (const generator of D.GENERATORS) {
      if (G.generatorUnlocked(state, generator)) {
        const count = el('span', { class: 'gen__count' });
        const rate = el('span', { class: 'gen__rate' });
        const cost = el('span', { class: 'btn__cost' });
        const button = el('button', { class: 'btn btn--buy', type: 'button', 'aria-label': 'Buy ' + generator.name }, [
          el('span', { class: 'btn__label' }, 'Add'),
          cost,
        ]);
        button.addEventListener('click', () => {
          if (G.buyGenerator(state, generator)) refresh();
        });
        genRefs.push({ generator, count, rate, cost, button });
        gens.append(
          el('li', { class: 'gen' }, [
            count,
            el('div', { class: 'gen__info' }, [
              el('span', { class: 'gen__name' }, generator.name),
              el('span', { class: 'gen__note' }, generator.note),
              rate,
            ]),
            button,
          ]),
        );
      } else if (!teased) {
        // Show only the next locked upgrade, as something to look forward to.
        teased = true;
        gens.append(
          el('li', { class: 'gen is-locked' }, [
            el('span', { class: 'gen__count' }, '?'),
            el('div', { class: 'gen__info' }, [
              el('span', { class: 'gen__name' }, generator.name),
              el('span', { class: 'gen__note' }, generator.note),
            ]),
            el('span', { class: 'gen__lock' }, 'Unlocks in ' + D.DIVISIONS[generator.unlockDivision].name),
          ]),
        );
      }
    }

    boostRefs = [];
    const boosts = $('boosts');
    boosts.textContent = '';
    const owned = [];
    for (const boost of D.BOOSTS) {
      if (state.boosts[boost.id]) {
        owned.push(boost.name);
      } else if (G.boostUnlocked(state, boost)) {
        const button = el('button', { class: 'btn', type: 'button', 'aria-label': 'Buy ' + boost.name }, [
          el('span', { class: 'btn__label' }, 'Buy'),
          el('span', { class: 'btn__cost' }, fmt(boost.cost)),
        ]);
        button.addEventListener('click', () => {
          if (G.buyBoost(state, boost)) {
            buildProgram();
            refresh();
          }
        });
        boostRefs.push({ boost, button });
        boosts.append(
          el('li', { class: 'boost' }, [
            el('span', { class: 'boost__name' }, boost.name),
            el('span', { class: 'boost__text' }, boost.text),
            button,
          ]),
        );
      }
    }
    if (boostRefs.length === 0) {
      const more = D.BOOSTS.some((boost) => !state.boosts[boost.id]);
      boosts.append(
        el('li', { class: 'boosts__empty' }, more ? 'More gear arrives when the team moves up a division.' : 'You own every piece of gear.'),
      );
    }
    const ownedLine = $('owned');
    ownedLine.hidden = owned.length === 0;
    setText(ownedLine, owned.length ? 'Owned: ' + owned.join(', ') + '.' : '');
  }

  function refreshProgram() {
    const multiplier = G.globalMultiplier(state);
    for (const ref of genRefs) {
      const cost = G.generatorCost(state, ref.generator);
      setText(ref.count, String(state.generators[ref.generator.id] || 0));
      setText(ref.rate, '+' + fmt(ref.generator.rate * multiplier) + ' per second each');
      setText(ref.cost, fmt(cost));
      setDisabled(ref.button, state.spirit < cost);
    }
    for (const ref of boostRefs) setDisabled(ref.button, state.spirit < ref.boost.cost);
  }

  // ---- Competition card ----------------------------------------------------

  function buildSeason() {
    const season = $('comp-season');
    season.textContent = '';
    const division = D.DIVISIONS[state.division];
    division.competitions.forEach((competition, index) => {
      const won = state.champion || index < state.competition;
      const next = !won && index === state.competition;
      season.append(
        el('li', { class: won ? 'is-won' : next ? 'is-next' : '' }, [
          el('span', { class: 'season__mark' }, won ? 'Won' : next ? 'Next' : 'Later'),
          el('span', null, competition.name),
          el('span', { class: 'season__target' }, String(competition.targetScore)),
        ]),
      );
    });
  }

  function refreshCompetition() {
    const next = G.nextCompetition(state);
    $('comp-body').hidden = !next;
    if (!next) {
      setText($('comp-kind'), 'Every title won');
      setText($('comp-name'), 'World champions');
      return;
    }
    const score = G.routineScore(state);
    const target = next.competition.targetScore;
    const ready = G.canWin(state);
    const nextDivision = D.DIVISIONS[state.division + 1];

    setText($('comp-kind'), next.isChampionship ? next.division.name + ' division championship' : 'Next competition');
    setText($('comp-name'), next.competition.name);
    setText($('comp-score'), score.toFixed(1));
    setText($('comp-target'), String(target));
    $('scorebar-fill').style.width = Math.min(100, score) + '%';
    $('scorebar-target').style.left = target + '%';
    $('scorebar').classList.toggle('is-ready', ready);
    $('scorebar').setAttribute('aria-label', 'Routine score ' + score.toFixed(1) + ' of the ' + target + ' needed to win');

    const levelsShort = Math.ceil((target - score) / G.pointsPerLevel() - 1e-9);
    const reward = 'a trophy and ' + fmt(next.prize) + ' Spirit';
    let status;
    if (!ready) {
      status = levelsShort + (levelsShort === 1 ? ' more skill level' : ' more skill levels') + ' to reach ' + target + '. Winning pays ' + reward + '.';
    } else if (next.isChampionship && nextDivision) {
      status = 'Routine is ready. Win for ' + reward + ', and move up to ' + nextDivision.name + '.';
    } else {
      status = 'Routine is ready. Win for ' + reward + '.';
    }
    setText($('comp-status'), status);
    $('comp-status').classList.toggle('is-ready', ready);
    setDisabled($('compete'), !ready);
  }

  function onCompete() {
    const result = G.compete(state);
    if (!result.won) return;
    confetti(result.promotedTo || result.champion ? 220 : 90);
    if (result.champion) {
      toast('World champions', 'The team won ' + result.competition.name + '. Every title in the game is yours.', true);
    } else if (result.promotedTo) {
      toast(
        'Moving up to ' + result.promotedTo.name,
        'First place at ' + result.competition.name + '. A new scoresheet, program upgrades and gear are open.',
        true,
      );
    } else {
      toast('First place', result.competition.name + ' is won. +' + fmt(result.prize) + ' Spirit and a trophy.', true);
    }
    buildAll();
    refresh();
    save();
  }

  // ---- Drill button --------------------------------------------------------

  function onDrill(event) {
    const amount = G.drill(state);
    refresh();
    const mat = $('floaters');
    if (mat.childElementCount > 24) return;
    const box = mat.getBoundingClientRect();
    // Keyboard presses have no pointer position, so float from the middle of the button.
    const fromPointer = event.clientX || event.clientY;
    const buttonBox = $('drill').getBoundingClientRect();
    const x = (fromPointer ? event.clientX : buttonBox.left + buttonBox.width / 2) - box.left + (Math.random() * 30 - 15);
    const y = (fromPointer ? event.clientY : buttonBox.top + buttonBox.height / 3) - box.top;
    const floater = el('span', { class: 'floater', style: 'left:' + x + 'px;top:' + y + 'px' }, '+' + fmt(amount));
    mat.append(floater);
    floater.addEventListener('animationend', () => floater.remove());
    window.setTimeout(() => floater.remove(), 1200);
  }

  // ---- Toasts and confetti -------------------------------------------------

  function toast(title, text, win) {
    const node = el('div', { class: 'toast' + (win ? ' toast--win' : '') }, [el('strong', null, title), text]);
    $('toasts').append(node);
    window.setTimeout(() => node.classList.add('is-leaving'), 5200);
    window.setTimeout(() => node.remove(), 5600);
  }

  function confetti(count) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = $('confetti');
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = (canvas.width = Math.floor(canvas.clientWidth * ratio));
    const height = (canvas.height = Math.floor(canvas.clientHeight * ratio));
    const colors = ['#ff5c97', '#f4b70e', '#2152e0', '#ffffff', '#4ade9f'];
    const pieces = [];
    for (let i = 0; i < count; i++) {
      pieces.push({
        x: width * (0.2 + Math.random() * 0.6),
        y: height * 0.35,
        vx: (Math.random() - 0.5) * 16 * ratio,
        vy: (-6 - Math.random() * 12) * ratio,
        size: (5 + Math.random() * 6) * ratio,
        spin: Math.random() * Math.PI,
        color: colors[i % colors.length],
      });
    }
    const started = performance.now();
    function frame(now) {
      const age = now - started;
      context.clearRect(0, 0, width, height);
      if (age > 2600) return;
      context.globalAlpha = Math.max(0, 1 - age / 2600);
      for (const piece of pieces) {
        piece.vy += 0.45 * ratio;
        piece.vx *= 0.99;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.spin += 0.2;
        context.fillStyle = piece.color;
        context.fillRect(piece.x, piece.y, piece.size, piece.size * (0.4 + 0.6 * Math.abs(Math.sin(piece.spin))));
      }
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  // ---- Frame ---------------------------------------------------------------

  function buildAll() {
    buildLadder();
    buildSkills();
    buildProgram();
    buildSeason();
  }

  function refresh() {
    setText($('spirit'), fmt(Math.floor(state.spirit)));
    setText($('rate'), fmt(G.spiritPerSecond(state)));
    setText($('trophies'), String(state.trophies));
    setText($('drill-power'), fmt(G.drillPower(state)));
    refreshSkills();
    refreshProgram();
    refreshCompetition();
  }

  function loop() {
    const now = Date.now();
    // A throttled or sleeping tab catches up here, up to the same cap as time away.
    const dt = Math.min((now - lastTick) / 1000, D.TUNING.offlineCapSeconds);
    lastTick = now;
    G.tick(state, dt);
    state.lastSeen = now;
    refresh();
  }

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll('.tabs__tab'));
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        $('board').dataset.tab = tab.dataset.tab;
        for (const other of tabs) other.setAttribute('aria-selected', String(other === tab));
      });
    }
  }

  function setupReset() {
    const button = $('reset');
    let armed = 0;
    button.addEventListener('click', () => {
      // Two presses within a few seconds, since browser confirm dialogs aren't always available.
      if (Date.now() - armed > 4000) {
        armed = Date.now();
        button.textContent = 'Press again to erase all progress';
        window.setTimeout(() => {
          button.textContent = 'Start over';
        }, 4000);
        return;
      }
      armed = 0;
      state = G.newState(Date.now());
      button.textContent = 'Start over';
      buildAll();
      refresh();
      save();
      toast('Fresh start', 'Back to Rec with a brand new team.', false);
    });
  }

  function start(carried) {
    state = load(carried);
    const away = G.applyOffline(state, Date.now());
    buildAll();
    refresh();
    if (away.seconds >= 60 && away.earned > 0) {
      const minutes = Math.floor(away.seconds / 60);
      const span = minutes >= 120 ? Math.floor(minutes / 60) + ' hours' : minutes + (minutes === 1 ? ' minute' : ' minutes');
      toast('Welcome back', 'The team earned ' + fmt(away.earned) + ' Spirit over ' + span + ' while you were away.', false);
    }

    $('drill').addEventListener('click', onDrill);
    $('compete').addEventListener('click', onCompete);
    setupTabs();
    setupReset();

    lastTick = Date.now();
    window.setInterval(loop, TICK_MS);
    window.setInterval(save, SAVE_MS);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) save();
    });
    save();
  }

  // When the page is republished while someone has it open, carry their game across.
  const hot = window.claude && window.claude.hot;
  try {
    if (hot && hot.snapshot) hot.snapshot(() => ({ save: G.serialize(state) }));
  } catch (error) {
    /* optional hook */
  }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
