// Runs the genetic algorithm off the main thread so the pet keeps animating
// while it trains.
import { Trainer } from './ga.js';
import { runEpisode } from './runner.js';
import { CHALLENGES } from './challenges/index.js';
import { mixSeeds } from './rng.js';

let stopRequested = false;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.cmd === 'stop') stopRequested = true;
  if (msg.cmd === 'train') train(msg);
  if (msg.cmd === 'profile') profile(msg);
};

function train({ population, focus, baseSeed, gen, generations, popSize }) {
  stopRequested = false;
  const trainer = new Trainer({ population, focus, baseSeed, gen, popSize });
  let done = 0;
  const loop = () => {
    if (stopRequested || done >= generations) {
      self.postMessage({ type: 'done', population: trainer.population, gen: trainer.gen, generations: done });
      return;
    }
    const r = trainer.step();
    done++;
    self.postMessage({ type: 'generation', ...r });
    setTimeout(loop, 0); // let a 'stop' message in between generations
  };
  loop();
}

// Skill profile: score the pet on every challenge with fixed seeds, so
// before/after comparisons show what training helped and what it hurt.
function profile({ genome, id }) {
  const ratings = {};
  for (const c of CHALLENGES) {
    let total = 0;
    for (let k = 0; k < 3; k++) total += runEpisode(c, genome, mixSeeds('profile', c.id, k));
    ratings[c.id] = total / 3 / c.par;
  }
  self.postMessage({ type: 'profile', ratings, id });
}
