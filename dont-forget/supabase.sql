-- Don't Forget shared rooms (same Supabase project as Our Lists).
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Put Project URL and anon key in dont-forget/config.js (or reuse shared-lists/config.js values).

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.dont_forget_rooms (
  code text primary key,
  pin_hash text not null,
  data jsonb not null default '{"items":[]}'::jsonb,
  revision bigint not null default 1,
  constraint dont_forget_rooms_code_chk check (code ~ '^[A-Z0-9]{4,12}$')
);

alter table public.dont_forget_rooms enable row level security;
revoke all on table public.dont_forget_rooms from public, anon, authenticated;

create or replace function public.df_room_status(p_code text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if c !~ '^[A-Z0-9]{4,12}$' then
    return 'bad_code';
  end if;
  if exists (select 1 from public.dont_forget_rooms where code = c) then
    return 'exists';
  end if;
  return 'new';
end;
$$;

create or replace function public.df_create_room(p_code text, p_pin text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
begin
  if c !~ '^[A-Z0-9]{4,12}$' then
    return jsonb_build_object('status', 'bad_code');
  end if;
  if pin !~ '^[0-9]{4,8}$' then
    return jsonb_build_object('status', 'bad_pin');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 400000 then
    return jsonb_build_object('status', 'bad_data');
  end if;
  begin
    insert into public.dont_forget_rooms (code, pin_hash, data, revision)
    values (c, extensions.crypt(pin, extensions.gen_salt('bf')), p_data, 1);
  exception when unique_violation then
    return jsonb_build_object('status', 'exists');
  end;
  return jsonb_build_object('status', 'ok', 'revision', 1, 'data', p_data);
end;
$$;

create or replace function public.df_open_room(p_code text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
  rec public.dont_forget_rooms%rowtype;
begin
  if c !~ '^[A-Z0-9]{4,12}$' then
    return jsonb_build_object('status', 'bad_code');
  end if;
  select * into rec from public.dont_forget_rooms where code = c;
  if not found then
    return jsonb_build_object('status', 'new');
  end if;
  if pin !~ '^[0-9]{4,8}$' or rec.pin_hash is distinct from extensions.crypt(pin, rec.pin_hash) then
    return jsonb_build_object('status', 'bad_pin');
  end if;
  return jsonb_build_object('status', 'ok', 'revision', rec.revision, 'data', rec.data);
end;
$$;

create or replace function public.df_save_room(p_code text, p_pin text, p_data jsonb, p_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  pin text := regexp_replace(coalesce(p_pin, ''), '\D', '', 'g');
  rec public.dont_forget_rooms%rowtype;
begin
  if c !~ '^[A-Z0-9]{4,12}$' then
    return jsonb_build_object('status', 'bad_code');
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or octet_length(p_data::text) > 400000 then
    return jsonb_build_object('status', 'bad_data');
  end if;
  select * into rec from public.dont_forget_rooms where code = c for update;
  if not found then
    return jsonb_build_object('status', 'new');
  end if;
  if pin !~ '^[0-9]{4,8}$' or rec.pin_hash is distinct from extensions.crypt(pin, rec.pin_hash) then
    return jsonb_build_object('status', 'bad_pin');
  end if;
  if rec.revision is distinct from p_revision then
    return jsonb_build_object('status', 'conflict', 'revision', rec.revision, 'data', rec.data);
  end if;
  update public.dont_forget_rooms
    set data = p_data,
        revision = rec.revision + 1
    where code = c
    returning revision into rec.revision;
  return jsonb_build_object('status', 'ok', 'revision', rec.revision);
end;
$$;

revoke all on function public.df_room_status(text) from public;
revoke all on function public.df_create_room(text, text, jsonb) from public;
revoke all on function public.df_open_room(text, text) from public;
revoke all on function public.df_save_room(text, text, jsonb, bigint) from public;

grant execute on function public.df_room_status(text) to anon, authenticated;
grant execute on function public.df_create_room(text, text, jsonb) to anon, authenticated;
grant execute on function public.df_open_room(text, text) to anon, authenticated;
grant execute on function public.df_save_room(text, text, jsonb, bigint) to anon, authenticated;
