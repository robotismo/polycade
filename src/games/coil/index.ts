import * as THREE from 'three';
import type { Game, GameEnv, GameFactory } from '../../engine/types';
import type { SwipeDir } from '../../input/input';
import { neon, surface, line, emissive } from '../../art/materials';
import { addLightRig, applyAtmosphere, addGradientBackdrop } from '../../art/lighting';
import { accents, palette } from '../../art/tokens';
import { Pool } from '../../engine/pool';
import { disposeScene } from '../../engine/dispose';
import { Rng } from '../../engine/rng';

/**
 * COIL — 3D snake on a grid inside a glowing glass arena.
 *
 * The board lives in the X-Z plane (y up); the camera looks down at an angle
 * from above-and-behind on +Z, so on-screen "up" is into the screen (-Z) and
 * "down" is toward the camera (+Z). Movement is grid-stepped on a fixed cadence;
 * between steps we interpolate segment positions in frame() for fluidity.
 */

const GRID = 17; // cells per side (odd => a true center cell)
const CELL = 1; // world units per cell
const HALF = (GRID - 1) / 2; // grid-coord extent from center (cells)
const START_LEN = 4; // initial snake length
const MOVE_START = 0.16; // seconds per step at length START_LEN
const MOVE_MIN = 0.085; // fastest step time (cap)
const MOVE_RAMP = 0.004; // step time shaved per food eaten
const SEG = 0.82; // segment cube size (world units)
const HEAD_SCALE = 1.12; // resting head scale (body is 1)
const POP_SCALE = 1.35; // peak head scale right after eating

/** A grid cell. x,z are integer cell coords centered on the board. */
interface Cell {
  x: number;
  z: number;
}

/** A pooled cosmetic particle shard (visual only — never simulation). */
interface Shard {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number; // remaining seconds
  ttl: number; // initial lifetime (for fade/scale)
}

