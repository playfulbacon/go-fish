import { CastGame, SET_LABELS } from './engine.js';
import { autoPlay } from './ai.js';
import { SUITS, rankPlural, suitName } from '../cards.js';

const AI_NAMES = ['Ruby', 'Milo', 'Pip', 'Nova', 'Otis'];
const COLORS = ['#e0663f', '#3f7fe0', '#8a63d2', '#d4a02c', '#2f9e6f', '#0f766e'];

/** Length of each beat of the game, in ms. */
const BEAT = { cast: 620, respond: 320, reveal: 760, boat: 640, banner: 1250, think: 520 };

const $ = (id) => document.getElementById(id);
const suitOf = (id) => SUITS.find((s) => s.id === id);

/** What a call named, for prose: "Queens" or "Hearts". */
const calledLabel = (called) =>
  called.kind === 'rank' ? rankPlural(called.value) : suitName(called.value);

/** A face-up card element. */
function cardEl(card, className = 'card', interactive = false) {
  const el = document.createElement(interactive ? 'button' : 'div');
  if (interactive) el.type = 'button';
  el.className = `${className}${suitOf(card.suit).color === 'red' ? ' red' : ''}`;
  el.innerHTML = `<span class="r">${card.rank}</span><span class="s">${suitOf(card.suit).symbol}</span>`;
  return el;
}

export class CastView {
  constructor() {
    this.game = null;
    this.timers = [];
    this.visualTimers = [];
    this.callKind = null;   // 'rank' | 'suit' while a call is armed
    this.swapArmed = false;
    this.swapPick = null;   // first boated card chosen for a swap
    this.rivalEls = new Map();
    this.handIds = new Set();

    this.el = {
      screen: $('cast-screen'),
      table: $('cast-screen').querySelector('.pond-table'),
      pill: $('cast-pill'),
      rivals: $('cast-rivals'),
      slot: $('cast-slot'),
      answers: $('cast-answers'),
      pile: $('cast-pile'),
      status: $('cast-status'),
      boat: $('cast-boat'),
      luck: $('cast-luck'),
      score: $('cast-score'),
      actions: $('cast-actions'),
      hand: $('cast-hand'),
      results: $('results'),
      resultsTitle: $('results-title'),
      scoreboard: $('scoreboard'),
    };
  }

  // ------------------------------------------------------------ life cycle

  start(rules, aiCount) {
    this.#clearTimers();
    this.#clearVisuals();
    this.rules = rules;

    const players = [{ name: 'You', isHuman: true, color: COLORS[COLORS.length - 1] }];
    for (let i = 0; i < aiCount; i++) {
      players.push({ name: AI_NAMES[i], isHuman: false, color: COLORS[i % (COLORS.length - 1)] });
    }

    this.game = new CastGame(rules, players);
    this.callKind = null;
    this.swapArmed = false;
    this.swapPick = null;
    this.handIds = new Set();
    this.el.results.classList.add('hidden');
    this.#buildRivals();
    this.#present(this.game.drainEvents());
  }

  stop() {
    this.#clearTimers();
    this.#clearVisuals();
  }

