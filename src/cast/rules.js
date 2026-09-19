import { standardDeck } from '../cards.js';

/**
 * Cast & Boat.
 *
 * A separate game from Go Fish, not a Go Fish variant: it has its own engine,
 * its own computer players and its own table. Every number the game balances
 * on lives here, so the whole thing can be re-tuned from one place.
 */
export const castAndBoat = {
  id: 'cast',
  name: 'Cast & Boat',
  tagline: 'Cast a lure, boat a catch, land sets of three.',

  handSize: 5,
  boatSize: 3,

  /**
   * Smallest number of answers the caster gets to choose between. At a short
   * table the pond makes up the difference with face-down cards off the draw
   * pile, so the caster always has a real decision. Pond cards earn nobody
   * luck. Set to 0 to let short tables play it straight.
   */
  minAnswers: 3,

  /**
   * Winning score, by number of players. A bigger table puts more answers in
   * front of the caster, so boats land more often and the target rises to keep
   * every game about the same length. Tuned by simulation to 13-25 casts each.
   */
  targetScore: (playerCount) => ({ 2: 12, 3: 12, 4: 14, 5: 18, 6: 22 }[playerCount] ?? 14),

  /** Luck earned by a responder whose card matches the cast card. */
  luckPerMatch: 1,
  /** Hoarding cap, so luck stays a currency rather than a savings account. */
  maxLuck: 6,

  costs: {
    call: 3,       // cast a rank every responder holding it must answer with
    extraBoat: 3,  // boat a second card this turn
    redraw: 1,     // swap a card out of your hand
  },

  /** Points for a finished boat. Only the best match is paid. */
  points: {
    run: 3,            // three consecutive ranks, any suits
    flush: 3,          // three of one suit
    trips: 5,          // three of one rank
    straightFlush: 8,  // a run all in one suit
  },

  buildDeck: standardDeck,

  howToPlay: [
    'On your turn you are the <em>caster</em>: play one card face up into the pond.',
    'Everyone else answers with a card face down. All answers are flipped at once.',
    'Any answer matching your cast card’s suit or rank earns that player <em>luck</em>.',
    'You then <em>boat</em> one of the answers — it goes face up in front of you. The rest are discarded.',
    'Three cards in your boat scores: three of a rank, three of a suit, or a run of three. Then the boat empties, set or not.',
    'Spend luck to call a rank everyone must answer with, to boat a second card, or to swap a card out of your hand.',
    'Everyone refills to five cards, and the next player casts. First to the target score wins.',
  ],
};
