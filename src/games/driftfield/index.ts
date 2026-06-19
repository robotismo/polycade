import * as THREE from 'three';
import type { Game, GameEnv, GameFactory } from '../../engine/types';
import { neon, surface, emissive } from '../../art/materials';
import { addLightRig, applyAtmosphere } from '../../art/lighting';
import { accents, palette } from '../../art/tokens';
import { Pool } from '../../engine/pool';
import { Rng } from '../../engine/rng';

// --- Field bounds (the X-Y plane). Objects wrap toroidally at the edges. -----
const BOUND_X = 12;
const BOUND_Y = 7;
const WORLD_W = BOUND_X * 2; // full width  (for wrapping)
const WORLD_H = BOUND_Y * 2; // full height

// --- Ship tuning -------------------------------------------------------------
const SHIP_R = 0.55; // collision radius
const TURN_RATE = 3.4; // rad/s
const THRUST = 14; // accel along facing (units/s^2)
const DRAG = 0.6; // velocity retained-per-second coefficient => gentle coast
const MAX_SPEED = 11;
const FIRE_COOLDOWN = 0.18; // min seconds between shots
const RESPAWN_TIME = 1.3; // post-death invulnerable settle (seconds)
const START_LIVES = 3;

// --- Bullets -----------------------------------------------------------------
const BULLET_SPEED = 16;
const BULLET_LIFE = 0.9; // seconds before expiry
const BULLET_R = 0.18;
const MAX_BULLETS = 24;

// --- Asteroids ---------------------------------------------------------------
// Per-tier: collision radius, base mesh scale, points, child count/tier.
type Tier = 'large' | 'medium' | 'small';
const ROCK: Record<Tier, { r: number; scale: number; score: number; speed: number }> = {
  large: { r: 1.7, scale: 1.7, score: 20, speed: 1.6 },
  medium: { r: 1.0, scale: 1.0, score: 50, speed: 2.4 },
  small: { r: 0.55, scale: 0.55, score: 100, speed: 3.4 },
};
const CHILD: Record<Tier, Tier | null> = { large: 'medium', medium: 'small', small: null };
const START_WAVE_ROCKS = 4; // large asteroids in wave 1
const MAX_ASTEROIDS = 64;

interface Bullet {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  px: number; // previous-step x for interpolation
  py: number;
  vx: number;
  vy: number;
  life: number;
  alive: boolean;
}

interface Asteroid {
  mesh: THREE.Mesh;
  tier: Tier;
  r: number; // collision radius
  x: number;
  y: number;
  px: number; // previous-step position for interpolation
  py: number;
  vx: number;
  vy: number;
  spin: number; // rad/s
  rot: number; // current visual rotation
  alive: boolean;
}

