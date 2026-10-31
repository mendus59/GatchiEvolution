// Target Range: lob stones at drifting targets. Each throw reports how far it
// missed, and that feedback is a sensor so the pet can correct its next shot.
import { W, H, DT, clamp, drawSprite, sky, hud } from './common.js';

const PX = 50, PY = 230;
const GRAVITY = 380;

class SlingGame {
  constructor(rng, t) {
    this.rng = rng;
    this.t = t;
    this.power = 250 + 140 * t.strength;
    this.cooldownMax = 1.0 - 0.45 * t.reflex;
    this.quant = 0.02 + 0.12 * (1 - t.vision);
    this.cooldown = 0.5;
    this.stones = [];
    this.missX = 0; this.missY = 0;
    this.time = 0;
    this.hits = 0;
    this.shaping = 0;
    this.wind = 0;
    this.newTarget();
    this.aim = 0.6;
    this.done = false;
    this.score = 0;
  }

  newTarget() {
    const lvl = Math.min(1, this.time / 40);
    this.target = {
      x: this.rng.range(200, 450), y: this.rng.range(60, 210),
      vx: this.rng.range(-1, 1) * 50 * lvl, vy: this.rng.range(-1, 1) * 40 * lvl, r: 14,
    };
    this.wind = this.rng.range(-1, 1) * 40 * lvl;
  }

  sense(s) {
    const qz = (v) => Math.round(v / this.quant) * this.quant;
    s[0] = qz((this.target.x - PX) / 400);
    s[1] = qz((PY - this.target.y) / 200);
    s[2] = this.target.vx / 60;
    s[3] = this.target.vy / 60;
    s[4] = this.cooldown > 0 ? 1 : -1;
    s[5] = this.wind / 40;
    s[6] = this.missX;
    s[7] = this.missY;
  }

  step(a) {
    this.time += DT;
    this.cooldown = Math.max(0, this.cooldown - DT);
    this.aim = 0.15 + 1.15 * clamp((a[0] + 1) / 2, 0, 1); // radians above horizontal
    const pow = this.power * (0.55 + 0.45 * clamp((a[1] + 1) / 2, 0, 1));
    if (a[2] > 0 && this.cooldown === 0) {
      this.stones.push({ x: PX, y: PY - 10, vx: Math.cos(this.aim) * pow, vy: -Math.sin(this.aim) * pow, best: Infinity, crossed: false });
      this.cooldown = this.cooldownMax;
    }
    const tg = this.target;
    tg.x += tg.vx * DT; tg.y += tg.vy * DT;
    if (tg.x < 180 || tg.x > 460) tg.vx = -tg.vx;
    if (tg.y < 40 || tg.y > 220) tg.vy = -tg.vy;

    for (const st of this.stones) {
      st.vx += this.wind * DT;
      st.vy += GRAVITY * DT;
      st.x += st.vx * DT; st.y += st.vy * DT;
      const d = Math.hypot(st.x - tg.x, st.y - tg.y);
      st.best = Math.min(st.best, d);
      if (!st.crossed && st.x >= tg.x) { st.crossed = true; this.missY = clamp((st.y - tg.y) / 100, -1, 1); }
      if (d < tg.r + 4) {
        st.dead = true; this.hits++; this.missX = 0; this.missY = 0;
        this.newTarget();
      } else if (st.y > H || st.x > W + 20) {
        st.dead = true;
        this.shaping += Math.max(0, 1 - st.best / 150) * 3;
        this.missX = clamp((st.x - tg.x) / 200, -1, 1);
        if (!st.crossed) this.missY = 1;
      }
    }
    this.stones = this.stones.filter((st) => !st.dead);
    this.score = Math.floor(this.hits * 20 + this.shaping);
  }

  draw(ctx, sprite) {
    sky(ctx, '#fbe6c8', '#fffaf2');
    ctx.fillStyle = '#d9b98b';
    ctx.fillRect(0, PY + 12, W, H);
    const tg = this.target;
    for (const [r, c] of [[tg.r, '#e53935'], [tg.r * 0.66, '#fff'], [tg.r * 0.33, '#e53935']]) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(tg.x, tg.y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#555';
    for (const st of this.stones) { ctx.beginPath(); ctx.arc(st.x, st.y, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(PX, PY - 4);
    ctx.lineTo(PX + Math.cos(this.aim) * 26, PY - 4 - Math.sin(this.aim) * 26); ctx.stroke();
    drawSprite(ctx, sprite, PX - 6, PY, 30);
    hud(ctx, `Hits ${this.hits}`, `Wind ${this.wind > 0 ? '→' : '←'} ${Math.abs(this.wind).toFixed(0)}`);
  }
}

export default {
  id: 'sling', slot: 9, name: 'Target Range', genre: 'Artillery', icon: '🎯',
  blurb: 'Lob stones at drifting targets, correcting for wind and distance.',
  uses: ['strength', 'reflex', 'vision'],
  par: 300, maxSteps: 2700,
  create: (rng, t) => new SlingGame(rng, t),
};
