begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(82);

-- Spec 023 Task C: manifests, entries, prepare/revalidate/consume, subject
-- binding, attempt-key replay, immutability. Fixture prefix fb39.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

-- Structure ---------------------------------------------------------------------

select extensions.has_table('public', 'memory_context_manifests', 'manifests are database-owned');
select extensions.has_table('public', 'memory_context_entries', 'entries are database-owned');
select extensions.has_column('public', 'memory_write_operations', 'actor_id', 'the workspace carries subject actors');
select extensions.has_column('public', 'memory_write_operations', 'operation_kind', 'and subject operation kinds');
select extensions.has_function('public', 'prepare_memory_context', 'worker prepare exists');
select extensions.has_function('public', 'prepare_subject_memory_context', 'subject prepare exists');
select extensions.has_function('public', 'revalidate_memory_context', 'worker revalidate exists');
select extensions.has_function('public', 'revalidate_subject_memory_context', 'subject revalidate exists');
select extensions.has_function('public', 'consume_memory_context', 'worker consume exists');
select extensions.has_function('public', 'consume_subject_memory_context', 'subject consume exists');
select extensions.has_function('public', 'erase_memory_source_content', 'erasure exists');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'memory_context_manifests'), 'manifests are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'memory_context_manifests'), 'even from the table owner');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'memory_context_entries'), 'entries are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'memory_context_entries'), 'even from the table owner');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.prepare_memory_context(uuid,text,text,uuid,text,uuid,uuid,uuid,uuid,text,jsonb,integer)', 'execute'), 'the worker holds prepare');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.prepare_memory_context(uuid,text,text,uuid,text,uuid,uuid,uuid,uuid,text,jsonb,integer)', 'execute'), 'members do not hold worker prepare');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.prepare_subject_memory_context(uuid,uuid,text,uuid,uuid,uuid,text,text,jsonb,integer)', 'execute'), 'members hold subject prepare');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.prepare_subject_memory_context(uuid,uuid,text,uuid,uuid,uuid,text,text,jsonb,integer)', 'execute'), 'the worker is denied subject prepare');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.consume_memory_context(uuid,uuid,text,text,timestamptz)', 'execute'), 'members do not hold worker consume');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.consume_memory_context(uuid,uuid,text,text,timestamptz)', 'execute'), 'the worker holds consume');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.consume_subject_memory_context(uuid,uuid,text,text,timestamptz)', 'execute'), 'the worker is denied subject consume');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.consume_subject_memory_context(uuid,uuid,text,text,timestamptz)', 'execute'), 'members hold subject consume');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb390000-0000-4000-8000-000000000001'::uuid),
  ('fb390000-0000-4000-8000-000000000002'::uuid),
  ('fb390000-0000-4000-8000-000000000003'::uuid),
  ('fb390000-0000-4000-8000-000000000004'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb390000-0000-4000-8000-000000000101'::uuid, 'Manifest A', 'manifest-a', 'fb390000-0000-4000-8000-000000000001'::uuid),
  ('fb390000-0000-4000-8000-000000000102'::uuid, 'Manifest B', 'manifest-b', 'fb390000-0000-4000-8000-000000000003'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb390000-0000-4000-8000-000000000201'::uuid, 'fb390000-0000-4000-8000-000000000101'::uuid, 'Manifest A', 'manifest-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb390000-0000-4000-8000-000000000001'::uuid),
  ('fb390000-0000-4000-8000-000000000202'::uuid, 'fb390000-0000-4000-8000-000000000102'::uuid, 'Manifest B', 'manifest-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb390000-0000-4000-8000-000000000003'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb390000-0000-4000-8000-000000000101'::uuid, 'fb390000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb390000-0000-4000-8000-000000000101'::uuid, 'fb390000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('fb390000-0000-4000-8000-000000000102'::uuid, 'fb390000-0000-4000-8000-000000000003'::uuid, 'owner', 'owner'),
  ('fb390000-0000-4000-8000-000000000102'::uuid, 'fb390000-0000-4000-8000-000000000004'::uuid, 'member', 'operator');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb390000-0000-4000-8000-000000000201'::uuid, 'fb390000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('fb390000-0000-4000-8000-000000000201'::uuid, 'fb390000-0000-4000-8000-000000000002'::uuid, 'operator'),
  ('fb390000-0000-4000-8000-000000000202'::uuid, 'fb390000-0000-4000-8000-000000000003'::uuid, 'owner'),
  ('fb390000-0000-4000-8000-000000000202'::uuid, 'fb390000-0000-4000-8000-000000000004'::uuid, 'operator');

-- Context flags on for A, defaults-off for B.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000001';
select extensions.is(
  (select public.update_memory_integration_settings('fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000001', true, true, true, true, true, false, 'shared-context-v1', 'fb390000-0000-4000-8000-000000000901') ->> 'captureEnabled'),
  'true', 'context flags switch on for the preparing organization');

reset role;

-- Consumer runs: one channel run per org, one growth request, one campaign run.
insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status, completed_at,
  result_digest, correlation_id
) values
  ('fb390000-0000-4000-8000-000000000301'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
   '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'fb390000-0000-4000-8000-000000000902'::uuid),
  ('fb390000-0000-4000-8000-000000000302'::uuid, 'fb390000-0000-4000-8000-000000000202'::uuid,
   '2026-08-01', '2026-08-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
   '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed', now(),
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   'fb390000-0000-4000-8000-000000000903'::uuid);

insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind,
  code, severity, priority, quality_state, calculation_digest
) values (
  'fb390000-0000-4000-8000-000000000311'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
  'fb390000-0000-4000-8000-000000000301'::uuid, 'kitchen.timing', 1, 'finding',
  'LATE_PLATES', 'high', 1, 'complete', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);

insert into public.memory_capture_events (
  id, organization_id, source_kind, channel_finding_id, source_revision, source_digest,
  event_kind, correlation_id, projection_document, sensitivity, reuse_class
) values (
  'fb390000-0000-4000-8000-000000000321'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
  'channel_finding', 'fb390000-0000-4000-8000-000000000311'::uuid, 1,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'recorded', 'fb390000-0000-4000-8000-000000000904'::uuid,
  '{"kind": "finding", "title": "Late plates"}', 'internal', 'internal_reusable'
);

-- Projected item for the event, plus the plain sources a pack assembles.
insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, knowledge_kind
) values
  ('fb390000-0000-4000-8000-000000000331'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Evening prep note', 'Two staff on Fridays.', 'system_generated', 'observation'),
  ('fb390000-0000-4000-8000-000000000332'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Projected finding', 'Late plates at peak.', 'system_generated', 'observation'),
  ('fb390000-0000-4000-8000-000000000333'::uuid, 'fb390000-0000-4000-8000-000000000202'::uuid,
   'episode', 'Other tenant note', 'Nothing to do with A.', 'system_generated', 'observation'),
  ('fb390000-0000-4000-8000-000000000334'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Old note', 'Past its date.', 'system_generated', 'observation'),
  ('fb390000-0000-4000-8000-000000000335'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Model guess', 'Unverified inference.', 'ai_proposed', 'observation'),
  ('fb390000-0000-4000-8000-000000000336'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Private note', 'Owner eyes only.', 'system_generated', 'observation');

update public.memory_items
set expires_at = now() - interval '1 day'
where id = 'fb390000-0000-4000-8000-000000000334';
update public.memory_items
set sensitivity = 'confidential'
where id = 'fb390000-0000-4000-8000-000000000336';

update public.memory_capture_events
set projected_item_id = 'fb390000-0000-4000-8000-000000000332',
  status = 'completed', completed_at = now()
where id = 'fb390000-0000-4000-8000-000000000321';
update public.memory_items
set capture_event_id = 'fb390000-0000-4000-8000-000000000321'
where id = 'fb390000-0000-4000-8000-000000000332';

insert into public.business_profiles (organization_id, business_model, value_proposition) values
  ('fb390000-0000-4000-8000-000000000201'::uuid, 'Dine-in', 'Family tables');
insert into public.business_facts (id, organization_id, fact_key, value, source, status) values
  ('fb390000-0000-4000-8000-000000000341'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'avg_ticket', '42', 'pos', 'verified');
insert into public.goals (id, organization_id, name, metric, baseline_status, target_value, unit, scope_kind) values
  ('fb390000-0000-4000-8000-000000000342'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'Grow revenue', 'revenue', 'unknown', 100, 'AED', 'organization');
insert into public.constraints (id, organization_id, name, constraint_key, constraint_type, value, severity, source) values
  ('fb390000-0000-4000-8000-000000000343'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'No discounts', 'no_discounts', 'pricing', 'true', 'hard', 'ops');
-- Exotic numerics: scale/precision edges for the documented ::text rule.
insert into public.goals (id, organization_id, name, metric, baseline_status, target_value, unit, scope_kind) values
  ('fb390000-0000-4000-8000-000000000344'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'Stretch goal', 'revenue', 'unknown', 99.50, 'AED', 'organization');
insert into public.constraints (id, organization_id, name, constraint_key, constraint_type, value, severity, source) values
  ('fb390000-0000-4000-8000-000000000345'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'Ticket floor', 'ticket_floor', 'pricing', '{"min": 19.95}', 'soft', 'ops');

insert into public.organization_market_profiles (id, organization_id) values
  ('fb390000-0000-4000-8000-000000000351'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid);
insert into public.organization_market_profile_versions (
  id, organization_id, market_profile_id, version, schema_version, profile_document, profile_digest,
  source_policy_digest, proposal_source, correlation_id
) values (
  'fb390000-0000-4000-8000-000000000352'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
  'fb390000-0000-4000-8000-000000000351'::uuid, 1, 1, '{}',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'operator', 'fb390000-0000-4000-8000-000000000905'::uuid
);
insert into public.growth_intelligence_requests (
  id, organization_id, kind, trigger_reason, request_fingerprint, market_profile_version_id,
  source_policy_digest, research_rule_version, local_time_bucket, due_at, correlation_id
) values (
  'fb390000-0000-4000-8000-000000000353'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
  'market_research', 'manual_retry',
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'fb390000-0000-4000-8000-000000000352'::uuid,
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'rules@1', 'immediate', now(), 'fb390000-0000-4000-8000-000000000906'::uuid
);

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by) values
  ('fb390000-0000-4000-8000-000000000361'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'Fill weekday tables', 'Nearby families', 'fb390000-0000-4000-8000-000000000001'::uuid);
insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by) values
  ('fb390000-0000-4000-8000-000000000362'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'Weekday push', 'manual_brief', 'fb390000-0000-4000-8000-000000000361'::uuid,
   'fb390000-0000-4000-8000-000000000001'::uuid);
insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions) values
  ('fb390000-0000-4000-8000-000000000363'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'fb390000-0000-4000-8000-000000000362'::uuid, '{}', '[]');
insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
) values (
  'fb390000-0000-4000-8000-000000000364'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
  'fb390000-0000-4000-8000-000000000362'::uuid, 1, 'fb390000-0000-4000-8000-000000000363'::uuid,
  ('{"version": 1, "campaignId": "fb390000-0000-4000-8000-000000000362", "generationProfile": "brand_guided", "executionMode": "best_effort", "schemaVersion": "2", "generationPolicy": {"maxVariantsPerDirection": 2, "maxVariantsTotal": 10, "policyExpiresAt": "2027-01-01T00:00:00Z"}, "directions": []}')::jsonb,
  'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'brand_guided', 'best_effort'
);
insert into public.campaign_generation_runs (
  id, organization_id, campaign_id, source_snapshot_id, kind, idempotency_key,
  request_digest, correlation_id
) values (
  'fb390000-0000-4000-8000-000000000365'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
  'fb390000-0000-4000-8000-000000000362'::uuid, 'fb390000-0000-4000-8000-000000000363'::uuid,
  'generate', 'fb39-gen-1',
  '1111111111111111111111111111111111111111111111111111111111111111',
  'fb390000-0000-4000-8000-000000000907'::uuid
);

-- Prepare: success plus digest stability ------------------------------------------------

reset role;

-- Seven valid sources, one per typed slot. Summaries equal the server rule exactly.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-attempt-1',
    'fb390000-0000-4000-8000-000000000908', null, null, null,
    'shared-context-v1',
    ('[' ||
      '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000331", "title": "Evening prep note", "summary": "Evening prep note\nTwo staff on Fridays.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "capture_event", "sourceId": "fb390000-0000-4000-8000-000000000321", "title": "Late plates", "summary": ' || to_jsonb((select projection_document::text from public.memory_capture_events where id = 'fb390000-0000-4000-8000-000000000321')) || ', "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "business_fact", "sourceId": "fb390000-0000-4000-8000-000000000341", "title": "Average ticket", "summary": "avg_ticket [verified] pos :: 42", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 0, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "business_profile", "sourceId": "fb390000-0000-4000-8000-000000000201", "title": "Profile", "summary": "Dine-in\nFamily tables", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 0, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "goal", "sourceId": "fb390000-0000-4000-8000-000000000342", "title": "Grow revenue", "summary": "Grow revenue [revenue] target 100 AED", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "constraint", "sourceId": "fb390000-0000-4000-8000-000000000343", "title": "No discounts", "summary": "No discounts [pricing/hard] true", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "campaign_version", "sourceId": "fb390000-0000-4000-8000-000000000364", "title": "Weekday push v1", "summary": "v1 brand_guided/best_effort fb390000-0000-4000-8000-000000000362 ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "priority": 0, "optional": true, "section": "current", "statementKind": "campaign_state", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"}' ||
    ']')::jsonb,
    40
  ) ->> 'status'),
  'ready', 'seven valid sources prepare a ready pack');

