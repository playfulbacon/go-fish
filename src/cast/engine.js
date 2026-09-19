import { shuffle, sortHand, rankOrder } from '../cards.js';

export const SET_LABELS = {
  straightFlush: 'Straight flush',
  trips: 'Three of a kind',
  flush: 'Flush',
  run: 'Run',
};

/**
 * Consecutive ranks. Aces run either low (A-2-3) or high (Q-K-A).
 * Works for any boat size, since boat size is tunable.
 */
export function isRun(orders) {
  const consecutive = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length < 3) return false;
    return sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
  };
  if (consecutive(orders)) return true;
  const ace = rankOrder('A');
  return orders.includes(ace) && consecutive(orders.map((o) => (o === ace ? -1 : o)));
}

/** Score a finished boat, paying only its best match. Null if it is a bust. */
export function evaluateBoat(cards, rules) {
  if (cards.length < rules.boatSize) return null;
  const orders = cards.map((c) => rankOrder(c.rank));
  const sameRank = orders.every((o) => o === orders[0]);
  const sameSuit = cards.every((c) => c.suit === cards[0].suit);
  const run = isRun(orders);

  if (run && sameSuit) return { kind: 'straightFlush', points: rules.points.straightFlush };
  if (sameRank) return { kind: 'trips', points: rules.points.trips };
  if (run) return { kind: 'run', points: rules.points.run };
  if (sameSuit) return { kind: 'flush', points: rules.points.flush };
  return null;
}

/**
 * Cast & Boat's engine. Holds all state and advances only through the moves
 * below, emitting events as it goes for the view to animate. Synchronous, with
 * no timers of its own.
 *
 * Phases:
 *   'cast'    the caster plays a card face up (and may spend luck first)
 *   'respond' every other player answers face down, in turn
 *   'boat'    the caster takes one answer, and may buy a second
 *   'over'    somebody reached the target score
 */
export class CastGame {
  constructor(rules, playerConfigs, rng = Math.random) {
    this.rules = rules;
    this.rng = rng;
    this.targetScore = rules.targetScore(playerConfigs.length);
    this.players = playerConfigs.map((config, index) => ({
      index,
      name: config.name,
      isHuman: !!config.isHuman,
      color: config.color,
      hand: [],
      boat: [],
      luck: 0,
      score: 0,
    }));
    this.draw = shuffle(rules.buildDeck(), rng);
    this.discard = [];
    this.caster = 0;
    this.round = 1;
    this.phase = 'cast';
    this.castCard = null;
    this.called = null;   // { kind: 'rank' | 'suit', value }
    this.responses = [];
    this.respondQueue = [];
    this.boatsLeft = 0;
    this.boatedThisTurn = 0;
    this.events = [];
    this.winners = [];
    this.#deal();
  }

  // ---------------------------------------------------------------- queries

  get human() {
    return this.players.find((p) => p.isHuman);
  }

  get isOver() {
    return this.phase === 'over';
  }

  /** The player the game is currently waiting on. */
  get current() {
    if (this.phase === 'respond') return this.players[this.respondQueue[0]];
    return this.players[this.caster];
  }

  /** Answers still on the table for the caster to take. */
  get availableResponses() {
    return this.responses.filter((r) => !r.taken);
  }

  /** A call forces anyone holding the named rank or suit to answer with it. */
  forcedCardsFor(playerIndex) {
    if (!this.called) return [];
    const { kind, value } = this.called;
    return this.players[playerIndex].hand.filter((c) => (kind === 'rank' ? c.rank : c.suit) === value);
  }

  canAfford(playerIndex, action) {
    return this.players[playerIndex].luck >= this.rules.costs[action];
  }

  /** Boated cards anyone could swap, as { player, index, card }. */
  get swappableCards() {
    const out = [];
    for (const player of this.players) {
      player.boat.forEach((card, index) => out.push({ player: player.index, index, card }));
    }
    return out;
  }

  /**
   * A swap needs two boated cards belonging to different players. The caster
   * need not own either of them -- breaking up two rivals is a legal play.
   */
  get canSwapBoats() {
    if (this.phase !== 'cast' || !this.canAfford(this.caster, 'boatSwap')) return false;
    const owners = new Set(this.players.filter((p) => p.boat.length > 0).map((p) => p.index));
    return owners.size >= 2;
  }

