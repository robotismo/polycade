import * as THREE from 'three';
import type { Game, GameEnv, GameFactory } from '../../engine/types';
import { neon, surface, emissive } from '../../art/materials';
import { addLightRig, applyAtmosphere, addGradientBackdrop } from '../../art/lighting';
import { accents, palette } from '../../art/tokens';
import { Pool } from '../../engine/pool';
import { disposeScene } from '../../engine/dispose';
import { Rng } from '../../engine/rng';

// --- Playfield geometry (world units, X horizontal, Y vertical) -----------
const HALF_W = 6; // distance from centre to the inner face of a side wall
const TOP_Y = 8; // y of the inner face of the top wall
const BOTTOM_Y = -8; // ball below this is lost
const WALL_T = 0.5; // wall thickness

// --- Paddle ---------------------------------------------------------------
const PADDLE_HW = 1.3; // half-width
const PADDLE_HH = 0.28; // half-height
const PADDLE_Y = -7; // fixed vertical position
const PADDLE_SPEED = 12; // units/s for keyboard nudge
const PADDLE_X_LIMIT = HALF_W - PADDLE_HW; // keep paddle inside the walls

// --- Ball -----------------------------------------------------------------
const BALL_R = 0.26;
const BALL_SPEED0 = 9.0; // launch speed (units/s)
const BALL_SPEED_MAX = 15.0;
const BALL_SPEED_GROWTH = 0.18; // speed gained per brick broken
const MAX_BOUNCE_ANGLE = 1.05; // rad off vertical at the paddle edge (~60°)

// --- Bricks ---------------------------------------------------------------
const ROWS = 6;
const COLS = 9;
const BRICK_GAP = 0.12;
const FIELD_W = HALF_W * 2 - 0.8; // horizontal span the brick grid fills
const BRICK_W = FIELD_W / COLS;
const BRICK_HW = BRICK_W / 2 - BRICK_GAP;
const BRICK_HH = 0.34;
const BRICK_TOP = TOP_Y - 0.9; // y of the top row's centre
const ROW_PITCH = BRICK_HH * 2 + 0.28; // vertical distance between rows

// Per-row colour + points (top rows are worth more), classic breakout.
const ROW_COLORS = [
  palette.magenta,
  palette.violet,
  palette.cyan,
  palette.green,
  palette.yellow,
  palette.cyan,
];
const ROW_POINTS = [7, 6, 5, 3, 2, 1];

const START_LIVES = 3;

interface Brick {
  alive: boolean;
  x: number;
  y: number;
  row: number;
}

/** A short-lived cosmetic shard from a shattered brick (visual only, not sim). */
interface Shard {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  ttl: number; // total lifetime (for fade)
}

