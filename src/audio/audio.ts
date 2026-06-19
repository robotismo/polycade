/**
 * All sound is synthesized at runtime with the Web Audio API — zero asset
 * files, zero licensing, instant load. A small palette of arcade blips, shared
 * across games for a coherent sonic identity.
 */

export type SfxName =
  | 'flap'
  | 'score'
  | 'crash'
  | 'start'
  | 'select'
  | 'eat'
  | 'bounce'
  | 'break'
  | 'shoot'
  | 'explode'
  | 'powerup';

export interface AudioBus {
  play(name: SfxName): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Resume the context after a user gesture (browsers require this). */
  unlock(): void;
}

interface Tone {
  freq: number;
  to?: number; // glide target
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

const RECIPES: Record<SfxName, Tone[]> = {
  flap: [{ freq: 380, to: 620, dur: 0.09, type: 'triangle', gain: 0.5 }],
  score: [
    { freq: 660, dur: 0.07, type: 'square', gain: 0.4 },
    { freq: 990, dur: 0.09, type: 'square', gain: 0.4, delay: 0.06 },
  ],
  crash: [{ freq: 180, to: 60, dur: 0.32, type: 'sawtooth', gain: 0.5 }],
  start: [
    { freq: 523, dur: 0.08, type: 'square', gain: 0.4 },
    { freq: 784, dur: 0.12, type: 'square', gain: 0.4, delay: 0.09 },
  ],
  select: [{ freq: 740, dur: 0.05, type: 'square', gain: 0.3 }],
  eat: [{ freq: 540, to: 760, dur: 0.07, type: 'square', gain: 0.4 }],
  bounce: [{ freq: 300, dur: 0.05, type: 'triangle', gain: 0.45 }],
  break: [{ freq: 820, to: 1100, dur: 0.06, type: 'square', gain: 0.35 }],
  shoot: [{ freq: 700, to: 240, dur: 0.12, type: 'sawtooth', gain: 0.3 }],
  explode: [{ freq: 140, to: 40, dur: 0.4, type: 'sawtooth', gain: 0.5 }],
  powerup: [
    { freq: 440, dur: 0.06, type: 'square', gain: 0.35 },
    { freq: 660, dur: 0.06, type: 'square', gain: 0.35, delay: 0.05 },
    { freq: 880, dur: 0.1, type: 'square', gain: 0.35, delay: 0.1 },
  ],
};

export class WebAudioBus implements AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted: boolean;

  constructor(muted = false) {
    this.muted = muted;
  }

  unlock(): void {
    this.ensure();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private ensure(): void {
    if (this.ctx) return;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.7;
  }

  isMuted(): boolean {
    return this.muted;
  }

  play(name: SfxName): void {
    if (this.muted) return;
    this.ensure();
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime;
    for (const tone of RECIPES[name]) {
      const start = t0 + (tone.delay ?? 0);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = tone.type ?? 'square';
      osc.frequency.setValueAtTime(tone.freq, start);
      if (tone.to !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, tone.to), start + tone.dur);
      }
      const peak = tone.gain ?? 0.4;
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(peak, start + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
      osc.connect(env);
      env.connect(master);
      osc.start(start);
      osc.stop(start + tone.dur + 0.02);
    }
  }
}
