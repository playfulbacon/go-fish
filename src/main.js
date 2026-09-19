import { GAMES, DEFAULT_GAME, SCREEN_IDS, getGame } from './games.js';
import { defaultValue, tunedRules, tuningWarnings } from './cast/tuning.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const STORE = 'gofish:prefs';

const state = {
  gameId: DEFAULT_GAME,
  aiCount: getGame(DEFAULT_GAME).defaultAi,
  /** Rule overrides per game id, set from the tuning sheet. */
  tuning: {},
};

/** Views are built on demand and reused, so a game keeps its DOM wiring. */
const views = new Map();

const el = {
  title: $('title-screen'),
  variantList: $('variant-list'),
  variantHint: $('variant-hint'),
  countValue: $('count-value'),
  countHint: $('count-hint'),
  countUp: $('count-up'),
  countDown: $('count-down'),
  sheetBackdrop: $('sheet-backdrop'),
  sheetBody: $('sheet-body'),
  sheetTitle: $('sheet-title'),
  tuneBtn: $('tune-btn'),
  tuneBackdrop: $('tune-backdrop'),
  tuneList: $('tune-list'),
  tuneNote: $('tune-note'),
  version: $('version'),
};

const tuningFor = (gameId) => state.tuning[gameId] || {};

// ------------------------------------------------------------------ prefs

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (GAMES.some((g) => g.id === saved.gameId)) state.gameId = saved.gameId;
    if (typeof saved.aiCount === 'number') state.aiCount = saved.aiCount;
    if (saved.tuning && typeof saved.tuning === 'object') state.tuning = saved.tuning;
    state.aiCount = clampAi(state.aiCount);
  } catch {
    /* First run, private mode, or corrupt value: the defaults are fine. */
  }
}

function savePrefs() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* Saving preferences is a convenience, never a requirement. */
  }
}

function clampAi(n) {
  const game = getGame(state.gameId);
  return Math.min(game.maxAi, Math.max(game.minAi, Math.round(n)));
}

// ------------------------------------------------------------ title screen

function renderGames() {
  const frag = document.createDocumentFragment();
  for (const game of GAMES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.role = 'radio';
    chip.textContent = game.name;
    chip.setAttribute('aria-checked', String(game.id === state.gameId));
    chip.addEventListener('click', () => {
      state.gameId = game.id;
      state.aiCount = clampAi(state.aiCount);
      savePrefs();
      renderGames();
      renderCount();
    });
    frag.append(chip);
  }
  el.variantList.replaceChildren(frag);
  el.variantHint.textContent = getGame(state.gameId).tagline;
}

function renderCount() {
  const game = getGame(state.gameId);
  el.countValue.textContent = state.aiCount;
  el.countUp.disabled = state.aiCount >= game.maxAi;
  el.countDown.disabled = state.aiCount <= game.minAi;
  el.countHint.textContent = game.setupHint(state.aiCount + 1, tuningFor(game.id));
  el.tuneBtn.classList.toggle('hidden', !game.tunables);
  el.tuneBtn.textContent = tunedCount(game) ? `Tune the rules (${tunedCount(game)} changed)` : 'Tune the rules';
}

/** How many of this game's numbers have been moved off their defaults. */
function tunedCount(game) {
  if (!game.tunables) return 0;
  const overrides = tuningFor(game.id);
  const players = state.aiCount + 1;
  return game.tunables.filter((f) => {
    const v = overrides[f.key];
    return typeof v === 'number' && v !== defaultValue(f, players);
  }).length;
}

function bumpCount(delta) {
  const next = clampAi(state.aiCount + delta);
  if (next === state.aiCount) return;
  state.aiCount = next;
  savePrefs();
  renderCount();
}

function hideScreens() {
  for (const id of SCREEN_IDS) $(id).classList.add('hidden');
}

function showTitle() {
  for (const view of views.values()) view.stop();
  hideScreens();
  $('results').classList.add('hidden');
  el.title.classList.remove('hidden');
  renderGames();
  renderCount();
}

function startGame() {
  const game = getGame(state.gameId);
  const tuning = tuningFor(game.id);
  for (const view of views.values()) view.stop();
  if (!views.has(game.id)) views.set(game.id, game.createView());

  el.title.classList.add('hidden');
  hideScreens();
  $('results').classList.add('hidden');
  $(game.screenId).classList.remove('hidden');
  game.start(views.get(game.id), state.aiCount, tuning);
}

// ------------------------------------------------------------------ sheet

