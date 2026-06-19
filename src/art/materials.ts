import * as THREE from 'three';
import { palette } from './tokens';

/**
 * Shared material factory. Every game pulls its surfaces from here, which is
 * what makes five scenes look like one product: same emissive-neon-on-matte
 * language, same roughness, same response to the shared lighting rig.
 *
 * Materials are owned by the game scene that uses them and freed by
 * disposeScene() on teardown — no module-global retention.
 */

/** Matte structural surface (floors, walls, frames). */
export function surface(color = palette.surface): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, flatShading: true });
}

/** Glowing neon body — the signature look. `glow` controls emissive intensity. */
export function neon(color: number, glow = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: glow,
    roughness: 0.35,
    metalness: 0.0,
    flatShading: true,
  });
}

/** Pure self-lit material (no lighting response) for HUD-like in-scene marks. */
export function emissive(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

/** Thin line material for wireframe / vector aesthetics (Driftfield, grids). */
export function line(color: number, opacity = 1): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
}
