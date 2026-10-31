// The Gatchi genome: one flat vector of real numbers split into regions.
//
//   BODY   physical genes. Decoded into traits that every challenge uses, so
//          changing one helps some challenges and hurts others.
//   LOOKS  purely visual genes (colors, silhouette, pattern, ornaments).
//   EMBED  a small learned "context" vector per challenge slot, fed into the
//          brain so it can tell which game it is playing.
//   BRAIN  weights of one shared feed-forward neural network. Every challenge
//          runs through the same network, so training on one game always
//          changes how the pet plays all the others.
//
// Gene values are quantized to 4 decimals so JSON round trips (localStorage,
// cloud backup) reproduce behaviour exactly.

import { Rng, hashString, randomSeed } from './rng.js';

export const GENOME_VERSION = 1;

export const BODY_GENES = ['size', 'limb', 'muscle', 'eye', 'nerve', 'metab', 'wing', 'focus'];
export const LOOK_GENES = [
  'hue', 'hue2', 'hue3', 'sat', 'light',
  'sh2', 'sh3', 'sh4', 'sh5', 'ph2', 'ph3', 'ph4', 'ph5',
  'pattern', 'patDensity', 'patScale',
  'eyeCount', 'eyeSpread', 'antenna', 'ears', 'tail', 'cheeks', 'mouth', 'feet',
];

export const MAX_CHALLENGES = 16; // embedding slots reserved for future games
export const EMBED_SIZE = 4;
export const SENSORS = 8;
export const OUTPUTS = 3;
export const HIDDEN = 12;
export const NET_IN = SENSORS + EMBED_SIZE + 1; // + bias

const W1 = NET_IN * HIDDEN;
const W2 = (HIDDEN + 1) * OUTPUTS;

export const REGIONS = {};
let cursor = 0;
for (const [name, size] of [
  ['body', BODY_GENES.length],
  ['looks', LOOK_GENES.length],
  ['embed', MAX_CHALLENGES * EMBED_SIZE],
  ['w1', W1],
  ['w2', W2],
]) {
  REGIONS[name] = { start: cursor, size };
  cursor += size;
}
export const GENOME_LENGTH = cursor;

const MUTATION_SIGMA = { body: 0.18, looks: 0.06, embed: 0.3, w1: 0.3, w2: 0.3 };

export const q = (x) => Math.round(Math.max(-6, Math.min(6, x)) * 1e4) / 1e4;
// softsign squash to 0..1. Uses only basic arithmetic so it is bit-identical
// across JS engines (unlike Math.exp/Math.tanh).
export const squash = (x) => 0.5 + 0.5 * (x / (1 + Math.abs(x)));
const softsign = (x) => x / (1 + Math.abs(x));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function regionOf(index) {
  for (const [name, r] of Object.entries(REGIONS)) {
    if (index >= r.start && index < r.start + r.size) return name;
  }
  return null;
}

export function randomGenome(seed = randomSeed()) {
  const rng = new Rng(seed);
  const genes = new Array(GENOME_LENGTH);
  for (let i = 0; i < GENOME_LENGTH; i++) {
    const region = regionOf(i);
    const scale = region === 'w1' || region === 'w2' ? 0.6 : region === 'body' ? 0.7 : 1.2;
    genes[i] = q(rng.gauss() * scale);
  }
  return { v: GENOME_VERSION, genes, gen: 0, lineage: [] };
}

export function fingerprint(genome) {
  const h = hashString(genome.genes.join(','));
  return 'GX-' + h.toString(16).toUpperCase().padStart(8, '0');
}

export function validateGenome(g) {
  return !!g && Array.isArray(g.genes) && g.genes.length === GENOME_LENGTH &&
    g.genes.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= 6);
}

// ---- Phenotype --------------------------------------------------------------

export function decodeBody(genome) {
  const b = {};
  BODY_GENES.forEach((name, i) => { b[name] = squash(genome.genes[REGIONS.body.start + i]); });
  return b;
}

export function decodeLooks(genome) {
  const l = {};
  LOOK_GENES.forEach((name, i) => { l[name] = genome.genes[REGIONS.looks.start + i]; });
  return l;
}

