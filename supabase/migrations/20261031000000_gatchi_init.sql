-- Gatchi Evolution backend tables. Only the `api` Edge Function touches them
-- (it connects as the database owner). Row level security is on with no
-- policies, so the public anon key cannot read or write anything here.

create table if not exists public.gatchi_players (
  key          text primary key,            -- lowercased username
  username     text not null,
  salt         text not null,
  hash         text not null,               -- scrypt
  created_at   bigint not null,
  elo          double precision not null default 1000,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  friends      text[] not null default '{}',
  last_versus  bigint not null default 0,
  pet          jsonb,                       -- copy of backup.pet for cheap lookups
  backup       jsonb,
  backup_at    bigint
);
create index if not exists gatchi_players_elo on public.gatchi_players (elo desc) where pet is not null;

create table if not exists public.gatchi_sessions (
  token_hash  text primary key,             -- sha256 of the bearer token
  username    text not null,
  expires     bigint not null
);

create table if not exists public.gatchi_matches (
  id       bigserial primary key,
  at       bigint not null,
  a        text not null,
  b        text not null,
  seed     bigint not null,
  winner   text not null,
  results  jsonb not null
);

alter table public.gatchi_players  enable row level security;
alter table public.gatchi_sessions enable row level security;
alter table public.gatchi_matches  enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.gatchi_players, public.gatchi_sessions, public.gatchi_matches from anon, authenticated;
  end if;
end $$;
