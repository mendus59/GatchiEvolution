// Loop Racer: steer around a procedurally shaped loop track as fast as you can.
import { W, H, DT, clamp, drawSprite, hud } from './common.js';

const N = 96;
const HALF = 22;
const CELL = 4;
const GW = W / CELL, GH = Math.ceil(H / CELL);
const RAYS = [-0.9, -0.45, 0, 0.45, 0.9];
const trackCache = new Map();

function buildTrack(rng) {
  const key = rng.s;
  if (trackCache.has(key)) return trackCache.get(key);
  const a2 = rng.range(0, 0.16), p2 = rng.range(0, 6.28);
  const a3 = rng.range(0, 0.12), p3 = rng.range(0, 6.28);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2;
    const r = 1 + a2 * Math.cos(2 * th + p2) + a3 * Math.cos(3 * th + p3);
    pts.push([W / 2 + 190 * r * Math.cos(th), H / 2 + 98 * r * Math.sin(th)]);
  }
  const grid = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2;
      let best = Infinity;
      for (let i = 0; i < N; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % N];
        const dx = bx - ax, dy = by - ay;
        const u = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        const ex = ax + u * dx - x, ey = ay + u * dy - y;
        const d = ex * ex + ey * ey;
        if (d < best) best = d;
      }
      grid[gy * GW + gx] = best < HALF * HALF ? 1 : 0;
    }
  }
  const track = { pts, grid };
  if (trackCache.size > 64) trackCache.clear();
  trackCache.set(key, track);
  return track;
}

class RacerGame {
  constructor(rng, t) {
    this.track = buildTrack(rng);
    const [x0, y0] = this.track.pts[0], [x1, y1] = this.track.pts[1];
    this.x = x0; this.y = y0;
    const len = Math.hypot(x1 - x0, y1 - y0);
    this.hx = (x1 - x0) / len; this.hy = (y1 - y0) / len;
    this.v = 0;
    this.vmax = 80 + 130 * t.speed;
    this.accel = 90 + 120 * t.strength;
    this.turn = 1.6 + 2.6 * t.agility;
    this.range = 50 + 150 * t.vision;
    this.idx = 0;
    this.passed = 0;
    this.stall = 0;
    this.done = false;
    this.score = 0;
    this.rays = new Float64Array(RAYS.length);
  }

  onTrack(x, y) {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return false;
    return this.track.grid[gy * GW + gx] === 1;
  }

  sense(s) {
    for (let i = 0; i < RAYS.length; i++) {
      const c = Math.cos(RAYS[i]), sn = Math.sin(RAYS[i]);
      const dx = this.hx * c - this.hy * sn, dy = this.hx * sn + this.hy * c;
      let d = 0;
      while (d < this.range && this.onTrack(this.x + dx * d, this.y + dy * d)) d += 6;
      this.rays[i] = Math.min(d, this.range) / this.range;
      s[i] = this.rays[i];
    }
    const pts = this.track.pts;
    const [ax, ay] = pts[this.idx], [bx, by] = pts[(this.idx + 2) % N];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const tx = (bx - ax) / len, ty = (by - ay) / len;
    s[5] = this.v / this.vmax;
    s[6] = this.hx * ty - this.hy * tx; // sin of heading error
    s[7] = ((this.x - ax) * ty - (this.y - ay) * tx) / HALF; // lateral offset
  }

  step(a) {
    const steer = clamp(a[0], -1, 1);
    const grip = 1 - 0.45 * (this.v / this.vmax);
    const ang = steer * this.turn * grip * DT;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const hx = this.hx * c - this.hy * sn, hy = this.hx * sn + this.hy * c;
    this.hx = hx; this.hy = hy;
    if (a[1] > 0) this.v += this.accel * a[1] * DT;
    else this.v += this.accel * 1.6 * a[1] * DT;
    this.v = clamp(this.v - this.v * 0.25 * DT, 0, this.vmax);
    this.x += this.hx * this.v * DT;
    this.y += this.hy * this.v * DT;

    if (!this.onTrack(this.x, this.y)) { this.done = true; return; }

    // Track progress by searching near the last known centerline point.
    const pts = this.track.pts;
    let best = this.idx, bestD = Infinity;
    for (let k = -3; k <= 6; k++) {
      const i = (this.idx + k + N) % N;
      const d = (pts[i][0] - this.x) ** 2 + (pts[i][1] - this.y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    let delta = best - this.idx;
    if (delta > N / 2) delta -= N;
    if (delta < -N / 2) delta += N;
    this.passed += delta;
    this.idx = best;
    this.stall = delta > 0 ? 0 : this.stall + DT;
    if (this.stall > 4) this.done = true;
    this.score = Math.max(0, Math.floor((this.passed / N) * 100));
  }

  draw(ctx, sprite) {
    ctx.fillStyle = '#6fbf5f';
    ctx.fillRect(0, 0, W, H);
    const pts = this.track.pts;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = HALF * 2 + 4;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = '#555c66';
    ctx.lineWidth = HALF * 2 - 2;
    ctx.stroke();
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    const [sx, sy] = pts[0];
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx - 2, sy - HALF, 4, HALF * 2);
    drawSprite(ctx, sprite, this.x, this.y, 22, { rot: Math.atan2(this.hy, this.hx) });
    hud(ctx, `Laps ${(this.passed / N).toFixed(2)}`, `${Math.round(this.v)} px/s`);
  }
}

export default {
  id: 'racer', slot: 2, name: 'Loop Racer', genre: 'Racing', icon: '🏁',
  blurb: 'Tear around a twisting loop track without spinning off.',
  uses: ['speed', 'agility', 'strength', 'vision'],
  par: 500, maxSteps: 2700,
  create: (rng, t) => new RacerGame(rng, t),
};