  #clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Visual tear-down, kept off the beat queue so a tap cannot strand it. */
  #clearVisuals() {
    this.visualTimers.forEach(clearTimeout);
    this.visualTimers = [];
    this.el.screen.querySelectorAll('.banner').forEach((b) => b.remove());
  }

  #after(ms, fn) { this.timers.push(setTimeout(fn, ms)); }
  #afterVisual(ms, fn) { this.visualTimers.push(setTimeout(fn, ms)); }

  // ------------------------------------------------------------- game loop

  #present(events) {
    let delay = 0;
    let lastLine = null;

    for (const event of events) {
      const line = this.#lineFor(event);
      if (line) lastLine = line;

      if (event.type === 'reveal') delay += BEAT.reveal;
      else if (event.type === 'score' || event.type === 'bust') {
        const at = delay;
        this.#after(at, () => this.#showBanner(event));
        delay += BEAT.banner;
      }
    }

    this.#render();
    const game = this.game;
    if (lastLine) this.#setStatus(lastLine);
    else if (this.#waitingOnPlayer()) this.#setStatus(this.#promptText());

    if (game.isOver) {
      this.#after(delay + 500, () => this.#showResults());
      return;
    }

    if (this.#waitingOnPlayer()) {
      if (lastLine) this.#after(Math.max(delay + 400, 1100), () => this.#setStatus(this.#promptText()));
      return;
    }

    const wait = delay + this.#beatFor(game.phase);
    this.#after(wait, () => {
      autoPlay(game);
      this.#present(game.drainEvents());
    });
  }

  #beatFor(phase) {
    if (phase === 'respond') return BEAT.respond;
    if (phase === 'boat') return BEAT.boat;
    return BEAT.cast;
  }

  /** True when the game cannot move without the player doing something. */
  #waitingOnPlayer() {
    const game = this.game;
    return !game.isOver && game.current.isHuman;
  }

  #lineFor(event) {
    const game = this.game;
    const name = (i) => (game.players[i].isHuman ? 'You' : `<b>${game.players[i].name}</b>`);
    const you = (i) => game.players[i].isHuman;

    switch (event.type) {
      case 'call':
        return `${name(event.player)} ${you(event.player) ? 'call' : 'calls'} <b>${calledLabel(event)}</b>.`;
      case 'boat-swap': {
        const a = `<b>${event.a.card.rank}${suitOf(event.a.card.suit).symbol}</b>`;
        const b = `<b>${event.b.card.rank}${suitOf(event.b.card.suit).symbol}</b>`;
        return `${name(event.player)} ${you(event.player) ? 'swap' : 'swaps'} ${a} and ${b} between boats.`;
      }
      case 'cast': {
        const card = `<b>${event.card.rank}${suitOf(event.card.suit).symbol}</b>`;
        return `${name(event.player)} ${you(event.player) ? 'cast' : 'casts'} the ${card}.`;
      }
      case 'reveal': {
        const matched = event.responses.filter((r) => r.matched).length;
        if (matched === 0) return 'No matches — nobody earns luck.';
        return `${matched} match${matched === 1 ? '' : 'es'} — luck earned.`;
      }
      case 'boat': {
        const card = `<b>${event.card.rank}${suitOf(event.card.suit).symbol}</b>`;
        return `${name(event.player)} ${you(event.player) ? 'boat' : 'boats'} the ${card}.`;
      }
      case 'score':
        return `${name(event.player)} — <b>${SET_LABELS[event.kind]}</b>, +${event.points}.`;
      case 'bust':
        return `${name(event.player)} ${you(event.player) ? 'fill' : 'fills'} the boat with no set.`;
      case 'redraw':
        return 'Swapped a card out of your hand.';
      case 'reshuffle':
        return 'The discards are shuffled back into the draw pile.';
      case 'gameover':
        return 'Target reached.';
      default:
        return null;
    }
  }

  #promptText() {
    const game = this.game;
    if (game.isOver) return '&nbsp;';
    const costs = game.rules.costs;

    if (game.phase === 'cast') {
      if (this.callKind === 'rank') return `Tap a card to cast it and call its rank (${costs.call} luck).`;
      if (this.callKind === 'suit') return `Tap a card to cast it and call its suit (${costs.call} luck).`;
      if (this.swapArmed) {
        return this.swapPick
          ? 'Now tap a card in a different boat to swap with.'
          : `Tap any boated card, then one in a different boat (${costs.boatSwap} luck).`;
      }
      return 'Cast a card into the pond.';
    }
    if (game.phase === 'respond') {
      const forced = game.forcedCardsFor(game.human.index);
      if (forced.length) return `<b>${calledLabel(game.called)}</b> were called — you must answer with one.`;
      return 'Answer face down.';
    }
    if (game.phase === 'boat') {
      if (game.boatsLeft > 0) return 'Tap a card to boat it.';
      return 'Boat another, or end your turn.';
    }
    return '&nbsp;';
  }

  // ------------------------------------------------------------- rendering

  #render() {
    const game = this.game;
    const you = game.human;

    this.el.pill.textContent = game.isOver
      ? 'Game over'
      : game.current.isHuman
        ? (game.phase === 'cast' ? 'Your cast' : game.phase === 'boat' ? 'Your catch' : 'Your answer')
        : `${game.players[game.caster].name}’s cast`;
    this.el.pill.classList.toggle('mine', !game.isOver && game.current.isHuman);

    this.swapActive = !game.isOver && game.current.isHuman
      && game.phase === 'cast' && this.swapArmed && game.canSwapBoats;

    this.#renderRivals();
    this.#renderTable();
    this.#renderPile();
    this.#renderBoat(this.el.boat, you, true);
    this.#renderLuck();
    this.#renderScore();
    this.#renderActions();
    this.#renderHand();
  }

  #buildRivals() {
    this.el.rivals.replaceChildren();
    this.rivalEls.clear();
    for (const player of this.game.players) {
      if (player.isHuman) continue;
      const tile = document.createElement('div');
      tile.className = 'rival';
      tile.innerHTML = `
        <span class="avatar" style="background:${player.color}">
          ${player.name.charAt(0)}<span class="avatar-count">0</span>
        </span>
        <span class="rival-name">${player.name}</span>
        <div class="boat mini"></div>
        <div class="luck mini"></div>`;
      this.el.rivals.append(tile);
      this.rivalEls.set(player.index, {
        tile,
        score: tile.querySelector('.avatar-count'),
        boat: tile.querySelector('.boat'),
        luck: tile.querySelector('.luck'),
      });
    }
  }

  #renderRivals() {
    const game = this.game;
    for (const [index, refs] of this.rivalEls) {
      const player = game.players[index];
      refs.score.textContent = player.score;
      refs.tile.classList.toggle('active', !game.isOver && game.caster === index);
      this.#renderBoat(refs.boat, player, false);
      this.#renderPips(refs.luck, player.luck, true);
    }
  }

  #renderBoat(container, player, large) {
    const size = this.game.rules.boatSize;
    const swapping = this.swapActive;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < size; i++) {
      const card = player.boat[i];
      if (card) {
        const el = cardEl(card, large ? 'card boat-card' : 'card boat-card tiny', swapping);
        if (!container.dataset[`slot${i}`] || container.dataset[`slot${i}`] !== card.id) el.classList.add('landed');
        if (swapping) {
          const pick = this.swapPick;
          const chosen = pick && pick.player === player.index && pick.index === i;
          el.classList.add('swappable');
          el.classList.toggle('picked', !!chosen);
          // Once one card is held, only a different player's boat can complete it.
          el.disabled = !!pick && !chosen && pick.player === player.index;
          el.addEventListener('click', () => this.#onBoatCardTap(player.index, i));
        }
        frag.append(el);
      } else {
        const slot = document.createElement('div');
        slot.className = large ? 'slot' : 'slot tiny';
        frag.append(slot);
      }
      container.dataset[`slot${i}`] = card ? card.id : '';
    }
    container.replaceChildren(frag);
  }

  #renderPips(container, count, mini) {
    const max = this.game.rules.maxLuck;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < max; i++) {
      const pip = document.createElement('span');
      pip.className = `pip${i < count ? ' on' : ''}${mini ? ' mini' : ''}`;
      frag.append(pip);
    }
    container.replaceChildren(frag);
  }

  #renderLuck() {
    const you = this.game.human;
    this.el.luck.innerHTML = `<span class="luck-label">Luck</span>`;
    const pips = document.createElement('span');
    pips.className = 'pips';
    this.el.luck.append(pips);
    this.#renderPips(pips, you.luck, false);
  }

  #renderScore() {
    const game = this.game;
    const you = game.human;
    this.el.score.innerHTML =
      `<span class="tally-n">${you.score}</span><span class="tally-of">/ ${game.targetScore}</span>`;
  }

  #renderTable() {
    const game = this.game;

    // The cast card.
    if (game.castCard) {
      const el = cardEl(game.castCard, 'card cast-card');
      const wrap = document.createElement('div');
      wrap.className = 'cast-wrap';
      wrap.append(el);
      const label = document.createElement('span');
      label.className = 'cast-label';
      label.textContent = game.called ? `calling ${calledLabel(game.called)}` : 'cast';
      wrap.append(label);
      this.el.slot.replaceChildren(wrap);
    } else {
      const empty = document.createElement('div');
      empty.className = 'slot cast-empty';
      this.el.slot.replaceChildren(empty);
    }

    // The answers.
    const revealed = game.phase === 'boat' || game.isOver;
    const canTake = game.phase === 'boat' && game.current.isHuman && game.boatsLeft > 0;
    const frag = document.createDocumentFragment();

    game.responses.forEach((response, index) => {
      if (response.taken) return;
      const wrap = document.createElement(canTake ? 'button' : 'div');
      wrap.className = `answer${revealed ? ' up' : ''}${response.matched ? ' matched' : ''}`;
      if (canTake) {
        wrap.type = 'button';
        wrap.classList.add('takeable');
        wrap.addEventListener('click', () => this.#takeAnswer(index));
      }

      const inner = document.createElement('div');
      inner.className = 'answer-inner';
      const back = document.createElement('div');
      back.className = 'face back';
      const front = cardEl(response.card, 'face front');
      inner.append(back, front);
      wrap.append(inner);

      const who = document.createElement('span');
      who.className = 'answer-who';
      who.textContent = response.player === null ? 'pond' : game.players[response.player].name;
      wrap.append(who);
      frag.append(wrap);
    });
    this.el.answers.replaceChildren(frag);
  }

  #renderPile() {
    const left = this.game.draw.length;
    this.el.pile.innerHTML =
      `<span class="pile-stack"><span></span><span></span><span></span></span>` +
      `<span class="pile-count">${left}</span>`;
    this.el.pile.classList.toggle('low', left <= 5);
  }

  #renderActions() {
    const game = this.game;
    const you = game.human;
    const costs = game.rules.costs;
    const frag = document.createDocumentFragment();

    const button = (label, on, handler, enabled = true) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `action${on ? ' on' : ''}`;
      el.innerHTML = label;
      el.disabled = !enabled;
      el.addEventListener('click', handler);
      frag.append(el);
    };

    if (!game.isOver && game.current.isHuman) {
      if (game.phase === 'cast') {
        const arm = (kind) => {
          this.callKind = this.callKind === kind ? null : kind;
          this.swapArmed = false;
          this.swapPick = null;
          this.#render();
          this.#setStatus(this.#promptText());
        };
        if (you.luck >= costs.call) {
          button(`Call rank <i>${costs.call}</i>`, this.callKind === 'rank', () => arm('rank'));
          button(`Call suit <i>${costs.call}</i>`, this.callKind === 'suit', () => arm('suit'));
        }
        if (game.canSwapBoats) {
          button(`Swap boats <i>${costs.boatSwap}</i>`, this.swapArmed, () => {
            this.swapArmed = !this.swapArmed;
            this.callKind = null;
            this.swapPick = null;
            this.#render();
            this.#setStatus(this.#promptText());
          });
        }
      }
      if (game.phase === 'boat' && game.boatsLeft === 0) {
        if (game.canBuyExtraBoat) {
          button(`Boat another <i>${costs.extraBoat}</i>`, false, () => {
            game.buyExtraBoat();
            this.#present(game.drainEvents());
          });
        }
        button('End turn', false, () => {
          game.endBoating();
          this.#present(game.drainEvents());
        });
      }
    }
    this.el.actions.replaceChildren(frag);
    this.el.actions.classList.toggle('empty', !frag.childNodes.length && !this.el.actions.childNodes.length);
  }

  #renderHand() {
    const game = this.game;
    const you = game.human;
    const live = !game.isOver && game.current.isHuman
      && (game.phase === 'cast' || game.phase === 'respond');

    // A called rank leaves only those cards playable.
    let playable = new Set(you.hand.map((c) => c.id));
    if (live && game.phase === 'respond') {
      const forced = game.forcedCardsFor(you.index);
      if (forced.length) playable = new Set(forced.map((c) => c.id));
    }

    const frag = document.createDocumentFragment();
    const nextIds = new Set();
    you.hand.forEach((card, i) => {
      nextIds.add(card.id);
      const el = cardEl(card, 'card');
      el.classList.toggle('dimmed', live && !playable.has(card.id));
      if (!this.handIds.has(card.id)) {
        el.classList.add('enter');
        el.style.animationDelay = `${Math.min(i * 26, 210)}ms`;
      }
      if (live && playable.has(card.id)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-btn';
        button.append(el);
        button.addEventListener('click', () => this.#playCard(card.id));
        frag.append(button);
      } else {
        frag.append(el);
      }
    });
    this.el.hand.replaceChildren(frag);
    this.el.hand.classList.toggle('live', live);
    this.el.hand.classList.toggle('tight', you.hand.length > 5);
    this.handIds = nextIds;
  }

  #setStatus(html) {
    this.el.status.innerHTML = `<span>${html}</span>`;
  }

  // ------------------------------------------------------------------ taps

  #playCard(cardId) {
    const game = this.game;
    if (game.isOver || !game.current.isHuman) return;
    this.#clearTimers();

    if (game.phase === 'cast') {
      const call = this.callKind;
      this.callKind = null;
      this.swapArmed = false;
      this.swapPick = null;
      const result = game.cast(cardId, { call });
      if (!result.ok) { this.#render(); return; }
      this.#present(game.drainEvents());
      return;
    }

    if (game.phase === 'respond') {
      const result = game.respond(game.human.index, cardId);
      if (!result.ok) { this.#render(); return; }
      this.#present(game.drainEvents());
    }
  }

  #onBoatCardTap(playerIndex, cardIndex) {
    const game = this.game;
    if (!this.swapActive) return;
    const pick = this.swapPick;

    if (!pick) {
      this.swapPick = { player: playerIndex, index: cardIndex };
      this.#render();
      this.#setStatus(this.#promptText());
      return;
    }
    if (pick.player === playerIndex) {
      // Tapping your own pick again clears it; the same boat cannot swap itself.
      this.swapPick = pick.index === cardIndex ? null : { player: playerIndex, index: cardIndex };
      this.#render();
      this.#setStatus(this.#promptText());
      return;
    }

    this.#clearTimers();
    const result = game.swapBoats(pick, { player: playerIndex, index: cardIndex });
    this.swapArmed = false;
    this.swapPick = null;
    if (!result.ok) { this.#render(); this.#setStatus(this.#promptText()); return; }
    this.#present(game.drainEvents());
  }

  #takeAnswer(index) {
    const game = this.game;
    if (game.isOver || game.phase !== 'boat' || !game.current.isHuman) return;
    this.#clearTimers();
    const result = game.boat(index);
    if (!result.ok) { this.#render(); return; }
    this.#present(game.drainEvents());
  }

  // -------------------------------------------------------------- flourish

  #showBanner(event) {
    const banner = document.createElement('div');
    const won = event.type === 'score';
    banner.className = `banner${won ? ' good' : ' bust'}`;
    const who = this.game.players[event.player];
    const title = won ? SET_LABELS[event.kind] : 'Bust';
    const sub = won ? `+${event.points}` : 'boat cleared';
    banner.innerHTML =
      `<span class="banner-who">${who.isHuman ? 'You' : who.name}</span>` +
      `<span class="banner-title">${title}</span>` +
      `<span class="banner-sub">${sub}</span>`;
    this.el.table.append(banner);
    this.#afterVisual(BEAT.banner, () => banner.remove());
  }

  #showResults() {
    const game = this.game;
    this.#clearVisuals();
    const ranked = game.players.slice().sort((a, b) => b.score - a.score);
    const humanWon = game.winners.includes(game.human.index);

    this.el.resultsTitle.textContent = humanWon
      ? (game.winners.length > 1 ? 'You tie for the win' : 'You win!')
      : game.winners.length > 1 ? 'It’s a tie' : `${game.players[game.winners[0]].name} wins`;

    const frag = document.createDocumentFragment();
    for (const player of ranked) {
      const row = document.createElement('li');
      row.className = `score-row${game.winners.includes(player.index) ? ' win' : ''}`;
      row.innerHTML = `
        <span class="dot" style="background:${player.color}">${player.name.charAt(0)}</span>
        <span class="who">${player.name}</span>
        <span class="n">${player.score} <small>point${player.score === 1 ? '' : 's'}</small></span>`;
      frag.append(row);
    }
    this.el.scoreboard.replaceChildren(frag);
    this.el.results.classList.remove('hidden');
  }
}
