import { standardDeck } from '../cards.js';

/**
 * Classic Go Fish.
 *
 * Every rule variant is a self-contained object with this shape, and the
 * engine only ever reads the variant it was handed. Adding a new variant means
 * adding a new file next to this one and listing it in ./index.js -- it never
 * means editing this file. That keeps variants independent of each other, so
 * old versions stay playable exactly as they were.
 */
export const classic = {
  id: 'classic',
  name: 'Classic',
  tagline: 'The original rules.',

  /** Cards that make a book. */
  bookSize: 4,

  /** Cards dealt to each player at the start. */
  handSize: (playerCount) => (playerCount <= 3 ? 7 : 5),

  buildDeck: standardDeck,

  /** You may only ask for a rank you are already holding. */
  mustHoldRank: true,

  /** A successful ask lets you keep your turn. */
  goAgainOnSuccess: true,

  /** Fishing up the exact card you asked for lets you keep your turn. */
  goAgainOnLuckyDraw: true,

  /** Run out of cards? Draw one from the pond at the start of your turn. */
  refillEmptyHand: true,

  howToPlay: [
    'On your turn, pick another player and ask them for a rank you are holding.',
    'If they have any, they hand over every card of that rank and you go again.',
    'If they do not, they say <em>Go fish</em> — tap the pond to draw a card.',
    'Fish up the exact rank you asked for and you get another turn.',
    'Four of a kind is a book. Books are laid down and scored.',
    'When every book has been made, the biggest pile of books wins.',
  ],
};
