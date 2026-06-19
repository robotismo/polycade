import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end coverage of the real path for every game: load from the URL, drive
 * the actual simulation with real semantic input (the same intents keyboard/
 * touch produce), assert the score climbs, reach a real game-over, then reload
 * and assert the high score persisted. Each game is driven by a headless
 * autopilot that reads the game's public state and feeds it virtual input,
 * advancing the deterministic fixed-step sim one tick at a time (so the result
 * is independent of framerate / tab visibility).
 */

const TARGET = 3; // score each autopilot aims to reach before forcing a game-over

type DriverResult = { scored: number; reachedGameOver: boolean };

// --- In-page autopilots (serialized into the browser by page.evaluate) -------
// Each plays to ~TARGET, forces a game-over, and returns the final score.

const DRIVERS: Record<string, (target: number) => DriverResult> = {
  updraft: (target) => {
    const p = (window as any).polycade;
    p.stopLoop();
    p.start();
    const g = p.game();
    const flap = () => {
      p.input.virtualDown('flap');
      p.input.virtualUp('flap');
    };
    let s = 0;
    for (; s < 8000 && p.score() < target && p.state() === 'playing'; s++) {
      let gapY = 0;
      let bx = Infinity;
      for (const gt of g.gates)
        if (gt.x > -0.7 && gt.x < bx) {
          bx = gt.x;
          gapY = gt.gapY;
        }
      if (g.y < gapY - 0.05 && g.vy < 0.8) flap();
      p.tick(1);
    }
    for (; s < 14000 && p.state() === 'playing'; s++) p.tick(1); // stop flapping -> fall
    return { scored: p.score(), reachedGameOver: p.state() === 'gameover' };
  },

  coil: (target) => {
    const p = (window as any).polycade;
    p.stopLoop();
    p.start();
    const g = p.game();
    const press = (a: string) => {
      p.input.virtualDown(a);
      p.input.virtualUp(a);
    };
    let s = 0;
    for (; s < 40000 && p.score() < target && p.state() === 'playing'; s++) {
      const h = g.snake[0];
      const f = g.food;
      const d = g.dir;
      let want: string | null = null;
      if (f.x < h.x && d.x !== 1) want = 'left';
      else if (f.x > h.x && d.x !== -1) want = 'right';
      else if (f.z < h.z && d.z !== 1) want = 'up';
      else if (f.z > h.z && d.z !== -1) want = 'down';
      if (want) press(want);
      p.tick(1);
    }
    for (; s < 80000 && p.state() === 'playing'; s++) p.tick(1); // run straight into a wall
    return { scored: p.score(), reachedGameOver: p.state() === 'gameover' };
  },

  shatter: (target) => {
    const p = (window as any).polycade;
    p.stopLoop();
    p.start();
    const g = p.game();
    const hold = (a: string, on: boolean) => (on ? p.input.virtualDown(a) : p.input.virtualUp(a));
    const launch = () => {
      p.input.virtualDown('fire');
      p.input.virtualUp('fire');
    };
    let s = 0;
    for (; s < 40000 && p.score() < target && p.state() === 'playing'; s++) {
      if (g.ballStuck) launch();
      const dx = g.ballPos.x - g.paddleX;
      hold('left', dx < -0.1);
      hold('right', dx > 0.1);
      p.tick(1);
    }
    hold('left', false);
    hold('right', false);
    // Force misses: park paddle opposite the ball + relaunch when re-stuck.
    for (; s < 90000 && p.state() === 'playing'; s++) {
      if (g.ballStuck) launch();
      hold('left', g.ballPos.x > 0);
      hold('right', g.ballPos.x <= 0);
      p.tick(1);
    }
    return { scored: p.score(), reachedGameOver: p.state() === 'gameover' };
  },

  rally: (target) => {
    const p = (window as any).polycade;
    p.stopLoop();
    p.start();
    const g = p.game();
    const hold = (a: string, on: boolean) => (on ? p.input.virtualDown(a) : p.input.virtualUp(a));
    let s = 0;
    for (; s < 60000 && p.score() < target && p.state() === 'playing'; s++) {
      const dx = g.ball.x - g.playerX;
      hold('left', dx < -0.1);
      hold('right', dx > 0.1);
      p.tick(1);
    }
    // Concede: park the paddle far from centre so serves miss.
    hold('right', false);
    hold('left', true);
    for (; s < 120000 && p.state() === 'playing'; s++) p.tick(1);
    return { scored: p.score(), reachedGameOver: p.state() === 'gameover' };
  },

  driftfield: (target) => {
    const p = (window as any).polycade;
    p.stopLoop();
    p.start();
    const g = p.game();
    const hold = (a: string, on: boolean) => (on ? p.input.virtualDown(a) : p.input.virtualUp(a));
    const fire = () => {
      p.input.virtualDown('fire');
      p.input.virtualUp('fire');
    };
    const wrap = (v: number, half: number) => {
      const span = half * 2;
      return ((((v + half) % span) + span) % span) - half;
    };
    const nearest = (): { dx: number; dy: number } | null => {
      let best: { dx: number; dy: number } | null = null;
      let bd = Infinity;
      for (const a of g.asteroids) {
        const dx = wrap(a.x - g.ship.x, g.bounds.x);
        const dy = wrap(a.y - g.ship.y, g.bounds.y);
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = { dx, dy };
        }
      }
      return best;
    };
    const angErr = (t: { dx: number; dy: number }) => {
      const desired = Math.atan2(-t.dx, t.dy);
      return Math.atan2(Math.sin(desired - g.shipAngle), Math.cos(desired - g.shipAngle));
    };
    let s = 0;
    for (; s < 60000 && p.score() < target && p.state() === 'playing'; s++) {
      const t = nearest();
      if (t) {
        const err = angErr(t);
        hold('left', err > 0.06);
        hold('right', err < -0.06);
        if (Math.abs(err) < 0.12) fire();
      }
      p.tick(1);
    }
    hold('left', false);
    hold('right', false);
    // Die: aim at the nearest rock and thrust into it, repeatedly.
    for (; s < 120000 && p.state() === 'playing'; s++) {
      const t = nearest();
      if (t) {
        const err = angErr(t);
        hold('left', err > 0.06);
        hold('right', err < -0.06);
        hold('thrust', Math.abs(err) < 0.5);
      }
      p.tick(1);
    }
    return { scored: p.score(), reachedGameOver: p.state() === 'gameover' };
  },
};

