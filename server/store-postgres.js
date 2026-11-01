// Postgres store for the hosted backend (Supabase). Same interface as
// store-file.js. `sql` is a postgres.js client (https://github.com/porsager/postgres);
// the caller creates it so this file has no imports and runs under Node or Deno.
// Schema: supabase/migrations/*_init.sql.

const rec = (r) => ({ wins: r.wins, losses: r.losses, draws: r.draws });
const num = (x) => Number(x);

export function postgresStore(sql) {
  const COLS = sql`username, salt, hash, auth_id, elo, wins, losses, draws, friends, backup_at`;
  const full = (r) => (r ? { username: r.username, salt: r.salt, hash: r.hash, authId: r.auth_id, elo: num(r.elo), record: rec(r), friends: r.friends, backupAt: r.backup_at == null ? null : num(r.backup_at) } : null);
  const view = (r) => ({ username: r.username, elo: num(r.elo), record: rec(r), pet: r.pet || null });

  return {
    async getUser(name) {
      const [r] = await sql`select ${COLS} from gatchi_players where key = ${String(name).toLowerCase()}`;
      return full(r);
    },

    async getUserByAuth(authId) {
      const [r] = await sql`select ${COLS} from gatchi_players where auth_id = ${authId}`;
      return full(r);
    },

    async linkAuth(name, authId) {
      const rows = await sql`
        update gatchi_players set auth_id = ${authId}
        where key = ${String(name).toLowerCase()}
          and not exists (select 1 from gatchi_players where auth_id = ${authId})
        returning key`.catch((err) => { if (err.code === '23505') return []; throw err; });
      return rows.length === 1;
    },

    async createUser({ username, salt, hash, createdAt, authId = null }) {
      const rows = await sql`
        insert into gatchi_players (key, username, salt, hash, created_at, auth_id)
        values (${username.toLowerCase()}, ${username}, ${salt}, ${hash}, ${createdAt}, ${authId})
        on conflict do nothing returning key`;
      return rows.length === 1;
    },

    async getBackup(name) {
      const [r] = await sql`select backup from gatchi_players where key = ${String(name).toLowerCase()}`;
      return r?.backup || null;
    },

    async setBackup(name, backup) {
      await sql`
        update gatchi_players set backup = ${sql.json(backup)}, pet = ${sql.json(backup.pet)}, backup_at = ${backup.savedAt}
        where key = ${String(name).toLowerCase()}`;
    },

    async setFriends(name, friends) {
      await sql`update gatchi_players set friends = ${sql.array(friends)}::text[] where key = ${String(name).toLowerCase()}`;
    },

    async publicUsers(names) {
      if (!names.length) return [];
      const keys = names.map((n) => String(n).toLowerCase());
      const rows = await sql`
        select key, username, elo, wins, losses, draws, pet
        from gatchi_players where key = any(${sql.array(keys)}::text[])`;
      const byKey = new Map(rows.map((r) => [r.key, r]));
      return keys.map((k) => byKey.get(k)).filter(Boolean).map(view);
    },

    async topPlayers(limit) {
      const rows = await sql`
        select username, elo, wins, losses, draws, pet from gatchi_players
        where pet is not null order by elo desc limit ${limit}`;
      return rows.map(view);
    },

    async createSession(hash, username, expires) {
      await sql`insert into gatchi_sessions (token_hash, username, expires) values (${hash}, ${username}, ${expires})`;
      // Opportunistic cleanup keeps the table small without a cron job.
      if (Math.random() < 0.05) await sql`delete from gatchi_sessions where expires < ${Date.now()}`;
    },

    async getSession(hash) {
      const [r] = await sql`select username, expires from gatchi_sessions where token_hash = ${hash}`;
      return r ? { username: r.username, expires: num(r.expires) } : null;
    },

    async deleteSession(hash) {
      await sql`delete from gatchi_sessions where token_hash = ${hash}`;
    },

    async claimVersus(name, now, gapMs) {
      const rows = await sql`
        update gatchi_players set last_versus = ${now}
        where key = ${String(name).toLowerCase()} and last_versus <= ${now - gapMs} returning key`;
      return rows.length === 1;
    },

    // One transaction with row locks, so two matches finishing at once can't
    // lose a rating update.
    async recordMatch(a, b, scoreA, rate, row) {
      const ka = String(a).toLowerCase(), kb = String(b).toLowerCase();
      return sql.begin(async (tx) => {
        const rows = await tx`select key, elo from gatchi_players where key in (${ka}, ${kb}) order by key for update`;
        const cur = new Map(rows.map((r) => [r.key, num(r.elo)]));
        const [ea, eb] = rate(cur.get(ka), cur.get(kb));
        const bump = (s) => tx`wins = wins + ${s === 1 ? 1 : 0}, losses = losses + ${s === 0 ? 1 : 0}, draws = draws + ${s === 0.5 ? 1 : 0}`;
        await tx`update gatchi_players set elo = ${ea}, ${bump(scoreA)} where key = ${ka}`;
        await tx`update gatchi_players set elo = ${eb}, ${bump(1 - scoreA)} where key = ${kb}`;
        await tx`
          insert into gatchi_matches (at, a, b, seed, winner, results)
          values (${row.at}, ${row.a}, ${row.b}, ${row.seed}, ${row.winner}, ${tx.json(row.results)})`;
        return [ea, eb];
      });
    },
  };
}