select extensions.is(
  (select selected_count from public.memory_context_manifests
   where attempt_key = 'fb39-attempt-1'),
  7, 'all seven entries persist');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries
   where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-1')),
  7, 'entries pin one row per source');

-- Same entries, fresh attempt: same digest, new manifest.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-attempt-2',
    'fb390000-0000-4000-8000-000000000909', null, null, null,
    'shared-context-v1',
    ('[' ||
      '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000331", "title": "Evening prep note", "summary": "Evening prep note\nTwo staff on Fridays.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}' ||
    ']')::jsonb,
    null
  ) ->> 'status'),
  'ready', 'a subset of the same sources still prepares');

-- Identical inputs under a fresh attempt key digest identically, with a new id.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-attempt-2b',
    'fb390000-0000-4000-8000-000000000931', null, null, null,
    'shared-context-v1',
    ('[' ||
      '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000331", "title": "Evening prep note", "summary": "Evening prep note\nTwo staff on Fridays.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}' ||
    ']')::jsonb,
    null
  ) ->> 'contextDigest'),
  (select context_digest from public.memory_context_manifests where attempt_key = 'fb39-attempt-2'),
  'identical inputs digest identically across attempts');
select extensions.is(
  (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-2b') =
  (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-2'),
  false, 'while each attempt pins its own manifest');

-- Exotic numerics render per the documented rule (numeric ::text keeps its
-- scale, jsonb ::text keeps its digits): the prepare succeeds only when the
-- caller summary matches the server recomputation byte-for-byte, so `ready`
-- plus the stored snapshots prove TS/SQL parity post-push.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-exotic',
    'fb390000-0000-4000-8000-000000000934', null, null, null,
    'shared-context-v1',
    ('[' ||
      '{"sourceKind": "goal", "sourceId": "fb390000-0000-4000-8000-000000000344", "title": "Stretch goal", "summary": "Stretch goal [revenue] target 99.50 AED", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "constraint", "sourceId": "fb390000-0000-4000-8000-000000000345", "title": "Ticket floor", "summary": "Ticket floor [pricing/soft] {\"min\": 19.95}", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"}' ||
    ']')::jsonb,
    null
  ) ->> 'status'),
  'ready', 'non-integer numerics prepare under the documented rendering');
