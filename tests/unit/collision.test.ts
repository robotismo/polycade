import { describe, it, expect } from 'vitest';
import { aabbOverlap, circleBox, reflectAxis, clamp, wrap, type Box } from '../../src/engine/collision';

const box = (cx: number, cy: number, hw: number, hh: number): Box => ({ cx, cy, hw, hh });

describe('aabbOverlap', () => {
  it('detects overlap and separation', () => {
    expect(aabbOverlap(box(0, 0, 1, 1), box(1.5, 0, 1, 1))).toBe(true);
    expect(aabbOverlap(box(0, 0, 1, 1), box(2.5, 0, 1, 1))).toBe(false);
    expect(aabbOverlap(box(0, 0, 1, 1), box(0, 3, 1, 1))).toBe(false);
  });
});

describe('circleBox', () => {
  it('detects a circle touching a box face', () => {
    expect(circleBox(0, 1.4, 0.5, box(0, 0, 1, 1))).toBe(true);
    expect(circleBox(0, 1.6, 0.5, box(0, 0, 1, 1))).toBe(false);
  });
  it('detects a circle inside a box', () => {
    expect(circleBox(0, 0, 0.2, box(0, 0, 1, 1))).toBe(true);
  });
  it('misses on the corner diagonal', () => {
    // Corner at (1,1); circle centred outside the corner radius.
    expect(circleBox(1.5, 1.5, 0.5, box(0, 0, 1, 1))).toBe(false);
  });
});

describe('reflectAxis', () => {
  it('reflects on Y when hitting a wide brick from below', () => {
    expect(reflectAxis(0, 0.9, 0.2, 0, 0.5, box(0, 1.3, 1, 0.3))).toBe('y');
  });
  it('reflects on X when hitting a tall wall from the side', () => {
    expect(reflectAxis(0.9, 0, 0.2, 0.5, 0, box(1.3, 0, 0.3, 1))).toBe('x');
  });
  it('returns null when there is no overlap', () => {
    expect(reflectAxis(0, 5, 0.2, 0, 4.9, box(0, 0, 1, 1))).toBeNull();
  });
});

describe('clamp / wrap', () => {
  it('clamps to range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
  it('wraps toroidally into [-half, half)', () => {
    expect(wrap(0, 10)).toBe(0);
    expect(wrap(11, 10)).toBeCloseTo(-9);
    expect(wrap(-11, 10)).toBeCloseTo(9);
    expect(wrap(10, 10)).toBeCloseTo(-10);
  });
});
