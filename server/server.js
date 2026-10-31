// Gatchi server: serves the static game and a small JSON API for accounts,
// cloud genome backup, friends and versus matches. No dependencies.
//
//   node server/server.js            (PORT, DATA_FILE env vars optional)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { validateGenome, fingerprint } from '../public/js/genome.js';
import { runEpisode } from '../public/js/runner.js';
import { CHALLENGES } from '../public/js/challenges/index.js';
import { Rng, mixSeeds } from '../public/js/rng.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(ROOT, '../public');
const PORT = Number(process.env.PORT || 8080);
const db = openDb(process.env.DATA_FILE || path.resolve(ROOT, '../data/db.json'));
const SESSION_DAYS = 30;
const MAX_BODY = 512 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// ---- helpers ----------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

function newSession(username) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.data.sessions[sha256(token)] = { username, expires: Date.now() + SESSION_DAYS * 864e5 };
  db.save();
  return token;
}

function authUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Sign in first');
  const s = db.data.sessions[sha256(m[1])];
  if (!s || s.expires < Date.now()) throw new HttpError(401, 'Session expired, sign in again');
  const user = db.data.users[s.username.toLowerCase()];
  if (!user) throw new HttpError(401, 'Unknown user');
  return user;
}

const attempts = new Map(); // ip -> { count, until }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) { attempts.set(key, { count: 1, until: now + windowMs }); return; }
  if (++a.count > max) throw new HttpError(429, 'Too many attempts, slow down');
}

function findUser(name) {
  const user = db.data.users[String(name || '').toLowerCase()];
  if (!user) throw new HttpError(404, 'No such player');
  return user;
}

function cleanBackup(body) {
  const pet = body?.pet;
  if (!pet || typeof pet !== 'object' || !validateGenome(pet.genome)) throw new HttpError(400, 'Backup needs a valid pet genome');
  const snapshots = Array.isArray(body.snapshots) ? body.snapshots.filter((s) => validateGenome(s?.genome)).slice(-30) : [];
  const history = Array.isArray(body.history) ? body.history.slice(-1500) : [];
  return { pet, snapshots, history, savedAt: Date.now() };
}

function publicView(user) {
  const pet = user.backup?.pet;
  return {
    username: user.username,
    elo: Math.round(user.elo),
    record: user.record,
    pet: pet ? {
      name: String(pet.name || 'Gatchi').slice(0, 24),
      fingerprint: fingerprint(pet.genome),
      totalGens: pet.totalGens | 0,
      hatched: !!pet.hatched,
      ratings: pet.ratings || {},
      genome: pet.genome,
    } : null,
  };
}

// ---- versus -------------------------------------------------------------------

// Server-authoritative match: both genomes come from cloud backups and every
// round is simulated here, so a tampered client cannot fake a win.
export function playMatch(genomeA, genomeB, seed, rounds = 3) {
  const rng = new Rng(seed);
  const pool = CHALLENGES.slice();
  const picked = [];
  while (picked.length < rounds) picked.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]);
  let a = 0, b = 0;
  const results = picked.map((c, i) => {
    const roundSeed = mixSeeds(seed, i);
    const sa = runEpisode(c, genomeA, roundSeed), sb = runEpisode(c, genomeB, roundSeed);
    if (sa > sb) a++; else if (sb > sa) b++;
    return { challenge: c.id, seed: roundSeed, a: sa, b: sb };
  });
  return { results, winner: a > b ? 'a' : b > a ? 'b' : 'draw' };
}

function elo(ra, rb, scoreA, k = 24) {
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  return [ra + k * (scoreA - ea), rb + k * (1 - scoreA - (1 - ea))];
}

// ---- routes -------------------------------------------------------------------

const USERNAME = /^[a-zA-Z0-9_-]{3,20}$/;

