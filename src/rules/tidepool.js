import { standardDeck } from '../cards.js';

/**
 * Tide Pool.
 *
 * Go Fish played in clear water: instead of fishing blind from a pile, four
 * cards lie face up in a pool and you pick the one you want. Everyone also
 * keeps one card face up in front of them, so some of what each player holds
 * is public and can be asked for by name.
 *
 * Only the two flags at the bottom separate this from Classic; the engine
 * treats them as off for any variant that does not set them.
 */
export const tidePool = {
  id: 'tide-pool',
  name: 'Tide Pool',
  tagline: 'Four fish in plain sight, and everyone shows a card.',

  bookSize: 4,

  /** Five in hand, plus the one on show. */
  handSize: () => 5,

  buildDeck: standardDeck,

  mustHoldRank: true,
  goAgainOnSuccess: true,

  /**
   * One principle: a card you could already see never wins you another turn.
   *
   * So a blind draw that finds your rank does, and prising a hidden card out
   * of someone does, but taking from the open pool does not, and nor does
   * helping yourself to a face-up card. Without this last one the table is a
   * shopping list: at six players, farming visible cards ran turns of a dozen
   * asks and handed the late seats a 27-point win-rate edge. With it, seats
   * finish within 1.4 points and turns run the length they do in Classic.
   */
  goAgainOnLuckyDraw: true,
  goAgainOnPoolPick: false,
  goAgainOnShowingTake: false,

  refillEmptyHand: true,

  /** Face-up cards to choose between when told to go fish. */
  poolSize: 4,

  /** Everyone keeps one card face up; replaced from hand when it is taken. */
  showingCard: true,

  howToPlay: [
    'Everyone holds five cards and keeps one more face up in front of them for all to see.',
    'On your turn, ask a player for a rank you hold — their face-up card counts, and so does yours.',
    'If they have any they hand every copy over, their face-up card included, and you go again.',
    'Otherwise it is <em>go fish</em>: take any of the four cards in the pool, or draw blind from the pile.',
    'A blind draw that finds the rank you asked for wins you another turn. Taking from the pool never does.',
    'Lose your face-up card and you choose a replacement from your hand, then draw back up to five.',
    'Four of a kind is a book. When every book has been made, the most books wins.',
  ],
};
