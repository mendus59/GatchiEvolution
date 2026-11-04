// Genetic algorithm. The population is always made of whole-pet genomes
// descended from the user's Gatchi. Training on one challenge reshapes that
// game's own brain and, gently, the body every game shares.
import { mutate, crossover, cloneGenome, upgradeGenome, brainStart, REGIONS, MAX_CHALLENGES, EMBED_SIZE, BRAIN_SIZE } from './genome.js';
import { Rng, mixSeeds } from './rng.js';
import { runEpisode } from './runner.js';
import { CHALLENGES, byId } from './challenges/index.js';

export const BALANCED = 'balanced';

// Skill test: every game on the same fixed courses, so before/after
// comparisons show real change, not course luck. The app's skill profile and
// the retention guard below both use it.
export const SKILL_SEEDS = 4;
export function skillRating(genome, challenge, maxSteps = challenge.maxSteps) {
  let total = 0;
  for (let k = 0; k < SKILL_SEEDS; k++) total += runEpisode(challenge, genome, mixSeeds('profile', challenge.id, k), { maxSteps });
  return total / SKILL_SEEDS / challenge.par;
}

// Skill retention. Each game has its own brain, so a focused session only
// reaches other games through the shared body. Any candidate whose body
// differs from the pet's plays every other game on the skill-test courses and
// loses fitness for a drop below that game's floor: a small allowed slide from
// where the session started, and never below a share of the personal best.
// Long, one-sided training can still soften other games a little.
export const GUARD = {
  maxSteps: 3600, // full games: a capped course hides late-game losses
  tolerance: 0.1, // a session may soften another game by about 10%...
  slack: 0.02, // ...plus a little absolute room for low skills
  keepBest: 0.75, // but never below 75% of its personal best
  weight: 1.5, // fitness lost per 100% of a game's starting skill below its floor
};

export function guardRating(genome, challenge) {
  return skillRating(genome, challenge, Math.min(challenge.maxSteps, GUARD.maxSteps));
}

// `mastery` is optional: { ratings, bestRatings } from the pet's skill tests.
export function retentionFloors(genome, focus, mastery = {}) {
  const floors = {};
  const now = mastery.ratings || {};
  const best = mastery.bestRatings || {};
  for (const c of CHALLENGES) {
    if (c.id === focus) continue;
    const start = guardRating(genome, c);
    let floor = start * (1 - GUARD.tolerance) - GUARD.slack;
    if (best[c.id] > 0 && now[c.id] > 0.02) {
      // The personal best comes from the skill test, the same courses as
      // this check; the ratio keeps it honest if the ratings are stale.
      floor = Math.max(floor, start * Math.min(3, best[c.id] / now[c.id]) * GUARD.keepBest);
    }
    if (floor > 0) floors[c.id] = { floor, scale: Math.max(start, 0.05) };
  }
  return floors;
}

export function retentionPenalty(genome, floors) {
  let penalty = 0;
  for (const [id, { floor, scale }] of Object.entries(floors)) {
    const r = guardRating(genome, byId[id]);
    if (r < floor) penalty += (floor - r) / scale;
  }
  return penalty * GUARD.weight;
}

const bodyKey = (g) => g.genes.slice(REGIONS.body.start, REGIONS.body.start + REGIONS.body.size).join(',');
const slotOf = (focus) => (focus === BALANCED || !byId[focus] ? null : byId[focus].slot);

export function seedPopulation(pet, size, rng, focus = BALANCED) {
  pet = upgradeGenome(pet);
  const pop = [cloneGenome(pet)];
  while (pop.length < size) pop.push(mutate(pet, rng, 1 + rng.next(), slotOf(focus)));
  return pop;
}

// Every member takes the pet's brains and embeddings for the games that are
// not being trained, so a saved population from another session cannot sneak
// in changes to them.
function adoptOtherSkills(genome, pet, focusSlot) {
  const g = cloneGenome(genome);
  for (let s = 0; s < MAX_CHALLENGES; s++) {
    if (s === focusSlot) continue;
    const b = brainStart(s);
    for (let i = b; i < b + BRAIN_SIZE; i++) g.genes[i] = pet.genes[i];
    const e = REGIONS.embed.start + s * EMBED_SIZE;
    for (let i = e; i < e + EMBED_SIZE; i++) g.genes[i] = pet.genes[i];
  }
  return g;
}