  /** True while the caster may still pay for another card this turn. */
  get canBuyExtraBoat() {
    return this.phase === 'boat'
      && this.boatsLeft === 0
      && this.availableResponses.length > 0
      && this.canAfford(this.caster, 'extraBoat');
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  // ------------------------------------------------------------------ moves

  /**
   * The caster plays `cardId` face up. `call` of 'rank' or 'suit' spends luck
   * to demand that everyone holding it answers with it.
   */
  cast(cardId, { call = null } = {}) {
    if (this.phase !== 'cast') return { ok: false, error: 'not-casting' };
    const caster = this.players[this.caster];
    const card = caster.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: 'no-such-card' };
    if (call && call !== 'rank' && call !== 'suit') return { ok: false, error: 'bad-call' };
    if (call && !this.canAfford(this.caster, 'call')) return { ok: false, error: 'not-enough-luck' };

    if (call) {
      caster.luck -= this.rules.costs.call;
      this.called = { kind: call, value: call === 'rank' ? card.rank : card.suit };
      this.#emit({ type: 'call', player: caster.index, ...this.called });
    }

    caster.hand = caster.hand.filter((c) => c.id !== cardId);
    this.castCard = card;
    this.responses = [];
    this.#emit({ type: 'cast', player: caster.index, card, called: this.called });

    // Answer order does not matter -- every answer is face down until they are
    // all flipped -- so the player goes first and never sits waiting.
    this.respondQueue = this.players
      .filter((p) => p.index !== this.caster && p.hand.length > 0)
      .sort((a, b) => Number(b.isHuman) - Number(a.isHuman))
      .map((p) => p.index);

    if (this.respondQueue.length === 0) {
      this.#beginBoating();
    } else {
      this.phase = 'respond';
      this.#emit({ type: 'await-response', player: this.respondQueue[0] });
    }
    return { ok: true };
  }

  /** A responder answers face down. */
  respond(playerIndex, cardId) {
    if (this.phase !== 'respond') return { ok: false, error: 'not-responding' };
    if (this.respondQueue[0] !== playerIndex) return { ok: false, error: 'not-your-answer' };
    const player = this.players[playerIndex];
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return { ok: false, error: 'no-such-card' };

    const forced = this.forcedCardsFor(playerIndex);
    if (forced.length > 0 && !forced.some((c) => c.id === cardId)) return { ok: false, error: 'must-answer-call' };

    player.hand = player.hand.filter((c) => c.id !== cardId);
    this.responses.push({ player: playerIndex, card, taken: false, matched: false, forced: forced.length > 0 });
    this.#emit({ type: 'respond', player: playerIndex, forced: forced.length > 0 });

    this.respondQueue.shift();
    if (this.respondQueue.length === 0) this.#reveal();
    else this.#emit({ type: 'await-response', player: this.respondQueue[0] });
    return { ok: true };
  }

