// Sky Climb: bounce upward from cloud to cloud. The screen wraps sideways.
import { W, H, DT, clamp, approach, drawSprite, sky, hud } from './common.js';

const GRAVITY = 900;

class ClimbGame {
  constructor(rng, t) {
    this.rng = rng;
    this.x = W / 2; this.h = 0; this.vx = 0; this.vy = 0;
    this.bounce = 400 + 260 * t.jump;
    this.vmax = 120 + 170 * t.agility;
    this.accel = 600 + 600 * t.speed;
    this.reach = 100 + 220 * t.vision;
    this.half = 8 * t.radius;
    this.plats = [{ x: W / 2, h: -10, w: 120, vx: 0 }];
    this.topH = -10;
    this.lastX = W / 2;
    while (this.topH < H * 2) this.addPlatform();
    this.best = 0;
    this.done = false;
    this.score = 0;
  }

  addPlatform() {
    const level = Math.max(0, this.topH);
    const gap = this.rng.range(40, 70) + Math.min(55, level / 60);
    const w = Math.max(40, 84 - level / 100);
    const moving = level > 1500 && this.rng.chance(0.35);
    this.topH += gap;
    // Stay within sideways reach of the previous cloud (wrapping around).
    const x = ((this.lastX + this.rng.range(-150, 150)) % W + W) % W;
    this.lastX = x;
    this.plats.push({ x, h: this.topH, w, vx: moving ? this.rng.range(-60, 60) : 0 });
  }

  wrapDx(x) {
    let d = x - this.x;
    if (d > W / 2) d -= W;
    if (d < -W / 2) d += W;
    return d;
  }

  sense(s) {
    const above = [], below = [];
    for (const p of this.plats) {
      const dy = p.h - this.h;
      if (dy > 0 && dy < this.reach) above.push({ p, dy });
      else if (dy <= 0 && dy > -200) below.push({ p, dy });
    }
    above.sort((a, b) => a.dy - b.dy);
    below.sort((a, b) => b.dy - a.dy);
    const enc = (o, i) => {
      if (o) { s[i] = this.wrapDx(o.p.x) / (W / 2); s[i + 1] = o.dy / 200; }
      else { s[i] = 0; s[i + 1] = i < 4 ? 1 : -1; }
    };
    enc(above[0], 0);
    enc(above[1], 2);
    enc(below[0], 4);
    s[6] = this.vx / this.vmax;
    s[7] = this.vy / 700;
  }

  step(a) {
    this.vx = approach(this.vx, clamp(a[0], -1, 1) * this.vmax, this.accel * DT);
    this.x = ((this.x + this.vx * DT) % W + W) % W;
    const prevH = this.h;
    this.vy -= GRAVITY * DT;
    this.h += this.vy * DT;
    for (const p of this.plats) {
      if (p.vx) { p.x += p.vx * DT; if (p.x < 20 || p.x > W - 20) p.vx = -p.vx; }
      if (this.vy < 0 && prevH >= p.h && this.h <= p.h && Math.abs(this.wrapDx(p.x)) < p.w / 2 + this.half) {
        this.h = p.h;
        this.vy = this.bounce;
      }
    }
    this.best = Math.max(this.best, this.h);
    while (this.topH < this.best + H * 1.5) this.addPlatform();
    this.plats = this.plats.filter((p) => p.h > this.best - H);
    if (this.h < this.best - 220) this.done = true;
    this.score = Math.floor(this.best / 10);
  }

  draw(ctx, sprite) {
    sky(ctx, '#7ab8ff', '#dff0ff');
    const cam = Math.max(0, this.best - 150);
    const yOf = (h) => H - 20 - (h - cam);
    for (const p of this.plats) {
      const y = yOf(p.h);
      if (y < -10 || y > H + 10) continue;
      ctx.fillStyle = p.vx ? '#fff3c4' : '#ffffff';
      for (const off of [0, W, -W]) {
        ctx.beginPath(); ctx.ellipse(p.x + off, y + 4, p.w / 2, 7, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    const y = yOf(this.h) - 12;
    const stretch = 1 + clamp(this.vy / 2000, -0.15, 0.2);
    for (const off of [0, W, -W]) {
      drawSprite(ctx, sprite, this.x + off, y, 26, { flip: this.vx < 0, stretchY: stretch });
    }
    hud(ctx, `Height ${this.score} m`);
  }
}

export default {
  id: 'climb', slot: 8, name: 'Sky Climb', genre: 'Vertical platformer', icon: '☁️',
  blurb: 'Bounce from cloud to cloud and climb as high as you can.',
  uses: ['jump', 'agility', 'vision'],
  par: 500, maxSteps: 3600,
  create: (rng, t) => new ClimbGame(rng, t),
};
