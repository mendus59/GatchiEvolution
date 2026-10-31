// Berry Grove: forage a hedge maze for berries while beetles roam the paths.
import { W, H, DT, drawSprite, hud } from './common.js';

const COLS = 15, ROWS = 9, CELL = 30;
const OX = (W - COLS * CELL) / 2, OY = 0;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // up right down left

function buildMaze(rng) {
  // walls[c][r] = bitmask of open directions
  const open = Array.from({ length: COLS * ROWS }, () => 0);
  const seen = new Array(COLS * ROWS).fill(false);
  const stack = [[0, 0]];
  seen[0] = true;
  while (stack.length) {
    const [c, r] = stack[stack.length - 1];
    const options = [];
    for (let d = 0; d < 4; d++) {
      const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
      if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && !seen[nr * COLS + nc]) options.push(d);
    }
    if (!options.length) { stack.pop(); continue; }
    const d = rng.pick(options);
    const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
    open[r * COLS + c] |= 1 << d;
    open[nr * COLS + nc] |= 1 << ((d + 2) % 4);
    seen[nr * COLS + nc] = true;
    stack.push([nc, nr]);
  }
  // Knock out extra walls so the grove has loops to escape through.
  for (let i = 0; i < 28; i++) {
    const c = rng.int(0, COLS - 1), r = rng.int(0, ROWS - 1), d = rng.int(0, 3);
    const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
    if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
    open[r * COLS + c] |= 1 << d;
    open[nr * COLS + nc] |= 1 << ((d + 2) % 4);
  }
  return open;
}

class Mover {
  constructor(c, r, speed) {
    this.c = c; this.r = r; this.tc = c; this.tr = r; this.p = 1; this.speed = speed; this.dir = -1;
  }
  get x() { return this.c + (this.tc - this.c) * this.p; }
  get y() { return this.r + (this.tr - this.r) * this.p; }
  atCenter() { return this.p >= 1; }
  go(d) {
    this.c = this.tc; this.r = this.tr;
    this.tc = this.c + DIRS[d][0]; this.tr = this.r + DIRS[d][1];
    this.p = 0; this.dir = d;
  }
  advance() {
    if (this.p < 1) this.p = Math.min(1, this.p + this.speed * DT);
    if (this.p >= 1) { this.c = this.tc; this.r = this.tr; }
  }
}

class GroveGame {
  constructor(rng, t) {
    this.rng = rng;
    this.open = buildMaze(rng);
    this.pet = new Mover(7, 4, 3 + 3.2 * t.speed);
    this.catchDist = 0.3 + 0.25 * t.radius;
    this.vis = 2 + Math.round(6 * t.vision);
    this.beetles = [[0, 0], [COLS - 1, 0], [0, ROWS - 1], [COLS - 1, ROWS - 1]]
      .slice(0, 3).map(([c, r]) => new Mover(c, r, 2.2));
    this.berries = new Uint8Array(COLS * ROWS);
    this.refill();
    this.eaten = 0;
    this.rounds = 0;
    this.done = false;
    this.score = 0;
    this.frame = 0;
    this.want = [0, 0, 0, 0];
  }

  refill() {
    this.berries.fill(1);
    this.berries[this.pet.tr * COLS + this.pet.tc] = 0;
    this.left = COLS * ROWS - 1;
    this.scent = null;
  }

  isOpen(c, r, d) { return (this.open[r * COLS + c] >> d) & 1; }

  // Multi-source BFS over the maze: path distance from every cell to the
  // nearest source cell. Gives the pet a "scent" to follow along corridors.
  flood(sources) {
    const dist = this.dist || (this.dist = new Int16Array(COLS * ROWS));
    const queue = this.queue || (this.queue = new Int16Array(COLS * ROWS));
    dist.fill(-1);
    let head = 0, tail = 0;
    for (const i of sources) if (dist[i] < 0) { dist[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], c = i % COLS, r = (i - c) / COLS;
      for (let d = 0; d < 4; d++) {
        if (!this.isOpen(c, r, d)) continue;
        const j = (r + DIRS[d][1]) * COLS + c + DIRS[d][0];
        if (dist[j] < 0) { dist[j] = dist[i] + 1; queue[tail++] = j; }
      }
    }
    return dist;
  }

  // The cell the pet is closest to; it eats and senses from there.
  near() {
    const p = this.pet;
    return p.p >= 0.5 ? [p.tc, p.tr] : [p.c, p.r];
  }

