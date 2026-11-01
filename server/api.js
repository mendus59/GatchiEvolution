// Gatchi account API, shared by the Node server (server/server.js, JSON-file
// store) and the Supabase Edge Function (supabase/functions/api, Postgres
// store). It only depends on node:crypto, which Deno also provides, and on a
// store object (see store-memory.js for the interface).
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { validateGenome, fingerprint } from '../public/js/genome.js';
import { runEpisode } from '../public/js/runner.js';
import { CHALLENGES } from '../public/js/challenges/index.js';
import { Rng, mixSeeds } from '../public/js/rng.js';

const SESSION_DAYS = 30;
export const MAX_BODY = 512 * 1024;
const USERNAME = /^[a-zA-Z0-9_-]{3,20}$/;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return { salt, hash };
}

function checkPassword(password, user) {
  if (!user.salt || !user.hash) return false; // Google-only account
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.hash, 'hex'));
}

const attempts = new Map(); // key -> { count, until }
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) {
    if (attempts.size > 10000) attempts.clear();
    attempts.set(key, { count: 1, until: now + windowMs });
    return;
  }
  if (++a.count > max) throw new HttpError(429, 'Too many attempts, slow down');
}

function cleanBackup(body) {
  const pet = body?.pet;
  if (!pet || typeof pet !== 'object' || !validateGenome(pet.genome)) throw new HttpError(400, 'Backup needs a valid pet genome');
  const snapshots = Array.isArray(body.snapshots) ? body.snapshots.filter((s) => validateGenome(s?.genome)).slice(-30) : [];
  const history = Array.isArray(body.history) ? body.history.slice(-1500) : [];
  return { pet, snapshots, history, savedAt: Date.now() };
}

