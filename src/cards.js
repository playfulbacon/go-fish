/**
 * Card primitives. Deliberately rules-agnostic so that rule variants can
 * build whatever deck they like on top of these helpers.
 */

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUITS = [
  { id: 'S', symbol: '♠', color: 'black' },
  { id: 'H', symbol: '♥', color: 'red' },
  { id: 'D', symbol: '♦', color: 'red' },
  { id: 'C', symbol: '♣', color: 'black' },
];

const PLURALS = {
  2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens',
  8: 'Eights', 9: 'Nines', 10: 'Tens', J: 'Jacks', Q: 'Queens', K: 'Kings', A: 'Aces',
};

const SINGULARS = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven',
  8: 'Eight', 9: 'Nine', 10: 'Ten', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace',
};

export const rankPlural = (rank) => PLURALS[rank] || rank;
export const rankSingular = (rank) => SINGULARS[rank] || rank;
export const rankOrder = (rank) => RANKS.indexOf(rank);

/** A standard 52-card deck, unshuffled. */
export function standardDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: `${rank}${suit.id}`, rank, suit: suit.id, symbol: suit.symbol, color: suit.color });
    }
  }
  return cards;
}

/** Fisher-Yates, non-mutating. */
export function shuffle(cards, rng = Math.random) {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Sort a hand by rank so the player's fan stays readable between turns. */
export function sortHand(hand) {
  return hand.sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank) || a.suit.localeCompare(b.suit));
}

/** { rank: count } for a set of cards. */
export function countByRank(cards) {
  const counts = Object.create(null);
  for (const card of cards) counts[card.rank] = (counts[card.rank] || 0) + 1;
  return counts;
}
