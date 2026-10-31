// Client for the Gatchi account server (server/server.js).
import { store } from './storage.js';

async function call(method, path, body) {
  const auth = store.loadAuth();
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  register: (username, password) => call('POST', '/register', { username, password }),
  login: (username, password) => call('POST', '/login', { username, password }),
  logout: () => call('POST', '/logout'),
  me: () => call('GET', '/me'),
  pushBackup: (backup) => call('PUT', '/backup', backup),
  pullBackup: () => call('GET', '/backup'),
  publicPet: (username) => call('GET', `/users/${encodeURIComponent(username)}/pet`),
  friends: () => call('GET', '/friends'),
  addFriend: (username) => call('POST', '/friends', { username }),
  removeFriend: (username) => call('DELETE', `/friends/${encodeURIComponent(username)}`),
  versus: (opponent) => call('POST', '/versus', { opponent }),
  leaderboard: () => call('GET', '/leaderboard'),
};