select extensions.is(
  (select safe_snapshot ->> 'summary' from public.memory_context_entries
   where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-exotic')
     and goal_id = 'fb390000-0000-4000-8000-000000000344'),
  'Stretch goal [revenue] target 99.50 AED', 'the goal keeps its numeric scale');
select extensions.is(
  (select safe_snapshot ->> 'summary' from public.memory_context_entries
   where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-exotic')
     and constraint_id = 'fb390000-0000-4000-8000-000000000345'),
  'Ticket floor [pricing/soft] {"min": 19.95}', 'the constraint keeps its decimal digits');

-- Same-attempt replay returns the pinned manifest, never a second pack.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-attempt-1',
    'fb390000-0000-4000-8000-000000000910', null, null, null,
    'shared-context-v1', '[]'::jsonb, null
  ) ->> 'manifestId'),
  (select id::text from public.memory_context_manifests where attempt_key = 'fb39-attempt-1'),
  'a same-attempt retry replays the pinned manifest');

-- Growth and campaign consumers prepare through their own bindings.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'growth_research', 'growth_request',
    'fb390000-0000-4000-8000-000000000353', 'fb39-attempt-growth',
    'fb390000-0000-4000-8000-000000000911', null, null, null,
    'shared-context-v1',
    ('[{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000331", "title": "Evening prep note", "summary": "Evening prep note\nTwo staff on Fridays.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null
  ) ->> 'status'),
  'ready', 'a growth request prepares its own pack');
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'campaign_generation', 'campaign_generation_run',
    'fb390000-0000-4000-8000-000000000365', 'fb39-attempt-campaign',
    'fb390000-0000-4000-8000-000000000912', null, null, 'fb390000-0000-4000-8000-000000000362',
    'shared-context-v1',
    ('[{"sourceKind": "campaign_version", "sourceId": "fb390000-0000-4000-8000-000000000364", "title": "Weekday push v1", "summary": "v1 brand_guided/best_effort fb390000-0000-4000-8000-000000000362 ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff", "priority": 0, "optional": false, "section": "current", "statementKind": "campaign_state", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null
  ) ->> 'status'),
  'ready', 'a campaign run prepares its own pack');

