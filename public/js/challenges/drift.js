// Balloon Drift: side-scrolling flyer. Hold thrust to rise, let go to sink,
// and thread the gaps between hanging vines.
import { W, H, DT, clamp, drawSprite, sky, hud } from './common.js';

const PET_X = 100;
const GRAVITY = 520;
const COL_W = 40;

class DriftGame {
  constructor(rng, t) {
    this.rng = rng;
    this.r = 9 * t.radius;
    this.y = H / 2;
    this.vy = 0;
    this.thrust = 780 + 600 * t.lift;
    this.range = 120 + 300 * t.vision;
    this.v = 140;
    this.dist = 0;
    this.cols = [];
    this.nextSpawn = 220;
    this.lastGap = H / 2;
    this.done = false;
    this.score = 0;
    this.frame = 0;
    this.thrusting = false;
  }

  spawn() {
    const gap = Math.max(72, 118 - this.dist / 400);
    const center = clamp(this.lastGap + this.rng.range(-90, 90), gap / 2 + 12, H - gap / 2 - 12);
    this.lastGap = center;
    this.cols.push({ x: W + 10, gap, center });
    this.nextSpawn = this.rng.range(170, 240);
  }

  sense(s) {
    const ahead = this.cols.filter((c) => c.x + COL_W > PET_X - this.r);
    const a = ahead[0], b = ahead[1];
    const seen = (c) => c && c.x - PET_X < this.range;
    s[0] = seen(a) ? (a.center - this.y) / 135 : 0;
    s[1] = seen(a) ? (a.x - PET_X) / this.range : 1;
    s[2] = seen(a) ? a.gap / 120 : 0;
    s[3] = this.vy / 400;
    s[4] = (this.y - H / 2) / (H / 2);
    s[5] = seen(b) ? (b.center - this.y) / 135 : 0;
    s[6] = seen(b) ? (b.x - PET_X) / this.range : 1;
    s[7] = (this.v - 140) / 100;
  }

  step(a) {
    this.frame++;
    const power = clamp((a[0] + 1) / 2, 0, 1);
    this.thrusting = power > 0.5;
    this.vy += (GRAVITY - power * this.thrust) * DT;
    this.vy = clamp(this.vy * (1 - 0.8 * DT), -380, 380);
    this.y += this.vy * DT;
    if (this.y - this.r < 0 || this.y + this.r > H) this.done = true;

    this.v += 3 * DT;
    const dx = this.v * DT;
    this.dist += dx;
    this.nextSpawn -= dx;
    if (this.nextSpawn <= 0) this.spawn();
    for (const c of this.cols) {
      c.x -= dx;
      if (PET_X + this.r > c.x && PET_X - this.r < c.x + COL_W) {
        if (this.y - this.r < c.center - c.gap / 2 || this.y + this.r > c.center + c.gap / 2) this.done = true;
      }
    }
    this.cols = this.cols.filter((c) => c.x + COL_W > -10);
    this.score = Math.floor(this.dist / 10);
  }

  draw(ctx, sprite) {
    sky(ctx, '#9fd7ff', '#e9f6ff');
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 6; i++) {
      const x = ((i * 97 - this.dist * 0.3) % (W + 80) + W + 80) % (W + 80) - 40;
      ctx.beginPath(); ctx.ellipse(x, 30 + (i % 3) * 70, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const c of this.cols) {
      ctx.fillStyle = '#4d8b3c';
      ctx.fillRect(c.x, 0, COL_W, c.center - c.gap / 2);
      ctx.fillRect(c.x, c.center + c.gap / 2, COL_W, H);
      ctx.fillStyle = '#3a6d2c';
      ctx.fillRect(c.x - 3, c.center - c.gap / 2 - 8, COL_W + 6, 8);
      ctx.fillRect(c.x - 3, c.center + c.gap / 2, COL_W + 6, 8);
    }
    // Balloon above the pet.
    ctx.strokeStyle = '#666'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PET_X, this.y - this.r); ctx.lineTo(PET_X, this.y - this.r - 12); ctx.stroke();
    ctx.fillStyle = this.thrusting ? '#ff6f61' : '#ff9e94';
    ctx.beginPath(); ctx.ellipse(PET_X, this.y - this.r - 20, 9, 11, 0, 0, Math.PI * 2); ctx.fill();
    drawSprite(ctx, sprite, PET_X, this.y, this.r * 2.6, { rot: clamp(this.vy / 900, -0.4, 0.4) });
    hud(ctx, `Distance ${this.score} m`);
  }
}

export default {
  id: 'drift', slot: 3, name: 'Balloon Drift', genre: 'Side-scrolling flyer', icon: '🎈',
  blurb: 'Pump your balloon to float through gaps in the hanging vines.',
  uses: ['lift', 'reflex', 'vision', 'radius'],
  par: 700, maxSteps: 3600,
  create: (rng, t) => new DriftGame(rng, t),
};
