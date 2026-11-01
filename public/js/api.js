// Client for the Gatchi account API (server/api.js), served by the Node
// server or by the hosted Supabase function, depending on config.js.
import { store } from './storage.js';
import { API_BASE, GOOGLE_AUTH_URL } from './config.js';

export const online = API_BASE != null;
export const googleEnabled = online && GOOGLE_AUTH_URL != null;

// Sends the browser to Google (via Supabase Auth). It comes back to this page
// with #access_token=... in the URL; see takeGoogleReturn().
// link: true links Google to the player who is signed in now.
export function startGoogleSignIn(link = false) {
  try { sessionStorage.setItem('gatchi:googleLink', link ? '1' : ''); } catch {}
  const back = location.origin + location.pathname;
  location.href = `${GOOGLE_AUTH_URL}/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`;
}

// Reads and clears the sign-in result from the URL after the redirect back.
// Returns { accessToken, link } or { error } or null when this isn't a sign-in return.
export function takeGoogleReturn() {
  const params = new URLSearchParams(location.hash.slice(1));
  const accessToken = params.get('access_token');
  const error = params.get('error_description') || params.get('error');
  if (!accessToken && !error) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let link = false;
  try { link = sessionStorage.getItem('gatchi:googleLink') === '1'; sessionStorage.removeItem('gatchi:googleLink'); } catch {}
  return accessToken ? { accessToken, link } : { error };
}

async function call(method, path, body, { auth: useAuth = true } = {}) {
  if (!online) throw new Error('Accounts and versus are not set up on this site yet. Training and play still work.');
  const auth = useAuth ? store.loadAuth() : null;
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
  googleSignIn: (accessToken, username) => call('POST', '/oauth', { accessToken, username }, { auth: false }),
  googleLink: (accessToken) => call('POST', '/oauth', { accessToken, link: true }),
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