/** Cardinal directions on the grid, matching the on-screen mapping. */
const DIRS: Record<SwipeDir, Cell> = {
  up: { x: 0, z: -1 }, // into the screen
  down: { x: 0, z: 1 }, // toward the camera
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

class Coil implements Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private rng = new Rng(0x5e7e5e7);

  // --- Simulation state (read by the test driver) -----------------------
  /** Snake body cells, head first. Each is an integer {x,z} grid cell. */
  snake: Cell[] = [];
  /** Current travel direction as a unit grid delta. */
  dir: Cell = { x: 1, z: 0 };
  /** Buffered next direction (applied at the next step; blocks 180s). */
  private nextDir: Cell = { x: 1, z: 0 };
  /** The food cell the snake is hunting. */
  food: Cell = { x: 0, z: 0 };
  /** Seconds between grid steps right now (shrinks as you grow). */
  moveInterval = MOVE_START;

  private moveAccum = 0; // time banked toward the next step
  private prevAccum = 0; // banked time at the previous step (for interp)
  private growBy = 0; // segments still owed from recent food
  private score = 0;
  private alive = true;
  private spinT = 0; // visual-only orb spin/bob clock (advanced by env.dt)
  private headPop = 0; // visual head-pop amount [0..1], decays in frame()

  // --- Render objects ---------------------------------------------------
  private segMeshes: THREE.Mesh[] = [];
  private segGeo!: THREE.BoxGeometry;
  private segMat!: THREE.MeshStandardMaterial;
  private headMat!: THREE.MeshStandardMaterial;
  private foodMesh!: THREE.Mesh;
  // Flat world positions per segment (x,z packed) — no per-frame Vector3 churn.
  private prevX: number[] = []; // each segment's world x at the previous step
  private prevZ: number[] = []; // each segment's world z at the previous step
  private targX: number[] = []; // each segment's world x at the current step
  private targZ: number[] = []; // each segment's world z at the current step

  // --- Cosmetic particles (visual only; pooled) -------------------------
  private shardGeo!: THREE.BoxGeometry;
  private shardPool!: Pool<Shard>;
  private shards: Shard[] = [];

  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 120);
    this.framingCamera(1); // default landscape-ish framing
    applyAtmosphere(this.scene, 22, 80);
  }

  init(_env: GameEnv): void {
    addLightRig(this.scene, palette.green);
    // Coil's camera looks down onto the accent-heavy bottom of the backdrop, so
    // use a gentle tint to keep the green-on-green snake readable.
    addGradientBackdrop(this.scene, accents.coil, 0.1);

    const boardSize = GRID * CELL;

    // Subtle matte floor slab under the play surface.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(boardSize + 1.4, 0.5, boardSize + 1.4),
      surface(palette.surface),
    );
    floor.position.y = -0.55;
    this.scene.add(floor);

    // Faint grid lines so the cells read clearly.
    const grid = new THREE.GridHelper(boardSize, GRID, palette.muted, palette.muted);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.18;
    grid.position.y = -0.28;
    this.scene.add(grid);

    // Neon border frame: four thin glowing rails around the arena edge.
    const railMat = neon(accents.coil, 0.85);
    const railLong = new THREE.BoxGeometry(boardSize + 0.6, 0.3, 0.18);
    const railSide = new THREE.BoxGeometry(0.18, 0.3, boardSize + 0.6);
    const edge = HALF * CELL + CELL / 2;
    const rN = new THREE.Mesh(railLong, railMat);
    rN.position.set(0, -0.15, -edge);
    const rS = new THREE.Mesh(railLong, railMat);
    rS.position.set(0, -0.15, edge);
    const rW = new THREE.Mesh(railSide, railMat);
    rW.position.set(-edge, -0.15, 0);
    const rE = new THREE.Mesh(railSide, railMat);
    rE.position.set(edge, -0.15, 0);
    this.scene.add(rN, rS, rW, rE);

    // A bright base outline on the floor for extra glass-arena polish.
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-edge, -0.27, -edge),
        new THREE.Vector3(edge, -0.27, -edge),
        new THREE.Vector3(edge, -0.27, edge),
        new THREE.Vector3(-edge, -0.27, edge),
      ]),
      line(accents.coil, 0.5),
    );
    this.scene.add(outline);

    // Shared segment geometry + materials (one geo, two mats: head vs body).
    this.segGeo = new THREE.BoxGeometry(SEG, SEG, SEG);
    this.segMat = neon(accents.coil, 0.7);
    this.headMat = neon(palette.green, 1.2);

    // Glowing food orb.
    this.foodMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), neon(palette.magenta, 1.3));
    this.scene.add(this.foodMesh);

    // Pooled cosmetic shards for eat/death bursts. Each shard owns its own
    // self-lit material so we can tint per burst (magenta = eat, green = death).
    this.shardGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    this.shardPool = new Pool<Shard>({
      create: () => {
        const mesh = new THREE.Mesh(this.shardGeo, emissive(palette.magenta));
        mesh.visible = false;
        this.scene.add(mesh);
        return { mesh, vx: 0, vy: 0, vz: 0, life: 0, ttl: 0 };
      },
      onAcquire: (s) => (s.mesh.visible = true),
      onRelease: (s) => (s.mesh.visible = false),
      prefill: 16,
    });

    this.reset();
  }

  // --- Grid helpers -----------------------------------------------------

  private inBounds(c: Cell): boolean {
    return c.x >= -HALF && c.x <= HALF && c.z >= -HALF && c.z <= HALF;
  }

  private occupied(x: number, z: number, ignoreTail: boolean): boolean {
    // When ignoreTail is true the last segment is excluded (it will move away).
    const last = this.snake.length - 1;
    for (let i = 0; i < this.snake.length; i++) {
      if (ignoreTail && i === last && this.growBy === 0) continue;
      if (this.snake[i].x === x && this.snake[i].z === z) return true;
    }
    return false;
  }

  /** Place food on a uniformly-random empty cell using the seeded Rng. */
  private placeFood(): void {
    const empties: Cell[] = [];
    for (let x = -HALF; x <= HALF; x++) {
      for (let z = -HALF; z <= HALF; z++) {
        if (!this.occupied(x, z, false)) empties.push({ x, z });
      }
    }
    if (empties.length === 0) return; // board full (win-ish); leave food as-is
    const pick = empties[this.rng.int(0, empties.length - 1)];
    this.food = { x: pick.x, z: pick.z };
    this.foodMesh.position.set(pick.x * CELL, 0.1, pick.z * CELL);
  }

  /** Grow/shrink the segment mesh pool to match the snake length. */
  private syncMeshes(): void {
    while (this.segMeshes.length < this.snake.length) {
      const m = new THREE.Mesh(this.segGeo, this.segMat);
      this.segMeshes.push(m);
      this.scene.add(m);
    }
    for (let i = 0; i < this.segMeshes.length; i++) {
      const m = this.segMeshes[i];
      const used = i < this.snake.length;
      m.visible = used;
      if (used) {
        // Head gets the brighter material and a touch more presence.
        m.material = i === 0 ? this.headMat : this.segMat;
        const s = i === 0 ? HEAD_SCALE : 1;
        m.scale.setScalar(s);
      }
    }
  }

  reset(): void {
    this.alive = true;
    this.score = 0;
    this.growBy = 0;
    this.moveInterval = MOVE_START;
    this.moveAccum = 0;
    this.prevAccum = 0;
    this.headPop = 0;
    this.rng.seed(0x5e7e5e7);

    // Retire any live cosmetic shards from the previous run.
    for (const s of this.shards) this.shardPool.release(s);
    this.shards.length = 0;

    // Snake of START_LEN cells along the center row, heading +x.
    // Head at the front of the array; body trails to -x.
    this.snake = [];
    const startX = -1; // head a little left of center so it has room to run
    for (let i = 0; i < START_LEN; i++) {
      this.snake.push({ x: startX - i, z: 0 });
    }
    this.dir = { x: 1, z: 0 };
    this.nextDir = { x: 1, z: 0 };

    this.syncMeshes();
    this.snapWorld(); // place meshes at their cells, seed interp buffer
    this.placeFood();
  }

  // --- Direction input --------------------------------------------------

  private steer(d: Cell): void {
    // Disallow reversing straight back into the neck.
    if (d.x === -this.dir.x && d.z === -this.dir.z) return;
    if (d.x === 0 && d.z === 0) return;
    this.nextDir = d;
  }

  private readInput(env: GameEnv): void {
    // Buffer at most one turn per step: priority swipe, then key edges.
    const sw = env.input.swipe();
    if (sw) {
      this.steer(DIRS[sw]);
      return;
    }
    if (env.input.pressed('up')) this.steer(DIRS.up);
    else if (env.input.pressed('down')) this.steer(DIRS.down);
    else if (env.input.pressed('left')) this.steer(DIRS.left);
    else if (env.input.pressed('right')) this.steer(DIRS.right);
  }

  // --- Simulation -------------------------------------------------------

  update(dt: number, env: GameEnv): void {
    if (!this.alive) return;

    this.readInput(env);

    this.moveAccum += dt;
    while (this.moveAccum >= this.moveInterval) {
      this.moveAccum -= this.moveInterval;
      this.prevAccum = this.moveAccum; // remaining time after this step
      this.step(env);
      if (!this.alive) return;
    }
  }

  /** Advance the snake exactly one grid cell. */
  private step(env: GameEnv): void {
    // Commit the buffered turn for this step.
    this.dir = this.nextDir;

    const head = this.snake[0];
    const next: Cell = { x: head.x + this.dir.x, z: head.z + this.dir.z };

    // Death: ran off the board.
    if (!this.inBounds(next)) {
      this.die(env);
      return;
    }
    // Death: bit own body. The tail is exempt because it vacates this step
    // (unless we're growing, in which case it stays put).
    if (this.occupied(next.x, next.z, true)) {
      this.die(env);
      return;
    }

    // Record where every segment was, so frame() can interpolate from here.
    this.capturePrevWorld();

    // Advance: push new head, pop tail unless we owe growth.
    this.snake.unshift(next);
    const ate = next.x === this.food.x && next.z === this.food.z;
    if (ate) {
      // Capture the eaten cell before placeFood relocates the food.
      const eatenX = this.food.x;
      const eatenZ = this.food.z;
      this.score++;
      env.setScore(this.score);
      env.audio.play('eat');
      this.growBy++; // keep the tail this step => net +1 length
      // Speed up a touch, down to the floor.
      this.moveInterval = Math.max(MOVE_MIN, MOVE_START - this.score * MOVE_RAMP);
      this.placeFood();
      // JUICE (visual only — does not touch sim state): head pop, shake, burst.
      this.headPop = 1;
      env.shake(0.12);
      if (!env.reducedMotion) this.spawnBurst(eatenX, eatenZ, palette.magenta, 8);
    }
    if (this.growBy > 0) {
      this.growBy--; // consume one owed growth: do not pop tail
    } else {
      this.snake.pop();
    }

    this.syncMeshes();
    this.snapTargets(); // set mesh positions to the new cells (interp target)
  }

  private die(env: GameEnv): void {
    if (!this.alive) return;
    this.alive = false;
    env.audio.play('crash');
    // JUICE (visual only): a solid shake + a green shard burst at the head.
    env.shake(0.25);
    const head = this.snake[0];
    if (head && !env.reducedMotion) this.spawnBurst(head.x, head.z, palette.green, 10);
    env.gameOver();
  }

  // --- Position bookkeeping for smooth interpolation --------------------

  /** Snapshot current world positions of all segments (pre-move).
   *  Writes into preallocated flat arrays — no Vector3 allocation. */
  private capturePrevWorld(): void {
    for (let i = 0; i < this.snake.length; i++) {
      const c = this.snake[i];
      this.prevX[i] = c.x * CELL;
      this.prevZ[i] = c.z * CELL;
    }
    this.prevX.length = this.snake.length;
    this.prevZ.length = this.snake.length;
  }

  /** Record each segment's target cell as flat world coords (interp target)
   *  and place the meshes at rest there. No Vector3 allocation. */
  private snapTargets(): void {
    for (let i = 0; i < this.snake.length; i++) {
      const c = this.snake[i];
      const x = c.x * CELL;
      const z = c.z * CELL;
      this.targX[i] = x;
      this.targZ[i] = z;
      this.segMeshes[i].position.set(x, 0, z);
    }
    this.targX.length = this.snake.length;
    this.targZ.length = this.snake.length;
  }

  /** Hard-place every mesh and seed the interp buffers (used on reset). */
  private snapWorld(): void {
    this.snapTargets();
    for (let i = 0; i < this.snake.length; i++) {
      this.prevX[i] = this.targX[i];
      this.prevZ[i] = this.targZ[i];
    }
    this.prevX.length = this.snake.length;
    this.prevZ.length = this.snake.length;
  }

  // --- Per-rendered-frame visual smoothing ------------------------------

  frame(alpha: number, env: GameEnv): void {
    // Cosmetic clock advanced by real elapsed time so visuals stay frame-rate
    // independent (replaces the old hardcoded 1/60 increment).
    this.spinT += env.dt;

    // Interpolation across the current step: blend prev->target cell.
    // `alpha` from the shell covers the sub-step within the latest fixed dt;
    // we fold in banked time so motion stays continuous across multiple steps.
    let t = 0;
    if (this.alive && this.moveInterval > 0) {
      t = (this.prevAccum + alpha * (1 / 60)) / this.moveInterval;
      if (t > 1) t = 1;
      if (t < 0) t = 0;
    }

    // Write straight into mesh.position from flat scratch arrays — no Vector3
    // allocation in this hot per-segment loop.
    for (let i = 0; i < this.snake.length; i++) {
      const tx = this.targX[i];
      const tz = this.targZ[i];
      const px = this.prevX[i] ?? tx;
      const pz = this.prevZ[i] ?? tz;
      this.segMeshes[i].position.set(px + (tx - px) * t, 0, pz + (tz - pz) * t);
    }

    // Head scale-pop on eat: ease the extra pop back to the resting head scale.
    if (this.segMeshes.length > 0 && this.snake.length > 0) {
      if (this.headPop > 0) {
        this.headPop = Math.max(0, this.headPop - env.dt * 5);
      }
      const s = HEAD_SCALE + (POP_SCALE - HEAD_SCALE) * this.headPop;
      this.segMeshes[0].scale.setScalar(s);
    }

    // Food orb: gentle bob + spin for life.
    this.foodMesh.rotation.y = this.spinT * 1.6;
    this.foodMesh.rotation.x = this.spinT * 1.1;
    this.foodMesh.position.y = 0.1 + Math.sin(this.spinT * 3) * 0.12;

    // Advance + retire cosmetic shards (visual only; ordinary math, no sim).
    this.updateShards(env.dt);
  }

  /** Spawn a small pooled burst of shards at a cell. Visual only — uses
   *  ordinary randomness and never touches the seeded sim Rng. */
  private spawnBurst(cellX: number, cellZ: number, color: number, count: number): void {
    const x = cellX * CELL;
    const z = cellZ * CELL;
    for (let i = 0; i < count; i++) {
      const s = this.shardPool.acquire();
      this.shards.push(s);
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      s.mesh.position.set(x, 0.2, z);
      s.mesh.scale.setScalar(1);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.6 + Math.random() * 2.4;
      s.vx = Math.cos(a) * sp;
      s.vz = Math.sin(a) * sp;
      s.vy = 2.4 + Math.random() * 2.2;
      s.ttl = 0.4 + Math.random() * 0.25;
      s.life = s.ttl;
    }
  }

  /** Integrate shards, fade/scale by remaining life, release the dead ones. */
  private updateShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shardPool.release(s);
        this.shards.splice(i, 1);
        continue;
      }
      s.vy -= 9 * dt; // gentle gravity
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      const k = s.life / s.ttl;
      s.mesh.scale.setScalar(k);
    }
  }

  // --- Framing / lifecycle ----------------------------------------------

  /** Position the camera for the given aspect (w/h). Pulls back on portrait. */
  private framingCamera(aspect: number): void {
    // Board spans GRID units; frame it with a tilted over-the-shoulder view.
    // Pull the camera farther out and higher when the viewport is tall.
    const portrait = aspect < 1;
    const back = portrait ? 17 : 13.5;
    const high = portrait ? 17 : 14;
    this.camera.position.set(0, high, back);
    this.camera.lookAt(0, 0, 0);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.framingCamera(width / height);
    this.camera.updateProjectionMatrix();
  }

  getScore(): number {
    return this.score;
  }

  dispose(): void {
    disposeScene(this.scene);
    this.segMeshes.length = 0;
    this.shards.length = 0;
  }
}

const factory: GameFactory = () => new Coil();
export default factory;
