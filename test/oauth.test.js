import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createApi } from '../server/api.js';
import { fileStore } from '../server/store-file.js';

// A fake provider: tokens look like "tok:<id>:<email>".
async function verifyOAuth(token) {
  const m = /^tok:([^:]+):(.*)$/.exec(token);
  return m ? { id: 'test:' + m[1], email: m[2] } : null;
}

export async function oauthSuite(store, tag = '') {
  const api = createApi(store, { verifyOAuth });
  const call = (method, p, body, token) => api.handle({
    method, path: p, ip: '1.2.3.' + Math.random(), authorization: token ? 'Bearer ' + token : '',
    bodyText: body ? JSON.stringify(body) : '',
  });
  const g1 = `tok:g1${tag}:gina.smith@example.com`, g2 = `tok:g2${tag}:x@example.com`;

  assert.equal((await call('POST', '/oauth', { accessToken: 'bogus' })).status, 401);

  const first = await call('POST', '/oauth', { accessToken: g1 });
  assert.equal(first.status, 200);
  assert.equal(first.body.needsUsername, true);
  assert.equal(first.body.suggestion, 'ginasmith');

  const pw = await call('POST', '/register', { username: 'pwuser' + tag, password: 'password1' });
  assert.equal((await call('POST', '/oauth', { accessToken: g1, username: 'PWUSER' + tag })).status, 409);

  const made = await call('POST', '/oauth', { accessToken: g1, username: 'gina' + tag });
  assert.equal(made.status, 200);
  assert.equal(made.body.username, 'gina' + tag);
  const me = await call('GET', '/me', null, made.body.token);
  assert.equal(me.body.google, true);
  // Google-only players can't be signed into with any password.
  assert.equal((await call('POST', '/login', { username: 'gina' + tag, password: 'password1' })).status, 401);

  const again = await call('POST', '/oauth', { accessToken: g1 });
  assert.equal(again.body.username, 'gina' + tag);
  assert.ok(again.body.token);

  // Linking: a Google identity already used can't be linked elsewhere.
  assert.equal((await call('POST', '/oauth', { accessToken: g1, link: true }, pw.body.token)).status, 409);
  assert.equal((await call('POST', '/oauth', { accessToken: g2, link: true })).status, 401);
  const link = await call('POST', '/oauth', { accessToken: g2, link: true }, pw.body.token);
  assert.equal(link.status, 200);
  assert.equal((await call('POST', '/oauth', { accessToken: g2 })).body.username, 'pwuser' + tag);
  assert.equal((await call('POST', '/login', { username: 'pwuser' + tag, password: 'password1' })).status, 200);

  // Without a provider, Google sign-in reports it's unavailable.
  const plain = createApi(store);
  assert.equal((await plain.handle({ method: 'POST', path: '/oauth', ip: 'x', bodyText: JSON.stringify({ accessToken: g1 }) })).status, 501);
}

test('Google sign-in (file store)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatchi-oauth-'));
  await oauthSuite(fileStore(path.join(dir, 'db.json')));
});
