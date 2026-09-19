import { castAndBoat } from './rules.js';

/**
 * Every number Cast & Boat balances on, exposed for the tuning sheet.
 *
 * Each field says how to read its value out of a rules object and how to write
 * a new one in, so values that are functions of the player count (the target
 * score, the hand size) can be shown as plain numbers and pinned by hand.
 */
export const CAST_TUNABLES = [
  {
    group: 'Scoring',
    key: 'targetScore',
    label: 'Target score',
    hint: 'first to this wins',
    min: 3,
    max: 40,
    get: (r, n) => (typeof r.targetScore === 'function' ? r.targetScore(n) : r.targetScore),
    set: (r, v) => { r.targetScore = () => v; },
  },
  { group: 'Scoring', key: 'points.trips', label: 'Three of a kind', min: 0, max: 20,
    get: (r) => r.points.trips, set: (r, v) => { r.points.trips = v; } },
  { group: 'Scoring', key: 'points.straightFlush', label: 'Straight flush', min: 0, max: 20,
    get: (r) => r.points.straightFlush, set: (r, v) => { r.points.straightFlush = v; } },
  { group: 'Scoring', key: 'points.flush', label: 'Flush', min: 0, max: 20,
    get: (r) => r.points.flush, set: (r, v) => { r.points.flush = v; } },
  { group: 'Scoring', key: 'points.run', label: 'Run', min: 0, max: 20,
    get: (r) => r.points.run, set: (r, v) => { r.points.run = v; } },

  { group: 'Luck', key: 'luckPerMatch', label: 'Luck per match', hint: 'for an answer that matches', min: 0, max: 4,
    get: (r) => r.luckPerMatch, set: (r, v) => { r.luckPerMatch = v; } },
  { group: 'Luck', key: 'maxLuck', label: 'Most luck held', min: 1, max: 20,
    get: (r) => r.maxLuck, set: (r, v) => { r.maxLuck = v; } },
  { group: 'Luck', key: 'costs.call', label: 'Call a rank or suit', min: 0, max: 12,
    get: (r) => r.costs.call, set: (r, v) => { r.costs.call = v; } },
  { group: 'Luck', key: 'costs.extraBoat', label: 'Boat another', min: 0, max: 12,
    get: (r) => r.costs.extraBoat, set: (r, v) => { r.costs.extraBoat = v; } },
  { group: 'Luck', key: 'costs.boatSwap', label: 'Swap boats', min: 0, max: 12,
    get: (r) => r.costs.boatSwap, set: (r, v) => { r.costs.boatSwap = v; } },

  // Cast & Boat's hand size is a plain number, unlike the Go Fish variants'.
  { group: 'Table', key: 'handSize', label: 'Hand size', min: 3, max: 9,
    get: (r) => r.handSize, set: (r, v) => { r.handSize = v; } },
  // Capped at four: at five, three-of-a-kind is impossible (there are only
  // four suits) and in simulation nobody scored at all at a full table.
  { group: 'Table', key: 'boatSize', label: 'Cards to a boat', hint: 'how many make a set', min: 3, max: 4,
    get: (r) => r.boatSize, set: (r, v) => { r.boatSize = v; } },
  { group: 'Table', key: 'minAnswers', label: 'Answers on the table', hint: 'the pond makes up the rest', min: 0, max: 6,
    get: (r) => r.minAnswers, set: (r, v) => { r.minAnswers = v; } },
];

/** What a field reads before anything has been tuned. */
export function defaultValue(field, playerCount) {
  return field.get(castAndBoat, playerCount);
}

/** The rules to play with, given a set of overrides from the tuning sheet. */
export function tunedRules(overrides = {}, playerCount = 4) {
  const rules = {
    ...castAndBoat,
    points: { ...castAndBoat.points },
    costs: { ...castAndBoat.costs },
  };
  for (const field of CAST_TUNABLES) {
    const value = overrides[field.key];
    if (typeof value === 'number') field.set(rules, value);
  }
  return rules;
}

/** Overrides that actually differ from the defaults, for display and storage. */
export function changedCount(overrides = {}, playerCount = 4) {
  return CAST_TUNABLES.filter((f) => {
    const v = overrides[f.key];
    return typeof v === 'number' && v !== defaultValue(f, playerCount);
  }).length;
}

/**
 * Settings that will not play well, in plain words. Checked against the tuned
 * rules rather than the overrides, so it catches the defaults too.
 */
export function tuningWarnings(rules, playerCount) {
  const warnings = [];
  if (Math.max(...Object.values(rules.points)) === 0) {
    warnings.push('No set scores anything, so nobody can ever reach the target.');
  }
  const dealt = rules.handSize * playerCount;
  if (dealt > 52) {
    warnings.push(`${playerCount} hands of ${rules.handSize} needs ${dealt} cards and the deck has 52, so play will start short.`);
  }
  if (rules.minAnswers > 0 && rules.minAnswers < 2) {
    warnings.push('With fewer than two answers the caster has no real choice.');
  }
  return warnings;
}
