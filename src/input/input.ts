/**
 * Unified semantic input. Games never read a key code or a touch event — they
 * read intents (`flap`, `left`, `thrust`, ...). The same intent can arrive from
 * keyboard, mouse, touch (tap + swipe), on-screen buttons, or a gamepad, so a
 * game written once is playable everywhere. Mobile-first by construction.
 */

export type Action =
  | 'flap'
  | 'thrust'
  | 'fire'
  | 'confirm'
  | 'pause'
  | 'left'
  | 'right'
  | 'up'
  | 'down';

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

export interface PointerState {
  /** CSS pixels within the canvas. */
  x: number;
  y: number;
  /** Normalized to [-1, 1] across the canvas (origin centre, +y up). */
  nx: number;
  ny: number;
  down: boolean;
  /** Whether we've seen the pointer at all this session. */
  active: boolean;
}

/** Read-only surface handed to games. */
export interface InputState {
  /** Is this intent currently held? */
  isDown(action: Action): boolean;
  /** Did this intent fire an edge during the current fixed step? */
  pressed(action: Action): boolean;
  /** A swipe gesture detected this step, if any. */
  swipe(): SwipeDir | null;
  readonly pointer: PointerState;
}

const KEY_MAP: Record<string, Action[]> = {
  Space: ['flap', 'fire', 'confirm'],
  ArrowUp: ['up', 'thrust', 'flap'],
  KeyW: ['up', 'thrust', 'flap'],
  ArrowDown: ['down'],
  KeyS: ['down'],
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  Enter: ['confirm', 'fire'],
  KeyJ: ['fire'],
  KeyZ: ['fire'],
  Escape: ['pause'],
  KeyP: ['pause'],
};

const SWIPE_THRESHOLD = 28; // px
const SWIPE_MAX_TIME = 600; // ms

export class InputManager implements InputState {
  readonly pointer: PointerState = { x: 0, y: 0, nx: 0, ny: 0, down: false, active: false };

  private held = new Set<Action>();
  private heldPrev = new Set<Action>();
  private pendingEdges = new Set<Action>();
  private stepEdges = new Set<Action>();

  private pendingSwipe: SwipeDir | null = null;
  private stepSwipe: SwipeDir | null = null;

  private padPrev = new Set<Action>();
  private dragStart: { x: number; y: number; t: number } | null = null;

