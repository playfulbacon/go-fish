import { Game } from './engine.js';
import { Memory } from './ai.js';
import { rankPlural, rankSingular, SUITS } from './cards.js';

const AI_NAMES = ['Ruby', 'Milo', 'Pip', 'Nova', 'Otis'];
const COLORS = ['#e0663f', '#3f7fe0', '#8a63d2', '#d4a02c', '#2f9e6f', '#0f766e'];
const MAX_PILE_CARDS = 18;

/** How long each beat of the game lasts, in ms. */
const BEAT = { think: 950, fish: 800, bubble: 420, hint: 1500 };

const $ = (id) => document.getElementById(id);
const suitOf = (id) => SUITS.find((s) => s.id === id);

export class GameView {
  constructor({ onExit }) {
    this.onExit = onExit;
    this.game = null;
    this.memory = null;
    this.timers = [];
    this.selectedTarget = null;
    this.selectedRank = null;
    this.handIds = new Set();
    this.opponentEls = new Map();
    this.booksShown = [];
    this.bubbles = [];
    this.visualTimers = [];

    this.el = {
      screen: $('game-screen'),
      opponents: $('opponents'),
      pond: $('pond'),
      pondCards: $('pond-cards'),
      pondCount: $('pond-count'),
      turnPill: $('turn-pill'),
      status: $('status'),
      hand: $('hand'),
      youBooks: $('you-books'),
      reveal: $('reveal-layer'),
      results: $('results'),
      resultsTitle: $('results-title'),
      scoreboard: $('scoreboard'),
    };

    this.#buildPile();
    this.el.pond.addEventListener('click', () => this.#onPondTap());
  }

  // ------------------------------------------------------------ life cycle

  start(rules, aiCount) {
    this.#clearTimers();
    this.rules = rules;
    const players = [{ name: 'You', isHuman: true, color: COLORS[COLORS.length - 1] }];
    for (let i = 0; i < aiCount; i++) {
      players.push({ name: AI_NAMES[i], isHuman: false, color: COLORS[i % (COLORS.length - 1)] });
    }

    this.game = new Game(rules, players);
    this.memory = new Memory(players.length);
    this.selectedTarget = null;
    this.selectedRank = null;
    this.handIds = new Set();
    this.booksShown = players.map(() => 0);

    this.el.results.classList.add('hidden');
    this.el.reveal.replaceChildren();
    this.el.youBooks.replaceChildren();
    this.#clearBubbles();
    this.#buildOpponents();
    this.#present(this.game.drainEvents());
  }

  stop() {
    this.#clearTimers();
    this.#clearBubbles();
    this.el.reveal.replaceChildren();
  }

  /** Cancels pending game beats. Does not touch in-flight visuals. */
  #clearTimers() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  #after(ms, fn) {
    this.timers.push(setTimeout(fn, ms));
  }

