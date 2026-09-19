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
      showing: null,   // the face-up card, for variants that use one
    }));
    this.pond = shuffle(rules.buildDeck(), rng);
    this.deckSize = this.pond.length;
    this.pool = [];    // face-up cards to fish from, for variants that use one
    this.turn = 0;
    this.phase = 'ask'; // 'ask' | 'fish' | 'replace' | 'over'
    this.pendingAsk = null;
    this.replacing = null;  // player owing a new face-up card
    this.suspended = null;  // phase to return to once they have placed it
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

  /** Every card a player holds. The face-up card is held, just visible. */
  holdings(player) {
    return player.showing ? [...player.hand, player.showing] : player.hand;
  }

  /** Distinct ranks a player can legally ask for. */
  askableRanks(player) {
    if (!this.rules.mustHoldRank) return this.rules.buildDeck().map((c) => c.rank).filter((v, i, a) => a.indexOf(v) === i);
    const ranks = Object.keys(countByRank(this.holdings(player)));
    return ranks.sort((a, b) => rankOrder(a) - rankOrder(b));
  }

  /** Players who can be asked right now. */
  validTargets(player) {
    return this.players.filter((p) => p.index !== player.index && this.holdings(p).length > 0);
  }

  /** Whether there is anything left to fish, in the pool or the pile. */
  canFish() {
    return this.pond.length > 0 || this.pool.length > 0;
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
    if (this.holdings(target).length === 0) return { ok: false, error: 'empty-target' };
    if (this.rules.mustHoldRank && !this.holdings(asker).some((c) => c.rank === rank)) {
      return { ok: false, error: 'rank-not-held' };
    }

    this.#emit({ type: 'ask', player: asker.index, target: target.index, rank });

    const matches = this.holdings(target).filter((c) => c.rank === rank);
    if (matches.length === 0) {
      this.pendingAsk = { asker: asker.index, target: target.index, rank };
      this.phase = 'fish';
      this.#emit({ type: 'gofish', player: target.index, asker: asker.index, rank });
      return { ok: true, got: 0 };
    }

    const gaveShowing = !!target.showing && target.showing.rank === rank;
    target.hand = target.hand.filter((c) => c.rank !== rank);
    if (gaveShowing) target.showing = null;
    asker.hand.push(...matches);
    sortHand(asker.hand);
    this.#emit({
      type: 'give', from: target.index, to: asker.index, rank,
      count: matches.length, cards: matches, showing: gaveShowing,
    });

    this.#claimBooks(asker);
    if (this.#checkGameOver()) return { ok: true, got: matches.length };

    // Taking a card you could already see is not a deduction, so a variant can
    // withhold the extra turn for it -- the same way it can for a pool pick.
    const onlyVisible = gaveShowing && matches.length === 1;
    const earnedAnother = this.rules.goAgainOnSuccess
      && !(onlyVisible && this.rules.goAgainOnShowingTake === false);

    if (earnedAnother) {
      this.#beginTurn();
    } else {
      this.#advanceTurn();
    }
    // Only now: a replacement can suspend play, and the phase it suspends has
    // to be the one the next turn is actually waiting in.
    this.#settleTurn();
    return { ok: true, got: matches.length };
  }

  /**
   * The current player takes a card. `source` is { from: 'pond' } for a blind
   * draw, or { from: 'pool', index } to take a named face-up card.
   */
  fish(source = { from: 'pond' }) {
    if (this.phase !== 'fish') return { ok: false, error: 'not-fishing' };
    const player = this.current;
    const asked = this.pendingAsk ? this.pendingAsk.rank : null;
    const fromPool = source && source.from === 'pool';

    if (fromPool && !this.pool[source.index]) return { ok: false, error: 'no-such-card' };
    if (!fromPool && this.pond.length === 0) {
      if (this.pool.length === 0) {
        this.pendingAsk = null;
        this.#emit({ type: 'pond-empty', player: player.index });
        this.#advanceTurn();
        return { ok: true, card: null };
      }
      return { ok: false, error: 'pond-empty' };
    }
    this.pendingAsk = null;

    let card;
    if (fromPool) {
      card = this.pool.splice(source.index, 1)[0];
      this.#refillPool();
    } else {
      card = this.#drawCard();
    }
    player.hand.push(card);
    sortHand(player.hand);
    // Taking a card you can already see is a choice, not luck, so variants can
    // withhold the extra turn for it.
    const mayGoAgain = fromPool
      ? this.rules.goAgainOnPoolPick !== false && this.rules.goAgainOnLuckyDraw
      : this.rules.goAgainOnLuckyDraw;
    const lucky = asked !== null && card.rank === asked && mayGoAgain;
    this.#emit({ type: 'draw', player: player.index, card, lucky, asked, fromPool });

    this.#claimBooks(player);
    if (this.#checkGameOver()) return { ok: true, card };

    if (lucky) {
      this.#beginTurn();
    } else {
      this.#advanceTurn();
    }
    this.#settleTurn();
    return { ok: true, card, lucky };
  }

  /** Put `cardId` face up, when the game is waiting on a replacement. */
  placeShowing(cardId) {
    if (this.phase !== 'replace') return { ok: false, error: 'not-replacing' };
    const player = this.players[this.replacing];
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: 'no-such-card' };

    this.#placeShowing(player, card);
    this.replacing = null;
    this.phase = this.suspended || 'ask';
    this.suspended = null;
    if (this.#checkGameOver()) return { ok: true };
    this.#settleTurn();
    return { ok: true };
  }

  /** The player the game is waiting on, which is not always whose turn it is. */
  get awaiting() {
    if (this.phase === 'replace') return this.players[this.replacing];
    return this.current;
  }

  /**
   * Make the move a computer player would make. One call = one visible beat,
   * so the UI can pace it with a timer.
   */
  autoPlay(knowledge) {
    if (this.phase === 'replace') return null;  // waiting on the player
    const player = this.current;
    if (player.isHuman || this.isOver) return null;
    if (this.phase === 'fish') return this.fish(chooseFishSource(this, player, knowledge));
    const move = chooseMove(this, player, knowledge, this.rng);
    if (!move) return null;
    const result = this.ask(move.target, move.rank);
    // A rejected move would leave the turn where it was with nothing emitted,
    // which reads as a hang. Nothing should reach here, so say so loudly.
    if (!result.ok) throw new Error(`computer player made an illegal ask: ${result.error}`);
    return result;
  }

  // ----------------------------------------------------------------- private

  #deal() {
    const size = this.rules.handSize(this.players.length);
    for (let i = 0; i < size; i++) {
      for (const player of this.players) {
        if (this.pond.length) player.hand.push(this.pond.pop());
      }
    }
    if (this.rules.showingCard) {
      for (const player of this.players) {
        if (this.pond.length) player.showing = this.pond.pop();
      }
    }
    this.#refillPool();
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
    const counts = countByRank(this.holdings(player));
    for (const rank of Object.keys(counts)) {
      if (counts[rank] < this.rules.bookSize) continue;
      player.hand = player.hand.filter((c) => c.rank !== rank);
      if (player.showing && player.showing.rank === rank) player.showing = null;
      player.books.push(rank);
      player.books.sort((a, b) => rankOrder(a) - rankOrder(b));
      if (!silent) this.#emit({ type: 'book', player: player.index, rank });
    }
  }

  /** Top the pool back up to size from the draw pile. */
  #refillPool() {
    const size = this.rules.poolSize || 0;
    while (this.pool.length < size && this.pond.length > 0) this.pool.push(this.#drawCard());
  }

  /** Draw back up to the hand size from the pile. */
  #refillHand(player) {
    const size = this.rules.handSize(this.players.length);
    while (player.hand.length < size && this.pond.length > 0) player.hand.push(this.#drawCard());
    sortHand(player.hand);
  }

  #placeShowing(player, card) {
    player.hand = player.hand.filter((c) => c.id !== card.id);
    player.showing = card;
    this.#emit({ type: 'showing', player: player.index, card });
    if (this.rules.refillOnReplace !== false) this.#refillHand(player);
    this.#claimBooks(player);
  }

  /** Which card a computer player puts on show: the one it is least invested
   *  in, since showing a rank you are collecting invites it to be asked for. */
  #autoShowing(player) {
    const counts = countByRank(player.hand);
    let worst = null;
    for (const card of player.hand) {
      const score = counts[card.rank] * 10 + rankOrder(card.rank) * 0.1;
      if (!worst || score < worst.score) worst = { card, score };
    }
    return worst.card;
  }

  /**
   * Fill every empty face-up slot. Computer players choose for themselves; the
   * player is asked, which suspends whatever phase we were in until they have
   * placed a card. Returns true if the game is now waiting on them.
   */
  #restock() {
    if (!this.rules.showingCard) return false;
    for (let pass = 0; pass < 4; pass++) {
      let placed = false;
      for (const player of this.players) {
        if (player.showing) continue;
        if (player.hand.length === 0) this.#refillHand(player);
        if (player.hand.length === 0) continue;   // nothing left to show
        if (player.isHuman) {
          if (this.phase !== 'replace') this.suspended = this.phase;
          this.phase = 'replace';
          this.replacing = player.index;
          this.#emit({ type: 'await-showing', player: player.index });
          return true;
        }
        this.#placeShowing(player, this.#autoShowing(player));
        placed = true;
      }
      if (!placed) break;
    }
    return false;
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
      if (this.holdings(this.players[index]).length > 0 || this.canFish()) {
        this.turn = index;
        this.#beginTurn();
        return;
      }
    }
    this.#endGame();
  }

  /**
   * With nothing left to fish and no two players holding the same rank, no ask
   * can ever succeed and no book can ever complete: the game is finished
   * whether or not all thirteen books were made. Classic never reaches this
   * because hands empty out, but a variant where everyone keeps a card on show
   * can sit here forever.
   */
  #isDeadlocked() {
    if (this.canFish()) return false;
    const holder = new Map();
    for (const player of this.players) {
      for (const card of this.holdings(player)) {
        const other = holder.get(card.rank);
        if (other !== undefined && other !== player.index) return false;
        if (other === undefined) holder.set(card.rank, player.index);
      }
    }
    return true;
  }

  #beginTurn(depth = 0) {
    const player = this.current;
    this.pendingAsk = null;

    if (this.#isDeadlocked()) {
      this.#emit({ type: 'stalemate' });
      this.#endGame();
      return;
    }

    if (player.hand.length === 0 && this.canFish() && this.rules.refillEmptyHand) {
      const card = this.pond.length > 0 ? this.#drawCard() : this.pool.shift();
      player.hand.push(card);
      sortHand(player.hand);
      this.#refillPool();
      this.#emit({ type: 'refill', player: player.index, card });
      this.#claimBooks(player);
      if (this.#checkGameOver()) return;
    }

    if (this.holdings(player).length === 0) {
      // Out of cards with a dry pond: this player is done for good.
      this.#emit({ type: 'skip', player: player.index });
      this.#advanceTurn();
      return;
    }

    if (this.validTargets(player).length === 0) {
      if (!this.canFish()) {
        this.#endGame();
        return;
      }
      this.phase = 'fish';
      this.#emit({ type: 'turn', player: player.index, forcedFish: true });
    } else {
      this.phase = 'ask';
      this.#emit({ type: 'turn', player: player.index, forcedFish: false });
    }

    this.#settleTurn(depth);
  }

  /**
   * Finish starting a turn once any face-up cards have been replaced.
   *
   * Replacing one can complete a book, and that book can take the last cards
   * of the very player whose turn just began -- leaving them holding nothing
   * in a phase that assumed otherwise, with no way to move. So re-run the turn
   * for them; each pass either deals them a card or ends the game.
   */
  #settleTurn(depth = 0) {
    if (this.#restock()) return;   // paused while the player chooses
    if (this.isOver || this.phase === 'replace') return;

    const player = this.current;
    // A book can empty the player whose turn it is, or the only player they
    // had left to ask. Either way the phase no longer holds.
    const unplayable = this.holdings(player).length === 0
      || (this.phase === 'ask' && this.validTargets(player).length === 0);
    if (!unplayable) return;

    if (depth < 8) this.#beginTurn(depth + 1);
    else this.#advanceTurn();
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

  const counts = countByRank(game.holdings(player));
  let best = null;

  for (const rank of ranks) {
    for (const target of targets) {
      const showing = target.showing && target.showing.rank === rank;
      const known = knowledge[target.index] ? knowledge[target.index][rank] : undefined;
      if (known === false && !showing) continue; // They showed us they do not have it.

      let score = rng() * 8;
      // A face-up card is proof, not a guess.
      if (showing) score += 140;
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

/**
 * Where a computer player fishes from. The pool is visible, so take a card
 * that helps; otherwise draw blind, which is the only way to keep the turn.
 */
function chooseFishSource(game, player, knowledge) {
  if (game.pool.length === 0) return { from: 'pond' };
  const asked = game.pendingAsk ? game.pendingAsk.rank : null;
  const counts = countByRank(game.holdings(player));

  let best = null;
  game.pool.forEach((card, index) => {
    let score = (counts[card.rank] || 0) * 10;
    if (card.rank === asked) score += 4;   // completes what we were chasing
    if (!best || score > best.score) best = { index, score };
  });

  // A blind draw might win another turn, so it beats taking a card that does
  // nothing for us -- but never a card that builds towards a book.
  if (best.score < 10 && game.pond.length > 0) return { from: 'pond' };
  return { from: 'pool', index: best.index };
}
