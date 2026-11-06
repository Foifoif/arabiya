-- Intentionally public access to this one collection by known email.
-- Owner explicitly accepts read/write access without identity verification.
-- Existing owner UUID and all version history are preserved.
begin;
create or replace function memory_private.require_owner() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); supplied text;
begin
  supplied := lower(btrim(coalesce(current_setting('request.headers', true), '{}')::jsonb->>'x-memory-email'));
  if supplied = 'aliafsh.3@gmail.com' then
    select u.id into actor from auth.users u where lower(u.email) = supplied and u.email_confirmed_at is not null;
  end if;
  if actor is null or not exists (select 1 from auth.users u where u.id=actor and lower(u.email)='aliafsh.3@gmail.com' and u.email_confirmed_at is not null) then
    raise sqlstate '42501' using message='No collection is available for this email.';
  end if;
  return actor;
end;
$$;
grant execute on function public.memory_state() to anon;
grant execute on function public.memory_versions() to anon;
grant execute on function public.memory_version(bigint) to anon;
grant execute on function public.memory_save(bigint,text,jsonb) to anon;
commit;