-- Prepare: refusals ------------------------------------------------------------------------

select extensions.is(
  pg_temp.state_of($$ select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'no_such_purpose', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-bad-purpose',
    'fb390000-0000-4000-8000-000000000913', null, null, null,
    'shared-context-v1', '[]'::jsonb, null) $$),
  '23514', 'a bad purpose is refused');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'campaign_generation', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-wrong-map',
    'fb390000-0000-4000-8000-000000000914', null, null, null,
    'shared-context-v1', '[]'::jsonb, null) $$),
  '23514', 'a run serving the wrong purpose is refused');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'subject_operation',
    'fb390000-0000-4000-8000-000000000301', 'fb39-forge-subject',
    'fb390000-0000-4000-8000-000000000915', null, null, null,
    'shared-context-v1', '[]'::jsonb, null) $$),
  '23514', 'the worker can never mint a subject binding');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000302', 'fb39-forged-run',
    'fb390000-0000-4000-8000-000000000916', null, null, null,
    'shared-context-v1', '[]'::jsonb, null) $$),
  '42501', 'a run from another tenant is refused');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-invented',
    'fb390000-0000-4000-8000-000000000917', null, null, null,
    'shared-context-v1',
    ('[{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000331", "title": "Evening prep note", "summary": "A model invented this line.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null) $$),
  '23514', 'caller-invented text under a valid source id is refused');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-elevated',
    'fb390000-0000-4000-8000-000000000918', null, null, null,
    'shared-context-v1',
    ('[{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000335", "title": "Model guess", "summary": "Model guess\nUnverified inference.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null) $$),
  '23514', 'trust elevation of unverified model output is refused');

