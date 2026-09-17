import { shuffle, sortHand, countByRank, rankOrder } from './cards.js';

/**
 * The game engine. It holds all state and exposes exactly three ways to move
 * the game forward: ask(), fish() and autoPlay() (for computer players).
 *
 * Everything rules-specific is read off the `rules` object it is constructed
 * with, so a new variant can change the shape of the game without this file
 * knowing anything about it.
 *
 * Each move emits events describing what just happened; the UI drains those to
 * animate. The engine itself is synchronous and has no timers.
 */
export class Game {
  constructor(rules, playerConfigs, rng = Math.random) {
    this.rules = rules;
    this.rng = rng;
    this.players = playerConfigs.map((config, index) => ({
      index,
      name: config.name,
      isHuman: !!config.isHuman,
      color: config.color,
      hand: [],
      books: [],
    }));
    this.pond = shuffle(rules.buildDeck(), rng);
    this.deckSize = this.pond.length;
    this.turn = 0;
    this.phase = 'ask'; // 'ask' | 'fish' | 'over'
    this.pendingAsk = null;
    this.events = [];
    this.winners = [];
    this.#deal();
  }

  // ---------------------------------------------------------------- queries

  get current() {
    return this.players[this.turn];
  }

  get human() {
    return this.players.find((p) => p.isHuman);
  }

  get isOver() {
    return this.phase === 'over';
  }

  /** Distinct ranks a player can legally ask for. */
  askableRanks(player) {
    if (!this.rules.mustHoldRank) return this.rules.buildDeck().map((c) => c.rank).filter((v, i, a) => a.indexOf(v) === i);
    const ranks = Object.keys(countByRank(player.hand));
    return ranks.sort((a, b) => rankOrder(a) - rankOrder(b));
  }

  /** Players who can be asked right now. */
  validTargets(player) {
    return this.players.filter((p) => p.index !== player.index && p.hand.length > 0);
  }

  /** Pull the events logged since the last drain. */
  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // ------------------------------------------------------------------ moves

  /**
   * The current player asks `target` for every card of `rank`.
   * Returns { ok, got } or { ok: false, error }.
   */
  ask(targetIndex, rank) {
    if (this.phase !== 'ask') return { ok: false, error: 'not-asking' };
    const asker = this.current;
    const target = this.players[targetIndex];
    if (!target || target.index === asker.index) return { ok: false, error: 'bad-target' };
    if (target.hand.length === 0) return { ok: false, error: 'empty-target' };
    if (this.rules.mustHoldRank && !asker.hand.some((c) => c.rank === rank)) {
      return { ok: false, error: 'rank-not-held' };
    }

    this.#emit({ type: 'ask', player: asker.index, target: target.index, rank });

    const matches = target.hand.filter((c) => c.rank === rank);
    if (matches.length === 0) {
      this.pendingAsk = { asker: asker.index, target: target.index, rank };
      this.phase = 'fish';
      this.#emit({ type: 'gofish', player: target.index, asker: asker.index, rank });
      return { ok: true, got: 0 };
    }

    target.hand = target.hand.filter((c) => c.rank !== rank);
    asker.hand.push(...matches);
    sortHand(asker.hand);
    this.#emit({ type: 'give', from: target.index, to: asker.index, rank, count: matches.length, cards: matches });

    this.#claimBooks(asker);
    if (this.#checkGameOver()) return { ok: true, got: matches.length };

    if (this.rules.goAgainOnSuccess) {
      this.#beginTurn();
    } else {
      this.#advanceTurn();
    }
    return { ok: true, got: matches.length };
  }

  /** The current player draws one card from the pond. */
  fish() {
    if (this.phase !== 'fish') return { ok: false, error: 'not-fishing' };
    const player = this.current;
    const asked = this.pendingAsk ? this.pendingAsk.rank : null;
    this.pendingAsk = null;

    if (this.pond.length === 0) {
      this.#emit({ type: 'pond-empty', player: player.index });
      this.#advanceTurn();
      return { ok: true, card: null };
    }

    const card = this.#drawCard();
    player.hand.push(card);
    sortHand(player.hand);
    const lucky = asked !== null && card.rank === asked && this.rules.goAgainOnLuckyDraw;
    this.#emit({ type: 'draw', player: player.index, card, lucky, asked });

    this.#claimBooks(player);
    if (this.#checkGameOver()) return { ok: true, card };

    if (lucky) {
      this.#beginTurn();
    } else {
      this.#advanceTurn();
    }
    return { ok: true, card, lucky };
  }

  /**
   * Make the move a computer player would make. One call = one visible beat,
   * so the UI can pace it with a timer.
   */
  autoPlay(knowledge) {
    const player = this.current;
    if (player.isHuman || this.isOver) return null;
    if (this.phase === 'fish') return this.fish();
    const move = chooseMove(this, player, knowledge, this.rng);
    if (!move) return null;
    return this.ask(move.target, move.rank);
  }

  // ----------------------------------------------------------------- private

  #deal() {
    const size = this.rules.handSize(this.players.length);
    for (let i = 0; i < size; i++) {
      for (const player of this.players) {
        if (this.pond.length) player.hand.push(this.pond.pop());
      }
    }
    for (const player of this.players) {
      sortHand(player.hand);
      this.#claimBooks(player, true);
    }
    this.#emit({ type: 'deal' });
    this.#beginTurn();
  }

  #drawCard() {
    // The pond is a messy pile, so pull from a random spot in it. The deck is
    // already shuffled; this just makes tapping the pile feel like fishing.
    const index = Math.floor(this.rng() * this.pond.length);
    return this.pond.splice(index, 1)[0];
  }

