// Runs a genome through a challenge. Headless runs (training, versus
// verification) and on-screen playback share this code, so a recorded seed
// always replays the same game.
import { Brain, traits, thinkInterval, SENSORS } from './genome.js';
import { Rng, mixSeeds } from './rng.js';
import { byId } from './challenges/index.js';

export class Episode {
  constructor(challenge, genome, seed, opts = {}) {
    this.def = typeof challenge === 'string' ? byId[challenge] : challenge;
    this.traits = traits(genome);
    this.brain = new Brain(genome, this.def.slot);
    this.game = this.def.create(new Rng(mixSeeds('world', seed)), this.traits);
    this.noiseRng = new Rng(mixSeeds('noise', seed));
    this.interval = thinkInterval(this.traits);
    this.noise = (1 - this.traits.focus) * 0.2;
    this.maxSteps = opts.maxSteps ?? this.def.maxSteps;
    this.sensors = new Float64Array(SENSORS);
    this.actions = [0, 0, 0];
    this.steps = 0;
  }
  get done() { return this.game.done || this.steps >= this.maxSteps; }
  get score() { return this.game.score; }
  tick() {
    if (this.done) return;
    if (this.steps % this.interval === 0) {
      this.game.sense(this.sensors);
      const out = this.brain.act(this.sensors);
      for (let i = 0; i < out.length; i++) this.actions[i] = out[i] + this.noise * this.noiseRng.gauss();
    }
    this.game.step(this.actions);
    this.steps++;
  }
  run() {
    while (!this.done) this.tick();
    return this.game.score;
  }
}

export function runEpisode(challenge, genome, seed, opts) {
  return new Episode(challenge, genome, seed, opts).run();
}

export function normalized(challengeId, score) {
  return score / byId[challengeId].par;
}
