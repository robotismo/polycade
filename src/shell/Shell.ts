import type { Game, GameMeta } from '../engine/types';
import { Engine } from '../engine/engine';
import { LocalScoreStore } from '../score/store';
import type { ScoreStore } from '../score/store';
import { loadSettings, saveSettings } from '../engine/settings';
import type { Settings } from '../engine/settings';
import { GAMES, getGameMeta } from './registry';
import { buildTouchControls } from './controls';
import { el, clear } from './dom';
import { hexToCss } from '../art/tokens';

type View = 'home' | 'game';

/**
 * The DOM shell: tab navigation, home grid, HUD, overlays, settings and the
 * lifecycle glue between the URL, the score store and the Engine. It owns no
 * 3D — it tells the Engine what to mount and reacts to the Engine's events.
 */
export class Shell {
  private engine: Engine;
  private store: ScoreStore = new LocalScoreStore();
  private settings: Settings = loadSettings();

  private canvas!: HTMLCanvasElement;
  private tabsEl!: HTMLElement;
  private homeEl!: HTMLElement;
  private hudEl!: HTMLElement;
  private scoreEl!: HTMLElement;
  private bestEl!: HTMLElement;
  private overlayEl!: HTMLElement;
  private touchHost!: HTMLElement;
  private muteBtn!: HTMLButtonElement;

  private view: View = 'home';
  private currentMeta: GameMeta | null = null;
  private bestAtStart = 0;
  private loadToken = 0;

  constructor(private root: HTMLElement) {
    this.buildSkeleton();
    this.engine = new Engine(this.canvas, this.settings.muted);
    this.wireEngine();
    this.wireGlobal();
    this.onResize();
    this.engine.startLoop();
    this.route();
    this.exposeTestApi();
  }

  /**
   * A tiny, stable inspection surface for end-to-end tests (and manual debug).
   * Lets a driver read state/score and force input without scraping the canvas.
   */
  private exposeTestApi(): void {
    (window as unknown as { polycade: unknown }).polycade = {
      state: () => this.engine.state,
      score: () => this.engine.getScore(),
      best: (id: string) => this.store.getBest(id),
      currentId: () => this.currentMeta?.id ?? null,
      start: () => this.startRun(),
      input: this.engine.input,
      game: () => this.engine.current,
      tick: (n: number) => this.engine.advance(n ?? 1),
    };
  }

  // --- Skeleton ---------------------------------------------------------

  private buildSkeleton(): void {
    if (this.settings.reducedMotion) this.root.classList.add('reduced-motion');

    this.canvas = el('canvas', { class: 'stage', id: 'stage' });

    this.tabsEl = el('nav', { class: 'tabs' });
    this.tabsEl.setAttribute('aria-label', 'Games');
    const brand = el('button', { class: 'brand', html: 'POLY<b>CADE</b>' });
    brand.type = 'button';
    brand.addEventListener('click', () => this.go('#/'));

    this.muteBtn = el('button', { class: 'icon mute' });
    this.muteBtn.type = 'button';
    this.muteBtn.setAttribute('aria-label', 'Toggle sound');
    this.muteBtn.addEventListener('click', () => this.toggleMute());

    const header = el('header', { class: 'topbar' }, [brand, this.tabsEl, this.muteBtn]);

    this.homeEl = el('section', { class: 'home' });

    this.scoreEl = el('span', { class: 'score', html: '0' });
    this.bestEl = el('span', { class: 'best', html: 'BEST 0' });
    const pauseBtn = el('button', { class: 'icon pause', html: '❚❚' });
    pauseBtn.type = 'button';
    pauseBtn.setAttribute('aria-label', 'Pause');
    pauseBtn.addEventListener('click', () => this.togglePause());

    const hudTop = el('div', { class: 'hud-top' }, [this.scoreEl, this.bestEl, pauseBtn]);
    this.overlayEl = el('div', { class: 'overlay' });
    this.touchHost = el('div', { class: 'touch-host' });
    this.hudEl = el('div', { class: 'hud hidden' }, [hudTop, this.overlayEl, this.touchHost]);

    const main = el('main', { class: 'stage-wrap' }, [this.homeEl, this.hudEl]);

    this.root.append(this.canvas, header, main);
    this.buildTabs();
    this.refreshMuteBtn();
  }

