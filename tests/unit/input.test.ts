import { describe, it, expect } from 'vitest';
import { InputManager } from '../../src/input/input';

/**
 * The input edge state machine — verified without a DOM by driving the virtual
 * (on-screen control) path plus the frame lifecycle the engine uses.
 */
describe('InputManager edges', () => {
  it('reports a press as an edge for exactly one step', () => {
    const im = new InputManager(() => 0);
    im.virtualDown('flap');
    im.beginFrame();
    expect(im.pressed('flap')).toBe(true);
    im.afterStep();
    expect(im.pressed('flap')).toBe(false);
    // No new press next frame.
    im.virtualUp('flap');
    im.beginFrame();
    expect(im.pressed('flap')).toBe(false);
  });

  it('tracks held state independent of edges', () => {
    const im = new InputManager(() => 0);
    im.virtualDown('thrust');
    im.beginFrame();
    expect(im.isDown('thrust')).toBe(true);
    im.afterStep();
    // Still held across subsequent frames until released.
    im.beginFrame();
    expect(im.isDown('thrust')).toBe(true);
    expect(im.pressed('thrust')).toBe(false); // not a new edge
    im.virtualUp('thrust');
    im.beginFrame();
    expect(im.isDown('thrust')).toBe(false);
  });

  it('a held action only edges once even across multiple sub-steps', () => {
    const im = new InputManager(() => 0);
    im.virtualDown('fire');
    im.beginFrame();
    let edges = 0;
    for (let i = 0; i < 4; i++) {
      if (im.pressed('fire')) edges++;
      im.afterStep();
    }
    expect(edges).toBe(1);
  });

  it('delivers a swipe for one step then clears it', () => {
    const im = new InputManager(() => 0);
    im.virtualSwipe('left');
    im.beginFrame();
    expect(im.swipe()).toBe('left');
    im.afterStep();
    expect(im.swipe()).toBeNull();
  });

  it('reset clears all transient state', () => {
    const im = new InputManager(() => 0);
    im.virtualDown('left');
    im.virtualSwipe('up');
    im.reset();
    im.beginFrame();
    expect(im.isDown('left')).toBe(false);
    expect(im.pressed('left')).toBe(false);
    expect(im.swipe()).toBeNull();
  });
});
