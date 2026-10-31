// Gatchi UI: wires the pet, the training worker, play, versus and backups.
import { traits, fingerprint, cloneGenome } from './genome.js';
import { Rng, randomSeed } from './rng.js';
import { CHALLENGES, byId } from './challenges/index.js';
import { Episode } from './runner.js';
import { seedPopulation, BALANCED } from './ga.js';
import { drawPet, appearance, makeSprite } from './render/pet.js';
import {
  newPet, tickCare, stageOf, moodScore, feed, cuddle, toggleSleep, revive,
  trainBlocker, spendTraining, playBlocker, awardRun, FOODS,
} from './pet.js';
import { store } from './storage.js';
import { api } from './api.js';

const POP_SIZE = 24;
const $ = (id) => document.getElementById(id);

const state = {
  pet: null,
  look: null,
  sprite: null,
  auth: store.loadAuth(),
  focus: 'hop',
  training: null, // { log: [], focus }
  playing: null,
  match: null,
};

// ---- utilities ----------------------------------------------------------------

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// Scales a canvas for the device pixel ratio. Fixed canvases keep their
// logical size (games always draw in 480x270); fluid ones (charts) match
// their on-screen width so text is not stretched.
function setupCanvas(canvas, fluid = false) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!canvas.dataset.w) {
    canvas.dataset.w = canvas.getAttribute('width');
    canvas.dataset.h = canvas.getAttribute('height');
  }
  if (fluid && canvas.clientWidth) canvas.dataset.w = canvas.clientWidth;
  const w = Number(canvas.dataset.w), h = Number(canvas.dataset.h);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: Number(canvas.dataset.w), h: Number(canvas.dataset.h) };
}

function save() {
  store.savePet(state.pet);
  const sync = store.loadSync();
  sync.dirty = true;
  store.saveSync(sync);
}

function genomeChanged() {
  state.look = appearance(state.pet.genome);
  state.sprite = makeSprite(state.pet.genome, stageOf(state.pet));
}

// In-page dialog (native confirm/prompt are blocked in some embeds).
function ask(message, { input = null, ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    const dlg = $('askDialog');
    $('askText').textContent = message;
    $('askInput').hidden = input === null;
    $('askInput').value = input ?? '';
    $('askOk').textContent = ok;
    dlg.showModal();
    if (input !== null) $('askInput').select();
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(input === null ? true : $('askInput').value);
    };
  });
}

const fmt = (x) => (x >= 10 ? x.toFixed(0) : x.toFixed(1));

// ---- pet panel ----------------------------------------------------------------

function renderPetCard() {
  const pet = state.pet;
  const c = pet.care;
  $('petName').textContent = pet.name;
  $('petStage').textContent = stageOf(pet)[0].toUpperCase() + stageOf(pet).slice(1);
  $('petFp').textContent = fingerprint(pet.genome);
  $('petGen').textContent = pet.totalGens;
  $('pointsBadge').textContent = `⭐ ${pet.points}`;
  $('barFull').style.width = c.fullness + '%';
  $('barEnergy').style.width = c.energy + '%';
  $('barMood').style.width = c.mood + '%';
  $('barHealth').style.width = c.health + '%';
  $('hatchRow').classList.toggle('hidden', pet.hatched);
  $('careRow').classList.toggle('hidden', !pet.hatched);
  $('sleepBtn').textContent = c.sleeping ? '☀️ Wake up' : '💤 Sleep';
  let status = '';
  if (!pet.hatched) status = 'Something is wiggling inside…';
  else if (c.fainted) status = `${pet.name} fainted! Give it medicine.`;
  else if (c.sleeping) status = 'Sleeping…';
  else if (state.training) status = 'Training hard…';
  else if (c.fullness < 20) status = 'Hungry!';
  else if (c.energy < 15) status = 'Sleepy…';
  else if (c.mood < 25) status = 'Feeling lonely.';
  else status = 'Happy and curious.';
  $('petStatus').textContent = status;

  for (const btn of document.querySelectorAll('#foodButtons button')) {
    const f = FOODS[btn.dataset.food];
    btn.disabled = pet.points < f.cost && !(btn.dataset.food === 'medicine' && c.fainted);
  }
  const t = traits(pet.genome);
  $('traitList').innerHTML = ['speed', 'jump', 'agility', 'strength', 'lift', 'vision', 'reflex', 'focus', 'stamina', 'mass', 'appetite']
    .map((k) => {
      const v = k === 'appetite' ? t[k] / 2 : t[k];
      return `<div class="trait"><span>${k}</span><div class="track"><div class="fill" style="width:${Math.round(v * 100)}%"></div></div><span class="small muted">${t[k].toFixed(2)}</span></div>`;
    }).join('');
}

