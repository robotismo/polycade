/**
 * Pure collision/intersection helpers shared by the games. Kept free of three.js
 * and of any rendering so the math can be unit-tested in isolation (the spec's
 * "collision/intersection math, unit-tested independent of rendering").
 */

export interface Box {
  /** center x */
  cx: number;
  /** center y */
  cy: number;
  /** half-width */
  hw: number;
  /** half-height */
  hh: number;
}

/** Axis-aligned box overlap test. */
export function aabbOverlap(a: Box, b: Box): boolean {
  return (
    Math.abs(a.cx - b.cx) <= a.hw + b.hw && Math.abs(a.cy - b.cy) <= a.hh + b.hh
  );
}

/** Does a circle (cx,cy,r) intersect an axis-aligned box? */
export function circleBox(cx: number, cy: number, r: number, box: Box): boolean {
  const nx = clamp(cx, box.cx - box.hw, box.cx + box.hw);
  const ny = clamp(cy, box.cy - box.hh, box.cy + box.hh);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Resolve which axis a circle should reflect on after hitting a box, given the
 * pre-collision position. Returns 'x', 'y', or null if no overlap. Used by
 * Breakout/Pong-style reflections to avoid tunnelling through corners.
 */
export function reflectAxis(
  cx: number,
  cy: number,
  r: number,
  prevX: number,
  prevY: number,
  box: Box,
): 'x' | 'y' | null {
  if (!circleBox(cx, cy, r, box)) return null;
  const overlapX = box.hw + r - Math.abs(cx - box.cx);
  const overlapY = box.hh + r - Math.abs(cy - box.cy);
  if (overlapX < overlapY) return 'x';
  if (overlapY < overlapX) return 'y';
  // Corner: decide by approach direction.
  return Math.abs(cx - prevX) > Math.abs(cy - prevY) ? 'x' : 'y';
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Toroidal wrap of a value into [-half, half). For Asteroids-style fields. */
export function wrap(v: number, half: number): number {
  const span = half * 2;
  return ((((v + half) % span) + span) % span) - half;
}
