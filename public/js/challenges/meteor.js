// Meteor Field: top-down arena survival. Meteors streak in from the edges.
import { W, H, DT, clamp, approach, drawSprite, hud } from './common.js';

class MeteorGame {
  constructor(rng, t) {
    this.rng = rng;
    this.x = W / 2; this.y = H / 2; this.vx = 0; this.vy = 0;
    this.vmax = 100 + 170 * t.speed;
    this.accel = 500 + 900 * t.agility;
    this.r = 8 * t.radius;
    this.range = 70 + 210 * t.vision;
    this.rocks = [];
    this.timer = 0.6;
    this.time = 0;
    this.done = false;
    this.score = 0;
    this.stars = [];
    for (let i = 0; i < 40; i++) this.stars.push([rng.range(0, W), rng.range(0, H)]);
  }

  spawn() {
    const rng = this.rng;
    const side = rng.int(0, 3);
    let x, y;
    if (side === 0) { x = rng.range(0, W); y = -15; }
    else if (side === 1) { x = W + 15; y = rng.range(0, H); }
    else if (side === 2) { x = rng.range(0, W); y = H + 15; }
    else { x = -15; y = rng.range(0, H); }
    const pace = Math.min(1, this.time / 45);
    const tx = this.x + rng.range(-80, 80), ty = this.y + rng.range(-80, 80);
    const d = Math.hypot(tx - x, ty - y) || 1;
    const speed = rng.range(90, 150) + 80 * pace;
    this.rocks.push({ x, y, vx: ((tx - x) / d) * speed, vy: ((ty - y) / d) * speed, r: rng.range(6, 14) });
    this.timer = rng.range(0.4, 0.9) - 0.3 * pace;
  }

  sense(s) {
    const near = [];
    for (const m of this.rocks) {
      const dx = m.x - this.x, dy = m.y - this.y;
      const d = Math.hypot(dx, dy) - m.r;
      if (d < this.range) near.push({ m, dx, dy, d: Math.max(d, 1) });
    }
    near.sort((a, b) => a.d - b.d);
    for (let k = 0; k < 2; k++) {
      const n = near[k];
      if (!n) { s[k * 3] = 0; s[k * 3 + 1] = 0; s[k * 3 + 2] = -1; continue; }
      const len = Math.hypot(n.dx, n.dy) || 1;
      const prox = 1 - n.d / this.range;
      s[k * 3] = (n.dx / len) * prox;
      s[k * 3 + 1] = (n.dy / len) * prox;
      s[k * 3 + 2] = -(n.m.vx * n.dx + n.m.vy * n.dy) / len / 200; // closing speed
    }
    s[6] = (this.x - W / 2) / (W / 2);
    s[7] = (this.y - H / 2) / (H / 2);
  }

  step(a) {
    this.time += DT;
    this.vx = approach(this.vx, clamp(a[0], -1, 1) * this.vmax, this.accel * DT);
    this.vy = approach(this.vy, clamp(a[1], -1, 1) * this.vmax, this.accel * DT);
    this.x = clamp(this.x + this.vx * DT, this.r, W - this.r);
    this.y = clamp(this.y + this.vy * DT, this.r, H - this.r);
    this.timer -= DT;
    if (this.timer <= 0) this.spawn();
    for (const m of this.rocks) {
      m.x += m.vx * DT; m.y += m.vy * DT;
      if (Math.hypot(m.x - this.x, m.y - this.y) < m.r + this.r) this.done = true;
    }
    this.rocks = this.rocks.filter((m) => m.x > -40 && m.x < W + 40 && m.y > -40 && m.y < H + 40);
    this.score = Math.floor(this.time * 10);
  }

  draw(ctx, sprite) {
    ctx.fillStyle = '#141633';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff88';
    for (const [x, y] of this.stars) ctx.fillRect(x, y, 1.5, 1.5);
    for (const m of this.rocks) {
      ctx.strokeStyle = 'rgba(255,170,80,0.35)';
      ctx.lineWidth = m.r;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 0.12, m.y - m.vy * 0.12); ctx.stroke();
      ctx.fillStyle = '#a5735a';
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2); ctx.stroke();
    drawSprite(ctx, sprite, this.x, this.y, this.r * 3, { flip: this.vx < -5 });
    hud(ctx, '', `Survived ${this.time.toFixed(1)} s`, '#fff');
  }
}

export default {
  id: 'meteor', slot: 5, name: 'Meteor Field', genre: 'Arena dodger', icon: '☄️',
  blurb: 'Survive as long as you can while meteors streak across the field.',
  uses: ['agility', 'speed', 'vision', 'radius'],
  par: 400, maxSteps: 3600,
  create: (rng, t) => new MeteorGame(rng, t),
};
