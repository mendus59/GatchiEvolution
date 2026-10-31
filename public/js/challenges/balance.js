// Pole Balance: keep a pole upright on your nose while gusts of wind push it.
import { W, H, DT, clamp, drawSprite, sky, hud } from './common.js';

const G = 9.8, POLE_M = 0.1, HALF_L = 0.5;
const X_LIM = 2.4, THETA_LIM = 0.65;
const SCALE = 85;

class BalanceGame {
  constructor(rng, t) {
    this.rng = rng;
    this.cartM = 0.6 + 1.0 * t.mass;
    this.force = 6 + 9 * t.strength;
    this.x = 0; this.xd = 0;
    this.th = rng.range(-0.05, 0.05); this.thd = 0;
    this.wind = 0; this.windTarget = 0; this.windTimer = 1;
    this.time = 0;
    this.done = false;
    this.score = 0;
    this.lastF = 0;
  }

  sense(s) {
    s[0] = this.x / X_LIM;
    s[1] = this.xd / 2;
    s[2] = this.th / THETA_LIM;
    s[3] = this.thd / 2;
    s[4] = this.wind / 3;
    s[5] = 0; s[6] = 0; s[7] = 0;
  }

  step(a) {
    this.time += DT;
    this.windTimer -= DT;
    if (this.windTimer <= 0) {
      const maxWind = Math.min(3, 0.4 + this.time / 20);
      this.windTarget = this.rng.range(-maxWind, maxWind);
      this.windTimer = this.rng.range(1, 3);
    }
    this.wind += (this.windTarget - this.wind) * 2 * DT;

    const f = clamp(a[0], -1, 1) * this.force;
    this.lastF = f;
    const total = this.cartM + POLE_M;
    const sin = Math.sin(this.th), cos = Math.cos(this.th);
    const temp = (f + POLE_M * HALF_L * this.thd * this.thd * sin) / total;
    const thacc = (G * sin - cos * temp + this.wind * 0.6) /
      (HALF_L * (4 / 3 - (POLE_M * cos * cos) / total));
    const xacc = temp - (POLE_M * HALF_L * thacc * cos) / total;
    this.x += this.xd * DT; this.xd += xacc * DT;
    this.th += this.thd * DT; this.thd += thacc * DT;
    if (Math.abs(this.x) > X_LIM || Math.abs(this.th) > THETA_LIM) this.done = true;
    this.score = Math.floor(this.time * 10);
  }

  draw(ctx, sprite) {
    sky(ctx, '#e0f7f1', '#f7fffc');
    const floor = 235;
    ctx.fillStyle = '#9ccfbf';
    ctx.fillRect(0, floor, W, H - floor);
    ctx.fillStyle = '#d66';
    ctx.fillRect(W / 2 - X_LIM * SCALE - 4, floor - 10, 4, 10);
    ctx.fillRect(W / 2 + X_LIM * SCALE, floor - 10, 4, 10);
    const px = W / 2 + this.x * SCALE;
    const headY = floor - 30;
    drawSprite(ctx, sprite, px, floor - 16, 34, { rot: clamp(this.lastF / 60, -0.2, 0.2) });
    const len = HALF_L * 2 * 110;
    ctx.strokeStyle = '#7a4f2a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, headY);
    ctx.lineTo(px + Math.sin(this.th) * len, headY - Math.cos(this.th) * len);
    ctx.stroke();
    // Wind streaks
    ctx.strokeStyle = 'rgba(80,120,140,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const y = 40 + i * 25;
      const x = ((this.time * 120 * Math.sign(this.wind || 1) + i * 90) % W + W) % W;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + this.wind * 12, y); ctx.stroke();
    }
    hud(ctx, `Balanced ${this.time.toFixed(1)} s`, `Wind ${this.wind > 0 ? '→' : '←'} ${Math.abs(this.wind).toFixed(1)}`);
  }
}

export default {
  id: 'balance', slot: 7, name: 'Pole Balance', genre: 'Balancing act', icon: '🎋',
  blurb: 'Balance a pole on your nose while the wind keeps shoving it.',
  uses: ['strength', 'mass', 'reflex'],
  par: 400, maxSteps: 3600,
  create: (rng, t) => new BalanceGame(rng, t),
};
