import type { ControlScheme } from '../engine/types';
import type { Action, InputManager } from '../input/input';
import { el } from './dom';

/**
 * On-screen touch controls. Rendered only on touch devices, tailored to each
 * game's control scheme so every game is playable one-handed on a phone. The
 * buttons feed the same semantic input the keyboard does.
 */
export function buildTouchControls(scheme: ControlScheme, input: InputManager): HTMLElement | null {
  switch (scheme) {
    case 'tap':
      // Whole-canvas tap already flaps; show only a hint.
      return el('div', { class: 'touch hint', html: '<span>tap to flap</span>' });

    case 'swipe': {
      // A d-pad is far more reliable than swipe on small screens; keep both.
      const pad = el('div', { class: 'touch dpad' });
      pad.append(
        holdBtn('▲', 'up', input, 'up'),
        el('div', { class: 'dpad-mid' }, [
          holdBtn('◀', 'left', input, 'left'),
          holdBtn('▶', 'right', input, 'right'),
        ]),
        holdBtn('▼', 'down', input, 'down'),
      );
      return pad;
    }

    case 'paddle':
      // Drag anywhere moves the paddle; show a hint plus nudge buttons.
      return el('div', { class: 'touch sides' }, [
        holdBtn('◀', 'left', input, 'left'),
        holdBtn('▶', 'right', input, 'right'),
      ]);

    case 'steer':
      return el('div', { class: 'touch sides' }, [
        holdBtn('◀', 'left', input, 'left'),
        holdBtn('▶', 'right', input, 'right'),
      ]);

    case 'thrust-fire': {
      const wrap = el('div', { class: 'touch cluster' });
      wrap.append(
        el('div', { class: 'cluster-left' }, [
          holdBtn('◀', 'left', input, 'left'),
          holdBtn('▶', 'right', input, 'right'),
        ]),
        el('div', { class: 'cluster-right' }, [
          holdBtn('THRUST', 'thrust', input, 'act'),
          holdBtn('FIRE', 'fire', input, 'act'),
        ]),
      );
      return wrap;
    }
  }
}

function holdBtn(
  label: string,
  action: Action,
  input: InputManager,
  variant: 'up' | 'down' | 'left' | 'right' | 'act',
): HTMLElement {
  const btn = el('button', { class: `ctl ctl-${variant}`, html: `<span>${label}</span>` });
  btn.type = 'button';
  const down = (e: Event) => {
    e.preventDefault();
    input.virtualDown(action);
    btn.classList.add('active');
  };
  const up = (e: Event) => {
    e.preventDefault();
    input.virtualUp(action);
    btn.classList.remove('active');
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointerleave', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  return btn;
}
