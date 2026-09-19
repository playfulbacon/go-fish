import { GameView } from './ui.js';
import { VARIANTS } from './rules/index.js';
import { CastView } from './cast/ui.js';
import { castAndBoat } from './cast/rules.js';

/**
 * Every playable version, in the order the title screen lists them.
 *
 * An entry is a whole game, not a tweak: it owns its own screen, view and
 * engine. Go Fish rule variants are generated from src/rules/, so adding one
 * there adds a menu entry here; a genuinely different game (like Cast & Boat)
 * gets its own folder and its own entry. Nothing reaches across entries, so
 * every version stays playable exactly as it was.
 */

const goFishGames = VARIANTS.map((variant) => ({
  id: `gofish:${variant.id}`,
  name: VARIANTS.length > 1 ? `Go Fish: ${variant.name}` : 'Go Fish',
  tagline: variant.tagline,
  howToPlay: variant.howToPlay,
  screenId: 'game-screen',
  minAi: 1,
  maxAi: 5,
  defaultAi: 3,
  setupHint: (total) => `${total} players, ${variant.handSize(total)} cards each.`,
  createView: () => new GameView({}),
  start: (view, aiCount) => view.start(variant, aiCount),
}));

const castGame = {
  id: 'cast',
  name: castAndBoat.name,
  tagline: castAndBoat.tagline,
  howToPlay: castAndBoat.howToPlay,
  screenId: 'cast-screen',
  minAi: 1,
  maxAi: 5,
  defaultAi: 3,
  setupHint: (total) =>
    `${total} players, ${castAndBoat.handSize} cards each, first to ${castAndBoat.targetScore(total)}.`,
  createView: () => new CastView(),
  start: (view, aiCount) => view.start(castAndBoat, aiCount),
};

export const GAMES = [...goFishGames, castGame];

export const DEFAULT_GAME = GAMES[0].id;

export const SCREEN_IDS = [...new Set(GAMES.map((g) => g.screenId))];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || GAMES[0];
}
