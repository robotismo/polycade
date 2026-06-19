import * as THREE from 'three';
import { palette } from './tokens';

export interface LightRig {
  ambient: THREE.AmbientLight;
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  dispose(): void;
}

/**
 * The shared three-point-ish lighting rig: soft ambient floor, a warm-ish key
 * for form, and a hemisphere fill that tints shadow into the brand background.
 * Identical across games so materials read consistently everywhere.
 */
export function addLightRig(scene: THREE.Scene, keyColor = 0xffffff): LightRig {
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const key = new THREE.DirectionalLight(keyColor, 1.1);
  key.position.set(5, 9, 6);
  const fill = new THREE.HemisphereLight(palette.ink, palette.bg, 0.5);

  scene.add(ambient, key, fill);

  return {
    ambient,
    key,
    fill,
    dispose() {
      scene.remove(ambient, key, fill);
      ambient.dispose();
      key.dispose();
      fill.dispose();
    },
  };
}

/** Apply the shared background + fog to a scene. */
export function applyAtmosphere(scene: THREE.Scene, near = 18, far = 60): void {
  scene.background = new THREE.Color(palette.bg);
  scene.fog = new THREE.Fog(palette.fog, near, far);
}