-- Unknown and ineligible sources become exclusions, never stored rows.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-exclusions',
    'fb390000-0000-4000-8000-000000000919', null, null, null,
    'shared-context-v1',
    ('[' ||
      '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000333", "title": "Other tenant note", "summary": "Other tenant note\nNothing to do with A.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000334", "title": "Old note", "summary": "Old note\nPast its date.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000336", "title": "Private note", "summary": "Private note\nOwner eyes only.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
      '{"sourceKind": "business_fact", "sourceId": "fb390000-0000-4000-8000-000000000399", "title": "Missing", "summary": "gone [verified] pos :: 1", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 0, "freshness": "fresh", "sensitivity": "internal"}' ||
    ']')::jsonb,
    null
  ) ->> 'status'),
  'empty', 'cross-tenant, expired, sensitive, and missing sources all exclude');
select extensions.is(
  (select exclusion_counts from public.memory_context_manifests where attempt_key = 'fb39-exclusions'),
  '{"UNKNOWN_SOURCE": 2, "EXPIRED": 1, "SENSITIVITY_BLOCKED": 1}'::jsonb,
  'exclusions are counted by safe code');

-- Missing-uniqueness gap, proven not assumed: a dangling fact reference is
-- storable at the table level (no FK exists) but never trusted by the RPC.
insert into public.memory_context_entries (
  organization_id, manifest_id, ordinal, context_ref, source_kind, business_fact_id,
  statement_kind, trust_rank, freshness, sensitivity, safe_snapshot
) values (
  'fb390000-0000-4000-8000-000000000201',
  (select id from public.memory_context_manifests where attempt_key = 'fb39-exclusions'),
  99, 'ctx-0099', 'business_fact', 'fb390000-0000-4000-8000-000000000399',
  'observation', 0, 'fresh', 'internal', '{"summary": "dangling"}'
);
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries where context_ref = 'ctx-0099'),
  1, 'the unconstrained slot stores a dangling reference at the table level');
