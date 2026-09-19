import { GAMES, DEFAULT_GAME, SCREEN_IDS, getGame } from './games.js';

const $ = (id) => document.getElementById(id);
const STORE = 'gofish:prefs';

const state = {
  gameId: DEFAULT_GAME,
  aiCount: getGame(DEFAULT_GAME).defaultAi,
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
};

// ------------------------------------------------------------------ prefs

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (GAMES.some((g) => g.id === saved.gameId)) state.gameId = saved.gameId;
    if (typeof saved.aiCount === 'number') state.aiCount = saved.aiCount;
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
  el.countHint.textContent = game.setupHint(state.aiCount + 1);
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
  for (const view of views.values()) view.stop();
  if (!views.has(game.id)) views.set(game.id, game.createView());

  el.title.classList.add('hidden');
  hideScreens();
  $('results').classList.add('hidden');
  $(game.screenId).classList.remove('hidden');
  game.start(views.get(game.id), state.aiCount);
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
$('quit-btn').addEventListener('click', showTitle);
$('cast-quit').addEventListener('click', showTitle);
$('again-btn').addEventListener('click', startGame);
$('menu-btn').addEventListener('click', showTitle);

loadPrefs();
showTitle();
