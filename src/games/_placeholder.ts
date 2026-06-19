import * as THREE from 'three';
import type { Game, GameEnv, GameFactory } from '../engine/types';
import { neon } from '../art/materials';
import { addLightRig, applyAtmosphere } from '../art/lighting';

/**
 * Temporary placeholder cabinet. Renders a slowly tumbling neon solid; tapping
 * scores, and a short timer ends the run — just enough to exercise the full
 * shell lifecycle while the real game is built. Replaced per game by the
 * fan-out workstream.
 */
export function placeholderFactory(accent: number, sides: number): GameFactory {
  return () => new Placeholder(accent, sides);
}

class Placeholder implements Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private solid: THREE.Mesh;
  private score = 0;
  private t = 0;
  private alive = true;

  constructor(accent: number, sides: number) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 0, 7);
    applyAtmosphere(this.scene, 10, 40);
    const geo =
      sides <= 4
        ? new THREE.TetrahedronGeometry(1.6)
        : sides === 6
          ? new THREE.BoxGeometry(2, 2, 2)
          : new THREE.IcosahedronGeometry(1.6, 0);
    this.solid = new THREE.Mesh(geo, neon(accent, 0.9));
  }

  init(_env: GameEnv): void {
    addLightRig(this.scene);
    this.scene.add(this.solid);
  }

  reset(): void {
    this.score = 0;
    this.t = 0;
    this.alive = true;
    this.solid.rotation.set(0, 0, 0);
  }

  update(dt: number, env: GameEnv): void {
    if (!this.alive) return;
    this.t += dt;
    if (env.input.pressed('flap') || env.input.pressed('fire')) {
      this.score++;
      env.setScore(this.score);
      env.audio.play('select');
    }
    if (this.t > 12) {
      this.alive = false;
      env.gameOver();
    }
  }

  frame(_alpha: number): void {
    this.solid.rotation.x += 0.01;
    this.solid.rotation.y += 0.013;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  getScore(): number {
    return this.score;
  }

  dispose(): void {
    this.solid.geometry.dispose();
    this.scene.clear();
  }
}