function petLoop(ts) {
  const { ctx, w } = setupCanvas($('petCanvas'));
  ctx.clearRect(0, 0, w, w);
  const pet = state.pet;
  drawPet(ctx, pet.genome, {
    size: w, time: ts / 1000, mood: moodScore(pet), sleeping: pet.care.sleeping || pet.care.fainted,
    stage: stageOf(pet), look: state.look,
  });
  requestAnimationFrame(petLoop);
}

function setupCare() {
  $('foodButtons').innerHTML = Object.entries(FOODS)
    .map(([id, f]) => `<button data-food="${id}">${f.icon} ${f.name} <span class="muted">${f.cost}⭐</span></button>`).join('');
  $('foodButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const err = btn.dataset.food === 'medicine' && state.pet.care.fainted ? revive(state.pet) : feed(state.pet, btn.dataset.food);
    if (err) toast(err); else { toast('Yum!'); save(); }
    renderPetCard();
  });
  const doCuddle = () => {
    if (!state.pet.hatched) return;
    const err = cuddle(state.pet);
    toast(err || `${state.pet.name} loves that.`);
    if (!err) save();
    renderPetCard();
  };
  $('cuddleBtn').onclick = doCuddle;
  $('petCanvas').onclick = doCuddle;
  $('sleepBtn').onclick = () => {
    if (state.training) stopTraining();
    toggleSleep(state.pet); save(); renderPetCard();
  };
  $('hatchBtn').onclick = () => {
    state.pet.hatched = true;
    state.pet.care.lastTick = Date.now();
    store.addSnapshot(state.pet.genome, { gen: 0, focus: 'hatch' });
    save();
    genomeChanged();
    renderAll();
    toast(`${state.pet.name} hatched!`);
    runProfile();
  };
  $('renameBtn').onclick = async () => {
    const name = await ask('Name your Gatchi', { input: state.pet.name, ok: 'Rename' });
    if (name && name.trim()) { state.pet.name = name.trim().slice(0, 24); save(); renderPetCard(); }
  };
  setInterval(() => { tickCare(state.pet); store.savePet(state.pet); renderPetCard(); }, 10000);
}

// ---- training -----------------------------------------------------------------

const trainWorker = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });
const profileWorker = new Worker(new URL('./train-worker.js', import.meta.url), { type: 'module' });

function renderPicker() {
  const items = [...CHALLENGES, { id: BALANCED, name: 'Cross-train', genre: 'All ten at once', icon: '⚖️' }];
  $('trainPicker').innerHTML = items.map((c) => {
    const r = state.pet.ratings[c.id];
    return `<button class="challenge${c.id === state.focus ? ' selected' : ''}" data-id="${c.id}" title="${c.blurb || 'Balanced fitness across every challenge. Slower, but no skill gets left behind.'}">
      <span class="name">${c.icon} ${c.name}</span>
      <span class="genre">${c.genre}${r !== undefined ? ` · ${Math.round(r * 100)}%` : ''}</span>
    </button>`;
  }).join('');
}

