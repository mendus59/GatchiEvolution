import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomGenome, mutate, crossover, validateGenome, fingerprint, traits, GENOME_LENGTH } from '../public/js/genome.js';
import { Rng } from '../public/js/rng.js';
import { CHALLENGES } from '../public/js/challenges/index.js';
import { runEpisode } from '../public/js/runner.js';
import { Trainer, seedPopulation } from '../public/js/ga.js';

test('challenge registry has 10 games with unique ids and slots', () => {
  assert.equal(CHALLENGES.length, 10);
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, 10);
  assert.equal(new Set(CHALLENGES.map((c) => c.slot)).size, 10);
});

test('every challenge runs and is deterministic for a seed', () => {
  const g = randomGenome(1);
  for (const c of CHALLENGES) {
    const a = runEpisode(c, g, 123), b = runEpisode(c, g, 123);
    assert.equal(a, b, c.id);
    assert.ok(Number.isFinite(a) && a >= 0, c.id);
  }
});

test('genomes survive a JSON round trip with identical behaviour', () => {
  const g = mutate(randomGenome(2), new Rng(3));
  const back = JSON.parse(JSON.stringify(g));
  assert.ok(validateGenome(back));
  assert.equal(fingerprint(back), fingerprint(g));
  for (const c of CHALLENGES) assert.equal(runEpisode(c, back, 9), runEpisode(c, g, 9));
});

test('random pets are distinct', () => {
  const fps = new Set();
  for (let i = 0; i < 500; i++) fps.add(fingerprint(randomGenome(i + 1)));
  assert.equal(fps.size, 500);
});

test('crossover and mutation keep genome shape valid', () => {
  const rng = new Rng(5);
  const child = mutate(crossover(randomGenome(1), randomGenome(2), rng), rng, 2);
  assert.equal(child.genes.length, GENOME_LENGTH);
  assert.ok(validateGenome(child));
  const t = traits(child);
  for (const k of ['speed', 'jump', 'agility', 'vision', 'reflex', 'focus']) assert.ok(t[k] >= 0 && t[k] <= 1, k);
});

test('the GA improves a pet at a challenge', () => {
  const pet = randomGenome(42);
  const tr = new Trainer({ population: seedPopulation(pet, 24, new Rng(1)), focus: 'balance', baseSeed: 7 });
  let first, last;
  for (let i = 0; i < 40; i++) {
    const r = tr.step();
    if (i === 0) first = r.best;
    last = r.best;
  }
  assert.ok(last > first * 2, `expected improvement, got ${first} -> ${last}`);
});

test('v1 genomes still validate and play exactly the same after upgrading', async () => {
  const { upgradeGenome, GENOME_LENGTH_V1, REGIONS } = await import('../public/js/genome.js');
  const g = randomGenome(11);
  const v1 = { v: 1, genes: g.genes.slice(0, GENOME_LENGTH_V1), gen: 0, lineage: [] };
  assert.ok(validateGenome(v1));
  const up = upgradeGenome(v1);
  assert.equal(up.genes.length, GENOME_LENGTH);
  assert.equal(REGIONS.brains.start, GENOME_LENGTH_V1);
  for (const c of CHALLENGES) assert.equal(runEpisode(c, up, 4), runEpisode(c, v1, 4), c.id);
});

test('focused training leaves other games\' skills in place', async () => {
  const { brainStart, BRAIN_SIZE } = await import('../public/js/genome.js');
  const { guardRating } = await import('../public/js/ga.js');
  const { byId } = await import('../public/js/challenges/index.js');
  let pet = randomGenome(3);
  let tr = new Trainer({ population: seedPopulation(pet, 24, new Rng(1), 'hop'), focus: 'hop', baseSeed: 3 });
  for (let i = 0; i < 25; i++) pet = tr.step().champion;
  const hopBefore = guardRating(pet, byId.hop);
  assert.ok(hopBefore > 0.1, `hop should have trained, got ${hopBefore}`);

  tr = new Trainer({ population: seedPopulation(pet, 24, new Rng(2), 'climb'), focus: 'climb', baseSeed: 5 });
  let after;
  for (let i = 0; i < 25; i++) after = tr.step().champion;
  // Hop's own brain is untouched by climb training...
  const h = brainStart(byId.hop.slot);
  assert.deepEqual(after.genes.slice(h, h + BRAIN_SIZE), pet.genes.slice(h, h + BRAIN_SIZE));
  // ...and body changes may only soften it a little.
  const hopAfter = guardRating(after, byId.hop);
  assert.ok(hopAfter >= hopBefore * 0.8, `hop fell from ${hopBefore} to ${hopAfter}`);
});
