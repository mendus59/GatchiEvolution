// Runs the genetic algorithm off the main thread so the pet keeps animating
// while it trains.
import { Trainer, skillRating } from './ga.js';
import { CHALLENGES } from './challenges/index.js';

let stopRequested = false;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.cmd === 'stop') stopRequested = true;
  if (msg.cmd === 'train') train(msg);
  if (msg.cmd === 'profile') profile(msg);
};

function train({ population, focus, baseSeed, gen, generations, popSize, mastery }) {
  stopRequested = false;
  const trainer = new Trainer({ population, focus, baseSeed, gen, popSize, mastery });
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
  for (const c of CHALLENGES) ratings[c.id] = skillRating(genome, c);
  self.postMessage({ type: 'profile', ratings, id });
}
