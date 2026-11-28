create table if not exists rooms (
  code text primary key,
  pin_hash text not null,
  data jsonb not null default '{"lists":[]}'::jsonb,
  revision bigint not null default 1,
  pin_fails integer not null default 0,
  pin_locked_until timestamptz
);
