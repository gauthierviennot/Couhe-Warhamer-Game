-- À exécuter une seule fois dans Supabase : SQL Editor > New query > coller > Run.

create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists saved_maps (
  id text primary key,
  name text not null,
  auto boolean not null default false,
  author text,
  saved_at bigint,
  cols integer,
  rows integer,
  tiles integer,
  terrains jsonb,
  grid jsonb
);

create table if not exists sessions (
  token text primary key,
  name text,
  is_admin boolean not null default false,
  fp text,
  last_seen bigint
);

-- Sécurité : seule la clé « service_role » (utilisée par le serveur) peut lire et écrire.
alter table app_state enable row level security;
alter table saved_maps enable row level security;
alter table sessions enable row level security;
