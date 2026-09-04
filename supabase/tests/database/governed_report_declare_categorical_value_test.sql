begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

-- A way out of a refusal that does not require opening the source code. The
-- projection still refuses an undeclared label -- folding it into "other"
-- would make an incomplete count read as complete -- but an owner or admin
-- can now propose the label into the figures and approve it through the
-- existing decision RPC, instead of asking an engineer to edit the library.

insert into auth.users (id) values
  ('a7000000-0000-4000-8000-000000000001'::uuid), -- org A owner: has report.contract_approve
  ('a7000000-0000-4000-8000-000000000002'::uuid), -- org A operator: report.upload only
  ('b7000000-0000-4000-8000-000000000001'::uuid); -- org B owner

insert into public.accounts (id, name, slug, created_by) values
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'Declare verifier A', 'declare-verifier-a', 'a7000000-0000-4000-8000-000000000001'::uuid),
  ('b7000000-0000-4000-8000-000000000101'::uuid, 'Declare verifier B', 'declare-verifier-b', 'b7000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000101'::uuid, 'Declare verifier A', 'declare-verifier-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'a7000000-0000-4000-8000-000000000001'::uuid),
  ('b7000000-0000-4000-8000-000000000201'::uuid, 'b7000000-0000-4000-8000-000000000101'::uuid, 'Declare verifier B', 'declare-verifier-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'b7000000-0000-4000-8000-000000000001'::uuid);

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency) values
  ('a7000000-0000-4000-8000-000000000301'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'Declare outlet A', 'declare-outlet-a', 'physical', 'Asia/Dubai', 'AED');

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by) values
  ('a7000000-0000-4000-8000-000000000401'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'declare-channel-a', 'Declare channel A', 'marketplace', 'a7000000-0000-4000-8000-000000000001'::uuid);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('a7000000-0000-4000-8000-000000000101'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('b7000000-0000-4000-8000-000000000101'::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner');

insert into public.integration_report_packages (
  id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end,
  declared_currency, period_timezone, file_kind, original_filename, declared_content_type, declared_content_length,
  storage_path, content_sha256, structure_fingerprint, status, upload_expires_at, created_by, correlation_id
) values
  ('a7000000-0000-4000-8000-000000000501'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid,
   'a7000000-0000-4000-8000-000000000401'::uuid, 'a7000000-0000-4000-8000-000000000301'::uuid,
   'Marketplace Cancellations', date '2026-03-01', date '2026-03-31', 'AED', 'Asia/Dubai', 'csv', 'mar.csv', 'text/csv', 42,
   'a7000000-0000-4000-8000-000000000201/a7000000-0000-4000-8000-000000000401/a7000000-0000-4000-8000-000000000501/1/original/report.csv',
   '1111111111111111111111111111111111111111111111111111111111111111',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'awaiting_contract',
   now() + interval '1 hour', 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000901'::uuid);

insert into public.report_contracts (id, organization_id, channel_id, report_type, outlet_grain, created_by) values
  ('a7000000-0000-4000-8000-000000000601'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Cancellations Contract', 'branch', 'a7000000-0000-4000-8000-000000000001'::uuid),
  ('a7000000-0000-4000-8000-000000000602'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000401'::uuid, 'Marketplace Minutes Contract', 'branch', 'a7000000-0000-4000-8000-000000000001'::uuid);

-- The mapping the declaration is checked against: a date column and the two
-- count columns the projection versions below read. Inserted directly,
-- bypassing the propose RPC, exactly as the admission suite does for rows
-- that are already past that stage -- only the declare RPC is under test.
insert into public.report_contract_versions (
  id, organization_id, report_contract_id, report_package_id, version, schema_fingerprint, parser_version,
  fingerprint_version, mapping_document, mapping_digest, declared_currency, financial_sign_semantics, controls,
  unmapped_field_disposition, proposal_source, created_by, correlation_id
) values
  ('a7000000-0000-4000-8000-000000000701'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000601'::uuid,
   'a7000000-0000-4000-8000-000000000501'::uuid, 1, '3333333333333333333333333333333333333333333333333333333333333333', 1, 1,
   '{"sheets":[{"normalizedSheetName":"csv","fields":[{"canonicalField":"business_date","parser":"local_date","required":true},{"canonicalField":"cancel_reason","parser":"text","required":true},{"canonicalField":"closed_minutes","parser":"integer","required":true}]}]}'::jsonb,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000905'::uuid),
  ('a7000000-0000-4000-8000-000000000702'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000602'::uuid,
   'a7000000-0000-4000-8000-000000000501'::uuid, 1, '3333333333333333333333333333333333333333333333333333333333333334', 1, 1,
   '{"sheets":[{"normalizedSheetName":"csv","fields":[{"canonicalField":"business_date","parser":"local_date","required":true},{"canonicalField":"cancel_reason","parser":"text","required":true},{"canonicalField":"closed_minutes","parser":"integer","required":true}]}]}'::jsonb,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccd', 'AED', '[]'::jsonb, '[]'::jsonb,
   'reviewed_ignore', 'human', 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000906'::uuid);

-- The approved run failed against ...801: March carries CLOSED, and only
-- ITEM_UNAVAILABLE is declared. ...802 is the plain-count neighbour that
-- proves declaring into an output with no vocabulary is a different refusal.
insert into public.report_projection_versions (
  id, organization_id, report_contract_version_id, version, projection_document, projection_digest,
  calculation_version, proposal_source, created_by, correlation_id
) values
  ('a7000000-0000-4000-8000-000000000801'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000701'::uuid,
   1, '{"schemaVersion":1,"outputKind":"period_grain","grain":"day","periodKey":{"normalizedSheetName":"csv","canonicalField":"business_date"},"outputs":[{"key":"cancel_reason","normalizedSheetName":"csv","canonicalField":"cancel_reason","metricKey":"order.avoidable_cancellation_reason","valueKind":"count","aggregation":"sum","categorical":{"dimensionKey":"cancelled_by","allowedValues":["ITEM_UNAVAILABLE"],"collectInjectedValues":false}}]}'::jsonb,
   'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 1, 'human', 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000911'::uuid),
  ('a7000000-0000-4000-8000-000000000802'::uuid, 'a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000702'::uuid,
   1, '{"schemaVersion":1,"outputKind":"period_grain","grain":"day","periodKey":{"normalizedSheetName":"csv","canonicalField":"business_date"},"outputs":[{"key":"closed_minutes","normalizedSheetName":"csv","canonicalField":"closed_minutes","metricKey":"operations.closed_minutes","valueKind":"count","aggregation":"sum"}]}'::jsonb,
   '1010101010101010101010101010101010101010101010101010101010101010', 1, 'human', 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000912'::uuid);

select extensions.has_function(
  'public', 'propose_governed_report_projection_with_declared_value',
  'the declare path exists beside the hand-authored proposal path'
);
select extensions.ok(
  pg_catalog.has_function_privilege('authenticated', 'public.propose_governed_report_projection_with_declared_value(uuid,uuid,uuid,text,text,text,uuid)', 'execute'),
  'an authenticated member can reach the declare function'
);
select extensions.ok(
  not pg_catalog.has_function_privilege('anon', 'public.propose_governed_report_projection_with_declared_value(uuid,uuid,uuid,text,text,text,uuid)', 'execute'),
  'anonymous callers cannot reach the declare function'
);
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-unauth-01', 'a7000000-0000-4000-8000-000000000921'::uuid) $$,
  '42501', 'report projection categorical value declaration is not authorized',
  'declaration rejects an unauthenticated caller'
);

set local role authenticated;
set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-operator-01', 'a7000000-0000-4000-8000-000000000922'::uuid) $$,
  '42501', 'report projection categorical value declaration is not authorized',
  'an operator who can upload cannot declare a label -- only report.contract_approve can'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000899'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-unknown-01', 'a7000000-0000-4000-8000-000000000923'::uuid) $$,
  '23514', 'report projection version was not found',
  'declaration names no version that is not there'
);
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'Cancel Reason', 'CLOSED', 'declare-categorical-keyshape-01', 'a7000000-0000-4000-8000-000000000924'::uuid) $$,
  '22023', 'report projection output key is invalid',
  'declaration refuses an output key no document could carry'
);
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'closed because the shop shut', 'declare-categorical-valueshape-01', 'a7000000-0000-4000-8000-000000000925'::uuid) $$,
  '22023', 'report projection categorical value is invalid',
  'provider prose with spaces cannot be declared -- the label map remains its path'
);
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000802'::uuid, 'closed_minutes', 'CLOSED', 'declare-categorical-nocats-01', 'a7000000-0000-4000-8000-000000000926'::uuid) $$,
  '23514', 'report projection output has no categorical values to declare',
  'an output with nothing to declare into is refused distinctly from an already-declared value'
);
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'ITEM_UNAVAILABLE', 'declare-categorical-duplicate-01', 'a7000000-0000-4000-8000-000000000927'::uuid) $$,
  '23514', 'report projection categorical value is already declared',
  'declaring what already governs changes nothing and says so'
);

