-- Google sign-in: players can be linked to a Supabase Auth identity, and
-- Google-only players have no password.
alter table public.gatchi_players add column if not exists auth_id text unique;
alter table public.gatchi_players alter column salt drop not null;
alter table public.gatchi_players alter column hash drop not null;
