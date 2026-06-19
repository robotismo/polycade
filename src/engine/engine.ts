import * as THREE from 'three';
import type { Game, GameEnv } from './types';
import { FIXED_DT } from './types';
import { InputManager } from '../input/input';
import { WebAudioBus } from '../audio/audio';
import { PostStack } from '../art/postfx';
import { Emitter } from './emitter';

export type EngineState = 'idle' | 'ready' | 'playing' | 'paused' | 'gameover';

type EngineEvents = {
  score: number;
  gameover: number;
  /** confirm/tap pressed while not actively playing (start / restart / resume). */
  confirm: void;
  state: EngineState;
};

const MAX_STEPS = 5; // cap catch-up steps to avoid spiral-of-death after a stall
const MAX_PIXEL_RATIO = 2; // perf budget: never render above 2x on hi-dpi phones

/**
 * The runtime that owns the single WebGLRenderer, the shared post stack, the
 * deterministic fixed-timestep loop, input and audio. The DOM shell drives it;
 * games plug into it. One renderer for the whole app — games are mounted and
 * disposed as you switch tabs, so we never exhaust WebGL contexts.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly input: InputManager;
  readonly audio: WebAudioBus;
  readonly events = new Emitter<EngineEvents>();

  private post: PostStack;
  private placeholderScene = new THREE.Scene();
  private placeholderCamera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);

  private game: Game | null = null;
  private env: GameEnv;
  private _state: EngineState = 'idle';
  private score = 0;

  private acc = 0;
  private last = 0;
  private rafId = 0;
  private width = 1;
  private height = 1;
  private shakeTrauma = 0;
  private reducedMotion = false;
  private pixelCap = MAX_PIXEL_RATIO;

  constructor(canvas: HTMLCanvasElement, muted = false) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.input = new InputManager();
    this.input.attach(canvas);
    this.audio = new WebAudioBus(muted);

    this.post = new PostStack(this.renderer, this.placeholderScene, this.placeholderCamera);

    this.env = {
      input: this.input,
      audio: this.audio,
      width: this.width,
      height: this.height,
      isTouch: matchTouch(),
      dt: FIXED_DT,
      reducedMotion: false,
      setScore: (s: number) => this.setScore(s),
      gameOver: () => this.triggerGameOver(),
      shake: (amount: number) => this.addShake(amount),
    };
  }

  get state(): EngineState {
    return this._state;
  }

  /** The currently mounted game, if any (used by tests/drivers). */
  get current(): Game | null {
    return this.game;
  }

  getScore(): number {
    return this.score;
  }

  private set(state: EngineState): void {
    this._state = state;
    this.events.emit('state', state);
  }

  // --- Game lifecycle ---------------------------------------------------

  mount(game: Game): void {
    this.unmount();
    this.game = game;
    game.init(this.env);
    this.post.setTarget(game.scene, game.camera);
    game.resize(this.width, this.height);
    game.reset();
    this.score = 0;
    this.set('ready');
  }

  unmount(): void {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    this.post.setTarget(this.placeholderScene, this.placeholderCamera);
    this.set('idle');
  }

  start(): void {
    if (!this.game) return;
    this.game.reset();
    this.score = 0;
    this.events.emit('score', 0);
    this.acc = 0;
    this.input.reset();
    this.audio.unlock();
    this.set('playing');
  }

  pause(): void {
    if (this._state === 'playing') this.set('paused');
  }

  resume(): void {
    if (this._state === 'paused') {
      this.acc = 0;
      this.set('playing');
    }
  }

  private setScore(s: number): void {
    if (s !== this.score) {
      this.score = s;
      this.events.emit('score', s);
    }
  }

  private triggerGameOver(): void {
    if (this._state !== 'playing') return;
    this.set('gameover');
    this.events.emit('gameover', this.score);
  }

  // --- Loop -------------------------------------------------------------

  startLoop(): void {
    if (this.rafId) return;
    this.last = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      this.step(now);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  /**
   * Manually advance the simulation by N fixed steps, independent of rAF.
   * Deterministic and framerate-free — the basis for headless E2E and the
   * reason a hidden tab (or a CI runner) can still drive real gameplay.
   */
  advance(steps = 1): void {
    if (!this.game) return;
    for (let i = 0; i < steps; i++) {
      this.input.beginFrame();
      if (this._state === 'playing') this.game.update(FIXED_DT, this.env);
      this.input.afterStep();
      if (this._state !== 'playing') break;
    }
  }

  /** Render a single frame on demand (used for headless screenshots). */
  renderOnce(): void {
    if (!this.game) return;
    this.game.frame?.(0, this.env);
    this.renderScene();
  }

  /** Add camera-shake trauma [0,1] from a gameplay impact (decays each frame). */
  addShake(amount: number): void {
    if (this.reducedMotion) return;
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  /** Render the active scene, applying a transient camera shake if any. */
  private renderScene(): void {
    const cam = this.game?.camera;
    if (cam && this.shakeTrauma > 0 && !this.reducedMotion) {
      const a = this.shakeTrauma * this.shakeTrauma;
      const ox = (Math.random() * 2 - 1) * a * 0.6;
      const oy = (Math.random() * 2 - 1) * a * 0.6;
      const oz = (Math.random() * 2 - 1) * a * 0.05;
      cam.position.x += ox;
      cam.position.y += oy;
      cam.rotation.z += oz;
      this.post.render();
      cam.position.x -= ox;
      cam.position.y -= oy;
      cam.rotation.z -= oz;
    } else {
      this.post.render();
    }
  }

  private step(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // clamp after tab-switch stalls
    this.env.dt = dt; // real frame delta for cosmetic (frame-rate-independent) animation
    if (this.shakeTrauma > 0) this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.8);

    this.input.beginFrame();

    if (this.game) {
      if (this._state === 'playing') {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= FIXED_DT && steps < MAX_STEPS) {
          this.game.update(FIXED_DT, this.env);
          this.input.afterStep();
          this.acc -= FIXED_DT;
          steps++;
          if (this._state !== 'playing') break; // game-over mid-step
        }
        this.game.frame?.(this.acc / FIXED_DT, this.env);
      } else {
        // Idle/ready/paused/gameover: let the scene breathe, no simulation.
        this.game.frame?.(0, this.env);
        if (
          (this._state === 'ready' || this._state === 'gameover' || this._state === 'paused') &&
          !document.hidden &&
          (this.input.pressed('confirm') || this.input.pressed('flap'))
        ) {
          this.events.emit('confirm', undefined);
        }
        this.input.afterStep();
      }
      this.renderScene();
    } else {
      this.input.afterStep();
      this.renderer.render(this.placeholderScene, this.placeholderCamera);
    }
  }

  /** Apply quality/accessibility settings: reduced motion weakens bloom + DPR. */
  setQuality(reducedMotion: boolean): void {
    this.reducedMotion = reducedMotion;
    this.env.reducedMotion = reducedMotion;
    this.pixelCap = reducedMotion ? 1.5 : MAX_PIXEL_RATIO;
    this.post.setReduced(reducedMotion);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelCap));
    this.post.setSize(this.width, this.height, this.renderer.getPixelRatio());
  }

  // --- Sizing -----------------------------------------------------------

  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.env.width = this.width;
    this.env.height = this.height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelCap));
    this.renderer.setSize(this.width, this.height, false);
    this.post.setSize(this.width, this.height, this.renderer.getPixelRatio());
    this.game?.resize(this.width, this.height);
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  dispose(): void {
    this.stopLoop();
    this.unmount();
    this.input.detach();
    this.post.dispose();
    this.renderer.dispose();
  }
}

function matchTouch(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  );
}
