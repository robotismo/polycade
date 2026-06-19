import { describe, it, expect } from 'vitest';
import { Rng } from '../../src/engine/rng';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 10 }, ((r) => () => r.next())(new Rng(1)));
    const b = Array.from({ length: 10 }, ((r) => () => r.next())(new Rng(2)));
    expect(a).not.toEqual(b);
  });

  it('next() stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() is within inclusive bounds', () => {
    const r = new Rng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('reseeding reproduces the stream', () => {
    const r = new Rng(1);
    const first = [r.next(), r.next(), r.next()];
    r.seed(1);
    expect([r.next(), r.next(), r.next()]).toEqual(first);
  });
});