function openRules() {
  const game = getGame(state.gameId);
  el.sheetTitle.textContent = `How to play — ${game.name}`;
  el.sheetBody.innerHTML = `<ol>${game.howToPlay.map((line) => `<li>${line}</li>`).join('')}</ol>`;
  el.sheetBackdrop.classList.remove('hidden');
}

function closeRules() {
  el.sheetBackdrop.classList.add('hidden');
}

// --------------------------------------------------------------- tuning

function currentValue(game, field) {
  const v = tuningFor(game.id)[field.key];
  return typeof v === 'number' ? v : defaultValue(field, state.aiCount + 1);
}

function setValue(game, field, value) {
  const players = state.aiCount + 1;
  const next = Math.min(field.max, Math.max(field.min, value));
  const overrides = { ...tuningFor(game.id) };
  if (next === defaultValue(field, players)) delete overrides[field.key];
  else overrides[field.key] = next;
  state.tuning = { ...state.tuning, [game.id]: overrides };
  savePrefs();
  renderTuning();
  renderCount();
}

function renderTuning() {
  const game = getGame(state.gameId);
  if (!game.tunables) return;
  const players = state.aiCount + 1;
  const frag = document.createDocumentFragment();
  let group = null;

  for (const field of game.tunables) {
    if (field.group && field.group !== group) {
      group = field.group;
      const head = document.createElement('div');
      head.className = 'tune-group';
      head.textContent = group;
      frag.append(head);
    }

    const value = currentValue(game, field);
    const row = document.createElement('div');
    row.className = `tune-row${value !== defaultValue(field, players) ? ' changed' : ''}`;

    const label = document.createElement('span');
    label.className = 'tune-label';
    label.innerHTML = `${field.label}${field.hint ? `<small>${field.hint}</small>` : ''}`;

    const ctl = document.createElement('span');
    ctl.className = 'tune-ctl';
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'step';
    down.innerHTML = '&minus;';
    down.disabled = value <= field.min;
    down.setAttribute('aria-label', `Less ${field.label}`);
    down.addEventListener('click', () => setValue(game, field, value - 1));

    const out = document.createElement('output');
    out.className = 'tune-value';
    out.textContent = value;

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'step';
    up.textContent = '+';
    up.disabled = value >= field.max;
    up.setAttribute('aria-label', `More ${field.label}`);
    up.addEventListener('click', () => setValue(game, field, value + 1));

    ctl.append(down, out, up);
    row.append(label, ctl);
    frag.append(row);
  }

  el.tuneList.replaceChildren(frag);

  const changed = tunedCount(game);
  const warnings = tuningWarnings(tunedRules(tuningFor(game.id), players), players);
  el.tuneNote.innerHTML = warnings.length
    ? warnings.map((w) => `<span class="tune-warn">${w}</span>`).join('')
    : changed
      ? `${changed} changed from the defaults. Takes effect on the next game.`
      : `${game.name}, at ${players} players. Takes effect on the next game.`;
}

function openTuning() {
  renderTuning();
  el.tuneBackdrop.classList.remove('hidden');
}

function closeTuning() {
  el.tuneBackdrop.classList.add('hidden');
}

function resetTuning() {
  const game = getGame(state.gameId);
  const next = { ...state.tuning };
  delete next[game.id];
  state.tuning = next;
  savePrefs();
  renderTuning();
  renderCount();
}

// ------------------------------------------------------------------ wiring

$('count-up').addEventListener('click', () => bumpCount(1));
$('count-down').addEventListener('click', () => bumpCount(-1));
$('start-btn').addEventListener('click', startGame);
$('title-rules-btn').addEventListener('click', openRules);
$('rules-btn').addEventListener('click', openRules);
$('cast-rules').addEventListener('click', openRules);
$('sheet-close').addEventListener('click', closeRules);
el.sheetBackdrop.addEventListener('click', (event) => {
  if (event.target === el.sheetBackdrop) closeRules();
});
$('tune-btn').addEventListener('click', openTuning);
$('tune-close').addEventListener('click', closeTuning);
$('tune-reset').addEventListener('click', resetTuning);
el.tuneBackdrop.addEventListener('click', (event) => {
  if (event.target === el.tuneBackdrop) closeTuning();
});
$('quit-btn').addEventListener('click', showTitle);
$('cast-quit').addEventListener('click', showTitle);
$('again-btn').addEventListener('click', startGame);
$('menu-btn').addEventListener('click', showTitle);

el.version.textContent = `v${VERSION}`;
loadPrefs();
showTitle();