select extensions.is(
  (select exclusion_counts ->> 'UNKNOWN_SOURCE'
   from public.memory_context_manifests where attempt_key = 'fb39-exclusions'),
  '2', 'yet the RPC excluded unknown sources instead of trusting them');

-- Oversized packs cap in SQL ------------------------------------------------------------------
-- Twenty-five optionals: 24 persist, the lowest-priority tail drops with a count.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-oversize',
    'fb390000-0000-4000-8000-000000000920', null, null, null,
    'shared-context-v1',
    (select pg_catalog.jsonb_agg(entry order by entry ->> 'summary')
     from (select pg_catalog.jsonb_build_object(
        'sourceKind', 'memory_item', 'sourceId', 'fb390000-0000-4000-8000-000000000331',
        'title', 'Evening prep note',
        'summary', 'Evening prep note' || chr(10) || 'Two staff on Fridays.',
        'priority', generate_series(0, 24), 'optional', true,
        'section', 'observations', 'statementKind', 'observation',
        'trustRank', 2, 'freshness', 'fresh', 'sensitivity', 'internal'
      ) as entry) built),
    null
  ) ->> 'status'),
  'ready', 'twenty-five optionals still resolve ready');
select extensions.is(
  (select selected_count from public.memory_context_manifests where attempt_key = 'fb39-oversize'),
  24, 'the SQL cap holds at twenty-four entries');
select extensions.is(
  (select exclusion_counts ->> 'OVER_BUDGET'
   from public.memory_context_manifests where attempt_key = 'fb39-oversize'),
  '1', 'the dropped tail is counted, not hidden');

-- Byte overflow with multibyte summaries: 8 x ~2400 bytes overflows 16384,
-- the lowest-priority optional drops, the pack stays ready.
insert into public.memory_items (id, organization_id, memory_type, title, body, origin, knowledge_kind) values
  ('fb390000-0000-4000-8000-000000000337'::uuid, 'fb390000-0000-4000-8000-000000000201'::uuid,
   'episode', 'Wide note', repeat('𐀀', 590), 'system_generated', 'observation');
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-bytes',
    'fb390000-0000-4000-8000-000000000921', null, null, null,
    'shared-context-v1',
    (select pg_catalog.jsonb_agg(entry order by (entry ->> 'priority')::integer)
     from (select pg_catalog.jsonb_build_object(
        'sourceKind', 'memory_item', 'sourceId', 'fb390000-0000-4000-8000-000000000337',
        'title', 'Wide note',
        'summary', 'Wide note' || chr(10) || repeat('𐀀', 590),
        'priority', generate_series(0, 7), 'optional', true,
        'section', 'observations', 'statementKind', 'observation',
        'trustRank', 2, 'freshness', 'fresh', 'sensitivity', 'internal'
      ) as entry) built),
    null
  ) ->> 'status'),
  'ready', 'byte overflow drops the lowest-priority optional');
select extensions.is(
  (select selected_bytes <= 16384 from public.memory_context_manifests where attempt_key = 'fb39-bytes'),
  true, 'the persisted byte count respects the budget');

-- Mandatory overflow turns partial with a safe reason, never silent truncation.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-mandatory',
    'fb390000-0000-4000-8000-000000000922', null, null, null,
    'shared-context-v1',
    (select pg_catalog.jsonb_agg(entry order by (entry ->> 'priority')::integer)
     from (select pg_catalog.jsonb_build_object(
        'sourceKind', 'memory_item', 'sourceId', 'fb390000-0000-4000-8000-000000000337',
        'title', 'Wide note',
        'summary', 'Wide note' || chr(10) || repeat('𐀀', 590),
        'priority', 0, 'optional', false,
        'section', 'current', 'statementKind', 'observation',
        'trustRank', 0, 'freshness', 'fresh', 'sensitivity', 'internal'
      ) as entry from generate_series(1, 8)) built),
    null
  ) ->> 'status'),
  'partial', 'mandatory overflow resolves partial');