function renderProfile() {
  const { ratings, prevRatings } = state.pet;
  $('profile').innerHTML = CHALLENGES.map((c) => {
    const r = ratings[c.id];
    if (r === undefined) return `<div class="prof-row"><span>${c.icon} ${c.name}</span><div class="track"></div><span class="muted">–</span></div>`;
    const p = prevRatings[c.id];
    const d = p === undefined ? 0 : r - p;
    const delta = Math.abs(d) < 0.005 ? '' : `<span class="delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.round(Math.abs(d) * 100)}</span>`;
    const ghost = p === undefined ? '' : `<div class="ghost-mark" style="left:${Math.min(100, (p / 1.5) * 100)}%"></div>`;
    return `<div class="prof-row" title="Average score vs. par on fixed test courses"><span>${c.icon} ${c.name}</span>
      <div class="track"><div class="fill" style="width:${Math.min(100, (r / 1.5) * 100)}%"></div>${ghost}</div>
      <span>${Math.round(r * 100)}% ${delta}</span></div>`;
  }).join('');
}

function drawLineChart(canvas, series, opts = {}) {
  const { ctx, w, h } = setupCanvas(canvas, true);
  const style = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, w, h);
  const all = series.flatMap((s) => s.data);
  if (!all.length) {
    ctx.fillStyle = style.getPropertyValue('--muted');
    ctx.font = '13px system-ui';
    ctx.fillText(opts.empty || 'No data yet', 12, h / 2);
    return;
  }
  const max = Math.max(...all, 1e-6) * 1.1;
  const n = Math.max(...series.map((s) => s.data.length));
  const pad = 28;
  ctx.strokeStyle = style.getPropertyValue('--line');
  ctx.beginPath(); ctx.moveTo(pad, 8); ctx.lineTo(pad, h - 20); ctx.lineTo(w - 8, h - 20); ctx.stroke();
  ctx.fillStyle = style.getPropertyValue('--muted');
  ctx.font = '11px system-ui';
  ctx.fillText(fmt(max), 2, 16);
  ctx.fillText('0', 14, h - 20);
  ctx.fillText(opts.xLabel || 'generation', w - 70, h - 6);
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = pad + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad - 10));
      const y = h - 20 - (v / max) * (h - 30);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  let lx = pad + 8;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 10, 10, 3);
    ctx.fillStyle = style.getPropertyValue('--muted');
    ctx.fillText(s.label, lx + 14, 15);
    lx += ctx.measureText(s.label).width + 34;
  }
}

function renderTrainChart() {
  const log = state.training?.log || state.lastLog || [];
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  drawLineChart($('trainChart'), [
    { label: 'best', color: accent, data: log.map((r) => r.best) },
    { label: 'population mean', color: '#f59e0b', data: log.map((r) => r.mean) },
  ], { empty: 'Start a training session to see generations improve.' });
}

function startTraining() {
  const pet = state.pet;
  const blocker = trainBlocker(pet);
  if (blocker) return toast(blocker);
  const generations = Number($('genCount').value);
  let saved = store.loadPopulation();
  let population;
  if (saved && fingerprint(saved.genomes[0]) === fingerprint(pet.genome)) population = saved.genomes;
  else population = seedPopulation(pet.genome, POP_SIZE, new Rng(randomSeed()));
  state.training = { log: [], focus: state.focus, startGen: pet.totalGens, startRatings: { ...pet.ratings } };
  trainWorker.postMessage({
    cmd: 'train', population, focus: state.focus, baseSeed: randomSeed(),
    gen: pet.totalGens, generations, popSize: POP_SIZE,
  });
  $('trainBtn').textContent = 'Stop';
  $('trainStatus').textContent = 'Evolving…';
  renderPetCard();
}

function stopTraining() {
  trainWorker.postMessage({ cmd: 'stop' });
}

