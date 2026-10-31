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
