-- ==============================================================================
-- BunkKro security audit (M10.1). READ-ONLY: every statement only looks, nothing is changed.
-- Supabase -> SQL Editor -> New query -> paste -> Run. Each block returns one table of results.
-- What "good" looks like is written above each block.
-- ==============================================================================

-- 1. Every table in "public" should have rls_on = true. A table with rls_on = false can be read and written by
--    ANYONE holding the site's public (publishable) key, all users' rows included.
select c.relname as table_name, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname;

-- 2. The policies. Each user table should have its SELECT / INSERT / UPDATE / DELETE rules tied to
--    auth.uid() = user_id. A qual of "true" (or no auth.uid()) on a user table means everyone can see it.
select tablename, policyname, cmd, roles, permissive, qual, with_check
from pg_policies where schemaname = 'public'
order by tablename, cmd;

-- 3. What the browser roles are allowed to do at all (RLS then narrows it to their own rows).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
group by table_name, grantee order by table_name, grantee;

-- 4. Views: a view runs with its owner's rights unless it is security_invoker, which can bypass RLS.
select c.relname as view_name, c.reloptions as options
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v';

-- 5. Functions that run with their owner's rights (SECURITY DEFINER) can bypass RLS: there should be none, or each
--    should be reviewed.
select p.proname as function_name, p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' order by p.prosecdef desc, p.proname;

-- 6. Storage buckets: public = true means anyone with the URL can download the files.
select id, name, public from storage.buckets;
