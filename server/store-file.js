// JSON-file store for the self-hosted Node server. Fine for a handful of
// friends; the hosted version uses store-postgres.js behind the same interface.
//
// Store interface (all methods async):
//   getUser(name)                     -> { username, salt, hash, elo, record, friends, backupAt } | null
//   createUser({ username, salt, hash, createdAt }) -> true, or false if the name is taken
//   getBackup(name) / setBackup(name, backup)
//   setFriends(name, friends)
//   publicUsers(names)                -> [{ username, elo, record, pet }] in the order given, missing names skipped
//   topPlayers(limit)                 -> same shape, only players with a backup, best Elo first
//   createSession(hash, username, expires) / getSession(hash) / deleteSession(hash)
//   claimVersus(name, now, gapMs)     -> false if the player started a match less than gapMs ago
//   recordMatch(a, b, scoreA, rate, row) -> [newEloA, newEloB]; rate(eloA, eloB) gives the new ratings
import fs from 'node:fs';
import path from 'node:path';

export function fileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let data = { users: {}, sessions: {}, matches: [] };
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let timer = null;

  function flush() {
    timer = null;
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file); // atomic replace
  }
  const save = () => { if (!timer) timer = setTimeout(flush, 200); };
  const raw = (name) => data.users[String(name).toLowerCase()];
  const view = (u) => ({ username: u.username, elo: u.elo, record: { ...u.record }, pet: u.backup?.pet || null });
  const tally = (u, s) => { if (s === 1) u.record.wins++; else if (s === 0) u.record.losses++; else u.record.draws++; };

  return {
    async getUser(name) {
      const u = raw(name);
      return u ? { username: u.username, salt: u.salt, hash: u.hash, elo: u.elo, record: { ...u.record }, friends: [...u.friends], backupAt: u.backup?.savedAt || null } : null;
    },
    async createUser({ username, salt, hash, createdAt }) {
      const key = username.toLowerCase();
      if (data.users[key]) return false;
      data.users[key] = { username, salt, hash, createdAt, elo: 1000, record: { wins: 0, losses: 0, draws: 0 }, friends: [], backup: null, lastVersus: 0 };
      save();
      return true;
    },
    async getBackup(name) { return raw(name)?.backup || null; },
    async setBackup(name, backup) { raw(name).backup = backup; save(); },
    async setFriends(name, friends) { raw(name).friends = friends; save(); },
    async publicUsers(names) { return names.map(raw).filter(Boolean).map(view); },
    async topPlayers(limit) {
      return Object.values(data.users).filter((u) => u.backup).sort((a, b) => b.elo - a.elo).slice(0, limit).map(view);
    },
    async createSession(hash, username, expires) { data.sessions[hash] = { username, expires }; save(); },
    async getSession(hash) { return data.sessions[hash] || null; },
    async deleteSession(hash) { delete data.sessions[hash]; save(); },
    async claimVersus(name, now, gapMs) {
      const u = raw(name);
      if (now - (u.lastVersus || 0) < gapMs) return false;
      u.lastVersus = now;
      save();
      return true;
    },
    async recordMatch(a, b, scoreA, rate, row) {
      const ua = raw(a), ub = raw(b);
      [ua.elo, ub.elo] = rate(ua.elo, ub.elo);
      tally(ua, scoreA); tally(ub, 1 - scoreA);
      data.matches.push(row);
      data.matches = data.matches.slice(-500);
      save();
      return [ua.elo, ub.elo];
    },
    flushNow() { if (timer) clearTimeout(timer); flush(); },
  };
}