// Derived, game-facing traits (all roughly 0..1). The overlapping weights are
// deliberate pleiotropy: mass makes a Gatchi stable and strong but slow and a
// bigger target; long limbs help running and jumping but cost agility; a fast
// metabolism powers muscles but makes the pet hungry.
export function traits(genome) {
  const b = decodeBody(genome);
  const t = {
    mass: b.size,
    speed: clamp01(0.25 + 0.45 * b.muscle + 0.35 * b.limb - 0.35 * b.size + 0.1 * b.metab),
    jump: clamp01(0.2 + 0.4 * b.muscle + 0.3 * b.limb + 0.25 * b.wing - 0.4 * b.size),
    agility: clamp01(0.3 + 0.45 * b.nerve - 0.3 * b.size - 0.2 * b.limb + 0.2 * b.wing),
    strength: clamp01(0.1 + 0.5 * b.size + 0.45 * b.muscle),
    lift: clamp01(0.2 + 0.65 * b.wing - 0.45 * b.size + 0.15 * b.muscle),
    vision: clamp01(0.15 + 0.8 * b.eye),
    reflex: clamp01(0.2 + 0.55 * b.nerve + 0.25 * b.metab - 0.15 * b.size),
    focus: clamp01(0.2 + 0.7 * b.focus - 0.2 * b.metab + 0.1 * b.eye),
    stamina: clamp01(0.3 + 0.35 * b.size + 0.2 * b.focus - 0.35 * b.metab),
    radius: 0.7 + 0.6 * b.size, // relative hitbox scale
  };
  // Upkeep: powerful bodies cost more food. Read by the pet-care loop.
  t.appetite = 0.6 + 0.5 * b.metab + 0.35 * b.muscle + 0.25 * b.size + 0.15 * b.wing;
  return t;
}

// Ticks between brain decisions (1 = every frame). Slow nerves react late.
export function thinkInterval(t) {
  return 1 + Math.round((1 - t.reflex) * 3);
}

// ---- Brain ------------------------------------------------------------------

export class Brain {
  constructor(genome, challengeIndex) {
    const g = genome.genes;
    this.w1 = Float64Array.from(g.slice(REGIONS.w1.start, REGIONS.w1.start + W1));
    this.w2 = Float64Array.from(g.slice(REGIONS.w2.start, REGIONS.w2.start + W2));
    const e = REGIONS.embed.start + (challengeIndex % MAX_CHALLENGES) * EMBED_SIZE;
    this.embed = g.slice(e, e + EMBED_SIZE).map(softsign);
    this.input = new Float64Array(NET_IN);
    this.hidden = new Float64Array(HIDDEN);
    this.out = new Float64Array(OUTPUTS);
  }
  act(sensors) {
    const x = this.input;
    for (let i = 0; i < SENSORS; i++) {
      const s = sensors[i];
      x[i] = s > 1 ? 1 : s < -1 ? -1 : s;
    }
    for (let i = 0; i < EMBED_SIZE; i++) x[SENSORS + i] = this.embed[i];
    x[NET_IN - 1] = 1;
    for (let h = 0; h < HIDDEN; h++) {
      let sum = 0;
      const base = h * NET_IN;
      for (let i = 0; i < NET_IN; i++) sum += this.w1[base + i] * x[i];
      this.hidden[h] = softsign(sum);
    }
    for (let o = 0; o < OUTPUTS; o++) {
      const base = o * (HIDDEN + 1);
      let sum = this.w2[base + HIDDEN];
      for (let h = 0; h < HIDDEN; h++) sum += this.w2[base + h] * this.hidden[h];
      this.out[o] = softsign(sum);
    }
    return this.out;
  }
}

// ---- Variation operators ----------------------------------------------------

export function mutate(genome, rng, strength = 1) {
  const genes = genome.genes.slice();
  for (const [name, r] of Object.entries(REGIONS)) {
    const sigma = MUTATION_SIGMA[name] * strength;
    const p = name === 'looks' ? 0.04 : 0.08;
    for (let i = r.start; i < r.start + r.size; i++) {
      if (rng.next() < p) genes[i] = q(genes[i] + rng.gauss() * sigma);
      else if (rng.next() < 0.003) genes[i] = q(rng.gauss()); // rare macro-mutation
    }
  }
  return { v: GENOME_VERSION, genes, gen: genome.gen, lineage: genome.lineage };
}

// Uniform crossover, but hidden neurons are inherited as whole units so a
// useful feature detector is not torn apart.
export function crossover(a, b, rng) {
  const genes = a.genes.slice();
  const pick = (start, len) => {
    if (rng.next() < 0.5) for (let i = start; i < start + len; i++) genes[i] = b.genes[i];
  };
  for (const name of ['body', 'looks', 'embed']) {
    const r = REGIONS[name];
    for (let i = r.start; i < r.start + r.size; i++) pick(i, 1);
  }
  for (let h = 0; h < HIDDEN; h++) pick(REGIONS.w1.start + h * NET_IN, NET_IN);
  for (let o = 0; o < OUTPUTS; o++) pick(REGIONS.w2.start + o * (HIDDEN + 1), HIDDEN + 1);
  return { v: GENOME_VERSION, genes, gen: Math.max(a.gen, b.gen), lineage: a.lineage };
}

export function cloneGenome(g) {
  return { v: g.v, genes: g.genes.slice(), gen: g.gen, lineage: (g.lineage || []).slice() };
}