select extensions.is(
  (select degraded_reasons from public.memory_context_manifests where attempt_key = 'fb39-mandatory'),
  array['MANDATORY_OVERFLOW'], 'the safe reason is recorded');

-- Empty, unavailable, disabled ----------------------------------------------------------------------
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-empty',
    'fb390000-0000-4000-8000-000000000923', null, null, null,
    'shared-context-v1', '[]'::jsonb, null
  ) ->> 'status'),
  'empty', 'no candidates resolve empty');
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-unavailable',
    'fb390000-0000-4000-8000-000000000924', null, null, null,
    'shared-context-v1', null, null
  ) ->> 'status'),
  'unavailable', 'a failed upstream read resolves unavailable, never empty');

-- Revalidate ------------------------------------------------------------------
-- Dedicated manifest over one live item: valid, then changed after an edit.
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-revalidate',
    'fb390000-0000-4000-8000-000000000925', null, null, null,
    'shared-context-v1',
    ('[{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000331", "title": "Evening prep note", "summary": "Evening prep note\nTwo staff on Fridays.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null
  ) ->> 'status'),
  'ready', 'the revalidation fixture prepares');
select extensions.is(
  (select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-revalidate')
  ) ->> 'status'),
  'valid', 'an unchanged pack revalidates valid');
update public.memory_items
set body = 'Three staff on Fridays.'
where id = 'fb390000-0000-4000-8000-000000000331';
select extensions.is(
  (select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-revalidate')
  ) ->> 'status'),
  'changed', 'an edited source revalidates changed');
update public.memory_items
set superseded_by_id = 'fb390000-0000-4000-8000-000000000332',
  superseded_at = now(),
  supersession_reason = 'Replaced by projection.'
where id = 'fb390000-0000-4000-8000-000000000331';
select extensions.is(
  (select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-revalidate')
  ) ->> 'status'),
  'revoked', 'a superseded source revalidates revoked');
select extensions.is(
  pg_temp.state_of($$ select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000399') $$),
  'P0002', 'an unknown manifest is not found');

-- Consume ------------------------------------------------------------------------
select extensions.is(
  (select public.consume_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-2'),
    'test-provider', 'test-model', now()
  ) ->> 'state'),
  'consumed', 'consume binds provider and model');
select extensions.is(
  (select provider_name from public.memory_context_manifests where attempt_key = 'fb39-attempt-2'),
  'test-provider', 'the provider id persists');
select extensions.is(
  (select model_id from public.memory_context_manifests where attempt_key = 'fb39-attempt-2'),
  'test-model', 'the model id persists');
select extensions.is(
  pg_temp.state_of($$ select public.consume_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-2'),
    'test-provider', 'test-model', now()) $$),
  '23505', 'a second consume is refused, never double-bound');
select extensions.is(
  pg_temp.state_of($$ select public.consume_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-1'),
    '', 'test-model', now()) $$),
  '23514', 'an empty provider is refused');
select extensions.is(
  pg_temp.state_of($$ select public.consume_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-1'),
    'test-provider', 'test-model', now() + interval '1 hour') $$),
  '23514', 'a future model-call time is refused');

-- Manifest immutability -------------------------------------------------------------
select extensions.is(
  pg_temp.state_of($$ update public.memory_context_manifests
    set status = 'empty' where attempt_key = 'fb39-attempt-1' $$),
  '23514', 'a prepared manifest cannot be silently rewritten');
