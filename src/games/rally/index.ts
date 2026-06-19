import * as THREE from 'three';
import type { Game, GameEnv, GameFactory } from '../../engine/types';
import { neon, surface, emissive } from '../../art/materials';
import { addLightRig, applyAtmosphere, addGradientBackdrop } from '../../art/lighting';
import { accents, palette } from '../../art/tokens';
import { Rng } from '../../engine/rng';
import { Pool } from '../../engine/pool';
import { disposeScene } from '../../engine/dispose';

/**
 * RALLY — 3D Pong on a vertical court. The ball travels mostly up/down; the
 * player's neon paddle slides HORIZONTALLY along the bottom (same control
 * language as Shatter), the AI paddle defends the top. Left/right walls bounce;
 * top/bottom are goal lines. Score by getting the ball past the AI; miss when it
 * gets past you. Five misses ends the run.
 */

// Court geometry, all in world units, in the X-Y plane (camera looks down -z).
const HALF_W = 4.6; // playfield half-width (left/right wall inner faces)
const HALF_H = 7.0; // playfield half-height (top/bottom goal lines)
const WALL_T = 0.4; // wall thickness
const PADDLE_HW = 1.15; // paddle half-width in x
const PADDLE_HH = 0.28; // paddle half-height in y
const PADDLE_Y = HALF_H - 0.9; // distance of each paddle from centre (player at -, ai at +)
const BALL_R = 0.34;

const BASE_SPEED = 9.0; // ball launch speed (units/s)
const MAX_SPEED = 18.0; // ball speed cap
const SPEED_GAIN = 0.45; // speed added per paddle volley
const PADDLE_SPEED = 16.0; // player keyboard slide speed (units/s)
const AI_SPEED = 7.6; // AI paddle cap — deliberately below ball so it's beatable
const AI_DEADZONE = 0.35; // AI ignores x-error smaller than this (gives the player gaps)
const SPIN_FACTOR = 0.42; // how much paddle motion nudges the ball's vx
const MAX_MISSES = 5;

/** A short-lived cosmetic spark (visual only — never simulation). */
interface Spark {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

class Rally implements Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private rng = new Rng(0x5a11ee);

  // --- Test-readable simulation state -----------------------------------
  /** Ball centre, world units (z stays 0). */
  ball = new THREE.Vector2(0, 0);
  /** Ball velocity, units/s. */
  ballVel = new THREE.Vector2(0, 0);
  /** Player paddle centre x (y is fixed at -PADDLE_Y). */
  playerX = 0;
  /** AI paddle centre x (y is fixed at +PADDLE_Y). */
  aiX = 0;
  /** Paddle half-width / ball radius / court bounds, for autopilots. */
  readonly paddleHalfWidth = PADDLE_HW;
  readonly ballRadius = BALL_R;
  readonly courtHalfWidth = HALF_W;
  readonly courtHalfHeight = HALF_H;
  readonly playerY = -PADDLE_Y;
  readonly aiY = PADDLE_Y;

  private score = 0;
  private misses = 0;
  private alive = true;

  // --- Visual smoothing (frame-only) ------------------------------------
  private prevBall = new THREE.Vector2(0, 0);
  private prevPlayerX = 0;
  private prevAiX = 0;
  private playerVelSmoothed = 0; // recent player x-motion, for spin feel
  private serveDelay = 0; // brief freeze after a point, sim-stepped
  private glowT = 0;

  // --- Juice (frame-only, never simulation) -----------------------------
  /** Per-paddle scale-pop trauma [0..1], decays each frame. */
  private playerPop = 0;
  private aiPop = 0;
  /** Pending visual events raised by update(), consumed/spawned in frame(). */
  private fxQueue: { x: number; y: number; color: number; count: number }[] = [];
  private sparks: Spark[] = [];
  private sparkPool!: Pool<Spark>;