trainWorker.onmessage = (e) => {
  const msg = e.data;
  const tr = state.training;
  if (!tr) return;
  if (msg.type === 'generation') {
    tr.log.push({ gen: msg.gen, best: msg.best, mean: msg.mean });
    const pet = state.pet;
    pet.genome = msg.champion;
    pet.genome.lineage = [...(pet.genome.lineage || []).slice(-50), msg.focus];
    spendTraining(pet, 1);
    store.appendHistory([{ gen: pet.totalGens, focus: msg.focus, best: msg.best, mean: msg.mean, fit: msg.bestFitness, at: Date.now() }]);
    genomeChanged();
    store.savePet(pet);
    const label = msg.focus === BALANCED ? 'Cross-train' : byId[msg.focus].name;
    $('trainStatus').textContent = `${label}: generation ${tr.log.length}, best ${fmt(msg.best)}${msg.focus === BALANCED ? '' : ' pts'}`;
    renderTrainChart();
    renderPetCard();
    if (trainBlocker(pet)) { toast(trainBlocker(pet)); stopTraining(); }
  }
  if (msg.type === 'done') {
    const pet = state.pet;
    store.savePopulation(msg.population, msg.gen);
    if (msg.generations > 0) {
      store.addSnapshot(pet.genome, { gen: pet.totalGens, focus: tr.focus, gens: msg.generations });
      pet.points += 2;
    }
    state.lastLog = tr.log;
    state.training = null;
    $('trainBtn').textContent = 'Start training';
    save();
    renderPetCard();
    if (msg.generations > 0) {
      toast(`Trained ${msg.generations} generations. Testing every skill…`);
      runProfile();
      autoBackup();
    }
  }
};

let profileId = 0;
function runProfile() {
  $('trainStatus').textContent = 'Running skill test on all 10 challenges…';
  profileWorker.postMessage({ cmd: 'profile', genome: state.pet.genome, id: ++profileId });
}
profileWorker.onmessage = (e) => {
  if (e.data.type !== 'profile' || e.data.id !== profileId) return;
  const pet = state.pet;
  pet.prevRatings = Object.keys(pet.ratings).length ? pet.ratings : e.data.ratings;
  pet.ratings = e.data.ratings;
  save();
  $('trainStatus').textContent = 'Skill test done. ▲▼ show change since the last test.';
  renderPicker();
  renderProfile();
};

function setupTraining() {
  $('trainPicker').addEventListener('click', (e) => {
    const btn = e.target.closest('.challenge');
    if (!btn || state.training) return;
    state.focus = btn.dataset.id;
    renderPicker();
  });
  $('trainBtn').onclick = () => (state.training ? stopTraining() : startTraining());
}

// ---- solo play ----------------------------------------------------------------

