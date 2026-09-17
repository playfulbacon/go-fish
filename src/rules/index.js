import { classic } from './classic.js';

/**
 * Every playable rule variant, in the order they appear on the title screen.
 * Variants never reach into each other; a game is played entirely through the
 * single variant object selected here.
 */
export const VARIANTS = [classic];

export const DEFAULT_VARIANT = classic.id;

export function getVariant(id) {
  return VARIANTS.find((v) => v.id === id) || VARIANTS[0];
}
