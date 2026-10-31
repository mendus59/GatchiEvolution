// Hop Trail: endless runner. Jump over rocks, duck under swooping birds.
import { W, H, DT, drawSprite, sky, hud, roundRect } from './common.js';

const GROUND = 220;
const PET_X = 80;
const GRAVITY = 1500;

class HopGame {
  constructor(rng, t) {
    this.rng = rng;
    this.t = t;
    this.size = 22 * t.radius;
    this.y = 0; // height above ground
    this.vy = 0;
    this.ducking = false;
    this.v = 170 + 130 * t.speed;
    this.jumpV = 360 + 260 * t.jump;
    this.range = 110 + 300 * t.vision;
    this.dist = 0;
    this.obstacles = [];
    this.nextSpawn = 300;
    this.done = false;
    this.score = 0;
    this.frame = 0;
  }

  spawn() {
    const rng = this.rng;
    const x = W + 20;
    if (this.dist > 1200 && rng.chance(0.3)) {
      const high = rng.chance(0.5);
      this.obstacles.push({ x, w: 26, h: 14, lift: high ? 44 : 26, bird: true });
    } else {
      this.obstacles.push({ x, w: rng.range(14, 34), h: rng.range(18, 44), lift: 0, bird: false });
    }
    this.nextSpawn = rng.range(200, 420) + this.v * 0.35;
  }

  sense(s) {
    const ahead = this.obstacles.filter((o) => o.x + o.w > PET_X - this.size / 2);
    const enc = (o) => (o && o.x - PET_X < this.range ? (o.x - PET_X) / this.range : 1);
    const a = ahead[0], b = ahead[1];
    const visible = a && a.x - PET_X < this.range;
    s[0] = enc(a);
    s[1] = visible ? a.h / 50 : 0;
    s[2] = visible ? a.w / 40 : 0;
    s[3] = visible ? (a.bird ? 1 : -1) : 0;
    s[4] = enc(b);
    s[5] = this.y / 100;
    s[6] = this.vy / 600;
    s[7] = (this.v - 170) / 300;
  }

  step(a) {
    this.frame++;
    const grounded = this.y <= 0;
    this.ducking = a[1] > 0.3;
    if (grounded && a[0] > 0 && !this.ducking) this.vy = this.jumpV;
    const g = this.ducking && !grounded ? GRAVITY * 2.2 : GRAVITY;
    this.vy -= g * DT;
    this.y += this.vy * DT;
    if (this.y <= 0) { this.y = 0; this.vy = 0; }

    this.v += 5 * DT;
    const dx = this.v * DT;
    this.dist += dx;
    this.nextSpawn -= dx;
    if (this.nextSpawn <= 0) this.spawn();
    for (const o of this.obstacles) o.x -= dx;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -10);

    // Collision with a little forgiveness.
    const ph = this.ducking && this.y <= 0 ? this.size * 0.5 : this.size * 0.9;
    const px0 = PET_X - this.size * 0.35, px1 = PET_X + this.size * 0.35;
    const py0 = this.y, py1 = this.y + ph;
    for (const o of this.obstacles) {
      const oy0 = o.lift, oy1 = o.lift + o.h;
      if (px1 > o.x + 2 && px0 < o.x + o.w - 2 && py1 > oy0 + 2 && py0 < oy1 - 2) {
        this.done = true;
      }
    }
    this.score = Math.floor(this.dist / 10);
  }

  draw(ctx, sprite) {
    sky(ctx, '#ffe7c4', '#fff8ec');
    ctx.fillStyle = '#c9a77a';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = '#a8865a';
    for (let i = 0; i < 12; i++) {
      const x = ((i * 53 - this.dist * 0.9) % W + W) % W;
      ctx.fillRect(x, GROUND + 10 + (i % 3) * 12, 6, 2);
    }
    for (const o of this.obstacles) {
      if (o.bird) {
        ctx.strokeStyle = '#3b3b58';
        ctx.lineWidth = 3;
        const flap = Math.sin(this.frame * 0.3) * 5;
        const y = GROUND - o.lift - o.h / 2;
        ctx.beginPath();
        ctx.moveTo(o.x, y - flap);
        ctx.lineTo(o.x + o.w / 2, y + 3);
        ctx.lineTo(o.x + o.w, y - flap);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#7d7468';
        roundRect(ctx, o.x, GROUND - o.h, o.w, o.h, 5);
        ctx.fill();
      }
    }
    const squash = this.ducking && this.y <= 0 ? 0.55 : 1;
    const bob = this.y <= 0 ? Math.abs(Math.sin(this.frame * 0.35)) * 2 : 0;
    const s = this.size * 1.25;
    drawSprite(ctx, sprite, PET_X, GROUND - this.y - (s * squash) / 2 - bob, s, { stretchY: squash });
    hud(ctx, `Distance ${this.score} m`);
  }
}

export default {
  id: 'hop', slot: 0, name: 'Hop Trail', genre: 'Endless runner', icon: '🪨',
  blurb: 'Run forever. Jump the rocks, duck the swooping birds.',
  uses: ['jump', 'speed', 'reflex', 'vision'],
  par: 900, maxSteps: 3600,
  create: (rng, t) => new HopGame(rng, t),
};
