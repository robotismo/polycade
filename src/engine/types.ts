import type * as THREE from 'three';
import type { InputState } from '../input/input';
import type { AudioBus } from '../audio/audio';

/**
 * Control scheme hints. The shell uses these to decide which on-screen touch
 * controls to render for a game on mobile.
 */
export type ControlScheme = 'tap' | 'swipe' | 'paddle' | 'thrust-fire' | 'steer';

/**
 * Stable, shell-owned services handed to a game. The same object instance is
 * passed to `init`, `update`, and `frame` for the lifetime of the game, so a
 * game may capture it once in `init`. The shell mutates `input`/`width`/
 * `height` in place between frames.
 */
export interface GameEnv {
  input: InputState;
  audio: AudioBus;
  width: number;
  height: number;
  /** True when the primary pointer is touch (mobile). */
  isTouch: boolean;
  /** Report the current score; drives the live HUD. Idempotent. */
  setScore(score: number): void;
  /** End the current run. The shell shows the game-over overlay. */
  gameOver(): void;
}

/**
 * The contract every game implements. The shell owns the renderer, the loop,
 * post-processing, input, audio and scoring UI; a game owns only its scene,
 * camera and simulation. Keeping this surface small is what lets five games
 * read as one product.
 */
export interface Game {
  /** The scene the shell renders. Created by the game in its constructor/init. */
  readonly scene: THREE.Scene;
  /** The camera the shell renders with. */
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

  /** One-time setup. Build the world, register input intent, seed state. */
  init(env: GameEnv): void;

  /**
   * Fixed-timestep simulation step. `dt` is constant (see FIXED_DT) so the
   * simulation is deterministic and unit-testable independent of framerate.
   */
  update(dt: number, env: GameEnv): void;

  /**
   * Optional per-rendered-frame hook. `alpha` in [0,1) is the interpolation
   * factor between the last two fixed steps — use it to smooth visuals.
   */
  frame?(alpha: number, env: GameEnv): void;

  /** Viewport changed; update camera aspect/projection. */
  resize(width: number, height: number): void;

  /** Restart to a fresh, playable state (called on play and on restart). */
  reset(): void;

  /** Release every GPU resource this game allocated. */
  dispose(): void;

  /** Current score. */
  getScore(): number;
}

/** A game module's default export: a zero-arg factory. */
export type GameFactory = () => Game;

/** Static metadata describing a game to the shell/home grid. */
export interface GameMeta {
  id: string;
  title: string;
  tagline: string;
  /** One-line "how to play" shown on the game screen. */
  instructions: string;
  /** Accent color (hex) used for this game's card and HUD. */
  accent: number;
  /** Controls the game responds to; drives mobile on-screen controls. */
  scheme: ControlScheme;
  /** Lazy loader for the game's code chunk (separate tab => separate chunk). */
  load: () => Promise<{ default: GameFactory }>;
}

/** Fixed simulation timestep: 60 Hz. */
export const FIXED_DT = 1 / 60;