/** DRIFTFIELD — 3D Asteroids in a bounded, wrapping neon field. */
class Driftfield implements Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;

  private rng = new Rng(0xd217f1e1);

  // --- Ship state (read by the test driver) ---------------------------------
  /** Ship position in field units; +x right, +y up. */
  ship = new THREE.Vector2(0, 0);
  /** Ship velocity in units/s. */
  shipVel = new THREE.Vector2(0, 0);
  /** Facing angle in radians; 0 = pointing +y (up), increases CCW. */
  shipAngle = 0;
  private shipPrev = new THREE.Vector2(0, 0);
  private shipAnglePrev = 0;
  private shipGroup = new THREE.Group();
  private flame!: THREE.Mesh;

  /** Live asteroids. Driver reads .x/.y/.r/.tier. */
  asteroids: Asteroid[] = [];
  /** Live bullets. Driver reads .x/.y. */
  bullets: Bullet[] = [];

  /** Field half-extents (read by driver to plan wrapping/aim). */
  readonly bounds = { x: BOUND_X, y: BOUND_Y };

  /** Remaining lives (starts at START_LIVES). */
  lives = START_LIVES;
  /** Current wave number (1-based). */
  wave = 1;

  private score = 0;
  private alive = true; // game-over guard (mirrors the reference)
  private fireTimer = 0; // dt-accumulated fire cooldown
  private respawnTimer = 0; // >0 => ship is settling / invulnerable
  private thrusting = false; // for flame visual

  private pool!: Pool<Asteroid>;
  private bulletPool!: Pool<Bullet>;
  private rockGeo!: THREE.IcosahedronGeometry;
  private stars!: THREE.Points;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
    // Look down from +z with a slight tilt so the field reads top-down with depth.
    this.camera.position.set(0, -2.5, 18);
    this.camera.lookAt(0, 0, 0);
    applyAtmosphere(this.scene, 20, 80);
  }

  init(_env: GameEnv): void {
    addLightRig(this.scene, accents.driftfield);

    // --- Ship: a low-poly arrowhead (cone) in neon yellow + a thrust flame ----
    const hullGeo = new THREE.ConeGeometry(0.55, 1.5, 3); // 3-sided => triangle prism
    const hull = new THREE.Mesh(hullGeo, neon(accents.driftfield, 1.1));
    hull.rotation.x = Math.PI / 2; // lay the cone flat, tip pointing +y
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), emissive(palette.ink));
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 3), emissive(palette.magenta));
    this.flame.rotation.x = -Math.PI / 2; // point -y (out the back)
    this.flame.position.y = -0.95;
    this.flame.visible = false;
    this.shipGroup.add(hull, core, this.flame);
    this.scene.add(this.shipGroup);

    // --- Field border frame (a thin neon rectangle around the bounds) ---------
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-BOUND_X, -BOUND_Y, 0),
        new THREE.Vector3(BOUND_X, -BOUND_Y, 0),
        new THREE.Vector3(BOUND_X, BOUND_Y, 0),
        new THREE.Vector3(-BOUND_X, BOUND_Y, 0),
      ]),
      new THREE.LineBasicMaterial({ color: palette.violet, transparent: true, opacity: 0.5 }),
    );
    border.position.z = -0.5;
    this.scene.add(border);

    // --- Faint backdrop slab so the field has a floor of depth ----------------
    const slab = new THREE.Mesh(new THREE.BoxGeometry(WORLD_W + 4, WORLD_H + 4, 0.5), surface(palette.surface));
    slab.position.z = -2.5;
    this.scene.add(slab);

    // --- Parallax starfield ---------------------------------------------------
    const count = 160;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = this.rng.range(-BOUND_X - 6, BOUND_X + 6);
      positions[i * 3 + 1] = this.rng.range(-BOUND_Y - 6, BOUND_Y + 6);
      positions[i * 3 + 2] = this.rng.range(-22, -4);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: palette.muted, size: 0.12, sizeAttenuation: true }),
    );
    this.scene.add(this.stars);

    // --- Shared rock geometry; per-asteroid scale jitters it ------------------
    this.rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = neon(accents.driftfield, 0.7);
    this.pool = new Pool<Asteroid>({
      create: () => {
        const mesh = new THREE.Mesh(this.rockGeo, rockMat);
        this.scene.add(mesh);
        return {
          mesh,
          tier: 'large',
          r: ROCK.large.r,
          x: 0,
          y: 0,
          px: 0,
          py: 0,
          vx: 0,
          vy: 0,
          spin: 0,
          rot: 0,
          alive: false,
        };
      },
      onAcquire: (a) => (a.mesh.visible = true),
      onRelease: (a) => (a.mesh.visible = false),
    });

    // --- Bullet pool ----------------------------------------------------------
    const bulletGeo = new THREE.SphereGeometry(BULLET_R, 6, 4);
    const bulletMat = emissive(palette.cyan);
    this.bulletPool = new Pool<Bullet>({
      create: () => {
        const mesh = new THREE.Mesh(bulletGeo, bulletMat);
        this.scene.add(mesh);
        return { mesh, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0, alive: false };
      },
      onAcquire: (b) => (b.mesh.visible = true),
      onRelease: (b) => (b.mesh.visible = false),
    });
  }

  reset(): void {
    // Recycle every live object back to its pool.
    for (const a of this.asteroids) this.pool.release(a);
    for (const b of this.bullets) this.bulletPool.release(b);
    this.asteroids.length = 0;
    this.bullets.length = 0;

    this.ship.set(0, 0);
    this.shipPrev.set(0, 0);
    this.shipVel.set(0, 0);
    this.shipAngle = 0;
    this.shipAnglePrev = 0;
    this.shipGroup.position.set(0, 0, 0);
    this.shipGroup.rotation.z = 0;

    this.lives = START_LIVES;
    this.wave = 1;
    this.score = 0;
    this.alive = true;
    this.fireTimer = 0;
    this.respawnTimer = 0;
    this.thrusting = false;
    this.flame.visible = false;

    this.spawnWave(this.wave);
  }

  /** Seed a wave of large asteroids around the edges, away from the ship. */
  private spawnWave(wave: number): void {
    const n = START_WAVE_ROCKS + (wave - 1); // grows each wave
    for (let i = 0; i < n; i++) {
      // Spawn on the perimeter so nothing lands on the centered ship.
      const onTop = this.rng.next() < 0.5;
      const x = onTop ? this.rng.range(-BOUND_X, BOUND_X) : this.rng.pick([-BOUND_X, BOUND_X]);
      const y = onTop ? this.rng.pick([-BOUND_Y, BOUND_Y]) : this.rng.range(-BOUND_Y, BOUND_Y);
      this.spawnAsteroid('large', x, y);
    }
  }

  private spawnAsteroid(tier: Tier, x: number, y: number): void {
    if (this.asteroids.length >= MAX_ASTEROIDS) return;
    const spec = ROCK[tier];
    const a = this.pool.acquire();
    a.tier = tier;
    a.r = spec.r;
    a.x = x;
    a.y = y;
    a.px = x;
    a.py = y;
    // Random drift direction, tier-scaled speed.
    const dir = this.rng.range(0, Math.PI * 2);
    const sp = spec.speed * this.rng.range(0.6, 1.2);
    a.vx = Math.cos(dir) * sp;
    a.vy = Math.sin(dir) * sp;
    a.spin = this.rng.range(-1.4, 1.4);
    a.rot = this.rng.range(0, Math.PI * 2);
    a.alive = true;
    // Jitter the mesh scale a touch so no two rocks look identical.
    const s = spec.scale * this.rng.range(0.82, 1.12);
    a.mesh.scale.set(s, s * this.rng.range(0.85, 1.1), s * this.rng.range(0.85, 1.1));
    a.mesh.position.set(x, y, 0);
    a.mesh.rotation.set(a.rot, a.rot * 0.7, 0);
    this.asteroids.push(a);
  }

  private fire(env: GameEnv): void {
    if (this.fireTimer > 0 || this.bullets.length >= MAX_BULLETS) return;
    this.fireTimer = FIRE_COOLDOWN;
    const b = this.bulletPool.acquire();
    // Muzzle at the ship nose (angle 0 => +y), velocity = ship vel + shot vel.
    const dx = -Math.sin(this.shipAngle);
    const dy = Math.cos(this.shipAngle);
    b.x = this.ship.x + dx * SHIP_R;
    b.y = this.ship.y + dy * SHIP_R;
    b.px = b.x;
    b.py = b.y;
    b.vx = this.shipVel.x + dx * BULLET_SPEED;
    b.vy = this.shipVel.y + dy * BULLET_SPEED;
    b.life = BULLET_LIFE;
    b.alive = true;
    b.mesh.position.set(b.x, b.y, 0);
    this.bullets.push(b);
    env.audio.play('shoot');
  }

  /** Wrap a coordinate toroidally into [-half, half). */
  private static wrap(v: number, half: number): number {
    const full = half * 2;
    if (v > half) return v - full;
    if (v < -half) return v + full;
    return v;
  }

  update(dt: number, env: GameEnv): void {
    if (!this.alive) return;
    const input = env.input;

    // --- Snapshot previous-step state for frame() interpolation -------------
    this.shipPrev.copy(this.ship);
    this.shipAnglePrev = this.shipAngle;
    for (const a of this.asteroids) {
      a.px = a.x;
      a.py = a.y;
    }
    for (const b of this.bullets) {
      b.px = b.x;
      b.py = b.y;
    }

    if (this.fireTimer > 0) this.fireTimer = Math.max(0, this.fireTimer - dt);

    // --- Respawn settle: ship is invulnerable but still controllable --------
    if (this.respawnTimer > 0) this.respawnTimer = Math.max(0, this.respawnTimer - dt);

    // --- Rotate ---------------------------------------------------------------
    if (input.isDown('left')) this.shipAngle += TURN_RATE * dt;
    if (input.isDown('right')) this.shipAngle -= TURN_RATE * dt;

    // --- Thrust (along facing) + gentle drag so it coasts ---------------------
    this.thrusting = input.isDown('thrust');
    if (this.thrusting) {
      const dx = -Math.sin(this.shipAngle);
      const dy = Math.cos(this.shipAngle);
      this.shipVel.x += dx * THRUST * dt;
      this.shipVel.y += dy * THRUST * dt;
    }
    // Exponential drag: framerate-independent coast.
    const dragK = Math.pow(DRAG, dt);
    this.shipVel.multiplyScalar(dragK);
    const sp = this.shipVel.length();
    if (sp > MAX_SPEED) this.shipVel.multiplyScalar(MAX_SPEED / sp);

    // --- Integrate + wrap the ship -------------------------------------------
    this.ship.x = Driftfield.wrap(this.ship.x + this.shipVel.x * dt, BOUND_X);
    this.ship.y = Driftfield.wrap(this.ship.y + this.shipVel.y * dt, BOUND_Y);
    // Avoid a teleport-glitch in interpolation when we wrap.
    if (Math.abs(this.ship.x - this.shipPrev.x) > BOUND_X) this.shipPrev.x = this.ship.x;
    if (Math.abs(this.ship.y - this.shipPrev.y) > BOUND_Y) this.shipPrev.y = this.ship.y;

    // --- Fire -----------------------------------------------------------------
    if (input.pressed('fire')) this.fire(env);

    // --- Advance bullets ------------------------------------------------------
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= dt;
      if (b.life <= 0) {
        b.alive = false;
        this.bulletPool.release(b);
        this.bullets.splice(i, 1);
        continue;
      }
      b.x = Driftfield.wrap(b.x + b.vx * dt, BOUND_X);
      b.y = Driftfield.wrap(b.y + b.vy * dt, BOUND_Y);
      if (Math.abs(b.x - b.px) > BOUND_X) b.px = b.x;
      if (Math.abs(b.y - b.py) > BOUND_Y) b.py = b.y;
    }

    // --- Advance asteroids ----------------------------------------------------
    for (const a of this.asteroids) {
      a.x = Driftfield.wrap(a.x + a.vx * dt, BOUND_X);
      a.y = Driftfield.wrap(a.y + a.vy * dt, BOUND_Y);
      if (Math.abs(a.x - a.px) > BOUND_X) a.px = a.x;
      if (Math.abs(a.y - a.py) > BOUND_Y) a.py = a.y;
      a.rot += a.spin * dt;
    }

    // --- Bullet vs asteroid collisions (split / destroy + score) -------------
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi];
      let hit = -1;
      for (let ai = 0; ai < this.asteroids.length; ai++) {
        const a = this.asteroids[ai];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const rr = a.r + BULLET_R;
        if (dx * dx + dy * dy <= rr * rr) {
          hit = ai;
          break;
        }
      }
      if (hit >= 0) {
        const a = this.asteroids[hit];
        // Consume the bullet.
        b.alive = false;
        this.bulletPool.release(b);
        this.bullets.splice(bi, 1);
        this.destroyAsteroid(hit, env);
        // Score by tier.
        this.score += ROCK[a.tier].score;
        env.setScore(this.score);
      }
    }

    // --- Ship vs asteroid: lose a life (unless settling) ---------------------
    if (this.respawnTimer <= 0) {
      for (const a of this.asteroids) {
        const dx = a.x - this.ship.x;
        const dy = a.y - this.ship.y;
        const rr = a.r + SHIP_R;
        if (dx * dx + dy * dy <= rr * rr) {
          this.loseLife(env);
          break;
        }
      }
    }

    // --- Wave cleared => bigger next wave -------------------------------------
    if (this.alive && this.asteroids.length === 0) {
      this.wave++;
      this.spawnWave(this.wave);
    }

    // Slow parallax drift on the starfield for life.
    this.stars.rotation.z += 0.02 * dt;
  }

  /** Split asteroid at index into children (or destroy if smallest). */
  private destroyAsteroid(index: number, env: GameEnv): void {
    const a = this.asteroids[index];
    a.alive = false;
    // Remove from the live list first (swap-pop is fine; order irrelevant).
    this.asteroids.splice(index, 1);
    const child = CHILD[a.tier];
    if (child) {
      env.audio.play('break');
      // Two children inheriting position, fresh random velocities (in spawn).
      this.spawnAsteroid(child, a.x, a.y);
      this.spawnAsteroid(child, a.x, a.y);
    } else {
      env.audio.play('explode');
    }
    this.pool.release(a);
  }

  private loseLife(env: GameEnv): void {
    env.audio.play('crash');
    this.lives--;
    if (this.lives <= 0) {
      this.die(env);
      return;
    }
    // Respawn at center, zero velocity, brief invulnerable settle.
    this.ship.set(0, 0);
    this.shipPrev.set(0, 0);
    this.shipVel.set(0, 0);
    this.shipAngle = 0;
    this.shipAnglePrev = 0;
    this.respawnTimer = RESPAWN_TIME;
  }

  private die(env: GameEnv): void {
    if (!this.alive) return;
    this.alive = false;
    env.gameOver();
  }

  frame(alpha: number, _env: GameEnv): void {
    // --- Ship: interpolate position + angle, render facing -------------------
    const sx = this.shipPrev.x + (this.ship.x - this.shipPrev.x) * alpha;
    const sy = this.shipPrev.y + (this.ship.y - this.shipPrev.y) * alpha;
    this.shipGroup.position.set(sx, sy, 0);
    const ang = this.shipAnglePrev + (this.shipAngle - this.shipAnglePrev) * alpha;
    this.shipGroup.rotation.z = ang;
    // Flicker the flame while thrusting; blink the hull while settling.
    this.flame.visible = this.thrusting && this.alive;
    if (this.flame.visible) this.flame.scale.y = 0.7 + Math.sin(alpha * 12 + sx) * 0.3;
    this.shipGroup.visible = !(this.respawnTimer > 0 && Math.floor(this.respawnTimer * 12) % 2 === 0);

    // --- Asteroids: interpolate + spin ---------------------------------------
    for (const a of this.asteroids) {
      const ax = a.px + (a.x - a.px) * alpha;
      const ay = a.py + (a.y - a.py) * alpha;
      a.mesh.position.set(ax, ay, 0);
      a.mesh.rotation.set(a.rot, a.rot * 0.7, a.rot * 0.3);
    }

    // --- Bullets: interpolate -------------------------------------------------
    for (const b of this.bullets) {
      const bx = b.px + (b.x - b.px) * alpha;
      const by = b.py + (b.y - b.py) * alpha;
      b.mesh.position.set(bx, by, 0);
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    // Keep the whole field framed on portrait phones by pulling the camera back.
    const portrait = height > width;
    // Tall/narrow viewports need extra distance to fit the wide field.
    this.camera.position.z = portrait ? 18 + (1 - width / height) * 12 : 18;
    this.camera.position.y = portrait ? -1.5 : -2.5;
    this.camera.lookAt(0, 0, 0);
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

const factory: GameFactory = () => new Driftfield();
export default factory;