  sense(s) {
    const [c, r] = this.near();
    if (!this.scent) {
      const berrySources = [];
      for (let i = 0; i < this.berries.length; i++) if (this.berries[i]) berrySources.push(i);
      this.scent = Int16Array.from(this.flood(berrySources));
    }
    const scent = this.scent;
    const danger = this.flood(this.beetles.flatMap((b) => [b.tr * COLS + b.tc, b.r * COLS + b.c]));
    for (let d = 0; d < 4; d++) {
      if (!this.isOpen(c, r, d)) { s[d] = -1; s[d + 4] = 0; continue; }
      const j = (r + DIRS[d][1]) * COLS + c + DIRS[d][0];
      s[d] = scent[j] < 0 ? 0 : Math.max(0.05, 1 - scent[j] / 20);
      s[d + 4] = danger[j] >= 0 && danger[j] <= this.vis ? 1 - danger[j] / (this.vis + 1) : 0;
    }
  }

  step(a) {
    this.frame++;
    // Two outputs map onto four directions: up/down and right/left.
    this.want[0] = a[0]; this.want[2] = -a[0]; this.want[1] = a[1]; this.want[3] = -a[1];
    const pet = this.pet;
    if (pet.atCenter()) {
      let best = -1, bestV = -Infinity;
      for (let d = 0; d < 4; d++) {
        if (this.isOpen(pet.c, pet.r, d) && this.want[d] > bestV) { bestV = this.want[d]; best = d; }
      }
      if (best >= 0) pet.go(best);
    } else if (pet.dir >= 0 && this.want[(pet.dir + 2) % 4] > this.want[pet.dir] + 0.6) {
      // Turn back mid-corridor.
      const back = (pet.dir + 2) % 4;
      const [oc, or] = [pet.c, pet.r];
      pet.c = pet.tc; pet.r = pet.tr; pet.tc = oc; pet.tr = or; pet.p = 1 - pet.p; pet.dir = back;
    }
    pet.advance();
    const [nc, nr] = this.near();
    const i = nr * COLS + nc;
    if (this.berries[i]) {
      this.berries[i] = 0; this.eaten++; this.left--; this.scent = null;
      if (this.left <= 0) { this.rounds++; this.refill(); }
    }

    const speedUp = 1 + this.frame / 3600 * 0.5;
    for (const b of this.beetles) {
      b.speed = 2.2 * speedUp;
      if (b.atCenter()) {
        const opts = [];
        for (let d = 0; d < 4; d++) if (this.isOpen(b.c, b.r, d) && d !== (b.dir + 2) % 4) opts.push(d);
        if (!opts.length) opts.push((b.dir + 2) % 4);
        let d = this.rng.pick(opts);
        if (this.rng.chance(0.3)) {
          let bestDist = Infinity;
          for (const o of opts) {
            const dist = Math.abs(b.c + DIRS[o][0] - pet.x) + Math.abs(b.r + DIRS[o][1] - pet.y);
            if (dist < bestDist) { bestDist = dist; d = o; }
          }
        }
        b.go(d);
      }
      b.advance();
      if (Math.abs(b.x - pet.x) + Math.abs(b.y - pet.y) < this.catchDist) this.done = true;
    }
    this.score = this.eaten * 10 + this.rounds * 100;
  }

  draw(ctx, sprite) {
    ctx.fillStyle = '#e6f4d7';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#3f7d3a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = OX + c * CELL, y = OY + r * CELL;
        if (!this.isOpen(c, r, 0)) { ctx.moveTo(x, y); ctx.lineTo(x + CELL, y); }
        if (!this.isOpen(c, r, 3)) { ctx.moveTo(x, y); ctx.lineTo(x, y + CELL); }
        if (r === ROWS - 1) { ctx.moveTo(x, y + CELL); ctx.lineTo(x + CELL, y + CELL); }
        if (c === COLS - 1) { ctx.moveTo(x + CELL, y); ctx.lineTo(x + CELL, y + CELL); }
      }
    }
    ctx.stroke();
    ctx.fillStyle = '#c2185b';
    for (let i = 0; i < this.berries.length; i++) {
      if (!this.berries[i]) continue;
      const c = i % COLS, r = Math.floor(i / COLS);
      ctx.beginPath();
      ctx.arc(OX + (c + 0.5) * CELL, OY + (r + 0.5) * CELL, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of this.beetles) {
      const x = OX + (b.x + 0.5) * CELL, y = OY + (b.y + 0.5) * CELL;
      ctx.fillStyle = '#2b2233';
      ctx.beginPath(); ctx.ellipse(x, y, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#5a4a6a'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
    }
    const flip = this.pet.dir === 3;
    drawSprite(ctx, sprite, OX + (this.pet.x + 0.5) * CELL, OY + (this.pet.y + 0.5) * CELL, 26, { flip });
    hud(ctx, `Berries ${this.eaten}`, `Score ${this.score}`);
  }
}

export default {
  id: 'grove', slot: 1, name: 'Berry Grove', genre: 'Maze forager', icon: '🫐',
  blurb: 'Gobble berries in a hedge maze while beetles hunt you down.',
  uses: ['speed', 'vision', 'radius'],
  par: 500, maxSteps: 3600,
  create: (rng, t) => new GroveGame(rng, t),
};