-- Org B's owner holds the same permission in their own tenant, so the check
-- below proves invisibility rather than a permission failure: org A's
-- version reads as not found across the boundary.
set local request.jwt.claim.sub = 'b7000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('b7000000-0000-4000-8000-000000000201'::uuid, 'b7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-tenant-01', 'b7000000-0000-4000-8000-000000000928'::uuid) $$,
  '23514', 'report projection version was not found',
  'another organization cannot declare onto this version -- it is invisible across the boundary'
);

set local request.jwt.claim.sub = 'a7000000-0000-4000-8000-000000000001';
select extensions.lives_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-happy-0001', 'a7000000-0000-4000-8000-000000000929'::uuid) $$,
  'declaring CLOSED proposes a new version of the March figures'
);
select extensions.is(
  (select ((public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-happy-0001', 'a7000000-0000-4000-8000-000000000929'::uuid))::jsonb #>> '{projection_document,outputs,0,categorical,allowedValues}')),
  '["ITEM_UNAVAILABLE", "CLOSED"]',
  'the replayed proposal differs from its parent only by the appended label'
);
select extensions.is(
  (select ((public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'CLOSED', 'declare-categorical-happy-0001', 'a7000000-0000-4000-8000-000000000929'::uuid))::jsonb ->> 'version')),
  '2',
  'the declaration continues the lineage rather than starting one'
);
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection_with_declared_value('a7000000-0000-4000-8000-000000000201'::uuid, 'a7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000801'::uuid, 'cancel_reason', 'NO_SHOW', 'declare-categorical-happy-0001', 'a7000000-0000-4000-8000-000000000930'::uuid) $$,
  '23505', 'idempotency key conflicts with another projection proposal',
  'one key cannot propose two different declarations'
);

select * from extensions.finish();

rollback;
