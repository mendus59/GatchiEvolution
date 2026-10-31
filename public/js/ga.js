// Genetic algorithm. The population is always made of whole-pet genomes
// descended from the user's Gatchi, so training on one challenge reshapes the
// body and the shared brain the pet uses everywhere.
import { mutate, crossover, cloneGenome } from './genome.js';
import { Rng, mixSeeds } from './rng.js';
import { runEpisode } from './runner.js';
import { CHALLENGES, byId } from './challenges/index.js';

export const BALANCED = 'balanced';

export function seedPopulation(pet, size, rng) {
  const pop = [cloneGenome(pet)];
  while (pop.length < size) pop.push(mutate(pet, rng, 1 + rng.next()));
  return pop;
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
  constructor({ population, focus, baseSeed, gen = 0, popSize = 24, seedsPerEval = 2, elite = 2 }) {
    this.focus = focus;
    this.baseSeed = baseSeed;
    this.gen = gen;
    this.popSize = popSize;
    this.seedsPerEval = seedsPerEval;
    this.elite = elite;
    this.rng = new Rng(mixSeeds('ga', baseSeed, gen));
    this.population = population.slice(0, popSize);
    while (this.population.length < popSize) this.population.push(mutate(population[0], this.rng, 1.5));
    this.bestEver = -Infinity;
    this.stagnant = 0;
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
    const ranked = this.population
      .map((genome) => ({ genome, ...evaluate(genome, this.focus, this.gen, this.baseSeed, this.seedsPerEval) }))
      .sort((a, b) => b.fitness - a.fitness);

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
      child = mutate(child, this.rng, strength);
      child.gen = this.gen;
      next.push(child);
    }
    this.population = next;
    return { gen: this.gen, focus: this.focus, best: best.raw, bestFitness: best.fitness, mean, champion };
  }
}