  /** The caster takes one of the revealed answers into their boat. */
  boat(responseIndex) {
    if (this.phase !== 'boat') return { ok: false, error: 'not-boating' };
    if (this.boatsLeft <= 0) return { ok: false, error: 'no-boats-left' };
    const response = this.responses[responseIndex];
    if (!response || response.taken) return { ok: false, error: 'unavailable' };

    const caster = this.players[this.caster];
    response.taken = true;
    caster.boat.push(response.card);
    this.boatsLeft -= 1;
    this.boatedThisTurn += 1;
    this.#emit({ type: 'boat', player: caster.index, card: response.card, from: response.player });

    if (this.#scoreBoat(caster)) return { ok: true };
    if (this.boatsLeft > 0 && this.availableResponses.length > 0) return { ok: true };
    if (this.canBuyExtraBoat) {
      this.#emit({ type: 'offer-extra', player: caster.index });
      return { ok: true };
    }
    this.#endTurn();
    return { ok: true };
  }

  /** Pay luck for a second card this turn. */
  buyExtraBoat() {
    if (!this.canBuyExtraBoat) return { ok: false, error: 'unavailable' };
    const caster = this.players[this.caster];
    caster.luck -= this.rules.costs.extraBoat;
    this.boatsLeft += 1;
    this.#emit({ type: 'buy-extra', player: caster.index });
    return { ok: true };
  }

  /**
   * End the turn without taking (another) card. Boating is never compulsory:
   * with two cards already in the boat, a third that makes no set would clear
   * the boat for nothing, so declining is often the right play.
   */
  endBoating() {
    if (this.phase !== 'boat') return { ok: false, error: 'not-boating' };
    if (this.boatedThisTurn === 0) this.#emit({ type: 'decline', player: this.caster });
    this.#endTurn();
    return { ok: true };
  }

  /**
   * Pay luck to exchange two boated cards. The two must belong to different
   * players; neither has to be the caster. Boat sizes are unchanged, so this
   * can never complete a boat.
   */
  swapBoats(a, b) {
    if (this.phase !== 'cast') return { ok: false, error: 'not-casting' };
    if (!this.canAfford(this.caster, 'boatSwap')) return { ok: false, error: 'not-enough-luck' };
    if (!a || !b || a.player === b.player) return { ok: false, error: 'same-boat' };

    const from = this.players[a.player];
    const to = this.players[b.player];
    const cardA = from?.boat[a.index];
    const cardB = to?.boat[b.index];
    if (!cardA || !cardB) return { ok: false, error: 'no-such-card' };

    this.players[this.caster].luck -= this.rules.costs.boatSwap;
    from.boat[a.index] = cardB;
    to.boat[b.index] = cardA;
    this.#emit({
      type: 'boat-swap',
      player: this.caster,
      a: { player: from.index, card: cardA },
      b: { player: to.index, card: cardB },
    });
    return { ok: true };
  }

  // ----------------------------------------------------------------- private

  #deal() {
    for (const player of this.players) this.#refill(player);
    this.#emit({ type: 'deal' });
    this.#startCast();
  }

  #reveal() {
    const { castCard, rules } = this;

    // A short table leaves the caster nothing to choose between, so the pond
    // answers too. Pond cards belong to nobody and earn nobody luck.
    while (this.responses.length < rules.minAnswers) {
      const card = this.#drawCard();
      if (!card) break;
      this.responses.push({ player: null, card, taken: false, matched: false, forced: false });
      this.#emit({ type: 'pond-answer' });
    }

    for (const response of this.responses) {
      response.matched = response.player !== null
        && (response.card.suit === castCard.suit || response.card.rank === castCard.rank);
    }
    this.#emit({ type: 'reveal', responses: this.responses.map((r) => ({ ...r })) });

    for (const response of this.responses) {
      if (!response.matched) continue;
      const player = this.players[response.player];
      const before = player.luck;
      player.luck = Math.min(rules.maxLuck, player.luck + rules.luckPerMatch);
      if (player.luck > before) {
        this.#emit({ type: 'luck', player: player.index, amount: player.luck - before, total: player.luck });
      }
    }
    this.#beginBoating();
  }

  #beginBoating() {
    this.phase = 'boat';
    this.boatedThisTurn = 0;
    this.boatsLeft = this.responses.length > 0 ? 1 : 0;
    if (this.boatsLeft === 0) {
      this.#endTurn();
      return;
    }
    this.#emit({ type: 'await-boat', player: this.caster });
  }

  /** Pay out a full boat and empty it. Returns true if the game ended. */
  #scoreBoat(player) {
    if (player.boat.length < this.rules.boatSize) return false;
    const result = evaluateBoat(player.boat, this.rules);
    const cards = player.boat.slice();
    if (result) {
      player.score += result.points;
      this.#emit({ type: 'score', player: player.index, cards, ...result, total: player.score });
    } else {
      this.#emit({ type: 'bust', player: player.index, cards });
    }
    this.discard.push(...cards);
    player.boat = [];

    if (player.score >= this.targetScore) {
      this.#endGame();
      return true;
    }
    return false;
  }

  #endTurn() {
    const spent = [];
    if (this.castCard) spent.push(this.castCard);
    for (const response of this.responses) if (!response.taken) spent.push(response.card);
    this.discard.push(...spent);
    if (spent.length) this.#emit({ type: 'discard', cards: spent });

    this.castCard = null;
    this.called = null;
    this.responses = [];
    this.boatsLeft = 0;
    this.boatedThisTurn = 0;

    for (const player of this.players) {
      const drawn = this.#refill(player);
      if (drawn) this.#emit({ type: 'refill', player: player.index, count: drawn });
    }

    this.caster = (this.caster + 1) % this.players.length;
    if (this.caster === 0) this.round += 1;
    this.#startCast();
  }

  /**
   * Hand the cast to the next player who can actually make one. Normally that
   * is whoever is next, but a table can run out of cards -- a hand size the
   * deck cannot sustain, say -- and nobody can cast from an empty hand.
   */
  #startCast() {
    for (let step = 0; step < this.players.length; step++) {
      if (this.players[this.caster].hand.length > 0) {
        this.phase = 'cast';
        this.#emit({ type: 'turn', player: this.caster, round: this.round });
        return;
      }
      this.#emit({ type: 'skip', player: this.caster });
      this.caster = (this.caster + 1) % this.players.length;
    }
    this.#endGame();   // every hand is empty and the deck is spent
  }

  #refill(player) {
    let drawn = 0;
    while (player.hand.length < this.rules.handSize) {
      const card = this.#drawCard();
      if (!card) break;
      player.hand.push(card);
      drawn += 1;
    }
    if (drawn) sortHand(player.hand);
    return drawn;
  }

  #drawCard() {
    if (this.draw.length === 0) {
      if (this.discard.length === 0) return null;
      this.draw = shuffle(this.discard, this.rng);
      this.discard = [];
      this.#emit({ type: 'reshuffle', count: this.draw.length });
    }
    return this.draw.pop();
  }

  #endGame() {
    this.phase = 'over';
    const best = Math.max(...this.players.map((p) => p.score));
    this.winners = this.players.filter((p) => p.score === best).map((p) => p.index);
    this.#emit({ type: 'gameover', winners: this.winners });
  }

  #emit(event) {
    this.events.push(event);
  }
}