/** SHATTER — 3D breakout: bounce a neon ball to shatter a wall of bricks. */
class Shatter implements Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private rng = new Rng(0x51a77e2);

  // Visual objects
  private paddle!: THREE.Mesh;
  private ball!: THREE.Mesh;
  private brickMeshes: THREE.Mesh[] = []; // one mesh per brick (reused across walls)
  private brickRowMats: THREE.MeshStandardMaterial[] = []; // one neon material per row
  private brickGeo!: THREE.BoxGeometry;

  // Cosmetic shard particles (frame()-only; never read by the sim/E2E).
  private shardGeo!: THREE.BoxGeometry;
  private shardPool!: Pool<Shard>;
  private shards: Shard[] = [];
  /** Per-frame queue of brick breaks to emit a burst for (filled in update()). */
  private breakBursts: { x: number; y: number; row: number }[] = [];

  // --- Simulation state (the test driver reads these) ---
  /** Ball centre in world units. */
  ballPos = new THREE.Vector3(0, PADDLE_Y + 0.8, 0);
  /** Ball velocity in units/s. */
  ballVel = new THREE.Vector3(0, BALL_SPEED0, 0);
  /** Paddle centre x in world units. */
  paddleX = 0;
  /** Paddle half-width (collision uses this). */
  readonly paddleHalfWidth = PADDLE_HW;
  /** Ball radius. */
  readonly ballRadius = BALL_R;
  /** Flat brick list; index = row * COLS + col. `alive` flips false when broken. */
  bricks: Brick[] = [];
  /** Bricks remaining alive (0 => respawn fresh wall). */
  bricksLeft = 0;
  /** Lives remaining; reaching 0 ends the run. */
  lives = START_LIVES;
  /** True until the ball has been launched off the paddle. */
  ballStuck = true;

  // Bookkeeping for interpolation + scoring.
  private prevBallPos = new THREE.Vector3();
  private curSpeed = BALL_SPEED0;
  private score = 0;
  private alive = true;
  private shimmerT = 0;

  // Touch-launch bookkeeping: while stuck, a pointer-down aims the paddle; the
  // ball only launches on the tap *release* (or a non-pointer fire edge). This
  // lets a phone player reposition before serving. pointerWasDown tracks the
  // down->up transition; pressAimX is the paddle x at press-time so we can tell
  // a deliberate aim-drag from a quick serving tap.
  private pointerWasDown = false;
  private pressAimX = 0;

  constructor() {
    // Camera on +z, slight downward tilt for depth.
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    this.camera.position.set(0, -1.2, 20);
    this.camera.lookAt(0, 0.5, 0);
    applyAtmosphere(this.scene, 22, 70);
  }

  init(_env: GameEnv): void {
    addLightRig(this.scene, palette.magenta);
    // Tinted gradient sky so the neon sits in a volume, not a flat void.
    addGradientBackdrop(this.scene, accents.shatter);

    // Back plate for depth — a dim matte slab behind the action.
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(HALF_W * 2 + 2, TOP_Y - BOTTOM_Y + 2, 0.4),
      surface(palette.surface),
    );
    back.position.set(0, (TOP_Y + BOTTOM_Y) / 2, -1.2);
    this.scene.add(back);

    // Neon frame: left, right and top walls (bottom is open).
    const wallMat = neon(accents.shatter, 0.7);
    const sideH = TOP_Y - BOTTOM_Y + WALL_T;
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, sideH, 1), wallMat);
    leftWall.position.set(-HALF_W - WALL_T / 2, (TOP_Y + BOTTOM_Y) / 2, 0);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(WALL_T, sideH, 1), wallMat);
    rightWall.position.set(HALF_W + WALL_T / 2, (TOP_Y + BOTTOM_Y) / 2, 0);
    const topWall = new THREE.Mesh(
      new THREE.BoxGeometry(HALF_W * 2 + WALL_T * 2, WALL_T, 1),
      wallMat,
    );
    topWall.position.set(0, TOP_Y + WALL_T / 2, 0);
    this.scene.add(leftWall, rightWall, topWall);

    // Paddle: a glowing box that slides along the bottom.
    this.paddle = new THREE.Mesh(
      new THREE.BoxGeometry(PADDLE_HW * 2, PADDLE_HH * 2, 0.7),
      neon(accents.shatter, 1.1),
    );
    this.paddle.position.set(0, PADDLE_Y, 0);
    this.scene.add(this.paddle);

    // Ball: a small self-lit sphere so it always reads bright.
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), emissive(palette.ink));
    this.scene.add(this.ball);

    // Bricks: one shared geometry + one neon material per row colour. Plain
    // meshes (reused across walls) keep each brick reading in its own colour and
    // avoid the dense field blooming out to a solid white block.
    this.brickGeo = new THREE.BoxGeometry(BRICK_HW * 2, BRICK_HH * 2, 0.6);
    this.brickRowMats = ROW_COLORS.map((c) => neon(c, 0.45));
    for (let i = 0; i < ROWS * COLS; i++) {
      const m = new THREE.Mesh(this.brickGeo, this.brickRowMats[0]);
      m.visible = false;
      this.brickMeshes.push(m);
      this.scene.add(m);
    }

    // Shard particle pool: tiny self-lit cubes flung from a shattered brick.
    // Pure cosmetic, lives in frame(); material is recolored per-burst.
    this.shardGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    this.shardPool = new Pool<Shard>({
      create: () => {
        const mesh = new THREE.Mesh(this.shardGeo, emissive(palette.ink));
        mesh.visible = false;
        this.scene.add(mesh);
        return { mesh, vx: 0, vy: 0, life: 0, ttl: 1 };
      },
      onAcquire: (s) => (s.mesh.visible = true),
      onRelease: (s) => {
        s.mesh.visible = false;
        s.mesh.scale.setScalar(1);
      },
    });

    this.buildBricks();
    this.reset();
  }

  /** Lay out a fresh ROWS x COLS wall: position + show every brick mesh. */
  private buildBricks(): void {
    this.bricks.length = 0;
    const x0 = -FIELD_W / 2 + BRICK_W / 2;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = x0 + c * BRICK_W;
        const y = BRICK_TOP - r * ROW_PITCH;
        const i = r * COLS + c;
        this.bricks.push({ alive: true, x, y, row: r });
        const m = this.brickMeshes[i];
        m.material = this.brickRowMats[r];
        m.position.set(x, y, 0);
        m.visible = true;
      }
    }
    this.bricksLeft = ROWS * COLS;
  }

  reset(): void {
    this.score = 0;
    this.lives = START_LIVES;
    this.alive = true;
    this.shimmerT = 0;
    this.paddleX = 0;
    this.pointerWasDown = false;
    this.pressAimX = 0;
    // Retire any in-flight cosmetic shards from the prior run.
    if (this.shardPool) {
      for (const s of this.shards) this.shardPool.release(s);
      this.shards.length = 0;
      this.breakBursts.length = 0;
    }
    if (this.brickMeshes.length) this.buildBricks();
    this.resetBall();
  }

  /** Recentre the paddle and stick the ball to it, ready to launch upward. */
  private resetBall(): void {
    this.curSpeed = BALL_SPEED0;
    this.paddleX = 0;
    this.ballStuck = true;
    this.ballPos.set(this.paddleX, PADDLE_Y + PADDLE_HH + BALL_R + 0.05, 0);
    this.prevBallPos.copy(this.ballPos);
    // A slight initial sideways lean so the launch isn't a vertical stalemate.
    const lean = this.rng.range(-0.3, 0.3);
    this.ballVel.set(lean, 1, 0).normalize().multiplyScalar(this.curSpeed);
  }

  update(dt: number, env: GameEnv): void {
    if (!this.alive) return;
    this.prevBallPos.copy(this.ballPos);

    // --- Paddle control: pointer.nx maps directly to x when active, else
    // left/right nudge at a fixed speed. Both desktop keys and touch buttons
    // arrive as the same 'left'/'right' intents.
    const p = env.input.pointer;
    if (p.active && p.down) {
      this.paddleX = THREE.MathUtils.clamp(p.nx * HALF_W, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
    } else {
      if (env.input.isDown('left')) this.paddleX -= PADDLE_SPEED * dt;
      if (env.input.isDown('right')) this.paddleX += PADDLE_SPEED * dt;
      this.paddleX = THREE.MathUtils.clamp(this.paddleX, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
    }

    // --- Launch: while stuck the ball rides the paddle.
    //
    // Touch nuance: a pointer-down both grabs the paddle (aim) AND, via the
    // input layer, raises a 'fire'/'flap'/'confirm' edge on the very same frame.
    // If we launched on that edge a phone player could never reposition before
    // serving. So while the pointer is held we only AIM; the serve happens on
    // tap RELEASE (a quick tap with little aim movement). The keyboard /
    // on-screen-button / E2E path never sets pointer.down, so a fire edge with
    // pointer.down === false still launches immediately (the E2E depends on it).
    if (this.ballStuck) {
      this.ballPos.set(this.paddleX, PADDLE_Y + PADDLE_HH + BALL_R + 0.05, 0);

      const fireEdge =
        env.input.pressed('fire') ||
        env.input.pressed('flap') ||
        env.input.pressed('up') ||
        env.input.pressed('confirm');

      const pointerDown = p.down;
      let launch = false;

      if (fireEdge && !pointerDown) {
        // Keyboard / on-screen button / gamepad / E2E virtual fire.
        launch = true;
      } else if (this.pointerWasDown && !pointerDown) {
        // Tap release: serve if the paddle barely moved since press (a tap, not
        // a deliberate aim-drag), so dragging to aim never auto-serves.
        if (Math.abs(this.paddleX - this.pressAimX) < 0.6) launch = true;
      }

      if (pointerDown && !this.pointerWasDown) this.pressAimX = this.paddleX; // press start
      this.pointerWasDown = pointerDown;

      if (launch) {
        this.ballStuck = false;
        this.pointerWasDown = false;
        env.audio.play('bounce');
      }
      return;
    }
    this.pointerWasDown = p.down;

    // --- Integrate ball.
    this.ballPos.x += this.ballVel.x * dt;
    this.ballPos.y += this.ballVel.y * dt;

    // --- Walls (side + top). Reflect and clamp out of penetration.
    if (this.ballPos.x - BALL_R < -HALF_W) {
      this.ballPos.x = -HALF_W + BALL_R;
      this.ballVel.x = Math.abs(this.ballVel.x);
      env.audio.play('bounce');
    } else if (this.ballPos.x + BALL_R > HALF_W) {
      this.ballPos.x = HALF_W - BALL_R;
      this.ballVel.x = -Math.abs(this.ballVel.x);
      env.audio.play('bounce');
    }
    if (this.ballPos.y + BALL_R > TOP_Y) {
      this.ballPos.y = TOP_Y - BALL_R;
      this.ballVel.y = -Math.abs(this.ballVel.y);
      env.audio.play('bounce');
    }

    // --- Paddle: reflect only while descending and overlapping. Hit offset
    // from the paddle centre sets the outgoing horizontal angle (breakout feel).
    if (
      this.ballVel.y < 0 &&
      this.ballPos.y - BALL_R <= PADDLE_Y + PADDLE_HH &&
      this.ballPos.y >= PADDLE_Y - PADDLE_HH &&
      this.ballPos.x >= this.paddleX - PADDLE_HW - BALL_R &&
      this.ballPos.x <= this.paddleX + PADDLE_HW + BALL_R
    ) {
      this.ballPos.y = PADDLE_Y + PADDLE_HH + BALL_R;
      const offset = THREE.MathUtils.clamp((this.ballPos.x - this.paddleX) / PADDLE_HW, -1, 1);
      const angle = offset * MAX_BOUNCE_ANGLE; // 0 at centre, ±MAX at the edges
      this.ballVel.x = Math.sin(angle) * this.curSpeed;
      this.ballVel.y = Math.cos(angle) * this.curSpeed; // always upward
      env.audio.play('bounce');
    }

    // --- Bricks: AABB (expanded by ball radius) vs ball centre. Resolve on the
    // shallower axis so the reflection direction is correct.
    this.collideBricks(env);

    // --- Bottom: lost ball.
    if (this.ballPos.y - BALL_R < BOTTOM_Y) {
      this.loseLife(env);
      return;
    }
  }

  /** Test the ball against alive bricks; break the first hit and reflect. */
  private collideBricks(env: GameEnv): void {
    for (let i = 0; i < this.bricks.length; i++) {
      const b = this.bricks[i];
      if (!b.alive) continue;
      const dx = this.ballPos.x - b.x;
      const dy = this.ballPos.y - b.y;
      const overlapX = BRICK_HW + BALL_R - Math.abs(dx);
      const overlapY = BRICK_HH + BALL_R - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue; // no collision

      // Break the brick.
      b.alive = false;
      this.bricksLeft--;
      this.brickMeshes[i].visible = false;

      this.score += ROW_POINTS[b.row];
      env.setScore(this.score);
      env.audio.play('break');

      // Juice: a small camera tick + a shard burst in this brick's row colour.
      // The shake self-guards on reducedMotion; particles are spawned in frame()
      // and gated there, so we only record where the break happened.
      env.shake(0.1);
      this.breakBursts.push({ x: b.x, y: b.y, row: b.row });

      // Reflect off the shallower penetration axis.
      if (overlapX < overlapY) {
        this.ballVel.x = dx > 0 ? Math.abs(this.ballVel.x) : -Math.abs(this.ballVel.x);
        this.ballPos.x += dx > 0 ? overlapX : -overlapX;
      } else {
        this.ballVel.y = dy > 0 ? Math.abs(this.ballVel.y) : -Math.abs(this.ballVel.y);
        this.ballPos.y += dy > 0 ? overlapY : -overlapY;
      }

      // Speed up a touch, renormalize to keep magnitude controlled.
      this.curSpeed = Math.min(BALL_SPEED_MAX, this.curSpeed + BALL_SPEED_GROWTH);
      const len = Math.hypot(this.ballVel.x, this.ballVel.y) || 1;
      this.ballVel.x = (this.ballVel.x / len) * this.curSpeed;
      this.ballVel.y = (this.ballVel.y / len) * this.curSpeed;

      // Endless: clear the wall, respawn a fresh one and keep the ball going.
      if (this.bricksLeft <= 0) {
        this.buildBricks();
        env.audio.play('powerup');
      }
      return; // one brick per step keeps reflections clean
    }
  }

  /** Lose a life; reset ball + paddle, or end the run at zero. */
  private loseLife(env: GameEnv): void {
    this.lives--;
    env.audio.play('crash');
    env.shake(0.25); // solid jolt on a dropped ball (no-op under reducedMotion)
    if (this.lives <= 0) {
      this.alive = false;
      env.gameOver();
      return;
    }
    this.resetBall();
  }

  frame(alpha: number, env: GameEnv): void {
    // Smooth the ball between fixed steps.
    if (this.ballStuck) {
      this.ball.position.set(this.paddleX, PADDLE_Y + PADDLE_HH + BALL_R + 0.05, 0);
    } else {
      this.ball.position.lerpVectors(this.prevBallPos, this.ballPos, alpha);
    }
    // Paddle follows immediately (it's already deterministic per step).
    this.paddle.position.x = this.paddleX;

    // Subtle brick shimmer via a gentle emissive pulse on the per-row materials.
    // Driven by real elapsed time so the pulse rate is frame-rate independent.
    this.shimmerT += env.dt;
    const pulse = 0.45 + Math.sin(this.shimmerT * 2.2) * 0.1;
    for (const m of this.brickRowMats) m.emissiveIntensity = pulse;

    // Cosmetic shard bursts (visual only — ordinary randomness is fine here).
    // Spawning is suppressed under reducedMotion; queued breaks are discarded so
    // they don't pile up. Live shards still need to animate/clear.
    if (env.reducedMotion) {
      this.breakBursts.length = 0;
    } else {
      for (const b of this.breakBursts) this.spawnBurst(b.x, b.y, ROW_COLORS[b.row]);
      this.breakBursts.length = 0;
    }
    this.updateShards(env.dt);
  }

  /** Fling ~6 colored shards out of a broken brick. Pooled; faded by life. */
  private spawnBurst(x: number, y: number, color: number): void {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const s = this.shardPool.acquire();
      const ang = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 3;
      s.vx = Math.cos(ang) * spd;
      s.vy = Math.sin(ang) * spd + 1.5; // bias upward
      s.ttl = 0.45 + Math.random() * 0.25;
      s.life = s.ttl;
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      s.mesh.position.set(x, y, 0.4);
      s.mesh.scale.setScalar(1);
      this.shards.push(s);
    }
  }

  /** Integrate + fade live shards; release the dead ones back to the pool. */
  private updateShards(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const s = this.shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shardPool.release(s);
        this.shards.splice(i, 1);
        continue;
      }
      s.vy -= 9 * dt; // gentle gravity for a settling arc
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      const t = s.life / s.ttl; // 1 -> 0
      s.mesh.scale.setScalar(0.2 + t * 0.8);
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // Pull the camera back on portrait phones so the whole frame stays visible.
    const portrait = height > width;
    if (portrait) {
      // The taller the viewport, the further back we need to be to fit width.
      const fit = HALF_W / (Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect);
      this.camera.position.z = Math.max(20, fit + 4);
    } else {
      this.camera.position.z = 20;
    }
    this.camera.updateProjectionMatrix();
  }

  getScore(): number {
    return this.score;
  }

  dispose(): void {
    // Frees geometry AND materials AND textures, then clears the scene. The
    // shared brickGeo / shardGeo are reachable via their meshes in the scene
    // graph, so disposeScene covers them too (no manual geo.dispose needed).
    disposeScene(this.scene);
  }
}

const factory: GameFactory = () => new Shatter();
export default factory;