  // --- Meshes -----------------------------------------------------------
  private ballMesh!: THREE.Mesh;
  private playerMesh!: THREE.Mesh;
  private aiMesh!: THREE.Mesh;
  private playerMat!: THREE.MeshStandardMaterial;
  private aiMat!: THREE.MeshStandardMaterial;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
    this.camera.position.set(0, -1.2, 14.5);
    this.camera.lookAt(0, 0, 0);
    applyAtmosphere(this.scene, 18, 80);
  }

  init(_env: GameEnv): void {
    addLightRig(this.scene, palette.violet);
    addGradientBackdrop(this.scene, accents.rally);

    // Court floor slab for depth.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(HALF_W * 2 + WALL_T * 2, HALF_H * 2, 0.6),
      surface(palette.surface),
    );
    floor.position.set(0, 0, -1.2);
    this.scene.add(floor);

    // Left / right neon side walls (the bouncy ones).
    const wallMat = neon(palette.violet, 0.55);
    const wallGeo = new THREE.BoxGeometry(WALL_T, HALF_H * 2 + WALL_T, 1.0);
    const left = new THREE.Mesh(wallGeo, wallMat);
    left.position.set(-(HALF_W + WALL_T / 2), 0, 0);
    const right = new THREE.Mesh(wallGeo, wallMat);
    right.position.set(HALF_W + WALL_T / 2, 0, 0);
    this.scene.add(left, right);

    // Dashed centre line for depth/orientation.
    const dashMat = emissive(accents.rally);
    const dashGeo = new THREE.BoxGeometry(HALF_W * 1.7, 0.06, 0.05);
    const dashes = 9;
    for (let i = 0; i < dashes; i++) {
      // Horizontal dashes stacked vertically would read as a ladder; instead a
      // single thin mid-court bar plus tick marks gives a clean tennis-net look.
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.34, 0.05),
        dashMat,
      );
      tick.position.set(-HALF_W * 0.85 + (i / (dashes - 1)) * HALF_W * 1.7, 0, 0.05);
      this.scene.add(tick);
    }
    const netBar = new THREE.Mesh(dashGeo, dashMat);
    netBar.position.set(0, 0, 0.04);
    this.scene.add(netBar);

    // Goal-line glow strips behind each paddle (player = accent, ai = magenta).
    const goalGeo = new THREE.BoxGeometry(HALF_W * 2, 0.08, 0.05);
    const playerGoal = new THREE.Mesh(goalGeo, emissive(accents.rally));
    playerGoal.position.set(0, -HALF_H + 0.1, 0.05);
    const aiGoal = new THREE.Mesh(goalGeo, emissive(palette.magenta));
    aiGoal.position.set(0, HALF_H - 0.1, 0.05);
    this.scene.add(playerGoal, aiGoal);

    // Ball.
    this.ballMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(BALL_R, 0),
      neon(palette.ink, 1.2),
    );
    this.scene.add(this.ballMesh);

    // Paddles.
    const paddleGeo = new THREE.BoxGeometry(PADDLE_HW * 2, PADDLE_HH * 2, 0.8);
    this.playerMat = neon(accents.rally, 0.9);
    this.aiMat = neon(palette.magenta, 0.9);
    this.playerMesh = new THREE.Mesh(paddleGeo, this.playerMat);
    this.aiMesh = new THREE.Mesh(paddleGeo, this.aiMat);
    this.playerMesh.position.y = -PADDLE_Y;
    this.aiMesh.position.y = PADDLE_Y;
    this.scene.add(this.playerMesh, this.aiMesh);

    // Pooled cosmetic sparks (visual only — recycled, never allocated mid-rally).
    const sparkGeo = new THREE.IcosahedronGeometry(0.12, 0);
    this.sparkPool = new Pool<Spark>({
      create: () => {
        const mat = new THREE.MeshBasicMaterial({ color: palette.ink, transparent: true });
        const mesh = new THREE.Mesh(sparkGeo, mat);
        mesh.visible = false;
        this.scene.add(mesh);
        return { mesh, mat, vx: 0, vy: 0, life: 0, maxLife: 0 };
      },
      onAcquire: (s) => (s.mesh.visible = true),
      onRelease: (s) => (s.mesh.visible = false),
      prefill: 12,
    });
  }

  reset(): void {
    this.score = 0;
    this.misses = 0;
    this.alive = true;
    this.playerX = 0;
    this.aiX = 0;
    this.prevPlayerX = 0;
    this.prevAiX = 0;
    this.playerVelSmoothed = 0;
    this.serveDelay = 0;
    // Clear any in-flight juice so a restart starts visually clean.
    this.playerPop = 0;
    this.aiPop = 0;
    this.fxQueue.length = 0;
    for (const s of this.sparks) this.sparkPool.release(s);
    this.sparks.length = 0;
    this.serve(this.rng.next() < 0.5 ? -1 : 1);
    // Place meshes immediately so the first rendered frame is correct.
    this.syncMeshes();
  }

  /** Launch the ball from centre toward dir (-1 down/player, +1 up/ai). */
  private serve(dir: number): void {
    this.ball.set(0, 0);
    this.prevBall.set(0, 0);
    // Random shallow angle so the serve is never dead-vertical.
    const angle = this.rng.range(-0.5, 0.5); // radians off vertical
    const vy = Math.cos(angle) * BASE_SPEED * dir;
    const vx = Math.sin(angle) * BASE_SPEED;
    this.ballVel.set(vx, vy);
    this.serveDelay = 0.6; // ~36 fixed steps of anticipation
  }

  update(dt: number, env: GameEnv): void {
    if (!this.alive) return;

    this.glowT += dt;
    this.prevBall.copy(this.ball);
    this.prevPlayerX = this.playerX;
    this.prevAiX = this.aiX;

    // --- Player paddle: pointer.nx OR left/right keys ------------------
    const input = env.input;
    const maxX = HALF_W - PADDLE_HW;
    const beforeX = this.playerX;
    if (input.pointer.active && input.pointer.down) {
      // Map normalized pointer x [-1,1] straight onto the playable span.
      this.playerX = THREE.MathUtils.clamp(input.pointer.nx * maxX, -maxX, maxX);
    } else {
      let dir = 0;
      if (input.isDown('left')) dir -= 1;
      if (input.isDown('right')) dir += 1;
      this.playerX = THREE.MathUtils.clamp(
        this.playerX + dir * PADDLE_SPEED * dt,
        -maxX,
        maxX,
      );
    }
    // Track recent player motion (smoothed) to drive ball spin on contact.
    const instantVel = (this.playerX - beforeX) / dt;
    this.playerVelSmoothed += (instantVel - this.playerVelSmoothed) * 0.4;

    // --- AI paddle: capped tracking with a reaction deadzone -----------
    const err = this.ball.x - this.aiX;
    if (Math.abs(err) > AI_DEADZONE) {
      const step = THREE.MathUtils.clamp(err, -AI_SPEED * dt, AI_SPEED * dt);
      this.aiX = THREE.MathUtils.clamp(this.aiX + step, -maxX, maxX);
    }

    // Hold the ball at centre during the post-point anticipation beat.
    if (this.serveDelay > 0) {
      this.serveDelay -= dt;
      this.syncMeshes();
      return;
    }

    // --- Ball integration ---------------------------------------------
    this.ball.x += this.ballVel.x * dt;
    this.ball.y += this.ballVel.y * dt;

    // Side-wall bounces (reflect vx, clamp inside).
    if (this.ball.x - BALL_R < -HALF_W) {
      this.ball.x = -HALF_W + BALL_R;
      this.ballVel.x = Math.abs(this.ballVel.x);
      env.audio.play('bounce');
    } else if (this.ball.x + BALL_R > HALF_W) {
      this.ball.x = HALF_W - BALL_R;
      this.ballVel.x = -Math.abs(this.ballVel.x);
      env.audio.play('bounce');
    }

    // Paddle collisions. Only test the paddle the ball is heading toward.
    if (this.ballVel.y < 0) {
      this.tryPaddleHit(this.playerX, -PADDLE_Y, +1, this.playerVelSmoothed, env);
    } else {
      // AI paddle has no meaningful velocity-spin; pass 0.
      this.tryPaddleHit(this.aiX, PADDLE_Y, -1, 0, env);
    }

    // Goals. Past the top -> player scores; past the bottom -> player miss.
    if (this.ball.y > HALF_H + BALL_R) {
      this.score += 1;
      env.setScore(this.score);
      env.audio.play('score');
      // Juice: violet burst near the top goal on a player point.
      env.shake(0.12);
      this.fxQueue.push({ x: this.ball.x, y: HALF_H - 0.1, color: palette.violet, count: 10 });
      this.serve(-1); // next serve goes down toward the player
    } else if (this.ball.y < -HALF_H - BALL_R) {
      this.misses += 1;
      env.audio.play('crash');
      // Juice: magenta burst near the bottom goal on a miss.
      env.shake(0.22);
      this.fxQueue.push({ x: this.ball.x, y: -HALF_H + 0.1, color: palette.magenta, count: 10 });
      if (this.misses >= MAX_MISSES) {
        this.alive = false;
        this.syncMeshes();
        env.gameOver();
        return;
      }
      this.serve(1); // next serve goes up toward the AI
    }

    this.syncMeshes();
  }

  /**
   * Reflect the ball off a paddle if it's overlapping. `normalY` is +1 for the
   * bottom (player) paddle, -1 for the top (AI). `paddleVel` adds spin.
   */
  private tryPaddleHit(
    px: number,
    py: number,
    normalY: number,
    paddleVel: number,
    env: GameEnv,
  ): void {
    // Y overlap test against the paddle face.
    const faceY = py + normalY * (PADDLE_HH + BALL_R);
    const crossing =
      normalY > 0 ? this.ball.y <= faceY : this.ball.y >= faceY;
    if (!crossing) return;
    // Within the paddle's horizontal span (plus ball radius for a forgiving edge)?
    if (Math.abs(this.ball.x - px) > PADDLE_HW + BALL_R * 0.6) return;

    // Reflect vy outward and nudge the ball clear of the face.
    this.ball.y = faceY;
    this.ballVel.y = normalY * Math.abs(this.ballVel.y);

    // Angle control: where on the paddle it hit deflects vx (classic Pong).
    const offset = THREE.MathUtils.clamp((this.ball.x - px) / PADDLE_HW, -1, 1);
    // Spin: paddle's own motion adds english.
    this.ballVel.x += offset * 2.6 + paddleVel * SPIN_FACTOR;

    // Speed up each volley, then renormalize to keep direction but cap speed.
    const speed = Math.min(this.ballVel.length() + SPEED_GAIN, MAX_SPEED);
    this.ballVel.setLength(speed);

    // Guarantee a minimum vertical component so rallies never stall sideways.
    const minVy = speed * 0.45;
    if (Math.abs(this.ballVel.y) < minVy) {
      this.ballVel.y = normalY * minVy;
      this.ballVel.setLength(speed);
    }

    env.audio.play('bounce');

    // --- Juice (no sim effect) ----------------------------------------
    env.shake(0.06);
    const contactColor = normalY > 0 ? accents.rally : palette.magenta;
    if (normalY > 0) this.playerPop = 1;
    else this.aiPop = 1;
    this.fxQueue.push({ x: this.ball.x, y: faceY, color: contactColor, count: 6 });
  }

  /** Push simulation state onto meshes (called at end of each step). */
  private syncMeshes(): void {
    this.ballMesh.position.set(this.ball.x, this.ball.y, 0);
    this.playerMesh.position.x = this.playerX;
    this.aiMesh.position.x = this.aiX;
  }

  frame(alpha: number, env: GameEnv): void {
    const dt = env.dt;

    // Interpolate the ball between fixed steps for buttery motion.
    const bx = this.prevBall.x + (this.ball.x - this.prevBall.x) * alpha;
    const by = this.prevBall.y + (this.ball.y - this.prevBall.y) * alpha;
    this.ballMesh.position.set(bx, by, 0);
    // Frame-rate-independent cosmetic spin (was hardcoded 0.04 / 0.05 per frame).
    this.ballMesh.rotation.x += dt * 2.4;
    this.ballMesh.rotation.y += dt * 3.0;

    this.playerMesh.position.x =
      this.prevPlayerX + (this.playerX - this.prevPlayerX) * alpha;
    this.aiMesh.position.x = this.prevAiX + (this.aiX - this.prevAiX) * alpha;

    // Paddle scale-pop on contact, decaying to rest over ~0.18s.
    this.playerPop = Math.max(0, this.playerPop - dt * 5.5);
    this.aiPop = Math.max(0, this.aiPop - dt * 5.5);
    this.playerMesh.scale.set(1 + this.playerPop * 0.18, 1 + this.playerPop * 0.4, 1);
    this.aiMesh.scale.set(1 + this.aiPop * 0.18, 1 + this.aiPop * 0.4, 1);

    // Subtle synchronized paddle glow pulse.
    const pulse = 0.9 + Math.sin(this.glowT * 4) * 0.18;
    this.playerMat.emissiveIntensity = pulse;
    this.aiMat.emissiveIntensity = pulse;

    // --- Cosmetic particles (visual only; ordinary randomness is fine here) ---
    // Spawn any queued bursts unless reduced motion is requested.
    if (this.fxQueue.length) {
      if (!env.reducedMotion) {
        for (const fx of this.fxQueue) this.spawnBurst(fx.x, fx.y, fx.color, fx.count);
      }
      this.fxQueue.length = 0;
    }
    // Integrate + fade live sparks, releasing the dead ones back to the pool.
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparkPool.release(s);
        this.sparks.splice(i, 1);
        continue;
      }
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      const t = s.life / s.maxLife;
      s.mat.opacity = t;
      s.mesh.scale.setScalar(0.4 + t * 0.6);
    }
  }

  /** Spawn a small pooled spark burst (frame-only; never simulation). */
  private spawnBurst(x: number, y: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.sparkPool.acquire();
      const a = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      s.vx = Math.cos(a) * speed;
      s.vy = Math.sin(a) * speed;
      s.maxLife = 0.32 + Math.random() * 0.18;
      s.life = s.maxLife;
      s.mat.color.setHex(color);
      s.mat.opacity = 1;
      s.mesh.position.set(x, y, 0.1);
      s.mesh.scale.setScalar(1);
      this.sparks.push(s);
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // The court is tall, so portrait phones need the camera pulled back to keep
    // both goal lines in frame.
    const portrait = height > width;
    this.camera.position.z = portrait ? 18.5 : 14.5;
    this.camera.position.y = portrait ? -0.6 : -1.2;
    this.camera.updateProjectionMatrix();
  }

  getScore(): number {
    return this.score;
  }

  dispose(): void {
    disposeScene(this.scene);
  }
}

const factory: GameFactory = () => new Rally();
export default factory;
