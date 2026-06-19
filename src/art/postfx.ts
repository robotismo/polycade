import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * One shared post stack for every game: render -> subtle UnrealBloom -> output
 * (the OutputPass restores correct sRGB after the linear bloom math). The same
 * composer instance is re-pointed at each game's scene/camera, so we never
 * allocate a second WebGL render target per game.
 */
export class PostStack {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  readonly bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.7, // strength
      0.6, // radius
      0.85, // threshold
    );
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Re-point the stack at the active game's scene + camera. */
  setTarget(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
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
