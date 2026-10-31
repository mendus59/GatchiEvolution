// Local persistence. Training state lives in localStorage so the GA can pick
// up where it left off; the cloud copy (see api.js) is the safety net when the
// browser's data is cleared.
import { validateGenome, fingerprint, cloneGenome } from './genome.js';

const KEYS = {
  pet: 'gatchi:pet',
  population: 'gatchi:population',
  history: 'gatchi:history',
  snapshots: 'gatchi:snapshots',
  auth: 'gatchi:auth',
  sync: 'gatchi:sync',
};
const MAX_HISTORY = 1500;
const MAX_SNAPSHOTS = 30;

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('localStorage write failed', key, err);
    return false;
  }
}

export const store = {
  loadPet() {
    const pet = read(KEYS.pet, null);
    return pet && validateGenome(pet.genome) ? pet : null;
  },
  savePet(pet) {
    pet.updatedAt = Date.now();
    write(KEYS.pet, pet);
  },

  // The working GA population: whole genomes descended from the pet.
  loadPopulation() {
    const p = read(KEYS.population, null);
    if (!p || !Array.isArray(p.genomes) || !p.genomes.every(validateGenome)) return null;
    return p;
  },
  savePopulation(genomes, gen) {
    write(KEYS.population, { genomes, gen, savedAt: Date.now() });
  },
  clearPopulation() { localStorage.removeItem(KEYS.population); },

  loadHistory() { return read(KEYS.history, []); },
  appendHistory(entries) {
    const h = this.loadHistory().concat(entries);
    write(KEYS.history, h.slice(-MAX_HISTORY));
  },

  // Snapshots: earlier iterations of the pet that can be restored.
  loadSnapshots() { return read(KEYS.snapshots, []); },
  addSnapshot(genome, meta) {
    const snaps = this.loadSnapshots();
    snaps.push({ ...meta, fp: fingerprint(genome), genome: cloneGenome(genome), at: Date.now() });
    write(KEYS.snapshots, snaps.slice(-MAX_SNAPSHOTS));
  },

  loadAuth() { return read(KEYS.auth, null); },
  saveAuth(auth) { auth ? write(KEYS.auth, auth) : localStorage.removeItem(KEYS.auth); },

  loadSync() { return read(KEYS.sync, { lastPush: 0, dirty: true }); },
  saveSync(s) { write(KEYS.sync, s); },

  exportAll() {
    return { kind: 'gatchi-export', v: 1, at: Date.now(), pet: this.loadPet(), snapshots: this.loadSnapshots(), history: this.loadHistory() };
  },
  importAll(data) {
    if (!data || data.kind !== 'gatchi-export' || !data.pet || !validateGenome(data.pet.genome)) throw new Error('Not a Gatchi export file');
    write(KEYS.pet, data.pet);
    write(KEYS.snapshots, (data.snapshots || []).filter((s) => validateGenome(s.genome)));
    write(KEYS.history, data.history || []);
    this.clearPopulation();
  },
  wipeLocal() {
    for (const k of [KEYS.pet, KEYS.population, KEYS.history, KEYS.snapshots, KEYS.sync]) localStorage.removeItem(k);
  },
};