// Fitness of one genome for one generation. Every member of a generation sees
// the same seeds, so ranking is fair; seeds change each generation, so the pet
// learns the game rather than memorizing one layout.
export function evaluate(genome, focus, gen, baseSeed, seedsPerEval) {
  if (focus === BALANCED) {
    let sum = 0;
    for (const c of CHALLENGES) {
      const seed = mixSeeds(baseSeed, gen, c.id);
      sum += Math.min(2, runEpisode(c, genome, seed, { maxSteps: Math.min(c.maxSteps, 1800) }) / c.par);
    }
    return { fitness: sum / CHALLENGES.length, raw: sum / CHALLENGES.length };
  }
  const c = byId[focus];
  let total = 0;
  for (let k = 0; k < seedsPerEval; k++) total += runEpisode(c, genome, mixSeeds(baseSeed, gen, k));
  const raw = total / seedsPerEval;
  return { fitness: raw / c.par, raw };
}

export class Trainer {
  constructor({ population, focus, baseSeed, gen = 0, popSize = 24, seedsPerEval = 2, elite = 2, retain = true, mastery }) {
    this.focus = focus;
    this.baseSeed = baseSeed;
    this.gen = gen;
    this.popSize = popSize;
    this.seedsPerEval = seedsPerEval;
    this.elite = elite;
    this.rng = new Rng(mixSeeds('ga', baseSeed, gen));
    this.focusSlot = slotOf(focus);
    population = population.map(upgradeGenome);
    const pet = population[0];
    if (this.focusSlot !== null) population = [pet, ...population.slice(1).map((g) => adoptOtherSkills(g, pet, this.focusSlot))];
    this.population = population.slice(0, popSize);
    while (this.population.length < popSize) this.population.push(mutate(pet, this.rng, 1.5, this.focusSlot));
    this.bestEver = -Infinity;
    this.stagnant = 0;
    this.startBody = bodyKey(pet);
    this.floors = retain && this.focusSlot !== null ? retentionFloors(pet, focus, mastery) : {};
    this.penalties = new Map(); // body genes -> penalty, so repeat bodies are not re-checked
  }

  // Other games only change if the body did, so only those candidates are
  // checked against the floors.
  penaltyOf(genome) {
    const key = bodyKey(genome);
    if (key === this.startBody) return 0;
    let p = this.penalties.get(key);
    if (p === undefined) {
      p = retentionPenalty(genome, this.floors);
      if (this.penalties.size > 1000) this.penalties.clear();
      this.penalties.set(key, p);
    }
    return p;
  }

  rank() {
    const ranked = this.population.map((genome) => ({ genome, ...evaluate(genome, this.focus, this.gen, this.baseSeed, this.seedsPerEval) }));
    if (Object.keys(this.floors).length) {
      for (const r of ranked) r.fitness -= this.penaltyOf(r.genome);
    }
    return ranked.sort((a, b) => b.fitness - a.fitness);
  }

  tournament(ranked, k = 3) {
    let best = null;
    for (let i = 0; i < k; i++) {
      const c = ranked[Math.floor(this.rng.next() * ranked.length)];
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best.genome;
  }

  // Evaluate the current population, then breed the next one.
  step() {
    const ranked = this.rank();

    const best = ranked[0];
    const mean = ranked.reduce((s, r) => s + r.raw, 0) / ranked.length;
    if (best.fitness > this.bestEver + 1e-6) { this.bestEver = best.fitness; this.stagnant = 0; }
    else this.stagnant++;
    const strength = Math.min(2.5, 1 + this.stagnant * 0.15);

    this.gen++;
    const champion = cloneGenome(best.genome);
    champion.gen = this.gen;
    const next = [champion];
    for (let i = 1; i < this.elite; i++) next.push(cloneGenome(ranked[i].genome));
    while (next.length < this.popSize) {
      let child;
      if (this.rng.next() < 0.6) child = crossover(this.tournament(ranked), this.tournament(ranked), this.rng);
      else child = cloneGenome(this.tournament(ranked));
      child = mutate(child, this.rng, strength, this.focusSlot);
      child.gen = this.gen;
      next.push(child);
    }
    this.population = next;
    return { gen: this.gen, focus: this.focus, best: best.raw, bestFitness: best.fitness, mean, champion };
  }
}
