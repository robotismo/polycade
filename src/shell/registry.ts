import type { GameMeta } from '../engine/types';
import { accents } from '../art/tokens';

/**
 * The game catalog. Each entry's `load` is a dynamic import, so every game ships
 * as its own lazily-fetched chunk — opening a tab downloads only that game.
 */
export const GAMES: GameMeta[] = [
  {
    id: 'updraft',
    title: 'UPDRAFT',
    tagline: 'Flap through the neon canyon',
    instructions: 'Tap / Space / ↑ to flap. Thread the gaps. One touch ends the run.',
    accent: accents.updraft,
    scheme: 'tap',
    load: () => import('../games/updraft/index'),
  },
  {
    id: 'coil',
    title: 'COIL',
    tagline: 'A serpent of cubes in a glass arena',
    instructions: 'Swipe / arrows to turn. Eat the orbs, grow, never bite yourself.',
    accent: accents.coil,
    scheme: 'swipe',
    load: () => import('../games/coil/index'),
  },
  {
    id: 'shatter',
    title: 'SHATTER',
    tagline: 'Break the wall, keep the ball alive',
    instructions: 'Move the paddle (drag / mouse / ←→). Clear every brick.',
    accent: accents.shatter,
    scheme: 'paddle',
    load: () => import('../games/shatter/index'),
  },
  {
    id: 'rally',
    title: 'RALLY',
    tagline: 'Pong with depth and spin',
    instructions: 'Drag / mouse / ←→ to move your paddle. First to outlast the AI.',
    accent: accents.rally,
    scheme: 'paddle',
    load: () => import('../games/rally/index'),
  },
  {
    id: 'driftfield',
    title: 'DRIFTFIELD',
    tagline: 'Spin, thrust, and shoot the drift',
    instructions: 'Rotate ←→, thrust ↑, fire Space. Split the rocks, survive the field.',
    accent: accents.driftfield,
    scheme: 'thrust-fire',
    load: () => import('../games/driftfield/index'),
  },
];

export function getGameMeta(id: string): GameMeta | undefined {
  return GAMES.find((g) => g.id === id);
}
