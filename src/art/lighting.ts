import * as THREE from 'three';
import { palette } from './tokens';

export interface LightRig {
  ambient: THREE.AmbientLight;
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  dispose(): void;
}

/**
 * The shared lighting rig: soft ambient, a key for form, and a hemisphere fill
 * whose sky tint carries the per-game accent so each game owns a distinct mood
 * while staying one family. Lower ambient than a flat wash keeps low-poly facet
 * definition.
 */
export function addLightRig(scene: THREE.Scene, keyColor = 0xffffff): LightRig {
  const ambient = new THREE.AmbientLight(0xffffff, 0.42);
  const key = new THREE.DirectionalLight(keyColor, 1.25);
  key.position.set(5, 9, 6);
  const fill = new THREE.HemisphereLight(keyColor, palette.bg, 0.45);

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

/**
 * A large inward-facing gradient sphere: near-black at the top easing to a faint
 * accent glow at the bottom. Unfogged, drawn first, so neon objects sit in a
 * tinted volume instead of a flat void. Same language across games, hue per game.
 * Returns the mesh (disposed with the scene on teardown).
 */
export function addGradientBackdrop(
  scene: THREE.Scene,
  accent: number,
  intensity = 0.18,
  radius = 60,
): THREE.Mesh {
  const top = new THREE.Color(palette.bg);
  const bottom = new THREE.Color(palette.bg).lerp(new THREE.Color(accent), intensity);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: top }, bottom: { value: bottom } },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vPos;
      uniform vec3 top;
      uniform vec3 bottom;
      void main() {
        float h = clamp(normalize(vPos).y * 0.5 + 0.5, 0.0, 1.0);
        // Bias toward the dark top so the bulk of the visible sphere stays dark
        // and the accent only glows up from the bottom edge.
        gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.2, 0.85, h)), 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
  mesh.renderOrder = -1;
  scene.add(mesh);
  return mesh;
}
