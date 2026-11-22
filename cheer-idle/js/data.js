/*
 * Game content. Everything a designer would want to tune lives in this file:
 * divisions, the skills on each division's scoresheet, competitions,
 * program upgrades (passive Spirit) and gear (one-time boosts).
 *
 * Plain script (no modules) so index.html works when opened straight from disk.
 */
(function (root) {
  'use strict';

  /** Scoresheet categories. Every division has exactly one skill per category. */
  const CATEGORIES = [
    { id: 'jumps', name: 'Jumps' },
    { id: 'tumbling', name: 'Tumbling' },
    { id: 'stunts', name: 'Stunts' },
    { id: 'pyramid', name: 'Pyramid' },
    { id: 'tosses', name: 'Tosses' },
    { id: 'dance', name: 'Dance' },
  ];

  const TUNING = {
    maxSkillLevel: 10,
    /** Each skill level costs this much more than the one before it. */
    skillCostGrowth: 1.5,
    /** Each program upgrade costs this much more than the one before it. */
    generatorCostGrowth: 1.15,
    /** Spirit bonus per trophy (additive: 4 trophies = +100%). */
    trophyBonus: 0.25,
    /** Spirit bonus per skill level, across every division (additive). */
    skillLevelBonus: 0.01,
    /** Longest stretch of time away that still earns Spirit, in seconds. */
    offlineCapSeconds: 8 * 60 * 60,
  };

  /*
   * Divisions, in the order a program climbs them.
   *  - skillBaseCost: Spirit cost of the first level of any skill in the division.
   *  - competitions: won in order. targetScore is out of 100; the last one is the
   *    division championship and winning it moves the team up.
   *  - prize: Spirit paid on a win, as a multiple of skillBaseCost.
   */
  const DIVISIONS = [
    {
      id: 'rec',
      name: 'Rec',
      short: 'Rec',
      blurb: 'Saturday mornings at the community center. Nobody has a skill yet.',
      skillBaseCost: 10,
      skills: {
        jumps: { name: 'Tuck Jump' },
        tumbling: { name: 'Forward Roll' },
        stunts: { name: 'Thigh Stand' },
        pyramid: { name: 'Shoulder Sit Line' },
        tosses: { name: 'Cradle Catch' },
        dance: { name: 'Eight-Count Basics' },
      },
      competitions: [
        { id: 'rec-1', name: 'Community Showcase', targetScore: 30, prize: 15 },
        { id: 'rec-2', name: 'County Rec Jamboree', targetScore: 60, prize: 60 },
        { id: 'rec-3', name: 'Rec League Championship', targetScore: 90, prize: 250 },
      ],
    },
    {
      id: 'club',
      name: 'Club',
      short: 'Club',
      blurb: 'Tryouts, a real practice schedule and the first away meets.',
      skillBaseCost: 500,
      skills: {
        jumps: { name: 'Toe Touch' },
        tumbling: { name: 'Round-Off' },
        stunts: { name: 'Prep' },
        pyramid: { name: 'Prep-Level Pyramid' },
        tosses: { name: 'Straight Ride Basket' },
        dance: { name: 'Pom Routine' },
      },
      competitions: [
        { id: 'club-1', name: 'Club Invitational', targetScore: 30, prize: 15 },
        { id: 'club-2', name: 'Tri-County Classic', targetScore: 60, prize: 60 },
        { id: 'club-3', name: 'Club State Finals', targetScore: 90, prize: 250 },
      ],
    },
    {
      id: 'jv',
      name: 'Junior Varsity',
      short: 'JV',
      blurb: 'School colors, Friday sidelines and a conference to win.',
      skillBaseCost: 40000,
      skills: {
        jumps: { name: 'Pike Jump' },
        tumbling: { name: 'Back Handspring' },
        stunts: { name: 'Extension' },
        pyramid: { name: 'Extended Pyramid' },
        tosses: { name: 'Toe Touch Basket' },
        dance: { name: 'Sideline-to-Floor Dance' },
      },
      competitions: [
        { id: 'jv-1', name: 'JV Conference Meet', targetScore: 30, prize: 15 },
        { id: 'jv-2', name: 'JV Regional Qualifier', targetScore: 60, prize: 60 },
        { id: 'jv-3', name: 'JV State Championship', targetScore: 90, prize: 250 },
      ],
    },
    {
      id: 'varsity',
      name: 'Varsity',
      short: 'Varsity',
      blurb: 'The top squad at school. Letter jackets are on the line.',
      skillBaseCost: 5000000,
      skills: {
        jumps: { name: 'Double Toe Touch' },
        tumbling: { name: 'Standing Back Tuck' },
        stunts: { name: 'Liberty' },
        pyramid: { name: 'Two-and-a-Half High Pyramid' },
        tosses: { name: 'Full Twist Basket' },
        dance: { name: 'Hip-Hop Dance Break' },
      },
      competitions: [
        { id: 'varsity-1', name: 'District Qualifier', targetScore: 30, prize: 15 },
        { id: 'varsity-2', name: 'State Championship', targetScore: 60, prize: 60 },
        { id: 'varsity-3', name: 'High School Nationals', targetScore: 90, prize: 250 },
      ],
    },
    {
      id: 'allstar',
      name: 'All Star',
      short: 'All Star',
      blurb: 'A competition-only gym team. Two and a half minutes, full out.',
      skillBaseCost: 1000000000,
      skills: {
        jumps: { name: 'Triple Jump to Back Tuck' },
        tumbling: { name: 'Full Twisting Layout' },
        stunts: { name: 'Full-Up Heel Stretch' },
        pyramid: { name: 'Braced Flip Pyramid' },
        tosses: { name: 'Kick Full Basket' },
        dance: { name: 'Elite Dance Section' },
      },
      competitions: [
        { id: 'allstar-1', name: 'Regional Open', targetScore: 30, prize: 15 },
        { id: 'allstar-2', name: 'Bid Qualifier', targetScore: 60, prize: 60 },
        { id: 'allstar-3', name: 'All Star Nationals', targetScore: 90, prize: 250 },
      ],
    },
    {
      id: 'international',
      name: 'International',
      short: 'Intl',
      blurb: 'The national flag on the uniform and the best teams on earth.',
      skillBaseCost: 300000000000,
      skills: {
        jumps: { name: 'Quad Jump Combination' },
        tumbling: { name: 'Double Full' },
        stunts: { name: 'Rewind to One-Arm Cupie' },
        pyramid: { name: 'Two-Two-One Tower' },
        tosses: { name: 'Kick Double Basket' },
        dance: { name: 'Worlds Showcase Dance' },
      },
      competitions: [
        { id: 'intl-1', name: 'Continental Cup', targetScore: 30, prize: 15 },
        { id: 'intl-2', name: 'World Semi-Finals', targetScore: 60, prize: 60 },
        { id: 'intl-3', name: 'World Championship', targetScore: 90, prize: 250 },
      ],
    },
  ];

  /*
   * Program upgrades: bought any number of times, each one adds passive Spirit.
   *  - baseCost: cost of the first one. rate: Spirit per second for each one owned.
   *  - unlockDivision: index into DIVISIONS where it first appears.
   */
  const GENERATORS = [
    { id: 'warmup', name: 'Warm-Up Circle', note: 'Stretch, count off, get loud.', baseCost: 15, rate: 0.2, unlockDivision: 0 },
    { id: 'volunteers', name: 'Parent Volunteers', note: 'Snacks, carpools and sideline cheering.', baseCost: 100, rate: 1, unlockDivision: 0 },
    { id: 'captain', name: 'Team Captain', note: 'Runs counts when the coach steps out.', baseCost: 1100, rate: 8, unlockDivision: 1 },
    { id: 'mats', name: 'Panel Mats', note: 'Somewhere soft to land.', baseCost: 12000, rate: 47, unlockDivision: 1 },
    { id: 'tumbling-coach', name: 'Tumbling Coach', note: 'Spots every pass until it sticks.', baseCost: 130000, rate: 260, unlockDivision: 2 },
    { id: 'choreographer', name: 'Choreographer', note: 'Cleans transitions and formations.', baseCost: 1400000, rate: 1400, unlockDivision: 3 },
    { id: 'spring-floor', name: 'Spring Floor', note: 'Nine blue panels over springs.', baseCost: 20000000, rate: 7800, unlockDivision: 3 },
    { id: 'gym', name: 'All Star Gym', note: 'A home with a tumble track and a pro shop.', baseCost: 330000000, rate: 44000, unlockDivision: 4 },
    { id: 'sponsor', name: 'Uniform Sponsor', note: 'Crystals on everything.', baseCost: 5100000000, rate: 260000, unlockDivision: 4 },
    { id: 'broadcast', name: 'Broadcast Deal', note: 'The routine goes out live.', baseCost: 75000000000, rate: 1600000, unlockDivision: 5 },
  ];

  /*
   * Gear: one-time purchases. effect.kind is one of
   *  - 'drill'      multiply Spirit from a manual drill
   *  - 'drillShare' each drill also earns this fraction of Spirit per second
   *  - 'global'     multiply all Spirit earned
   *  - 'skillCost'  multiply skill training costs (below 1 is a discount)
   */
  const BOOSTS = [
    { id: 'bows', name: 'Matching Bows', text: 'Drills earn 2x', cost: 100, unlockDivision: 0, effect: { kind: 'drill', value: 2 } },
    { id: 'megaphone', name: 'Megaphone', text: 'Each drill also earns 5% of your Spirit per second', cost: 1000, unlockDivision: 0, effect: { kind: 'drillShare', value: 0.05 } },
    { id: 'banner', name: 'Team Banner', text: 'All Spirit +50%', cost: 15000, unlockDivision: 1, effect: { kind: 'global', value: 1.5 } },
    { id: 'skills-camp', name: 'Summer Skills Camp', text: 'Skill training costs 15% less', cost: 50000, unlockDivision: 1, effect: { kind: 'skillCost', value: 0.85 } },
    { id: 'poms', name: 'Metallic Poms', text: 'Drills earn 5x', cost: 500000, unlockDivision: 2, effect: { kind: 'drill', value: 5 } },
    { id: 'film', name: 'Film Review', text: 'All Spirit +50%', cost: 2000000, unlockDivision: 2, effect: { kind: 'global', value: 1.5 } },
    { id: 'uniforms', name: 'Competition Uniforms', text: 'All Spirit 2x', cost: 50000000, unlockDivision: 3, effect: { kind: 'global', value: 2 } },
    { id: 'stunt-clinic', name: 'Stunt Clinic', text: 'Skill training costs 15% less', cost: 150000000, unlockDivision: 3, effect: { kind: 'skillCost', value: 0.85 } },
    { id: 'music', name: 'Custom Music Mix', text: 'All Spirit 2x', cost: 2000000000, unlockDivision: 4, effect: { kind: 'global', value: 2 } },
    { id: 'choreo-camp', name: 'Choreography Camp', text: 'Each drill earns another 10% of your Spirit per second', cost: 5000000000, unlockDivision: 4, effect: { kind: 'drillShare', value: 0.1 } },
    { id: 'flag', name: 'National Team Flag', text: 'All Spirit 2x', cost: 100000000000, unlockDivision: 5, effect: { kind: 'global', value: 2 } },
  ];

  root.CheerData = { CATEGORIES, TUNING, DIVISIONS, GENERATORS, BOOSTS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
