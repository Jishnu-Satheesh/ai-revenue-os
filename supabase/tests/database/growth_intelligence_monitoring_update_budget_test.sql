begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(25);

-- Contract: update-keyed fenced spend ---------------------------------------
-- (1) has_function reserve_monitoring_update_budget
-- (2) has_function reserve_monitoring_update_attempt

select extensions.has_function(
  'public', 'reserve_monitoring_update_budget',
  array['uuid', 'uuid', 'bigint', 'text'],
  'update admission reserves its quote against the organization day'
);
select extensions.has_function(
  'public', 'reserve_monitoring_update_attempt',
  array['uuid', 'uuid', 'text', 'text', 'integer', 'bigint'],
  'every update-scoped paid call debits its worst case first, with no claim token'
);

-- (3) authenticated may execute the budget RPC
-- (4) authenticated may execute the attempt RPC
-- (5) anonymous callers cannot reserve update spend

select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_monitoring_update_budget(uuid,uuid,bigint,text)',
    'execute'
  ),
  'signed-in members reserve update budgets through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reserve_monitoring_update_attempt(uuid,uuid,text,text,integer,bigint)',
    'execute'
  ),
  'signed-in members debit update attempts through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.reserve_monitoring_update_budget(uuid,uuid,bigint,text)',
    'execute'
  ),
  'anonymous callers cannot reserve update spend'
);

-- (6) the shared reservation carries the update key

select extensions.has_column(
  'private', 'growth_intelligence_research_budget_reservations', 'update_id',
  'reservations key update scopes alongside pipelines and requests'
);

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('e6000000-0000-4000-8000-000000000001'::uuid),
  ('e6000000-0000-4000-8000-000000000002'::uuid),
  ('e6000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'Update agency A', 'update-agency-a', 'e6000000-0000-4000-8000-000000000001'::uuid),
  ('e6000000-0000-4000-8000-000000000102'::uuid, 'Update agency B', 'update-agency-b', 'e6000000-0000-4000-8000-000000000003'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000101'::uuid, 'Update client A', 'update-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e6000000-0000-4000-8000-000000000001'::uuid),
  ('e6000000-0000-4000-8000-000000000202'::uuid, 'e6000000-0000-4000-8000-000000000102'::uuid, 'Update client B', 'update-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'e6000000-0000-4000-8000-000000000003'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'e6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('e6000000-0000-4000-8000-000000000101'::uuid, 'e6000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('e6000000-0000-4000-8000-000000000102'::uuid, 'e6000000-0000-4000-8000-000000000003'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('e6000000-0000-4000-8000-000000000301'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'Update branch one', 'update-branch-one', 'physical', 'Asia/Dubai', 'AED', true),
  ('e6000000-0000-4000-8000-000000000302'::uuid, 'e6000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED', true);

insert into public.growth_intelligence_research_projects (
  id, organization_id, branch_id, title, question, mode, created_by
) values
  ('e6000000-0000-4000-8000-000000000401'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000301'::uuid, 'Update budget probe', 'How does demand change?', 'one-time', 'e6000000-0000-4000-8000-000000000001'::uuid),
  ('e6000000-0000-4000-8000-000000000402'::uuid, 'e6000000-0000-4000-8000-000000000202'::uuid, 'e6000000-0000-4000-8000-000000000302'::uuid, 'Other tenant project', 'How does demand change?', 'one-time', 'e6000000-0000-4000-8000-000000000003'::uuid);

insert into public.growth_intelligence_monitoring_updates (
  update_id, organization_id, project_id, stage, attempts
) values
  ('e6000000-0000-4000-8000-000000000501'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000401'::uuid, 'queued', 1),
  ('e6000000-0000-4000-8000-000000000502'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000401'::uuid, 'research_failed', 1),
  ('e6000000-0000-4000-8000-000000000503'::uuid, 'e6000000-0000-4000-8000-000000000201'::uuid, 'e6000000-0000-4000-8000-000000000401'::uuid, 'queued', 1),
  ('e6000000-0000-4000-8000-000000000504'::uuid, 'e6000000-0000-4000-8000-000000000202'::uuid, 'e6000000-0000-4000-8000-000000000402'::uuid, 'queued', 1);

update public.growth_intelligence_monitoring_updates update_row
set reason_code = 'RESEARCH_EXECUTION_UNAVAILABLE', retryable = true
where update_row.update_id = 'e6000000-0000-4000-8000-000000000502'::uuid;

-- The canary-staging migration may have committed a tinyfish row on shared
-- staging. Remove it inside this transaction (rolled back afterwards) so the
-- fixture insert below works with or without the push.

delete from private.growth_intelligence_provider_qualifications
where provider = 'tinyfish';

insert into private.growth_intelligence_provider_qualifications (
  provider, agreement_version, agreement_date, agreement_expires_at,
  permitted_uses, retention_policy, deletion_rules, pricing_version,
  search_rate_micros_usd, credential_ready, model_bounds, canary_result
) values (
  'tinyfish', 'TINYFISH-ORDER-2026-09-20', '2026-09-01', pg_catalog.now() + interval '90 days',
  array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse', 'agreed_retention'],
  'retain permitted excerpts for 400 days, then erase',
  'erase on termination within 30 days, including derived text on request',
  'tinyfish-search-2026-09', 1, true,
  -- Rate 1 micro-dollar is the documented free-tier accounting floor: the
  -- lane assert requires a positive rate, and actual TinyFish cost stays zero.
  '{"extraction": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "supportReview": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "synthesis": {"maxInputTokens": 24000, "maxOutputTokens": 6000}}'::jsonb,
  'passed'
);

-- Unknown updates and foreign tenants fail closed ------------------------------
-- (7) spend on a missing update refuses
-- (8) spend on another tenant's update refuses

set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000599'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  )$$,
  '42501', null,
  'spend on a missing update refuses without confirming anything'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  )$$,
  '42501', null,
  'spend on another tenant update refuses without confirming it exists'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000002';

-- Admission, replay, conflict, closed update ------------------------------------
-- (9) the first update reservation admits its full quote
-- (10) replaying the same terms returns the kept row
-- (11) replay returns the same reservation id
-- (12) replaying with a different quote conflicts
-- (13) a terminal update admits no budget

select extensions.is(
  (select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'the first update reservation admits its full quote'
);

create temp table pg_temp.update_budget_reservation as
select public.reserve_monitoring_update_budget(
  'e6000000-0000-4000-8000-000000000201'::uuid,
  'e6000000-0000-4000-8000-000000000501'::uuid,
  1000000::bigint, 'tinyfish-search-2026-09'
) as response;

grant select on table pg_temp.update_budget_reservation to service_role;

select extensions.is(
  (select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  true,
  'replaying the same update reservation cannot reserve twice'
);

select extensions.is(
  (select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'reservationId')::uuid,
  (select (response ->> 'reservationId')::uuid from pg_temp.update_budget_reservation),
  'replay returns the same reservation row'
);

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    500000::bigint, 'tinyfish-search-2026-09'
  )$$,
  '23505', null,
  'replaying with a different quote conflicts instead of double booking'
);

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000502'::uuid,
    1000000::bigint, 'tinyfish-search-2026-09'
  )$$,
  '23505', null,
  'a terminal update admits no new budget'
);

-- Attempt debits, replay, conflict ----------------------------------------------
-- (14) the first attempt debits its worst case
-- (15) the attempt id is stable output
-- (16) replaying the same attempt returns the kept row
-- (17) replay returns the same attempt id
-- (18) replaying with a different maximum conflicts

select extensions.is(
  (select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    'research', 'area:demand', 0, 25000::bigint
  ) ->> 'replayed')::boolean,
  false,
  'the first update attempt debits its worst case'
);

select extensions.ok(
  (select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    'research', 'area:demand', 0, 25000::bigint
  ) ->> 'attemptId')::uuid is not null,
  'the attempt debit returns a stable attempt id'
);

select extensions.is(
  (select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    'research', 'area:demand', 0, 25000::bigint
  ) ->> 'replayed')::boolean,
  true,
  'replaying the same update attempt cannot debit twice'
);

create temp table pg_temp.update_budget_attempt as
select public.reserve_monitoring_update_attempt(
  'e6000000-0000-4000-8000-000000000201'::uuid,
  'e6000000-0000-4000-8000-000000000501'::uuid,
  'research', 'area:demand', 0, 25000::bigint
) as response;

grant select on table pg_temp.update_budget_attempt to service_role;

select extensions.is(
  (select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    'research', 'area:demand', 0, 25000::bigint
  ) ->> 'attemptId')::uuid,
  (select (response ->> 'attemptId')::uuid from pg_temp.update_budget_attempt),
  'replay returns the same attempt row'
);

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    'research', 'area:demand', 0, 20000::bigint
  )$$,
  '23505', null,
  'replaying with a different maximum conflicts instead of double booking'
);

