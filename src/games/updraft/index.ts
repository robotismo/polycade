import * as THREE from 'three';
import type { Game, GameEnv, GameFactory } from '../../engine/types';
import { neon, surface, emissive } from '../../art/materials';
import { addLightRig, applyAtmosphere } from '../../art/lighting';
import { accents, palette } from '../../art/tokens';
import { Pool } from '../../engine/pool';
import { Rng } from '../../engine/rng';

const HALF_H = 5; // playfield half-height
const GRAVITY = -18;
const FLAP_V = 6.6;
const SPEED = 6.0; // gate scroll speed (units/s)
const GAP = 3.9; // vertical gap size
const SPACING = 7.5; // x-distance between gates
const SPAWN_X = 15;
const DESPAWN_X = -17;
const BIRD_R = 0.46;
const GATE_HW = 0.7; // gate half-width in x
const PILLAR_H = 14;

interface Gate {
  group: THREE.Group;
  top: THREE.Mesh;
  bottom: THREE.Mesh;
  x: number;
  gapY: number;
  scored: boolean;
}

/** UPDRAFT — a flap-through-the-canyon game with real depth and lighting. */
class Updraft implements Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private rng = new Rng(0xc0ffee);
  private bird = new THREE.Group();
  private wingL!: THREE.Mesh;
  private wingR!: THREE.Mesh;
  private gates: Gate[] = [];
  private pool!: Pool<Gate>;
  private rungs: THREE.Mesh[] = [];
  private stars!: THREE.Points;

  private y = 0;
  private prevY = 0;
  private vy = 0;
  private score = 0;
  private alive = true;
  private flapPulse = 0;
  private animT = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(56, 1, 0.1, 120);
    this.camera.position.set(0, 0.4, 13);
    this.camera.lookAt(0, 0, 0);
    applyAtmosphere(this.scene, 16, 70);
  }

  init(_env: GameEnv): void {
    addLightRig(this.scene, palette.cyan);

    // Bird: glowing core + two flapping wings.
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(BIRD_R, 0), neon(accents.updraft, 1.1));
    const wingGeo = new THREE.BoxGeometry(0.1, 0.5, 0.9);
    const wingMat = neon(palette.ink, 0.5);
    this.wingL = new THREE.Mesh(wingGeo, wingMat);
    this.wingR = new THREE.Mesh(wingGeo, wingMat);
    this.wingL.position.set(-0.3, 0, 0);
    this.wingR.position.set(0.3, 0, 0);
    this.bird.add(core, this.wingL, this.wingR);
    this.scene.add(this.bird);

    // Canyon floor + ceiling slabs for a sense of bounds.
    const slabMat = surface(palette.surface);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 6), slabMat);
    floor.position.set(0, -HALF_H - 0.5, 0);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 6), slabMat);
    ceil.position.set(0, HALF_H + 0.5, 0);
    this.scene.add(floor, ceil);

    // Scrolling rungs on the floor for a speed cue.
    const rungMat = emissive(accents.updraft);
    for (let i = 0; i < 16; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 5), rungMat);
      rung.position.set(-18 + i * 2.4, -HALF_H + 0.02, 0);
      this.rungs.push(rung);
      this.scene.add(rung);
    }

    // Parallax starfield far behind the action.
    const count = 140;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = this.rng.range(-22, 22);
      positions[i * 3 + 1] = this.rng.range(-8, 8);
      positions[i * 3 + 2] = this.rng.range(-30, -6);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: palette.violet, size: 0.13, sizeAttenuation: true }),
    );
    this.scene.add(this.stars);

    // Gate pool.
    const gateMat = neon(palette.violet, 0.6);
    this.pool = new Pool<Gate>({
      create: () => {
        const group = new THREE.Group();
        const top = new THREE.Mesh(new THREE.BoxGeometry(GATE_HW * 2, PILLAR_H, 2), gateMat);
        const bottom = new THREE.Mesh(new THREE.BoxGeometry(GATE_HW * 2, PILLAR_H, 2), gateMat);
        group.add(top, bottom);
        this.scene.add(group);
        return { group, top, bottom, x: SPAWN_X, gapY: 0, scored: false };
      },
      onAcquire: (g) => (g.group.visible = true),
      onRelease: (g) => (g.group.visible = false),
    });
  }

  private spawnGate(x: number): void {
    const g = this.pool.acquire();
    g.x = x;
    g.gapY = this.rng.range(-HALF_H + GAP * 0.7, HALF_H - GAP * 0.7);
    g.scored = false;
    g.top.position.y = g.gapY + GAP / 2 + PILLAR_H / 2;
    g.bottom.position.y = g.gapY - GAP / 2 - PILLAR_H / 2;
    g.group.position.x = x;
    this.gates.push(g);
  }

  reset(): void {
    for (const g of this.gates) this.pool.release(g);
    this.gates.length = 0;
    this.y = 0;
    this.prevY = 0;
    this.vy = 0;
    this.score = 0;
    this.alive = true;
    this.flapPulse = 0;
    this.bird.position.set(0, 0, 0);
    // Seed three gates ahead.
    for (let i = 0; i < 3; i++) this.spawnGate(SPAWN_X + i * SPACING);
  }

  update(dt: number, env: GameEnv): void {
    if (!this.alive) return;
    this.prevY = this.y;

    if (env.input.pressed('flap')) {
      this.vy = FLAP_V;
      this.flapPulse = 1;
      env.audio.play('flap');
    }

    this.vy += GRAVITY * dt;
    this.y += this.vy * dt;

    // Ceiling clamp, floor kills.
    if (this.y + BIRD_R > HALF_H) {
      this.y = HALF_H - BIRD_R;
      this.vy = Math.min(this.vy, 0);
    }
    if (this.y - BIRD_R < -HALF_H) {
      this.die(env);
      return;
    }

    // Move gates, score, recycle, respawn.
    let rightmost = -Infinity;
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const g = this.gates[i];
      const prevX = g.x;
      g.x -= SPEED * dt;
      g.group.position.x = g.x;
      rightmost = Math.max(rightmost, g.x);

      if (!g.scored && prevX > 0 && g.x <= 0) {
        g.scored = true;
        this.score++;
        env.setScore(this.score);
        env.audio.play('score');
      }

      // Collision with the gate columns.
      if (Math.abs(g.x) < GATE_HW + BIRD_R) {
        const overTop = this.y + BIRD_R > g.gapY + GAP / 2;
        const underBottom = this.y - BIRD_R < g.gapY - GAP / 2;
        if (overTop || underBottom) {
          this.die(env);
          return;
        }
      }

      if (g.x < DESPAWN_X) {
        this.pool.release(g);
        this.gates.splice(i, 1);
      }
    }
    if (rightmost < SPAWN_X - SPACING) this.spawnGate(rightmost + SPACING);

    // Scroll rungs for the speed cue.
    for (const r of this.rungs) {
      r.position.x -= SPEED * dt;
      if (r.position.x < -19) r.position.x += 38.4;
    }
    this.stars.position.x -= SPEED * 0.18 * dt;
    if (this.stars.position.x < -8) this.stars.position.x = 0;
  }

  private die(env: GameEnv): void {
    if (!this.alive) return;
    this.alive = false;
    env.gameOver();
  }

  frame(alpha: number, _env: GameEnv): void {
    this.animT += 0.016;
    const y = this.prevY + (this.y - this.prevY) * alpha;
    this.bird.position.y = this.alive ? y : this.y;
    // Tilt with vertical velocity.
    this.bird.rotation.z = THREE.MathUtils.clamp(this.vy * 0.05, -0.7, 0.5);
    // Wing flap: a quick beat after each flap, idle flutter otherwise.
    this.flapPulse = Math.max(0, this.flapPulse - 0.06);
    const beat = Math.sin(this.animT * 9) * 0.25 + this.flapPulse * 0.7;
    this.wingL.rotation.z = 0.4 + beat;
    this.wingR.rotation.z = -0.4 - beat;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // Keep the playfield framed on portrait phones by easing the camera back.
    const portrait = height > width;
    this.camera.position.z = portrait ? 16.5 : 13;
    this.camera.updateProjectionMatrix();
  }

  getScore(): number {
    return this.score;
  }

  dispose(): void {
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.scene.clear();
  }
}

const factory: GameFactory = () => new Updraft();
export default factory;