function playEpisodes(episodes, canvases, speedFn, onFrame) {
  return new Promise((resolve) => {
    const frame = () => {
      const speed = speedFn();
      for (let i = 0; i < speed; i++) episodes.forEach((ep) => ep.tick());
      episodes.forEach((ep, i) => {
        const { ctx } = setupCanvas(canvases[i]);
        ep.game.draw(ctx, ep.sprite);
      });
      onFrame?.();
      if (episodes.every((ep) => ep.done)) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function setupPlay() {
  $('playSelect').innerHTML = CHALLENGES.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');
  $('playBtn').onclick = async () => {
    if (state.playing) return;
    const pet = state.pet;
    const blocker = playBlocker(pet);
    if (blocker) return toast(blocker);
    const def = byId[$('playSelect').value];
    const ep = new Episode(def, pet.genome, randomSeed());
    ep.sprite = state.sprite;
    state.playing = ep;
    $('playBtn').disabled = true;
    $('playResult').textContent = `${pet.name} is playing ${def.name}…`;
    await playEpisodes([ep], [$('playCanvas')], () => Number($('playSpeed').value));
    const { earned, record } = awardRun(pet, def, ep.score);
    $('playResult').textContent = `Final score ${ep.score}. Earned ${earned}⭐${record ? ' · New personal best!' : ''}`;
    state.playing = null;
    $('playBtn').disabled = false;
    save();
    renderPetCard();
  };
}

// ---- versus -------------------------------------------------------------------

async function refreshVersus() {
  const signedIn = !!state.auth;
  $('versusLocked').classList.toggle('hidden', signedIn);
  $('versusBody').classList.toggle('hidden', !signedIn);
  if (!signedIn) return;
  try {
    const [{ friends }, { players }] = await Promise.all([api.friends(), api.leaderboard()]);
    const row = (u, extra = '') => `<div class="list-item"><span><strong>${esc(u.username)}</strong> · ${esc(u.petName || '')} <span class="muted small">${u.elo} elo</span></span>
      <span class="row">${extra}<button data-vs="${esc(u.username)}">Challenge</button></span></div>`;
    $('friendList').innerHTML = friends.length
      ? friends.map((f) => row({ ...f, petName: f.pet?.name }, `<button data-unfriend="${esc(f.username)}" class="small">Remove</button>`)).join('')
      : '<div class="muted small">No friends yet. Add someone by username.</div>';
    $('leaderboard').innerHTML = players
      .filter((p) => p.username !== state.auth.username)
      .map((p, i) => row({ ...p, petName: `#${i + 1} ${p.pet}` })).join('') || '<div class="muted small">Nobody else here yet.</div>';
  } catch (err) {
    handleApiError(err);
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function challenge(opponent) {
  if (state.match) return;
  try {
    state.match = true;
    await pushBackup(true);
    const m = await api.versus(opponent);
    $('matchView').classList.remove('hidden');
    $('matchTitle').textContent = `${m.you.name} vs ${m.opponent.name}`;
    $('vsALabel').textContent = `${m.you.name} (you)`;
    $('vsBLabel').textContent = `${m.opponent.name} (${m.opponent.username})`;
    const spriteA = makeSprite(m.you.genome), spriteB = makeSprite(m.opponent.genome);
    $('matchRounds').innerHTML = '';
    $('matchView').scrollIntoView({ behavior: 'smooth' });
    for (const r of m.results) {
      const def = byId[r.challenge];
      const a = new Episode(def, m.you.genome, r.seed), b = new Episode(def, m.opponent.genome, r.seed);
      a.sprite = spriteA; b.sprite = spriteB;
      await playEpisodes([a, b], [$('vsA'), $('vsB')], () => 3);
      const res = r.a > r.b ? 'You win the round' : r.b > r.a ? 'They win the round' : 'Draw';
      $('matchRounds').insertAdjacentHTML('beforeend', `<div class="list-item"><span>${def.icon} ${def.name}</span><span>${r.a} – ${r.b} · ${res}</span></div>`);
    }
    const verdict = m.winner === 'a' ? 'You won the match! +15⭐' : m.winner === 'b' ? 'You lost this one.' : "It's a draw.";
    $('matchRounds').insertAdjacentHTML('beforeend', `<div class="list-item"><strong>${verdict}</strong><span>Your rating: ${m.you.elo}</span></div>`);
    const rec = state.pet.record;
    if (m.winner === 'a') { rec.wins++; state.pet.points += 15; } else if (m.winner === 'b') rec.losses++; else rec.draws++;
    save();
    renderPetCard();
    refreshVersus();
  } catch (err) {
    handleApiError(err);
  } finally {
    state.match = null;
  }
}

function setupVersus() {
  $('friendForm').onsubmit = async (e) => {
    e.preventDefault();
    const name = $('friendName').value.trim();
    if (!name) return;
    try { await api.addFriend(name); $('friendName').value = ''; toast(`Added ${name}`); refreshVersus(); }
    catch (err) { handleApiError(err); }
  };
  $('versusBody').addEventListener('click', async (e) => {
    const vs = e.target.closest('[data-vs]');
    if (vs) return challenge(vs.dataset.vs);
    const rm = e.target.closest('[data-unfriend]');
    if (rm) { await api.removeFriend(rm.dataset.unfriend).catch(handleApiError); refreshVersus(); }
  });
}

// ---- lineage ------------------------------------------------------------------

function renderLineage() {
  const hist = store.loadHistory();
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent');
  drawLineChart($('historyChart'), [{ label: 'best fitness vs par (each generation)', color: accent, data: hist.map((h) => h.fit ?? 0) }],
    { empty: 'No generations yet.', xLabel: 'all time' });
  const snaps = store.loadSnapshots().slice().reverse();
  $('snapshots').innerHTML = snaps.map((s, i) => {
    const label = s.focus === 'hatch' ? 'Hatched' : s.focus === BALANCED ? 'Cross-train' : byId[s.focus]?.name || s.focus;
    return `<div class="snap"><canvas width="80" height="80" data-snap="${i}"></canvas>
      <div><strong>Gen ${s.gen}</strong></div><div class="muted">${label}</div><div class="mono muted">${s.fp}</div>
      <button data-restore="${i}">Restore</button></div>`;
  }).join('') || '<div class="muted">No snapshots yet.</div>';
  for (const c of $('snapshots').querySelectorAll('canvas')) {
    const { ctx } = setupCanvas(c);
    drawPet(ctx, snaps[Number(c.dataset.snap)].genome, { size: 80, time: 0.3 });
  }
  $('snapshots').onclick = async (e) => {
    const btn = e.target.closest('[data-restore]');
    if (!btn) return;
    if (state.training) return toast('Stop training first.');
    const s = snaps[Number(btn.dataset.restore)];
    if (!(await ask(`Restore ${state.pet.name} to generation ${s.gen}? Your current genome stays in the snapshot list.`, { ok: 'Restore' }))) return;
    store.addSnapshot(state.pet.genome, { gen: state.pet.totalGens, focus: 'before-restore' });
    state.pet.genome = cloneGenome(s.genome);
    store.clearPopulation();
    genomeChanged();
    save();
    renderAll();
    runProfile();
    toast('Restored.');
  };
}

function setupLineage() {
  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(store.exportAll())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gatchi-${state.pet.name}-${fingerprint(state.pet.genome)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      store.importAll(JSON.parse(await file.text()));
      location.reload();
    } catch (err) { toast(err.message); }
  };
}

// ---- account & backup -----------------------------------------------------------

function handleApiError(err) {
  if (/sign in|session/i.test(err.message)) { state.auth = null; store.saveAuth(null); renderAccount(); }
  toast(err.message === 'Failed to fetch' ? 'Server unreachable. Your Gatchi is still saved in this browser.' : err.message);
}

function backupPayload() {
  return { pet: state.pet, snapshots: store.loadSnapshots().slice(-10), history: store.loadHistory().slice(-300) };
}

async function pushBackup(quiet) {
  if (!state.auth) return;
  const { savedAt } = await api.pushBackup(backupPayload());
  store.saveSync({ lastPush: savedAt, dirty: false });
  renderSync();
  if (!quiet) toast('Backed up to the cloud.');
}

async function autoBackup() {
  if (!state.auth || !store.loadSync().dirty) return;
  try { await pushBackup(true); } catch (err) { console.warn('auto backup failed', err); renderSync('Auto backup failed; will retry.'); }
}

function applyBackup(backup) {
  if (state.training) stopTraining();
  store.importAll({ kind: 'gatchi-export', pet: backup.pet, snapshots: backup.snapshots, history: backup.history });
  state.pet = store.loadPet();
  tickCare(state.pet);
  genomeChanged();
  renderAll();
}

function renderSync(extra = '') {
  const s = store.loadSync();
  $('syncStatus').textContent = (s.lastPush ? `Last cloud backup ${new Date(s.lastPush).toLocaleString()}.` : 'Not backed up yet.') +
    (s.dirty ? ' Changes since then will sync automatically.' : '') + (extra ? ' ' + extra : '');
}

function renderAccount() {
  const signed = !!state.auth;
  $('signedOut').classList.toggle('hidden', signed);
  $('signedIn').classList.toggle('hidden', !signed);
  $('accountBtn').textContent = signed ? `👤 ${state.auth.username}` : 'Sign in';
  if (signed) {
    $('whoami').textContent = state.auth.username;
    api.me().then((me) => { $('myElo').textContent = me.elo; }).catch(handleApiError);
    renderSync();
  }
}

function setupAccount() {
  $('accountBtn').onclick = () => showTab('account');
  $('authForm').onsubmit = (e) => e.preventDefault();
  for (const btn of $('authForm').querySelectorAll('button')) {
    btn.onclick = async (e) => {
      e.preventDefault();
      const u = $('authUser').value.trim(), p = $('authPass').value;
      try {
        const res = btn.dataset.mode === 'register' ? await api.register(u, p) : await api.login(u, p);
        state.auth = { token: res.token, username: res.username };
        store.saveAuth(state.auth);
        $('authPass').value = '';
        renderAccount();
        // A fresh sign-in on a browser with no real progress adopts the cloud pet.
        const cloud = await api.pullBackup().catch(() => null);
        if (cloud && (state.pet.totalGens === 0 || cloud.pet.totalGens > state.pet.totalGens) &&
            (await ask(`Load ${cloud.pet.name} (gen ${cloud.pet.totalGens}) from the cloud? This replaces the Gatchi in this browser.`, { ok: 'Load' }))) {
          applyBackup(cloud);
          toast('Restored from the cloud.');
        } else {
          await pushBackup();
        }
      } catch (err) { handleApiError(err); }
    };
  }
  $('backupBtn').onclick = () => pushBackup().catch(handleApiError);
  $('restoreBtn').onclick = async () => {
    try {
      const cloud = await api.pullBackup();
      if (await ask(`Replace this browser's Gatchi with ${cloud.pet.name} (gen ${cloud.pet.totalGens}) from the cloud?`, { ok: 'Restore' })) { applyBackup(cloud); toast('Restored.'); }
    } catch (err) { handleApiError(err); }
  };
  $('logoutBtn').onclick = async () => {
    await api.logout().catch(() => {});
    state.auth = null;
    store.saveAuth(null);
    renderAccount();
    refreshVersus();
  };
  $('resetBtn').onclick = async () => {
    const note = state.auth ? ' Your cloud backup is kept until you back up the new pet.' : ' Without an account this cannot be undone.';
    if (!(await ask(`Release ${state.pet.name}?${note}`, { ok: 'Release' }))) return;
    if (state.training) stopTraining();
    store.wipeLocal();
    location.reload();
  };
  setInterval(autoBackup, 2 * 60 * 1000);
  window.addEventListener('pagehide', () => { store.savePet(state.pet); });
}

// ---- tabs & boot ------------------------------------------------------------------

function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const p of document.querySelectorAll('.tab-panel')) p.classList.toggle('hidden', p.dataset.panel !== name);
  if (name === 'lineage') renderLineage();
  if (name === 'versus') refreshVersus();
  if (name === 'train') renderTrainChart();
}

function renderAll() {
  renderPetCard();
  renderPicker();
  renderProfile();
  renderTrainChart();
  renderAccount();
}

async function boot() {
  let pet = store.loadPet();
  if (!pet && state.auth) {
    // Browser data was cleared but we still have a session: pull the cloud copy.
    const cloud = await api.pullBackup().catch(() => null);
    if (cloud) { store.importAll({ kind: 'gatchi-export', ...cloud }); pet = store.loadPet(); }
  }
  if (!pet) {
    pet = newPet('Gatchi', randomSeed());
    store.savePet(pet);
  }
  state.pet = tickCare(pet);
  store.savePet(pet);
  genomeChanged();
  document.querySelector('.tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
  setupCare();
  setupTraining();
  setupPlay();
  setupVersus();
  setupLineage();
  setupAccount();
  renderAll();
  requestAnimationFrame(petLoop);
  if (pet.hatched && !Object.keys(pet.ratings).length) runProfile();
}

boot();
