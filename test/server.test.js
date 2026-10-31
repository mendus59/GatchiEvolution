import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomGenome } from '../public/js/genome.js';
import { newPet } from '../public/js/pet.js';

// Runs against the Node server with a temp JSON store. Set GATCHI_API_URL to
// run the same checks against another deployment, e.g. the Supabase function:
//   GATCHI_API_URL=http://localhost:8000/api npm test
let base, server;
const remote = process.env.GATCHI_API_URL;
const tag = remote ? '_' + Math.random().toString(36).slice(2, 8) : '';
before(async () => {
  if (remote) { base = remote.replace(/\/$/, ''); return; }
  process.env.DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gatchi-')), 'db.json');
  ({ server } = await import('../server/server.js'));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server?.close());

async function call(method, p, body, token) {
  const res = await fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

test('accounts, backup, friends and versus', async () => {
  const alice = 'alice' + tag, bob = 'bob' + tag;
  const a = await call('POST', '/register', { username: alice, password: 'password1' });
  const b = await call('POST', '/register', { username: bob, password: 'password2' });
  assert.equal(a.status, 200);
  assert.equal((await call('POST', '/register', { username: 'Alice' + tag, password: 'password1' })).status, 409);
  assert.equal((await call('POST', '/login', { username: alice, password: 'nope' })).status, 401);
  const relog = await call('POST', '/login', { username: 'ALICE' + tag, password: 'password1' });
  assert.equal(relog.status, 200);
  assert.equal(relog.body.username, alice);

  const petA = newPet('Ally', 1), petB = newPet('Bobo', 2);
  assert.equal((await call('PUT', '/backup', { pet: { ...petA, genome: { genes: [1, 2] } } }, a.body.token)).status, 400);
  assert.equal((await call('PUT', '/backup', { pet: petA }, a.body.token)).status, 200);
  assert.equal((await call('PUT', '/backup', { pet: petB }, b.body.token)).status, 200);
  const restored = await call('GET', '/backup', null, a.body.token);
  assert.deepEqual(restored.body.pet.genome.genes, petA.genome.genes);

  assert.equal((await call('POST', '/friends', { username: bob }, a.body.token)).status, 200);
  assert.equal((await call('POST', '/friends', { username: bob }, a.body.token)).status, 200);
  const friends = await call('GET', '/friends', null, a.body.token);
  assert.equal(friends.body.friends.length, 1);
  assert.equal(friends.body.friends[0].username, bob);
  assert.equal(friends.body.friends[0].pet.name, 'Bobo');

  const m = await call('POST', '/versus', { opponent: bob }, a.body.token);
  assert.equal(m.status, 200);
  assert.equal(m.body.results.length, 3);
  assert.ok(['a', 'b', 'draw'].includes(m.body.winner));
  assert.equal((await call('POST', '/versus', { opponent: bob }, a.body.token)).status, 429);
  const me = await call('GET', '/me', null, a.body.token);
  const r = me.body.record;
  assert.equal(r.wins + r.losses + r.draws, 1);
  assert.equal(me.body.elo, m.body.you.elo);

  const lb = await call('GET', '/leaderboard');
  assert.ok(lb.body.players.some((p) => p.username === bob));
  assert.equal((await call('GET', `/users/${bob}/pet`)).body.pet.name, 'Bobo');
  assert.equal((await call('DELETE', `/friends/${bob}`, null, a.body.token)).status, 200);
  assert.equal((await call('GET', '/friends', null, a.body.token)).body.friends.length, 0);
  assert.equal((await call('POST', '/logout', null, a.body.token)).status, 200);
  assert.equal((await call('GET', '/me', null, a.body.token)).status, 401);
  assert.equal((await call('GET', '/backup')).status, 401);
});
