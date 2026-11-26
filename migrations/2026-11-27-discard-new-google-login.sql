-- Applied to project mvlyeygitnnuksuxmcsy on 2026-11-27 (migration "discard_new_google_login").
--
-- "Login with Google" must not create accounts, but Google sign-in creates one for any Google user Supabase hasn't
-- seen. The website calls this right after Google when the trip started on Login: it removes the CALLER's own login,
-- and only if that login was made moments ago by this very sign-in, is Google-only and has nothing saved.
-- Anything else is left alone and 'kept' is returned. Signed-out callers are refused (no EXECUTE for anon).
-- Tested in a rolled-back transaction: brand-new Google-only -> discarded; 2 days old, has an email identity,
-- has a subject, signed in again later -> kept; anon -> refused.
create or replace function public.discard_new_google_login()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  u record;
begin
  if uid is null then return 'kept'; end if;
  select id, created_at, last_sign_in_at into u from auth.users where id = uid;
  if not found then return 'kept'; end if;
  if u.created_at < now() - interval '10 minutes' then return 'kept'; end if;
  if u.last_sign_in_at is not null and u.last_sign_in_at > u.created_at + interval '1 minute' then return 'kept'; end if;
  if exists (select 1 from auth.identities i where i.user_id = uid and i.provider <> 'google') then return 'kept'; end if;
  if not exists (select 1 from auth.identities i where i.user_id = uid and i.provider = 'google') then return 'kept'; end if;
  if exists (select 1 from public.subjects where user_id = uid)
     or exists (select 1 from public.timetables where user_id = uid)
     or exists (select 1 from public.timetable_entries where user_id = uid)
     or exists (select 1 from public.timetable_exceptions where user_id = uid)
     or exists (select 1 from public.timetable_imports where user_id = uid)
     or exists (select 1 from public.timetable_feedback where user_id = uid)
     or exists (select 1 from public.tracker_logs where user_id = uid)
     or exists (select 1 from public.daily_period_logs where user_id = uid)
     or exists (select 1 from public."Subjects_backup" where user_id = uid)
  then return 'kept'; end if;
  delete from auth.users where id = uid;
  return 'discarded';
end;
$$;

revoke all on function public.discard_new_google_login() from public, anon;
grant execute on function public.discard_new_google_login() to authenticated;
