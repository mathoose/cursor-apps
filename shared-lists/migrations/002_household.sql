create table if not exists household (
  id text primary key,
  data jsonb not null default '{"lists":[]}'::jsonb,
  revision bigint not null default 1
);
