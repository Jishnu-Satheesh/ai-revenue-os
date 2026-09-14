begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(6);

-- Companion test for 20260914183000_refresh_campaign_source_snapshot.sql.
--
-- The suites here share the staging database and wrap in begin/rollback, so
-- this asserts the function's contract and its guards rather than standing up
-- two tenants and driving a real repair. The properties that matter are the
-- ones a mistake would silently remove: that it refuses without permission,
-- that it is not reachable anonymously, and that it cannot mutate a snapshot
-- already pinned.

select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'refresh_campaign_source_snapshot'
  ),
  'the refresh function exists'
);

-- security definer with a pinned empty search_path. Without the pin, a caller
-- controlling search_path could shadow the tables it reads.
select extensions.ok(
  exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'refresh_campaign_source_snapshot'
      and proc.prosecdef
      and proc.proconfig @> array['search_path=']
  ),
  'the refresh function is security definer with an empty search_path'
);

-- The permission check is the whole tenant guard: the function runs as its
-- owner, so nothing else stops a member of one organization naming another.
select extensions.ok(
  (
    select pg_catalog.pg_get_functiondef(proc.oid)
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'refresh_campaign_source_snapshot'
  ) like '%has_organization_permission(target_organization_id, ''campaign.edit'')%',
  'the refresh function checks campaign.edit against the organization it was asked about'
);

-- A campaign in another tenant must be indistinguishable from one that does
-- not exist, or the error itself confirms the campaign is real.
select extensions.ok(
  (
    select pg_catalog.pg_get_functiondef(proc.oid)
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'refresh_campaign_source_snapshot'
  ) like '%campaign_snapshot_campaign_not_found%',
  'a campaign outside the organization is reported as not found, never as refused'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    join pg_catalog.pg_roles grantee
      on pg_catalog.has_function_privilege(grantee.rolname, proc.oid, 'EXECUTE')
    where space.nspname = 'public'
      and proc.proname = 'refresh_campaign_source_snapshot'
      and grantee.rolname in ('anon', 'public')
  ),
  'the refresh function is not executable anonymously'
);

-- Immutability of what is already pinned. The function may only insert; an
-- update or delete here would rewrite the evidence an existing approval was
-- explained by.
select extensions.ok(
  (
    select pg_catalog.pg_get_functiondef(proc.oid)
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname = 'refresh_campaign_source_snapshot'
  ) !~* '(update|delete from)\s+public\.campaign_source_snapshots',
  'the refresh function never rewrites a snapshot that is already pinned'
);

select * from extensions.finish();
rollback;