  /**
   * Tear-down for something already on screen. Kept off the beat queue: a
   * player tapping mid-animation cancels the next beat, and cleanup that rode
   * along with it would strand bubbles in the DOM forever.
   */
  #afterVisual(ms, fn) {
    this.visualTimers.push(setTimeout(fn, ms));
  }

  // ------------------------------------------------------------- game loop

  /** Take the events from the move that just happened and play them out. */
  #present(events) {
    let beat = 0;
    let lastLine = null;

    for (const event of events) {
      this.memory.observe(event);
      const beatIndex = beat;
      const bubble = this.#bubbleFor(event);
      if (bubble) {
        this.#after(beatIndex * BEAT.bubble, () => this.#showBubble(bubble.player, bubble.text, bubble.accent));
        beat++;
      }
      if (event.type === 'draw' && this.game.players[event.player].isHuman) {
        this.#after(beatIndex * BEAT.bubble, () => this.#showReveal(event.card));
      }
      const line = this.#lineFor(event);
      if (line) lastLine = line;
      if (event.type === 'gameover') this.#after(700, () => this.#showResults());
    }

    this.#render();
    const player = this.game.current;
    if (lastLine) this.#setStatus(lastLine);
    else if (player.isHuman) this.#setStatus(this.#promptText());

    if (this.game.isOver) return;

    if (player.isHuman) {
      // Let the player read what just happened, then remind them what to do.
      if (lastLine) this.#after(Math.max(BEAT.hint, beat * BEAT.bubble), () => this.#setStatus(this.#promptText()));
    } else {
      const wait = Math.max(this.game.phase === 'fish' ? BEAT.fish : BEAT.think, beat * BEAT.bubble + 250);
      this.#after(wait, () => {
        this.game.autoPlay(this.memory.knowledge);
        this.#present(this.game.drainEvents());
      });
    }
  }

  #bubbleFor(event) {
    const name = (i) => this.game.players[i].name;
    switch (event.type) {
      case 'ask':
        return { player: event.player, text: `Got any ${rankPlural(event.rank)}?` };
      case 'gofish':
        return { player: event.player, text: 'Go fish!' };
      case 'give':
        return { player: event.from, text: `Take ${event.count === 1 ? 'it' : `all ${event.count}`}.`, accent: true };
      case 'book':
        return { player: event.player, text: `Book of ${rankPlural(event.rank)}!`, accent: true };
      case 'refill':
        return { player: event.player, text: 'Out of cards — drawing one.' };
      case 'skip':
        return { player: event.player, text: `${name(event.player)} is out.` };
      default:
        return null;
    }
  }

  #lineFor(event) {
    const you = (i) => this.game.players[i].isHuman;
    const who = (i) => (you(i) ? 'You' : `<b>${this.game.players[i].name}</b>`);
    switch (event.type) {
      case 'ask':
        return `${who(event.player)} ${you(event.player) ? 'ask' : 'asks'} ${who(event.target)} for <b>${rankPlural(event.rank)}</b>.`;
      case 'gofish':
        return you(event.asker)
          ? `${who(event.player)} says go fish — tap the pond.`
          : `${who(event.player)} says go fish.`;
      case 'give': {
        const cards = `${event.count} <b>${event.count === 1 ? rankSingular(event.rank) : rankPlural(event.rank)}</b>`;
        return `${who(event.from)} ${you(event.from) ? 'hand over' : 'hands over'} ${cards}.`;
      }
      case 'draw':
        if (you(event.player)) {
          const card = `<b>${rankSingular(event.card.rank)} of ${suitOf(event.card.suit).symbol}</b>`;
          return event.lucky ? `You fished up the ${card} — go again!` : `You fished up the ${card}.`;
        }
        return event.lucky
          ? `${who(event.player)} fished exactly what they asked for — they go again.`
          : `${who(event.player)} fishes a card.`;
      case 'book':
        return `${who(event.player)} ${you(event.player) ? 'complete' : 'completes'} a book of <b>${rankPlural(event.rank)}</b>.`;
      case 'pond-empty':
        return 'The pond is empty.';
      case 'skip':
        return `${who(event.player)} ${you(event.player) ? 'are' : 'is'} out of cards.`;
      case 'gameover':
        return 'Every book is made.';
      default:
        return null;
    }
  }

  #promptText() {
    const game = this.game;
    if (game.isOver || !game.current.isHuman) return '&nbsp;';
    if (game.phase === 'fish') return 'Tap the pond to fish for a card.';
    if (this.selectedTarget === null) return 'Tap a player, then tap a card to ask for it.';
    return `Asking <b>${game.players[this.selectedTarget].name}</b> — now tap a card.`;
  }

  // ------------------------------------------------------------- rendering

  #render() {
    const game = this.game;
    const human = game.human;
    const myTurn = !game.isOver && game.current.isHuman;

    this.el.turnPill.textContent = game.isOver
      ? 'Game over'
      : myTurn ? 'Your turn' : `${game.current.name}'s turn`;
    this.el.turnPill.classList.toggle('mine', myTurn);

    this.#renderOpponents();
    this.#renderPond();
    this.#renderBooks(this.el.youBooks, human);
    this.#renderHand(human, myTurn);
  }

  #buildOpponents() {
    this.el.opponents.replaceChildren();
    this.opponentEls.clear();
    for (const player of this.game.players) {
      if (player.isHuman) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'opponent';
      button.innerHTML = `
        <span class="avatar" style="background:${player.color}">
          ${player.name.charAt(0)}<span class="avatar-count">0</span>
        </span>
        <span class="opponent-name">${player.name}</span>
        <span class="books-row"></span>`;
      button.addEventListener('click', () => this.#onOpponentTap(player.index));
      this.el.opponents.append(button);
      this.opponentEls.set(player.index, {
        button,
        count: button.querySelector('.avatar-count'),
        books: button.querySelector('.books-row'),
      });
    }
  }

  #renderOpponents() {
    const game = this.game;
    const canAsk = !game.isOver && game.current.isHuman && game.phase === 'ask';
    for (const [index, refs] of this.opponentEls) {
      const player = game.players[index];
      refs.count.textContent = player.hand.length;
      refs.button.classList.toggle('active', !game.isOver && game.turn === index);
      refs.button.disabled = !canAsk || player.hand.length === 0;
      refs.button.setAttribute('aria-pressed', String(this.selectedTarget === index));
      this.#renderBooks(refs.books, player);
    }
  }

  /** Only append chips for newly made books, so the pop animation fires once. */
  #renderBooks(container, player) {
    const shown = this.booksShown[player.index];
    for (let i = shown; i < player.books.length; i++) {
      const chip = document.createElement('span');
      chip.className = 'book-chip';
      chip.textContent = player.books[i];
      container.append(chip);
    }
    this.booksShown[player.index] = player.books.length;
  }

  #buildPile() {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < MAX_PILE_CARDS; i++) {
      // Golden-angle scatter: evenly messy, and identical every time so the
      // pile does not reshuffle itself visually on each render.
      const angle = i * 2.39996;
      // Measured in card widths, not pixels, so the pile keeps its shape when
      // the cards scale down on short screens instead of spilling out.
      const radius = 0.07 + i * 0.038;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const tilt = ((i * 53) % 74) - 37;
      const card = document.createElement('span');
      card.className = 'pile-card';
      card.style.transform =
        `translate(calc(var(--card-w) * ${x.toFixed(3)}), calc(var(--card-w) * ${y.toFixed(3)})) rotate(${tilt}deg)`;
      frag.append(card);
    }
    this.el.pondCards.replaceChildren(frag);
    this.pileCards = [...this.el.pondCards.children];
  }

  #renderPond() {
    const game = this.game;
    const left = game.pond.length;
    const visible = Math.min(left, MAX_PILE_CARDS);
    this.pileCards.forEach((card, i) => { card.style.opacity = i < visible ? '1' : '0'; });

    this.el.pondCount.textContent = left;
    const live = !game.isOver && game.current.isHuman && game.phase === 'fish' && left > 0;
    this.el.pond.classList.toggle('live', live);
    this.el.pond.classList.toggle('empty', left === 0);
    this.el.pond.disabled = !live;
  }

  #renderHand(human, myTurn) {
    const hand = this.el.hand;
    hand.classList.toggle('live', myTurn && this.game.phase === 'ask');
    hand.classList.toggle('tight', human.hand.length > 6);

    if (human.hand.length === 0) {
      hand.replaceChildren(Object.assign(document.createElement('span'), {
        className: 'hand-empty',
        textContent: this.game.pond.length ? 'No cards — you draw at the start of your turn.' : 'You are out of cards.',
      }));
      this.handIds = new Set();
      return;
    }

    const frag = document.createDocumentFragment();
    const nextIds = new Set();
    human.hand.forEach((card, i) => {
      nextIds.add(card.id);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `card${suitOf(card.suit).color === 'red' ? ' red' : ''}`;
      if (!this.handIds.has(card.id)) {
        el.classList.add('enter');
        el.style.animationDelay = `${Math.min(i * 28, 260)}ms`;
      }
      if (card.rank === this.selectedRank) el.classList.add('selected');
      el.dataset.rank = card.rank;
      el.innerHTML = `<span class="r">${card.rank}</span><span class="s">${suitOf(card.suit).symbol}</span>`;
      el.addEventListener('click', () => this.#onCardTap(card.rank));
      frag.append(el);
    });
    hand.replaceChildren(frag);
    this.handIds = nextIds;
  }

  #setStatus(html) {
    this.el.status.innerHTML = `<span>${html}</span>`;
  }

  // ------------------------------------------------------------------ taps

  #onOpponentTap(index) {
    const game = this.game;
    if (game.isOver || !game.current.isHuman || game.phase !== 'ask') return;
    if (game.players[index].hand.length === 0) return;

    this.selectedTarget = this.selectedTarget === index ? null : index;
    this.#renderOpponents();
    this.#clearTimers();
    this.#setStatus(this.#promptText());
  }

  #onCardTap(rank) {
    const game = this.game;
    if (game.isOver || !game.current.isHuman || game.phase !== 'ask') return;

    if (this.selectedTarget === null) {
      this.selectedRank = this.selectedRank === rank ? null : rank;
      this.#renderHand(game.human, true);
      this.#clearTimers();
      this.#setStatus(this.selectedRank
        ? `Asking for <b>${rankPlural(this.selectedRank)}</b> — now tap a player.`
        : this.#promptText());
      return;
    }
    this.#doAsk(this.selectedTarget, rank);
  }

  #doAsk(targetIndex, rank) {
    const result = this.game.ask(targetIndex, rank);
    if (!result.ok) return;
    this.selectedTarget = null;
    this.selectedRank = null;
    this.#clearTimers();
    this.#present(this.game.drainEvents());
  }

  #onPondTap() {
    const game = this.game;
    if (game.isOver || !game.current.isHuman || game.phase !== 'fish') return;
    this.#clearTimers();
    game.fish();
    this.#present(this.game.drainEvents());
  }

  // -------------------------------------------------------------- flourish

  #showBubble(playerIndex, text, accent) {
    const player = this.game.players[playerIndex];
    // Anchor above the status line (not the hand) so the player's own bubble
    // never lands on the text telling them what just happened.
    const anchor = player.isHuman
      ? this.el.status
      : this.opponentEls.get(playerIndex)?.button.querySelector('.avatar');
    if (!anchor) return;

    const box = anchor.getBoundingClientRect();
    const screen = this.el.screen.getBoundingClientRect();
    const bubble = document.createElement('div');
    bubble.className = `bubble${accent ? ' accent' : ''}${player.isHuman ? ' above' : ''}`;
    bubble.textContent = text;
    bubble.style.visibility = 'hidden';
    this.el.screen.append(bubble);

    // Measure, then place: opponents speak downwards into the open table,
    // the player speaks upwards over their hand.
    const width = bubble.offsetWidth;
    const half = width / 2;
    const margin = 8;
    const left = Math.min(
      Math.max(box.left + box.width / 2 - screen.left, half + margin),
      screen.width - half - margin,
    );
    let top = player.isHuman ? box.top - screen.top - 4 : box.bottom - screen.top + 8;

    // Two players often speak in the same beat; nudge a new bubble clear of
    // any it would land on top of.
    for (let attempt = 0; attempt < 4; attempt++) {
      const clash = this.bubbles.some((other) =>
        Math.abs(other.left - left) < (other.width + width) / 2 + 6 &&
        Math.abs(other.top - top) < 34);
      if (!clash) break;
      top += player.isHuman ? -36 : 36;
    }

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.visibility = '';

    const entry = { left, top, width, el: bubble };
    this.bubbles.push(entry);
    this.#afterVisual(1600, () => {
      bubble.remove();
      this.bubbles = this.bubbles.filter((b) => b !== entry);
    });
  }

  #clearBubbles() {
    this.visualTimers.forEach(clearTimeout);
    this.visualTimers = [];
    this.el.screen.querySelectorAll('.bubble').forEach((b) => b.remove());
    this.bubbles = [];
  }

  #showReveal(card) {
    const el = document.createElement('div');
    el.className = `reveal-card${suitOf(card.suit).color === 'red' ? ' red' : ''}`;
    el.innerHTML = `<span class="r">${card.rank}</span><span class="s">${suitOf(card.suit).symbol}</span>`;
    this.el.reveal.append(el);
    this.#afterVisual(900, () => el.remove());
  }

  #showResults() {
    const game = this.game;
    const ranked = game.players.slice().sort((a, b) => b.books.length - a.books.length);
    const humanWon = game.winners.includes(game.human.index);

    this.el.resultsTitle.textContent = humanWon
      ? (game.winners.length > 1 ? 'You tie for the win' : 'You win!')
      : game.winners.length > 1
        ? 'It’s a tie'
        : `${game.players[game.winners[0]].name} wins`;

    const frag = document.createDocumentFragment();
    for (const player of ranked) {
      const row = document.createElement('li');
      row.className = `score-row${game.winners.includes(player.index) ? ' win' : ''}`;
      row.innerHTML = `
        <span class="dot" style="background:${player.color}">${player.name.charAt(0)}</span>
        <span class="who">${player.name}</span>
        <span class="n">${player.books.length} <small>book${player.books.length === 1 ? '' : 's'}</small></span>`;
      frag.append(row);
    }
    this.el.scoreboard.replaceChildren(frag);
    this.el.results.classList.remove('hidden');
  }
}