  private buildTabs(): void {
    clear(this.tabsEl);
    const home = el('button', { class: 'tab', html: 'HOME' });
    home.type = 'button';
    home.dataset.id = '';
    home.addEventListener('click', () => this.go('#/'));
    this.tabsEl.append(home);
    for (const g of GAMES) {
      const t = el('button', { class: 'tab', html: g.title });
      t.type = 'button';
      t.dataset.id = g.id;
      t.style.setProperty('--accent', hexToCss(g.accent));
      t.addEventListener('click', () => this.go(`#/play/${g.id}`));
      this.tabsEl.append(t);
    }
  }

  private setActiveTab(id: string): void {
    for (const t of Array.from(this.tabsEl.children) as HTMLElement[]) {
      t.classList.toggle('active', (t.dataset.id ?? '') === id);
    }
  }

  // --- Wiring -----------------------------------------------------------

  private wireEngine(): void {
    this.engine.events.on('score', (s) => {
      this.scoreEl.textContent = String(s);
    });
    this.engine.events.on('gameover', (s) => this.onGameOver(s));
    this.engine.events.on('confirm', () => this.onConfirm());
  }

  private wireGlobal(): void {
    window.addEventListener('hashchange', () => this.route());
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => {
      if (this.view !== 'game') return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        this.togglePause();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.engine.state === 'playing') this.engine.pause();
    });
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.engine.resize(w, h);
  }

  private go(hash: string): void {
    if (location.hash === hash) this.route();
    else location.hash = hash;
  }

  // --- Routing ----------------------------------------------------------

  private route(): void {
    const hash = location.hash || '#/';
    const m = hash.match(/^#\/play\/([\w-]+)$/);
    if (m && getGameMeta(m[1])) {
      void this.showGame(m[1]);
    } else {
      this.showHome();
    }
  }

  private showHome(): void {
    this.view = 'home';
    this.loadToken++;
    this.engine.unmount();
    this.currentMeta = null;
    this.hudEl.classList.add('hidden');
    this.touchHost.replaceChildren();
    this.homeEl.classList.remove('hidden');
    this.setActiveTab('');
    this.renderHome();
  }

  private renderHome(): void {
    clear(this.homeEl);
    const intro = el('div', { class: 'home-intro' }, [
      el('h1', { html: 'POLY<b>CADE</b>' }),
      el('p', { html: 'Five low-poly arcade classics, reimagined in 3D. Pick a cabinet.' }),
    ]);
    const grid = el('div', { class: 'grid' });
    for (const g of GAMES) {
      const best = this.store.getBest(g.id);
      const card = el('button', { class: 'card' });
      card.type = 'button';
      card.style.setProperty('--accent', hexToCss(g.accent));
      card.append(
        el('div', { class: 'card-glow' }),
        el('span', { class: 'card-title', html: g.title }),
        el('span', { class: 'card-tag', html: g.tagline }),
        el('span', { class: 'card-best', html: best > 0 ? `BEST ${best}` : 'NEW' }),
      );
      card.addEventListener('click', () => this.go(`#/play/${g.id}`));
      grid.append(card);
    }
    this.homeEl.append(intro, grid);
  }

  private async showGame(id: string): Promise<void> {
    const meta = getGameMeta(id);
    if (!meta) return this.showHome();
    this.view = 'game';
    this.currentMeta = meta;
    this.homeEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    this.setActiveTab(id);
    this.hudEl.style.setProperty('--accent', hexToCss(meta.accent));
    this.scoreEl.textContent = '0';
    this.bestEl.textContent = `BEST ${this.store.getBest(id)}`;

    const token = ++this.loadToken;
    this.renderOverlay('loading', meta);

    let game: Game;
    try {
      const mod = await meta.load();
      if (token !== this.loadToken) return; // navigated away mid-load
      game = mod.default();
    } catch (err) {
      console.error('Failed to load game', id, err);
      this.renderOverlay('error', meta);
      return;
    }

    this.engine.mount(game);
    this.touchHost.replaceChildren();
    if (isTouch()) {
      const controls = buildTouchControls(meta.scheme, this.engine.input);
      if (controls) this.touchHost.append(controls);
    }
    this.renderOverlay('ready', meta);
  }

  // --- Run lifecycle ----------------------------------------------------

  private startRun(): void {
    if (!this.currentMeta) return;
    this.bestAtStart = this.store.getBest(this.currentMeta.id);
    this.engine.start();
    this.clearOverlay();
  }

  private togglePause(): void {
    if (this.engine.state === 'playing') {
      this.engine.pause();
      this.renderOverlay('paused', this.currentMeta);
    } else if (this.engine.state === 'paused') {
      this.engine.resume();
      this.clearOverlay();
    }
  }

  private onConfirm(): void {
    switch (this.engine.state) {
      case 'ready':
        this.startRun();
        break;
      case 'gameover':
        this.startRun();
        break;
      case 'paused':
        this.togglePause();
        break;
    }
  }

  private onGameOver(score: number): void {
    if (!this.currentMeta) return;
    this.engine.audio.play('crash');
    this.store.submit({ gameId: this.currentMeta.id, score, ts: Date.now() });
    const best = this.store.getBest(this.currentMeta.id);
    this.bestEl.textContent = `BEST ${best}`;
    this.renderOverlay('gameover', this.currentMeta, { score, best, isNewBest: score > this.bestAtStart && score > 0 });
  }

  // --- Overlays ---------------------------------------------------------

  private clearOverlay(): void {
    clear(this.overlayEl);
    this.overlayEl.classList.remove('visible');
  }

  private renderOverlay(
    kind: 'loading' | 'error' | 'ready' | 'paused' | 'gameover',
    meta: GameMeta | null,
    data?: { score: number; best: number; isNewBest: boolean },
  ): void {
    clear(this.overlayEl);
    this.overlayEl.classList.add('visible');
    const card = el('div', { class: 'panel' });

    if (kind === 'loading') {
      card.append(el('div', { class: 'spinner' }), el('p', { class: 'dim', html: 'loading cabinet…' }));
    } else if (kind === 'error') {
      card.append(
        el('h2', { html: 'Could not load' }),
        el('p', { class: 'dim', html: 'This cabinet is offline.' }),
        this.btn('Back to arcade', () => this.go('#/'), 'ghost'),
      );
    } else if (kind === 'ready' && meta) {
      card.append(
        el('h2', { html: meta.title }),
        el('p', { class: 'tag', html: meta.tagline }),
        el('p', { class: 'how', html: meta.instructions }),
        this.btn(isTouch() ? 'TAP TO START' : 'PRESS SPACE', () => this.startRun(), 'primary'),
        this.btn('Arcade', () => this.go('#/'), 'ghost'),
      );
    } else if (kind === 'paused' && meta) {
      card.append(
        el('h2', { html: 'PAUSED' }),
        this.btn('Resume', () => this.togglePause(), 'primary'),
        this.btn('Arcade', () => this.go('#/'), 'ghost'),
      );
    } else if (kind === 'gameover' && data) {
      card.append(
        el('h2', { html: 'GAME OVER' }),
        data.isNewBest ? el('p', { class: 'newbest', html: '★ NEW BEST ★' }) : el('span'),
        el('div', { class: 'score-final', html: String(data.score) }),
        el('p', { class: 'dim', html: `BEST ${data.best}` }),
        this.btn(isTouch() ? 'TAP TO RETRY' : 'PLAY AGAIN', () => this.startRun(), 'primary'),
        this.btn('Arcade', () => this.go('#/'), 'ghost'),
      );
    }
    this.overlayEl.append(card);
  }

  private btn(label: string, onClick: () => void, variant: 'primary' | 'ghost'): HTMLButtonElement {
    const b = el('button', { class: `btn ${variant}`, html: label });
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // --- Settings ---------------------------------------------------------

  private toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.engine.setMuted(this.settings.muted);
    saveSettings(this.settings);
    this.refreshMuteBtn();
    if (!this.settings.muted) this.engine.audio.unlock();
  }

  private refreshMuteBtn(): void {
    this.muteBtn.innerHTML = this.settings.muted ? '🔇' : '🔊';
    this.muteBtn.classList.toggle('off', this.settings.muted);
  }
}

function isTouch(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}
