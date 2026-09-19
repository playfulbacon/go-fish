import { rankOrder } from '../cards.js';
import { evaluateBoat, isRun } from './engine.js';

/**
 * Computer players for Cast & Boat.
 *
 * Everything here reads only from what is public at the table: the cast card,
 * the flipped answers, and the face-up boats. Hands are never inspected except
 * the deciding player's own.
 */

/** How much a card is worth to a boat. Finished boats are worth their points. */
export function boatValue(boat, card, rules) {
  const next = [...boat, card];
  if (next.length >= rules.boatSize) {
    const result = evaluateBoat(next, rules);
    return result ? 10 + result.points * 4 : 0;
  }
  if (next.length === 1) return 2;
  return pairPotential(next[0], next[1]);
}

/** How promising a part-built boat is. Boats never sit full, so 0-2 cards. */
export function boatPotential(boat) {
  if (boat.length === 0) return 0;
  if (boat.length === 1) return 2;
  return pairPotential(boat[0], boat[1]);
}

/** How promising two cards are as the start of a set. */
function pairPotential(a, b) {
  const gap = Math.abs(rankOrder(a.rank) - rankOrder(b.rank));
  let score = 0.5;
  if (a.rank === b.rank) score = 6;            // two to a trip
  else if (gap <= 2) score = 4;                // two to a run
  if (a.suit === b.suit) score += a.rank === b.rank ? 0 : 4;  // two to a flush
  return score;
}

/** The card in `hand` this player would least mind losing. */
function leastUseful(hand, boat, rules) {
  let worst = null;
  for (const card of hand) {
    const value = boatValue(boat, card, rules);
    if (!worst || value < worst.value) worst = { card, value };
  }
  return worst;
}

/** Would this card finish the caster's boat into a scoring set? */
function completesFor(boat, card, rules) {
  if (boat.length !== rules.boatSize - 1) return false;
  return evaluateBoat([...boat, card], rules) !== null;
}

/** Choose what to cast, and whether to spend luck calling its rank. */
export function chooseCast(game, player, rng = Math.random) {
  const { rules } = game;
  const dump = leastUseful(player.hand, player.boat, rules);

  // Calling forces everyone holding the named rank or suit to hand one over,
  // so it is worth paying for when the boat wants more of something specific.
  if (player.luck >= rules.costs.call && player.boat.length > 0) {
    let best = null;
    for (const card of player.hand) {
      if (card.id === dump.card.id) continue;
      // A rank call chases three of a kind; a suit call chases a flush.
      const wantsRank = player.boat.some((b) => b.rank === card.rank);
      const wantsSuit = player.boat.every((b) => b.suit === card.suit);
      if (wantsRank) {
        const score = 8 + rng();
        if (!best || score > best.score) best = { cardId: card.id, call: 'rank', score };
      }
      if (wantsSuit) {
        // A suit is thirteen cards to a rank's four, so it lands far more
        // often -- worth less per hit, but much more reliable.
        const score = 6 + rng();
        if (!best || score > best.score) best = { cardId: card.id, call: 'suit', score };
      }
    }
    if (best) return { cardId: best.cardId, call: best.call };
  }

  return { cardId: dump.card.id, call: null };
}

/** Choose what to answer a cast with. */
export function chooseResponse(game, player, rng = Math.random) {
  const { rules, castCard } = game;
  const forced = game.forcedCardsFor(player.index);
  if (forced.length > 0) {
    // A called rank leaves no choice of rank, only of suit.
    const pick = leastUseful(forced, player.boat, rules);
    return pick.card.id;
  }

  const caster = game.players[game.caster];
  let best = null;
  for (const card of player.hand) {
    const matches = card.suit === castCard.suit || card.rank === castCard.rank;
    // Matching earns luck, but every answer is a card the caster might take.
    let score = (matches ? 5 : 0) - boatValue(player.boat, card, rules);
    if (completesFor(caster.boat, card, rules)) score -= 9;
    score += rng() * 0.5;
    if (!best || score > best.score) best = { card, score };
  }
  return best.card.id;
}

/** Choose which revealed answer to take. */
export function chooseBoat(game, player) {
  const { rules } = game;
  let best = null;
  for (const [index, response] of game.responses.entries()) {
    if (response.taken) continue;
    const value = boatValue(player.boat, response.card, rules);
    if (!best || value > best.value) best = { index, value };
  }
  return best ? best.index : null;
}

/** Whether to pay luck for a second card this turn. */
export function shouldBuyExtraBoat(game, player) {
  if (!game.canBuyExtraBoat) return false;
  const pick = chooseBoat(game, player);
  if (pick === null) return false;
  const value = boatValue(player.boat, game.responses[pick].card, game.rules);
  // Only worth it for a card that finishes a set, or a strong pair.
  return value >= 10 || (player.luck >= game.rules.costs.extraBoat + 3 && value >= 6);
}

/**
 * The best boat swap available, or null. Weighs what the swap does to our own
 * boat against the damage it does to whoever we take from, so breaking up two
 * rivals is on the table even when we gain nothing directly.
 */
export function chooseBoatSwap(game, player) {
  const cards = game.swappableCards;
  let best = null;

  for (const a of cards) {
    for (const b of cards) {
      if (a.player >= b.player) continue;   // each unordered pair once
      const boats = new Map();
      for (const p of game.players) boats.set(p.index, p.boat.slice());
      boats.get(a.player)[a.index] = b.card;
      boats.get(b.player)[b.index] = a.card;

      let gain = 0;
      for (const p of game.players) {
        const before = boatPotential(p.boat);
        const after = boatPotential(boats.get(p.index));
        gain += p.index === player.index ? after - before : (before - after) * 0.6;
      }
      if (!best || gain > best.gain) best = { a: { player: a.player, index: a.index }, b: { player: b.player, index: b.index }, gain };
    }
  }
  return best;
}

/** Play one beat for whichever computer player the game is waiting on. */
export function autoPlay(game, rng = Math.random) {
  if (game.isOver) return null;
  const player = game.current;
  if (player.isHuman) return null;

  switch (game.phase) {
    case 'cast': {
      // A swap is worth paying for when it clearly moves the table our way.
      // Bounded: paying for one drops luck below the threshold.
      if (game.canSwapBoats) {
        const swap = chooseBoatSwap(game, player);
        if (swap && swap.gain >= 3) return game.swapBoats(swap.a, swap.b);
      }
      const move = chooseCast(game, player, rng);
      return game.cast(move.cardId, { call: move.call });
    }
    case 'respond':
      return game.respond(player.index, chooseResponse(game, player, rng));
    case 'boat': {
      if (game.boatsLeft > 0) {
        const pick = chooseBoat(game, player);
        return pick === null ? game.endBoating() : game.boat(pick);
      }
      if (shouldBuyExtraBoat(game, player)) return game.buyExtraBoat();
      return game.endBoating();
    }
    default:
      return null;
  }
}
