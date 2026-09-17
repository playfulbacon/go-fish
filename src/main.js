import { GameView } from './ui.js';
import { VARIANTS, getVariant, DEFAULT_VARIANT } from './rules/index.js';

const $ = (id) => document.getElementById(id);
const STORE = 'gofish:prefs';

const MIN_AI = 1;
const MAX_AI = 5;

const state = {
  variantId: DEFAULT_VARIANT,
  aiCount: 3,
};

const el = {
  title: $('title-screen'),
  game: $('game-screen'),
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

const view = new GameView({ onExit: showTitle });

// ------------------------------------------------------------------ prefs

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (typeof saved.aiCount === 'number') state.aiCount = clampAi(saved.aiCount);
    if (VARIANTS.some((v) => v.id === saved.variantId)) state.variantId = saved.variantId;
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

const clampAi = (n) => Math.min(MAX_AI, Math.max(MIN_AI, Math.round(n)));

// ------------------------------------------------------------ title screen

function renderVariants() {
  const frag = document.createDocumentFragment();
  for (const variant of VARIANTS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.role = 'radio';
    chip.textContent = variant.name;
    chip.setAttribute('aria-checked', String(variant.id === state.variantId));
    chip.addEventListener('click', () => {
      state.variantId = variant.id;
      savePrefs();
      renderVariants();
    });
    frag.append(chip);
  }
  el.variantList.replaceChildren(frag);
  el.variantHint.textContent = getVariant(state.variantId).tagline;
}

function renderCount() {
  const variant = getVariant(state.variantId);
  const total = state.aiCount + 1;
  el.countValue.textContent = state.aiCount;
  el.countUp.disabled = state.aiCount >= MAX_AI;
  el.countDown.disabled = state.aiCount <= MIN_AI;
  el.countHint.textContent = `${total} players, ${variant.handSize(total)} cards each.`;
}

function bumpCount(delta) {
  const next = clampAi(state.aiCount + delta);
  if (next === state.aiCount) return;
  state.aiCount = next;
  savePrefs();
  renderCount();
}

function showTitle() {
  view.stop();
  el.game.classList.add('hidden');
  el.title.classList.remove('hidden');
  $('results').classList.add('hidden');
  renderVariants();
  renderCount();
}

function startGame() {
  el.title.classList.add('hidden');
  el.game.classList.remove('hidden');
  $('results').classList.add('hidden');
  view.start(getVariant(state.variantId), state.aiCount);
}

// ------------------------------------------------------------------ sheet

function openRules() {
  const variant = getVariant(state.variantId);
  el.sheetTitle.textContent = `How to play — ${variant.name}`;
  el.sheetBody.innerHTML = `<ol>${variant.howToPlay.map((line) => `<li>${line}</li>`).join('')}</ol>`;
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
$('sheet-close').addEventListener('click', closeRules);
el.sheetBackdrop.addEventListener('click', (event) => {
  if (event.target === el.sheetBackdrop) closeRules();
});
$('quit-btn').addEventListener('click', showTitle);
$('again-btn').addEventListener('click', startGame);
$('menu-btn').addEventListener('click', showTitle);

loadPrefs();
showTitle();