-- Quote enforcement, shared settlement, post-terminal fence -----------------------
-- (19) attempts within a small quote debit
-- (20) a second attempt within the small quote debits
-- (21) the attempt past the quote refuses before any call
-- (22) usage settles through the shared attempt RPC
-- (23) spend after settle refuses
-- (24) one scope key never forks the ledger

select extensions.is(
  (select public.reserve_monitoring_update_budget(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000503'::uuid,
    50000::bigint, 'tinyfish-search-2026-09'
  ) ->> 'replayed')::boolean,
  false,
  'a small update quote admits for the over-cap probe'
);

select extensions.is(
  (select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000503'::uuid,
    'research', 'area:demand', 0, 25000::bigint
  ) ->> 'replayed')::boolean,
  false,
  'the first attempt fits inside the small quote'
);

select extensions.is(
  (select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000503'::uuid,
    'research', 'area:reviews', 0, 25000::bigint
  ) ->> 'replayed')::boolean,
  false,
  'the second attempt fits inside the small quote'
);

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000503'::uuid,
    'research', 'competitor:stitch-house', 0, 25000::bigint
  )$$,
  '23505', null,
  'the attempt past the admitted quote refuses before any call'
);

select extensions.is(
  (select public.settle_research_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    (select (response ->> 'attemptId')::uuid from pg_temp.update_budget_attempt),
    '{"kind": "reported", "microsUsd": 0}'::jsonb
  ) ->> 'settlementKind'),
  'reported',
  'update attempts reconcile through the shared settlement RPC'
);

reset role;

update public.growth_intelligence_monitoring_updates update_row
set stage = 'research_failed',
  reason_code = 'RESEARCH_EXECUTION_UNAVAILABLE',
  retryable = true
where update_row.update_id = 'e6000000-0000-4000-8000-000000000501'::uuid;

set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.reserve_monitoring_update_attempt(
    'e6000000-0000-4000-8000-000000000201'::uuid,
    'e6000000-0000-4000-8000-000000000501'::uuid,
    'research', 'area:demand', 1, 25000::bigint
  )$$,
  '23505', null,
  'spend after settle refuses on the terminal row'
);

reset role;

select extensions.ok(
  (select pg_catalog.count(*)::integer
   from private.growth_intelligence_research_budget_reservations reservation
   where reservation.organization_id = 'e6000000-0000-4000-8000-000000000201'::uuid
     and reservation.pipeline_id is null
     and reservation.request_id is null
     and reservation.update_id is not null) = 2,
  'update scopes book exactly their own reservations, never a forked row'
);

rollback;
