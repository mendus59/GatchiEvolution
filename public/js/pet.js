// Pet care: the "virtual pet" layer around the genome. Needs decay in real
// time (computed from timestamps, so it works across closed tabs), training
// costs energy and food, and play earns points that buy food.
import { randomGenome, traits, fingerprint } from './genome.js';

export const PET_VERSION = 1;
const HOUR = 3600 * 1000;
const clamp = (x) => Math.max(0, Math.min(100, x));

export const FOODS = {
  berry: { name: 'Berry', icon: '🍓', cost: 5, fullness: 15, mood: 2 },
  bento: { name: 'Bento', icon: '🍱', cost: 15, fullness: 45, mood: 8 },
  cake: { name: 'Cake', icon: '🍰', cost: 25, fullness: 20, mood: 30 },
  medicine: { name: 'Medicine', icon: '💊', cost: 15, fullness: 0, mood: 0, health: 40 },
};

export function newPet(name, seed) {
  const now = Date.now();
  const genome = randomGenome(seed);
  return {
    v: PET_VERSION,
    name: (name || 'Gatchi').slice(0, 24),
    createdAt: now,
    updatedAt: now,
    hatched: false,
    genome,
    care: { fullness: 80, energy: 100, mood: 80, health: 100, sleeping: false, fainted: false, lastTick: now, lastPet: 0 },
    points: 20,
    totalGens: 0,
    ratings: {}, // challengeId -> normalized score from the latest skill test
    prevRatings: {},
    bestScores: {}, // challengeId -> best raw score ever seen in a watched run
    record: { wins: 0, losses: 0, draws: 0 },
  };
}

export function stageOf(pet) {
  if (!pet.hatched) return 'egg';
  const g = pet.totalGens;
  if (g < 25) return 'sprout';
  if (g < 150) return 'juvenile';
  if (g < 600) return 'adult';
  return 'elder';
}

// Advance needs to `now`. Safe to call as often as you like.
export function tickCare(pet, now = Date.now()) {
  const c = pet.care;
  const hours = Math.max(0, (now - c.lastTick) / HOUR);
  c.lastTick = now;
  if (!pet.hatched || hours === 0) return pet;
  const t = traits(pet.genome);
  // Integrate in small slices so long absences behave sensibly.
  let left = Math.min(hours, 24 * 14);
  while (left > 0) {
    const dt = Math.min(left, 0.25);
    left -= dt;
    c.fullness = clamp(c.fullness - 6 * t.appetite * dt * (c.sleeping ? 0.5 : 1));
    c.mood = clamp(c.mood - (c.fullness < 25 ? 8 : 3) * dt);
    c.energy = clamp(c.energy + (c.sleeping ? 30 : 5) * dt);
    if (c.fullness <= 0 || c.mood <= 5) c.health = clamp(c.health - 8 * dt);
    else if (c.fullness > 50) c.health = clamp(c.health + 4 * dt);
    if (c.health <= 0) c.fainted = true;
  }
  if (c.sleeping && c.energy >= 100) c.sleeping = false;
  return pet;
}

export function moodScore(pet) {
  const c = pet.care;
  return (c.fullness * 0.3 + c.mood * 0.5 + c.health * 0.2) / 100;
}

export function feed(pet, foodId) {
  const f = FOODS[foodId];
  if (!f) return 'Unknown food';
  if (pet.points < f.cost) return `Need ${f.cost} points`;
  if (pet.care.fainted && foodId !== 'medicine') return 'Your Gatchi fainted. Give it medicine.';
  if (foodId !== 'medicine' && pet.care.fullness >= 98) return 'Too full!';
  pet.points -= f.cost;
  pet.care.fullness = clamp(pet.care.fullness + f.fullness);
  pet.care.mood = clamp(pet.care.mood + f.mood);
  if (f.health) {
    pet.care.health = clamp(pet.care.health + f.health);
    if (pet.care.health > 0) pet.care.fainted = false;
  }
  return null;
}

// Free cuddle, on a short cooldown.
export function cuddle(pet, now = Date.now()) {
  if (now - pet.care.lastPet < 60 * 1000) return 'Your Gatchi wants a little space.';
  pet.care.lastPet = now;
  pet.care.mood = clamp(pet.care.mood + 6);
  return null;
}

export function toggleSleep(pet) {
  pet.care.sleeping = !pet.care.sleeping;
}

// Free revive if broke, so a pet can never be permanently stuck.
export function revive(pet) {
  if (!pet.care.fainted) return null;
  if (pet.points >= FOODS.medicine.cost) return feed(pet, 'medicine');
  pet.care.fainted = false;
  pet.care.health = 30;
  pet.care.mood = 20;
  return null;
}

export function trainBlocker(pet) {
  const c = pet.care;
  if (!pet.hatched) return 'Hatch your egg first.';
  if (c.fainted) return 'Your Gatchi has fainted. Give it medicine.';
  if (c.sleeping) return 'Your Gatchi is asleep.';
  if (c.energy < 5) return 'Too tired to train. Let it sleep.';
  if (c.fullness < 5) return 'Too hungry to train. Feed it.';
  return null;
}

// Each generation of training tires the pet a little.
export function spendTraining(pet, gens = 1) {
  const t = traits(pet.genome);
  pet.care.energy = clamp(pet.care.energy - (0.9 - 0.6 * t.stamina) * gens);
  pet.care.fullness = clamp(pet.care.fullness - 0.25 * t.appetite * gens);
  pet.totalGens += gens;
}

export function playBlocker(pet) {
  const c = pet.care;
  if (!pet.hatched) return 'Hatch your egg first.';
  if (c.fainted) return 'Your Gatchi has fainted.';
  if (c.sleeping) return 'Your Gatchi is asleep.';
  if (c.energy < 2) return 'Too tired to play.';
  return null;
}

// A watched run earns points scaled by how well the pet did versus par.
export function awardRun(pet, challenge, score) {
  const norm = score / challenge.par;
  const earned = 1 + Math.round(10 * Math.min(2, norm));
  pet.points += earned;
  pet.care.energy = clamp(pet.care.energy - 2);
  pet.care.mood = clamp(pet.care.mood + 4);
  const prev = pet.bestScores[challenge.id] || 0;
  if (score > prev) pet.bestScores[challenge.id] = score;
  return { earned, record: score > prev };
}

export function petSummary(pet) {
  return { name: pet.name, fingerprint: fingerprint(pet.genome), stage: stageOf(pet), totalGens: pet.totalGens };
}