// `p` is { username, elo, record, pet } as returned by store.publicUsers().
function publicView(p) {
  const pet = p.pet;
  return {
    username: p.username,
    elo: Math.round(p.elo),
    record: p.record,
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

export function elo(ra, rb, scoreA, k = 24) {
  const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
  return [ra + k * (scoreA - ea), rb + k * (1 - scoreA - (1 - ea))];
}

// ---- api ----------------------------------------------------------------------

// Suggest a username from an email address for first-time Google sign-ins.
function suggestName(email) {
  const base = String(email || '').split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16);
  return base.length >= 3 ? base : 'gatchi' + Math.floor(Math.random() * 9000 + 1000);
}

// verifyOAuth(accessToken) -> { id, email } | null checks a token from the
// hosted sign-in provider (Supabase Auth, for Google). Without it, Google
// sign-in is unavailable and only username/password accounts work.
export function createApi(store, { verifyOAuth = null } = {}) {
  async function authUser(req) {
    const m = /^Bearer (.+)$/.exec(req.authorization || '');
    if (!m) throw new HttpError(401, 'Sign in first');
    const s = await store.getSession(sha256(m[1]));
    if (!s || s.expires < Date.now()) throw new HttpError(401, 'Session expired, sign in again');
    const user = await store.getUser(s.username);
    if (!user) throw new HttpError(401, 'Unknown user');
    return user;
  }

  async function findUser(name) {
    const user = await store.getUser(String(name || ''));
    if (!user) throw new HttpError(404, 'No such player');
    return user;
  }

  async function newSession(username) {
    const token = crypto.randomBytes(32).toString('base64url');
    await store.createSession(sha256(token), username, Date.now() + SESSION_DAYS * 864e5);
    return token;
  }

  const same = (a, b) => a.toLowerCase() === b.toLowerCase();

  const routes = {
    'POST /register': async (req, body) => {
      rateLimit('reg:' + req.ip, 10, 60 * 60e3);
      const { username, password } = body;
      if (!USERNAME.test(username || '')) throw new HttpError(400, 'Username: 3-20 letters, numbers, - or _');
      if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
      const created = await store.createUser({ username, ...hashPassword(password), createdAt: Date.now() });
      if (!created) throw new HttpError(409, 'That username is taken');
      return { token: await newSession(username), username };
    },

    'POST /login': async (req, body) => {
      rateLimit('login:' + req.ip, 20, 15 * 60e3);
      const user = await store.getUser(String(body.username || ''));
      if (!user || typeof body.password !== 'string' || !checkPassword(body.password, user)) throw new HttpError(401, 'Wrong username or password');
      return { token: await newSession(user.username), username: user.username };
    },

    // Google sign-in. The browser signs in with Google through Supabase Auth
    // and hands us that access token; we check it with the provider and swap
    // it for a normal Gatchi session.
    //   - identity already linked: signs in as that player
    //   - new identity, no username: { needsUsername, suggestion }
    //   - new identity + username: creates the player
    //   - sent with a Gatchi session (link: true): links Google to that player
    'POST /oauth': async (req, body) => {
      if (!verifyOAuth) throw new HttpError(501, 'Google sign-in is not set up on this server');
      rateLimit('oauth:' + req.ip, 30, 15 * 60e3);
      if (typeof body.accessToken !== 'string' || !body.accessToken) throw new HttpError(400, 'Missing sign-in token');
      const ident = await verifyOAuth(body.accessToken);
      if (!ident?.id) throw new HttpError(401, 'Google sign-in failed or expired, please try again');
      const linked = await store.getUserByAuth(ident.id);

      if (body.link) {
        const u = await authUser(req);
        if (linked && !same(linked.username, u.username)) throw new HttpError(409, `That Google account already signs in as ${linked.username}`);
        if (!linked && !(await store.linkAuth(u.username, ident.id))) throw new HttpError(409, 'That Google account is already linked to another player');
        return { linked: true, username: u.username };
      }
      if (linked) return { token: await newSession(linked.username), username: linked.username };
      if (body.username == null) return { needsUsername: true, suggestion: suggestName(ident.email) };
      const { username } = body;
      if (!USERNAME.test(username || '')) throw new HttpError(400, 'Username: 3-20 letters, numbers, - or _');
      const created = await store.createUser({ username, salt: null, hash: null, createdAt: Date.now(), authId: ident.id });
      if (!created) throw new HttpError(409, 'That username is taken');
      return { token: await newSession(username), username };
    },

    'POST /logout': async (req) => {
      const m = /^Bearer (.+)$/.exec(req.authorization || '');
      if (m) await store.deleteSession(sha256(m[1]));
      return { ok: true };
    },

    'GET /me': async (req) => {
      const u = await authUser(req);
      return { username: u.username, elo: Math.round(u.elo), record: u.record, friends: u.friends, backupAt: u.backupAt || null, google: !!u.authId };
    },

    'PUT /backup': async (req, body) => {
      const u = await authUser(req);
      const backup = cleanBackup(body);
      await store.setBackup(u.username, backup);
      return { ok: true, savedAt: backup.savedAt };
    },

    'GET /backup': async (req) => {
      const u = await authUser(req);
      const backup = await store.getBackup(u.username);
      if (!backup) throw new HttpError(404, 'No cloud backup yet');
      return backup;
    },

    'GET /friends': async (req) => {
      const u = await authUser(req);
      return { friends: (await store.publicUsers(u.friends)).map(publicView) };
    },

    'POST /friends': async (req, body) => {
      const u = await authUser(req);
      const f = await findUser(body.username);
      if (same(f.username, u.username)) throw new HttpError(400, "You can't friend yourself");
      if (!u.friends.some((n) => same(n, f.username))) await store.setFriends(u.username, [...u.friends, f.username].slice(-200));
      return { ok: true };
    },

    'GET /leaderboard': async () => {
      const players = (await store.topPlayers(25)).map((p) => ({
        username: p.username, elo: Math.round(p.elo), record: p.record, pet: p.pet.name, fingerprint: fingerprint(p.pet.genome),
      }));
      return { players };
    },

    'POST /versus': async (req, body) => {
      const u = await authUser(req);
      const o = await findUser(body.opponent);
      if (same(o.username, u.username)) throw new HttpError(400, 'Pick someone else to challenge');
      const [mine, theirs] = await store.publicUsers([u.username, o.username]);
      if (!mine?.pet) throw new HttpError(400, 'Back up your Gatchi to the cloud first');
      if (!theirs?.pet) throw new HttpError(400, `${o.username} has no Gatchi in the cloud yet`);
      if (!(await store.claimVersus(u.username, Date.now(), 3000))) throw new HttpError(429, 'One match at a time');
      const seed = crypto.randomBytes(4).readUInt32LE();
      const match = playMatch(mine.pet.genome, theirs.pet.genome, seed);
      const scoreA = match.winner === 'a' ? 1 : match.winner === 'b' ? 0 : 0.5;
      const [eloA, eloB] = await store.recordMatch(u.username, o.username, scoreA, (ra, rb) => elo(ra, rb, scoreA),
        { at: Date.now(), a: u.username, b: o.username, seed, winner: match.winner, results: match.results });
      return {
        seed, ...match,
        you: { username: u.username, elo: Math.round(eloA), genome: mine.pet.genome, name: mine.pet.name },
        opponent: { username: o.username, elo: Math.round(eloB), genome: theirs.pet.genome, name: theirs.pet.name },
      };
    },
  };

  // req: { method, path (after the /api prefix), authorization, ip, bodyText }
  // Returns { status, body }.
  async function handle(req) {
    try {
      let m;
      if ((m = /^\/users\/([^/]+)\/pet$/.exec(req.path)) && req.method === 'GET') {
        const [p] = await store.publicUsers([(await findUser(decodeURIComponent(m[1]))).username]);
        return { status: 200, body: publicView(p) };
      }
      if ((m = /^\/friends\/([^/]+)$/.exec(req.path)) && req.method === 'DELETE') {
        const u = await authUser(req);
        const name = decodeURIComponent(m[1]);
        await store.setFriends(u.username, u.friends.filter((n) => !same(n, name)));
        return { status: 200, body: { ok: true } };
      }
      const route = routes[`${req.method} ${req.path}`];
      if (!route) throw new HttpError(404, 'Not found');
      let body = {};
      if (req.method !== 'GET' && req.bodyText) {
        if (req.bodyText.length > MAX_BODY) throw new HttpError(413, 'Payload too large');
        try { body = JSON.parse(req.bodyText); } catch { throw new HttpError(400, 'Invalid JSON'); }
        if (!body || typeof body !== 'object') throw new HttpError(400, 'Invalid JSON');
      }
      return { status: 200, body: await route(req, body) };
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      return { status: err.status || 500, body: { error: err instanceof HttpError ? err.message : 'Server error' } };
    }
  }

  return { handle };
}
