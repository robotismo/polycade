import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const BLOOM_STRENGTH = 0.7;
const BLOOM_REDUCED = 0.25;

/** Radial edge-darkening — anchors the eye to centre and lifts the neon read. */
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.42 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      float vig = 1.0 - strength * smoothstep(0.32, 0.82, d);
      gl_FragColor = vec4(c.rgb * vig, c.a);
    }
  `,
};

/**
 * One shared post stack for every game: render -> subtle UnrealBloom -> output
 * (sRGB) -> vignette. The same composer is re-pointed at each game's scene/
 * camera, so we never allocate a second WebGL render target per game.
 */
export class PostStack {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;
  private vignette: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      BLOOM_STRENGTH, // strength
      0.6, // radius
      0.85, // threshold
    );
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.vignette);
  }

  /** Re-point the stack at the active game's scene + camera. */
  setTarget(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  /** Reduced-motion / low-power: weaken bloom (its mip-blur is the costliest pass). */
  setReduced(reduced: boolean): void {
    this.bloom.strength = reduced ? BLOOM_REDUCED : BLOOM_STRENGTH;
    this.vignette.uniforms.strength.value = reduced ? 0.28 : 0.42;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
