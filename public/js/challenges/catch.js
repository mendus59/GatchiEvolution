// Orchard Catch: shuffle along the ground catching ripe fruit, avoid rotten ones.
import { W, H, DT, clamp, approach, drawSprite, sky, hud } from './common.js';

const FLOOR = 245;

class CatchGame {
  constructor(rng, t) {
    this.rng = rng;
    this.x = W / 2;
    this.vx = 0;
    this.vmax = 140 + 200 * t.speed;
    this.accel = 700 + 1000 * t.agility;
    this.half = 14 * t.radius;
    this.sight = 70 + 190 * t.vision;
    this.fruit = [];
    this.timer = 0.5;
    this.time = 0;
    this.lives = 5;
    this.lastX = W / 2;
    this.caught = 0;
    this.done = false;
    this.score = 0;
  }

  visible() {
    return this.fruit.filter((f) => f.y > FLOOR - this.sight)
      .map((f) => ({ f, t: (FLOOR - f.y) / f.vy }))
      .sort((a, b) => a.t - b.t);
  }

  sense(s) {
    const vis = this.visible();
    const good = vis.filter((v) => !v.f.rotten), bad = vis.filter((v) => v.f.rotten);
    const enc = (v, i) => {
      if (v) { s[i] = (v.f.x - this.x) / 240; s[i + 1] = clamp(v.t / 2.5, 0, 1); }
      else { s[i] = 0; s[i + 1] = 1; }
    };
    enc(good[0], 0);
    enc(good[1], 2);
    enc(bad[0], 4);
    s[6] = this.vx / this.vmax;
    s[7] = (this.x - W / 2) / (W / 2);
  }

  step(a) {
    this.time += DT;
    this.vx = approach(this.vx, clamp(a[0], -1, 1) * this.vmax, this.accel * DT);
    this.x += this.vx * DT;
    if (this.x < this.half || this.x > W - this.half) { this.x = clamp(this.x, this.half, W - this.half); this.vx = 0; }

    this.timer -= DT;
    if (this.timer <= 0) {
      const pace = Math.min(1, this.time / 50);
      this.fruit.push({
        x: (this.lastX = clamp(this.lastX + this.rng.range(-170, 170), 20, W - 20)), y: -10,
        vy: 80 + 70 * pace, // shared speed, so fruit land in the order they spawn
        rotten: this.time > 5 && this.rng.chance(0.28),
      });
      this.timer = this.rng.range(0.7, 1.3) - 0.3 * pace;
    }
    for (const f of this.fruit) {
      f.y += f.vy * DT;
      if (f.y >= FLOOR - 8 && !f.gone) {
        f.gone = true;
        const hit = Math.abs(f.x - this.x) < this.half + 9;
        if (hit && !f.rotten) this.caught++;
        else if (hit && f.rotten) this.lives--;
        else if (!f.rotten) this.lives--;
      }
    }
    this.fruit = this.fruit.filter((f) => !f.gone);
    if (this.lives <= 0) this.done = true;
    this.score = this.caught * 10;
  }

  draw(ctx, sprite) {
    sky(ctx, '#d6f0ff', '#f6fff0');
    ctx.fillStyle = '#7cc46a';
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, W, FLOOR - this.sight);
    for (const f of this.fruit) {
      ctx.fillStyle = f.rotten ? '#6b5b3e' : '#ff7a2f';
      ctx.beginPath(); ctx.arc(f.x, f.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3d8b37';
      ctx.fillRect(f.x - 1, f.y - 11, 2, 5);
    }
    ctx.fillStyle = '#a0703c';
    ctx.fillRect(this.x - this.half - 4, FLOOR - 26, (this.half + 4) * 2, 6);
    drawSprite(ctx, sprite, this.x, FLOOR - 12, 28, { flip: this.vx < -5 });
    hud(ctx, `Caught ${this.caught}`, '♥'.repeat(Math.max(0, this.lives)));
  }
}

export default {
  id: 'catch', slot: 4, name: 'Orchard Catch', genre: 'Catcher', icon: '🍑',
  blurb: 'Catch ripe fruit as it falls, but dodge anything rotten.',
  uses: ['speed', 'agility', 'vision', 'radius'],
  par: 400, maxSteps: 3600,
  create: (rng, t) => new CatchGame(rng, t),
};
