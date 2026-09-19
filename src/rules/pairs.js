import { standardDeck } from '../cards.js';

/**
 * Pairs.
 *
 * Go Fish stripped back: two of a rank scores instead of four. Sets land
 * constantly, so a game is over in a few minutes, and asking is far less of a
 * commitment -- you are never sitting on three of something waiting for the
 * last one.
 */
export const pairs = {
  id: 'pairs',
  name: 'Pairs',
  tagline: 'Two of a kind scores. Quick games.',

  /** The whole variant, really. */
  bookSize: 2,

  /** What a completed set is called, so nothing says "book of Queens". */
  setLabel: { one: 'pair', many: 'pairs' },

  handSize: () => 5,

  buildDeck: standardDeck,

  mustHoldRank: true,
  goAgainOnSuccess: true,
  goAgainOnLuckyDraw: true,
  refillEmptyHand: true,

  howToPlay: [
    'On your turn, pick another player and ask them for a rank you are holding.',
    'If they have any, they hand over every card of that rank and you go again.',
    'If they do not, they say <em>Go fish</em> — tap the pond to draw a card.',
    'Fish up the exact rank you asked for and you get another turn.',
    'Two of a kind is a pair. Pairs are laid down and scored.',
    'There are twenty-six pairs in the deck. When they are all made, the biggest pile wins.',
  ],
};