select extensions.is(
  pg_temp.state_of($$ delete from public.memory_context_entries
    where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-1') $$),
  '23514', 'entries cannot be silently deleted');
select extensions.is(
  pg_temp.state_of($$ update public.memory_context_entries
    set safe_snapshot = '{"summary": "edited"}'
    where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-1') $$),
  '23514', 'entries cannot be silently edited');

-- Subject flow -------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000002';

select extensions.is(
  (select public.prepare_subject_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000002',
    'subject_drafting', 'fb390000-0000-4000-8000-000000000926', null, null,
    'fb39-fingerprint-1', 'shared-context-v1',
    ('[{"sourceKind": "goal", "sourceId": "fb390000-0000-4000-8000-000000000342", "title": "Grow revenue", "summary": "Grow revenue [revenue] target 100 AED", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null
  ) ->> 'status'),
  'ready', 'an authenticated member prepares subject context');
select extensions.is(
  (select operation_kind from public.memory_write_operations
   where idempotency_key = 'subject-context:fb390000-0000-4000-8000-000000000002:fb390000-0000-4000-8000-000000000926'),
  'subject_context', 'the preparation transaction creates the subject operation');
select extensions.is(
  (select actor_id from public.memory_write_operations
   where idempotency_key = 'subject-context:fb390000-0000-4000-8000-000000000002:fb390000-0000-4000-8000-000000000926'),
  'fb390000-0000-4000-8000-000000000002', 'the operation binds the actor');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_subject_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000002',
    'subject_drafting', 'fb390000-0000-4000-8000-000000000926', null, null,
    'a-different-fingerprint', 'shared-context-v1', '[]'::jsonb, null) $$),
  '23505', 'a mismatched replay is refused');
select extensions.is(
  pg_temp.state_of($$ select public.prepare_subject_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000002',
    'channel_advice', 'fb390000-0000-4000-8000-000000000927', null, null,
    'fb39-fingerprint-2', 'shared-context-v1', '[]'::jsonb, null) $$),
  '23514', 'the subject path serves subject drafting only');

set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000004';
select extensions.is(
  pg_temp.state_of($$ select public.prepare_subject_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000004',
    'subject_drafting', 'fb390000-0000-4000-8000-000000000928', null, null,
    'fb39-fingerprint-3', 'shared-context-v1', '[]'::jsonb, null) $$),
  '42501', 'a non-member cannot prepare subject context');

-- Subject revalidate and consume ride membership, never worker authority.
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000002';
select extensions.is(
  (select public.revalidate_subject_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key like 'subject-context:%' limit 1)
  ) ->> 'status'),
  'valid', 'a member revalidates subject context');
select extensions.is(
  pg_temp.state_of($$ select public.revalidate_subject_memory_context(
    'fb390000-0000-4000-8000-000000000202',
    (select id from public.memory_context_manifests where attempt_key like 'subject-context:%' limit 1)) $$),
  '42501', 'a member cannot revalidate another tenant manifest');
select extensions.is(
  (select public.consume_subject_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key like 'subject-context:%' limit 1),
    'test-provider', 'test-model', now()
  ) ->> 'state'),
  'consumed', 'a member consumes subject context');

-- Disabled -----------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000001';
select extensions.is(
  (select public.update_memory_integration_settings('fb390000-0000-4000-8000-000000000201', 'fb390000-0000-4000-8000-000000000001', true, false, true, true, true, false, 'shared-context-v1', 'fb390000-0000-4000-8000-000000000929') is not null),
  true, 'channel context switches off');
reset role;
select extensions.is(
  (select public.prepare_memory_context(
    'fb390000-0000-4000-8000-000000000201', 'channel_advice', 'analysis_run',
    'fb390000-0000-4000-8000-000000000301', 'fb39-disabled',
    'fb390000-0000-4000-8000-000000000930', null, null, null,
    'shared-context-v1',
    ('[{"sourceKind": "goal", "sourceId": "fb390000-0000-4000-8000-000000000342", "title": "Grow revenue", "summary": "Grow revenue [revenue] target 100 AED", "priority": 0, "optional": true, "section": "current", "statementKind": "observation", "trustRank": 1, "freshness": "fresh", "sensitivity": "internal"}]')::jsonb,
    null
  ) ->> 'status'),
  'disabled', 'a switched-off purpose resolves disabled with no entries');
select extensions.is(
  (select selected_count from public.memory_context_manifests where attempt_key = 'fb39-disabled'),
  0, 'a disabled manifest carries no entries');
select extensions.is(
  (select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000201',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-attempt-2')
  ) ->> 'status'),
  'unavailable', 'a switched-off purpose revalidates unavailable');

select * from extensions.finish();

rollback;
