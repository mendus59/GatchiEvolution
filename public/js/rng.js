// Seeded, deterministic random numbers. Every simulation draws from one of
// these so a (genome, challenge, seed) triple always replays identically.

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mixSeeds(...parts) {
  return hashString(parts.join(':'));
}

export class Rng {
  constructor(seed) {
    this.s = (seed >>> 0) || 0x9e3779b9;
    this.spare = null;
  }
  // mulberry32
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // Box-Muller with a cached spare value.
  gauss() {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    v = this.next();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }
}

export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0];
  }
  return Math.floor(Math.random() * 2 ** 32);
}