async function gotoGame(page: Page, id: string): Promise<void> {
  await page.goto('/');
  await page.evaluate((gid) => {
    location.hash = '#/play/' + gid;
  }, id);
  await page.waitForFunction(
    (gid) => {
      const p = (window as any).polycade;
      return p && p.currentId() === gid && p.state() === 'ready' && !!p.game();
    },
    id,
    { timeout: 20000 },
  );
}

for (const id of Object.keys(DRIVERS)) {
  test(`${id}: plays, scores, reaches game-over, and persists the high score`, async ({ page }) => {
    test.setTimeout(60000);

    // 1) Load the game from a real route.
    await gotoGame(page, id);

    // 2) Drive real input through the deterministic sim.
    const result: DriverResult = await page.evaluate(
      ({ driverSrc, target }) => {
        const driver = new Function('return (' + driverSrc + ')')();
        return driver(target);
      },
      { driverSrc: DRIVERS[id].toString(), target: TARGET },
    );

    // 3) Score climbed and a real game-over was reached.
    expect(result.scored, 'score should increase during play').toBeGreaterThan(0);
    expect(result.reachedGameOver, 'game-over must be reachable').toBe(true);

    // 4) Game-over UI shows the run's score + best + restart.
    await expect(page.locator('.overlay .panel h2')).toHaveText('GAME OVER');
    await expect(page.locator('.score-final')).toHaveText(String(result.scored));
    await expect(page.locator('.btn.primary')).toBeVisible();

    // 5) High-score round-trip: reload and confirm it persisted.
    const bestBefore = await page.evaluate((gid) => (window as any).polycade.best(gid), id);
    expect(bestBefore).toBeGreaterThanOrEqual(result.scored);

    await page.reload();
    await page.waitForFunction(() => !!(window as any).polycade, undefined, { timeout: 20000 });
    const bestAfter = await page.evaluate((gid) => (window as any).polycade.best(gid), id);
    expect(bestAfter, 'high score must survive a reload').toBe(bestBefore);
  });
}

test('home grid shows all five cabinets', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).polycade, undefined, { timeout: 20000 });
  await expect(page.locator('.card')).toHaveCount(5);
  await expect(page.locator('.card-title')).toContainText([
    'UPDRAFT',
    'COIL',
    'SHATTER',
    'RALLY',
    'DRIFTFIELD',
  ]);
});
