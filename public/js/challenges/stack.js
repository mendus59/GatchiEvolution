// Tower Stack: a timing game. Drop the sliding block so it lands on the tower;
// any overhang is sliced off, so sloppy drops shrink every block after.
import { W, H, DT, drawSprite, sky, hud } from './common.js';

const BLOCK_H = 16;
const START_W = 120;

class StackGame {
  constructor(rng, t) {
    this.rng = rng;
    this.t = t;
    this.perfectTol = 2 + 5 * t.focus;
    this.tower = [{ x: W / 2, w: START_W }];
    this.w = START_W;
    this.x = 40;
    this.v = 110;
    this.sinceSpawn = 0;
    this.cooldown = 0;
    this.perfects = 0;
    this.done = false;
    this.score = 0;
    this.hue = rng.range(0, 360);
    this.cut = null;
  }

  get top() { return this.tower[this.tower.length - 1]; }

  sense(s) {
    s[0] = (this.x - this.top.x) / 120;
    s[1] = this.v / 300;
    s[2] = this.w / START_W;
    s[3] = (this.x - this.top.x) / Math.max(this.w, 1);
    s[4] = this.cooldown > 0 ? 1 : -1;
    s[5] = this.sinceSpawn / 6;
    s[6] = (this.x - W / 2) / (W / 2);
    s[7] = this.tower.length / 40;
  }

  step(a) {
    this.sinceSpawn += DT;
    this.cooldown = Math.max(0, this.cooldown - DT);
    this.x += this.v * DT;
    const lo = this.w / 2 + 10, hi = W - this.w / 2 - 10;
    if (this.x < lo) { this.x = lo; this.v = Math.abs(this.v); }
    if (this.x > hi) { this.x = hi; this.v = -Math.abs(this.v); }

    if (a[0] > 0.3 && this.cooldown === 0) this.drop();
    else if (this.sinceSpawn > 6) this.done = true; // dawdling topples the tower
    this.score = (this.tower.length - 1) * 10 + this.perfects * 5;
  }

  drop() {
    const top = this.top;
    const dx = this.x - top.x;
    if (Math.abs(dx) <= this.perfectTol) {
      this.tower.push({ x: top.x, w: this.w });
      this.perfects++;
      this.cut = null;
    } else {
      const left = Math.max(this.x - this.w / 2, top.x - top.w / 2);
      const right = Math.min(this.x + this.w / 2, top.x + top.w / 2);
      if (right - left < 2) { this.done = true; return; }
      this.cut = { x: dx > 0 ? right : this.x - this.w / 2, w: this.w - (right - left), level: this.tower.length, life: 1 };
      this.w = right - left;
      this.tower.push({ x: (left + right) / 2, w: this.w });
    }
    const speed = Math.min(300, 110 + this.tower.length * 7);
    this.v = this.rng.chance(0.5) ? speed : -speed;
    this.x = this.v > 0 ? this.w / 2 + 10 : W - this.w / 2 - 10;
    this.sinceSpawn = 0;
    this.cooldown = 0.25;
  }

  draw(ctx, sprite) {
    sky(ctx, '#ffd9e8', '#fff3f8');
    const n = this.tower.length;
    const base = H - 20;
    const scroll = Math.max(0, n - 11) * BLOCK_H;
    const yOf = (level) => base - (level + 1) * BLOCK_H + scroll;
    for (let i = Math.max(0, n - 14); i < n; i++) {
      const b = this.tower[i];
      ctx.fillStyle = `hsl(${(this.hue + i * 9) % 360} 65% 62%)`;
      ctx.fillRect(b.x - b.w / 2, yOf(i), b.w, BLOCK_H - 1);
    }
    if (this.cut && this.cut.life > 0) {
      this.cut.life -= 0.03;
      ctx.globalAlpha = Math.max(0, this.cut.life);
      ctx.fillStyle = '#999';
      ctx.fillRect(this.cut.x, yOf(this.cut.level) + (1 - this.cut.life) * 60, this.cut.w, BLOCK_H - 1);
      ctx.globalAlpha = 1;
    }
    const y = yOf(n) - 24;
    ctx.fillStyle = `hsl(${(this.hue + n * 9) % 360} 65% 62%)`;
    ctx.fillRect(this.x - this.w / 2, y, this.w, BLOCK_H - 1);
    // The pet rides the crane hook above the moving block.
    ctx.strokeStyle = '#555';
    ctx.beginPath(); ctx.moveTo(this.x, y); ctx.lineTo(this.x, y - 16); ctx.stroke();
    drawSprite(ctx, sprite, this.x, y - 28, 26, { flip: this.v < 0 });
    hud(ctx, `Height ${n - 1}`, `Perfect ${this.perfects}`);
  }
}

export default {
  id: 'stack', slot: 6, name: 'Tower Stack', genre: 'Timing stacker', icon: '🧱',
  blurb: 'Drop sliding blocks onto the tower. Overhangs get sliced off.',
  uses: ['reflex', 'focus'],
  par: 300, maxSteps: 3600,
  create: (rng, t) => new StackGame(rng, t),
};