const routes = {
  'POST /api/register': async (req, body) => {
    rateLimit('reg:' + req.socket.remoteAddress, 10, 60 * 60e3);
    const { username, password } = body;
    if (!USERNAME.test(username || '')) throw new HttpError(400, 'Username: 3-20 letters, numbers, - or _');
    if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    const key = username.toLowerCase();
    if (db.data.users[key]) throw new HttpError(409, 'That username is taken');
    db.data.users[key] = {
      username, ...hashPassword(password), createdAt: Date.now(),
      elo: 1000, record: { wins: 0, losses: 0, draws: 0 }, friends: [], backup: null, lastVersus: 0,
    };
    db.save();
    return { token: newSession(username), username };
  },

  'POST /api/login': async (req, body) => {
    rateLimit('login:' + req.socket.remoteAddress, 20, 15 * 60e3);
    const user = db.data.users[String(body.username || '').toLowerCase()];
    if (!user || typeof body.password !== 'string' || !checkPassword(body.password, user)) throw new HttpError(401, 'Wrong username or password');
    return { token: newSession(user.username), username: user.username };
  },

  'POST /api/logout': async (req) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m) { delete db.data.sessions[sha256(m[1])]; db.save(); }
    return { ok: true };
  },

  'GET /api/me': async (req) => {
    const u = authUser(req);
    return { username: u.username, elo: Math.round(u.elo), record: u.record, friends: u.friends, backupAt: u.backup?.savedAt || null };
  },

  'PUT /api/backup': async (req, body) => {
    const u = authUser(req);
    u.backup = cleanBackup(body);
    db.save();
    return { ok: true, savedAt: u.backup.savedAt };
  },

  'GET /api/backup': async (req) => {
    const u = authUser(req);
    if (!u.backup) throw new HttpError(404, 'No cloud backup yet');
    return u.backup;
  },

  'GET /api/friends': async (req) => {
    const u = authUser(req);
    return { friends: u.friends.map((n) => db.data.users[n.toLowerCase()]).filter(Boolean).map(publicView) };
  },

  'POST /api/friends': async (req, body) => {
    const u = authUser(req);
    const f = findUser(body.username);
    if (f === u) throw new HttpError(400, "You can't friend yourself");
    if (!u.friends.some((n) => n.toLowerCase() === f.username.toLowerCase())) u.friends.push(f.username);
    db.save();
    return { ok: true };
  },

  'GET /api/leaderboard': async () => {
    const players = Object.values(db.data.users).filter((u) => u.backup)
      .sort((a, b) => b.elo - a.elo).slice(0, 25)
      .map((u) => ({ username: u.username, elo: Math.round(u.elo), record: u.record, pet: u.backup.pet.name, fingerprint: fingerprint(u.backup.pet.genome) }));
    return { players };
  },

  'POST /api/versus': async (req, body) => {
    const u = authUser(req);
    const o = findUser(body.opponent);
    if (o === u) throw new HttpError(400, 'Pick someone else to challenge');
    if (!u.backup) throw new HttpError(400, 'Back up your Gatchi to the cloud first');
    if (!o.backup) throw new HttpError(400, `${o.username} has no Gatchi in the cloud yet`);
    if (Date.now() - u.lastVersus < 3000) throw new HttpError(429, 'One match at a time');
    u.lastVersus = Date.now();
    const seed = crypto.randomBytes(4).readUInt32LE();
    const match = playMatch(u.backup.pet.genome, o.backup.pet.genome, seed);
    const scoreA = match.winner === 'a' ? 1 : match.winner === 'b' ? 0 : 0.5;
    [u.elo, o.elo] = elo(u.elo, o.elo, scoreA);
    const tally = (user, s) => { if (s === 1) user.record.wins++; else if (s === 0) user.record.losses++; else user.record.draws++; };
    tally(u, scoreA); tally(o, 1 - scoreA);
    db.data.matches.push({ at: Date.now(), a: u.username, b: o.username, seed, winner: match.winner, results: match.results });
    db.data.matches = db.data.matches.slice(-500);
    db.save();
    return {
      seed, ...match,
      you: { username: u.username, elo: Math.round(u.elo), genome: u.backup.pet.genome, name: u.backup.pet.name },
      opponent: { username: o.username, elo: Math.round(o.elo), genome: o.backup.pet.genome, name: o.backup.pet.name },
    };
  },
};

async function handleApi(req, res, url) {
  const key = `${req.method} ${url.pathname}`;
  let m;
  if ((m = /^\/api\/users\/([^/]+)\/pet$/.exec(url.pathname)) && req.method === 'GET') {
    return send(res, 200, publicView(findUser(decodeURIComponent(m[1]))));
  }
  if ((m = /^\/api\/friends\/([^/]+)$/.exec(url.pathname)) && req.method === 'DELETE') {
    const u = authUser(req);
    const name = decodeURIComponent(m[1]).toLowerCase();
    u.friends = u.friends.filter((n) => n.toLowerCase() !== name);
    db.save();
    return send(res, 200, { ok: true });
  }
  const route = routes[key];
  if (!route) throw new HttpError(404, 'Not found');
  const body = req.method === 'GET' ? {} : await readBody(req);
  send(res, 200, await route(req, body));
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Gatchi running at http://localhost:${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { db.flushNow(); process.exit(0); });
}
