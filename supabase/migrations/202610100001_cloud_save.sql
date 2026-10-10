-- Private, single-user cloud collection. Run once in the selected Supabase project.
-- Tables are deliberately outside the exposed public schema. Only the four
-- authenticated RPCs below are callable, and each derives ownership itself.
begin;
create schema if not exists memory_private;
revoke all on schema memory_private from public, anon, authenticated;

create table if not exists memory_private.collections (
  owner uuid primary key references auth.users(id),
  version bigint not null check (version > 0),
  data jsonb not null,
  updated_at timestamptz not null,
  mutation_id text not null
);
create table if not exists memory_private.versions (
  owner uuid not null references auth.users(id),
  version bigint not null,
  data jsonb not null,
  updated_at timestamptz not null,
  mutation_id text not null,
  primary key (owner, version),
  unique (owner, mutation_id)
);
alter table memory_private.collections enable row level security;
alter table memory_private.versions enable row level security;
revoke all on all tables in schema memory_private from public, anon, authenticated;

create or replace function memory_private.require_owner() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select 1 from auth.users u where u.id = actor
      and lower(u.email) = 'aliafsh.3@gmail.com'
      and u.email_confirmed_at is not null
  ) then
    raise sqlstate '42501' using message = 'This account is not allowed to access the collection.';
  end if;
  return actor;
end;
$$;
revoke all on function memory_private.require_owner() from public, anon, authenticated;

create or replace function public.memory_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := memory_private.require_owner(); result jsonb;
begin
  select jsonb_build_object('version', c.version, 'data', c.data,
    'updatedAt', c.updated_at, 'mutationId', c.mutation_id)
    into result from memory_private.collections c where c.owner = actor;
  return coalesce(result, jsonb_build_object('version', 0, 'data', null, 'updatedAt', null, 'mutationId', null));
end;
$$;

create or replace function public.memory_versions() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := memory_private.require_owner(); result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('version', v.version,
    'updatedAt', v.updated_at, 'cards', jsonb_array_length(v.data->'cards'),
    'reviews', jsonb_array_length(v.data->'reviews')) order by v.version desc), '[]'::jsonb)
    into result from memory_private.versions v where v.owner = actor;
  return result;
end;
$$;

create or replace function public.memory_version(requested_version bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := memory_private.require_owner(); result jsonb;
begin
  select v.data into result from memory_private.versions v
    where v.owner = actor and v.version = requested_version;
  if result is null then raise sqlstate 'PT404' using message = 'This version is no longer available.'; end if;
  return result;
end;
$$;

create or replace function public.memory_save(expected_version bigint, mutation_id text, collection jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := memory_private.require_owner(); current_row memory_private.collections%rowtype;
  next_version bigint; stamp timestamptz := clock_timestamp();
begin
  if expected_version is null or expected_version < 0 or expected_version >= 9007199254740991
    or mutation_id is null or mutation_id !~ '^[a-zA-Z0-9-]{16,80}$'
    or collection is null or octet_length(collection::text) > 4000000
    or (collection->>'version') is distinct from '2'
    or jsonb_typeof(collection->'cards') is distinct from 'array'
    or jsonb_typeof(collection->'reviews') is distinct from 'array'
    or jsonb_typeof(collection->'settings') is distinct from 'object'
    or jsonb_typeof(collection->'links') is distinct from 'object'
  then raise sqlstate 'PT400' using message = 'Invalid collection.'; end if;
  -- Includes the first insert: row locks alone cannot lock a missing row.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
  select * into current_row from memory_private.collections c where c.owner = actor;
  if current_row.mutation_id = memory_save.mutation_id then
    if current_row.data is distinct from collection then
      raise sqlstate 'PT400' using message = 'Mutation ID already used for different content.';
    end if;
    return public.memory_state();
  end if;
  if coalesce(current_row.version, 0) <> expected_version or exists (
    select 1 from memory_private.versions v where v.owner = actor and v.mutation_id = memory_save.mutation_id
  ) then raise sqlstate 'PT409' using message = 'Another device saved changes first.'; end if;
  next_version := expected_version + 1;
  insert into memory_private.collections as c values (actor, next_version, collection, stamp, mutation_id)
    on conflict (owner) do update set version = excluded.version, data = excluded.data,
      updated_at = excluded.updated_at, mutation_id = excluded.mutation_id;
  insert into memory_private.versions values (actor, next_version, collection, stamp, mutation_id);
  delete from memory_private.versions v where v.owner = actor and v.version <= next_version - 50;
  return jsonb_build_object('version', next_version, 'data', collection, 'updatedAt', stamp, 'mutationId', mutation_id);
end;
$$;

revoke all on function public.memory_state() from public, anon;
revoke all on function public.memory_versions() from public, anon;
revoke all on function public.memory_version(bigint) from public, anon;
revoke all on function public.memory_save(bigint, text, jsonb) from public, anon;
grant execute on function public.memory_state() to authenticated;
grant execute on function public.memory_versions() to authenticated;
grant execute on function public.memory_version(bigint) to authenticated;
grant execute on function public.memory_save(bigint, text, jsonb) to authenticated;
commit;
