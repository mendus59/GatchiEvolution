// Client for the Gatchi account API (server/api.js), served by the Node
// server or by the hosted Supabase function, depending on config.js.
import { store } from './storage.js';
import { API_BASE } from './config.js';

export const online = API_BASE != null;

async function call(method, path, body) {
  if (!online) throw new Error('Accounts and versus are not set up on this site yet. Training and play still work.');
  const auth = store.loadAuth();
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth?.token ? { Authorization: 'Bearer ' + auth.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the Gatchi server right now. Your pet is safe in this browser; try again in a minute.");
  }
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