  #claimBooks(player, silent = false) {
    const counts = countByRank(player.hand);
    for (const rank of Object.keys(counts)) {
      if (counts[rank] < this.rules.bookSize) continue;
      player.hand = player.hand.filter((c) => c.rank !== rank);
      player.books.push(rank);
      player.books.sort((a, b) => rankOrder(a) - rankOrder(b));
      if (!silent) this.#emit({ type: 'book', player: player.index, rank });
    }
  }

  #totalBooks() {
    return this.players.reduce((sum, p) => sum + p.books.length, 0);
  }

  #checkGameOver() {
    if (this.#totalBooks() * this.rules.bookSize < this.deckSize) return false;
    this.#endGame();
    return true;
  }

  #endGame() {
    this.phase = 'over';
    this.pendingAsk = null;
    const best = Math.max(...this.players.map((p) => p.books.length));
    this.winners = this.players.filter((p) => p.books.length === best).map((p) => p.index);
    this.#emit({ type: 'gameover', winners: this.winners });
  }

  #advanceTurn() {
    const count = this.players.length;
    for (let step = 1; step <= count; step++) {
      const index = (this.turn + step) % count;
      if (this.players[index].hand.length > 0 || this.pond.length > 0) {
        this.turn = index;
        this.#beginTurn();
        return;
      }
    }
    this.#endGame();
  }

  #beginTurn() {
    const player = this.current;
    this.pendingAsk = null;

    if (player.hand.length === 0 && this.pond.length > 0 && this.rules.refillEmptyHand) {
      const card = this.#drawCard();
      player.hand.push(card);
      sortHand(player.hand);
      this.#emit({ type: 'refill', player: player.index, card });
      this.#claimBooks(player);
      if (this.#checkGameOver()) return;
    }

    if (player.hand.length === 0) {
      // Out of cards with a dry pond: this player is done for good.
      this.#emit({ type: 'skip', player: player.index });
      this.#advanceTurn();
      return;
    }

    if (this.validTargets(player).length === 0) {
      if (this.pond.length > 0) {
        this.phase = 'fish';
        this.#emit({ type: 'turn', player: player.index, forcedFish: true });
        return;
      }
      this.#endGame();
      return;
    }

    this.phase = 'ask';
    this.#emit({ type: 'turn', player: player.index, forcedFish: false });
  }

  #emit(event) {
    this.events.push(event);
  }
}

/**
 * Computer player decision making. `knowledge[playerIndex][rank]` is true when
 * that player is known to hold the rank and false when they are known not to;
 * it is built from the public log in ai.js, so the computer only ever reasons
 * from what a human at the table could have seen.
 */
function chooseMove(game, player, knowledge = {}, rng = Math.random) {
  const targets = game.validTargets(player);
  const ranks = game.askableRanks(player);
  if (!targets.length || !ranks.length) return null;

  const counts = countByRank(player.hand);
  let best = null;

  for (const rank of ranks) {
    for (const target of targets) {
      const known = knowledge[target.index] ? knowledge[target.index][rank] : undefined;
      if (known === false) continue; // They showed us they do not have it.

      let score = rng() * 8;
      if (known === true) score += 100;
      // Chasing the rank we already have the most of finishes books faster.
      score += counts[rank] * 12;
      if (counts[rank] === game.rules.bookSize - 1) score += 40;
      // Bigger hands are likelier to be hiding what we want.
      score += Math.min(target.hand.length, 8);

      if (!best || score > best.score) best = { rank, target: target.index, score };
    }
  }

  if (best) return best;
  // Everything we hold is known to be missing everywhere; ask anyway.
  return {
    rank: ranks[Math.floor(rng() * ranks.length)],
    target: targets[Math.floor(rng() * targets.length)].index,
  };
}