  private el!: HTMLElement;
  private now: () => number;
  private bound: Array<[EventTarget, string, EventListener]> = [];

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  /** Attach listeners to the canvas (pointer) and window (keyboard). */
  attach(el: HTMLElement): void {
    this.el = el;
    const on = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn, { passive: false } as AddEventListenerOptions);
      this.bound.push([target, type, fn]);
    };

    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    on(el, 'pointerdown', (e) => this.onPointerDown(e as PointerEvent));
    on(window, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    on(window, 'pointerup', (e) => this.onPointerUp(e as PointerEvent));
    on(window, 'pointercancel', () => this.endDrag());
    on(window, 'blur', () => this.reset());
  }

  detach(): void {
    for (const [t, type, fn] of this.bound) t.removeEventListener(type, fn);
    this.bound = [];
    this.reset();
  }

  /** Clear all transient state (e.g. on window blur / game switch). */
  reset(): void {
    this.held.clear();
    this.heldPrev.clear();
    this.pendingEdges.clear();
    this.stepEdges.clear();
    this.pendingSwipe = null;
    this.stepSwipe = null;
    this.padPrev.clear();
    this.dragStart = null;
    this.pointer.down = false;
  }

  // --- Virtual (on-screen) controls -------------------------------------

  virtualDown(action: Action): void {
    if (!this.held.has(action)) this.pendingEdges.add(action);
    this.held.add(action);
  }

  virtualUp(action: Action): void {
    this.held.delete(action);
  }

  virtualSwipe(dir: SwipeDir): void {
    this.pendingSwipe = dir;
  }

  // --- Frame lifecycle (driven by the shell loop) -----------------------

  /** Snapshot edges for this frame; poll the gamepad. Call once per rAF. */
  beginFrame(): void {
    this.pollGamepad();
    this.stepEdges = new Set(this.pendingEdges);
    for (const a of this.held) if (!this.heldPrev.has(a)) this.stepEdges.add(a);
    this.stepSwipe = this.pendingSwipe;
    this.pendingEdges.clear();
    this.pendingSwipe = null;
    this.heldPrev = new Set(this.held);
  }

  /** Consume edges so only the first fixed sub-step of a frame sees them. */
  afterStep(): void {
    this.stepEdges.clear();
    this.stepSwipe = null;
  }

  // --- InputState reads -------------------------------------------------

  isDown(action: Action): boolean {
    return this.held.has(action);
  }

  pressed(action: Action): boolean {
    return this.stepEdges.has(action);
  }

  swipe(): SwipeDir | null {
    return this.stepSwipe;
  }

  // --- Event handlers ---------------------------------------------------

  private onKey(e: KeyboardEvent, down: boolean): void {
    const actions = KEY_MAP[e.code];
    if (!actions) return;
    // Prevent the page from scrolling on Space / arrows during play.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    for (const a of actions) {
      if (down) {
        if (!this.held.has(a)) this.pendingEdges.add(a);
        this.held.add(a);
      } else {
        this.held.delete(a);
      }
    }
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.nx = rect.width > 0 ? (x / rect.width) * 2 - 1 : 0;
    this.pointer.ny = rect.height > 0 ? -((y / rect.height) * 2 - 1) : 0;
    this.pointer.active = true;
  }

  private onPointerDown(e: PointerEvent): void {
    this.updatePointer(e);
    this.pointer.down = true;
    this.dragStart = { x: e.clientX, y: e.clientY, t: this.now() };
    for (const a of ['flap', 'fire', 'confirm'] as Action[]) {
      if (!this.held.has(a)) this.pendingEdges.add(a);
      this.held.add(a);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointer.active || this.pointer.down) this.updatePointer(e);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.dragStart) {
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      const dt = this.now() - this.dragStart.t;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (dt <= SWIPE_MAX_TIME && Math.max(adx, ady) >= SWIPE_THRESHOLD) {
        this.pendingSwipe = adx > ady ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      }
    }
    this.endDrag();
  }

  private endDrag(): void {
    this.dragStart = null;
    this.pointer.down = false;
    for (const a of ['flap', 'fire', 'confirm'] as Action[]) this.held.delete(a);
  }

  private pollGamepad(): void {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    const pad = Array.from(pads).find((p) => p);
    const now = new Set<Action>();
    if (pad) {
      const b = pad.buttons;
      const pressed = (i: number) => !!b[i]?.pressed;
      if (pressed(0)) ['flap', 'fire', 'confirm'].forEach((a) => now.add(a as Action));
      if (pressed(9) || pressed(8)) now.add('pause');
      if (pressed(12)) now.add('up');
      if (pressed(13)) now.add('down');
      if (pressed(14)) now.add('left');
      if (pressed(15)) now.add('right');
      const [ax, ay] = [pad.axes[0] ?? 0, pad.axes[1] ?? 0];
      if (ax < -0.4) now.add('left');
      if (ax > 0.4) now.add('right');
      if (ay < -0.4) now.add('up');
      if (ay > 0.4) now.add('down');
      if (now.has('up')) now.add('thrust');
    }
    // Reconcile gamepad-held actions into the main held set with edges.
    for (const a of now) {
      if (!this.padPrev.has(a) && !this.held.has(a)) this.pendingEdges.add(a);
      this.held.add(a);
    }
    for (const a of this.padPrev) if (!now.has(a)) this.held.delete(a);
    this.padPrev = now;
  }
}
