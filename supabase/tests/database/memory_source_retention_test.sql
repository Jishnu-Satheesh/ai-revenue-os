begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(25);

-- Spec 023 Task C: rights-driven erasure. The RPC nulls projection
-- documents, safe snapshots, and derived embeddings by source identity,
-- retains permitted ids/digests/decision metadata, writes an audit row per
-- call, and blocks descendant retrieval afterwards.

create or replace function pg_temp.state_of(call_sql text)
returns text language plpgsql as $$
begin
  execute call_sql;
  return 'no-error';
exception when others then
  return SQLSTATE;
end;
$$;

select extensions.has_function('public', 'erase_memory_source_content', 'erasure is database-owned');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.erase_memory_source_content(uuid,uuid,text,uuid,text)', 'execute'), 'members hold erasure');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.erase_memory_source_content(uuid,uuid,text,uuid,text)', 'execute'), 'the worker holds erasure');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.erase_memory_source_content(uuid,uuid,text,uuid,text)', 'execute'), 'anonymous callers hold no erasure');

-- Fixtures -----------------------------------------------------------------------

insert into auth.users (id) values
  ('fb390000-0000-4000-8000-000000000021'::uuid),
  ('fb390000-0000-4000-8000-000000000022'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb390000-0000-4000-8000-000000000121'::uuid, 'Retention A', 'retention-a', 'fb390000-0000-4000-8000-000000000021'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb390000-0000-4000-8000-000000000221'::uuid, 'fb390000-0000-4000-8000-000000000121'::uuid, 'Retention A', 'retention-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb390000-0000-4000-8000-000000000021'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb390000-0000-4000-8000-000000000121'::uuid, 'fb390000-0000-4000-8000-000000000021'::uuid, 'owner', 'owner'),
  ('fb390000-0000-4000-8000-000000000121'::uuid, 'fb390000-0000-4000-8000-000000000022'::uuid, 'member', 'operator');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb390000-0000-4000-8000-000000000221'::uuid, 'fb390000-0000-4000-8000-000000000021'::uuid, 'owner'),
  ('fb390000-0000-4000-8000-000000000221'::uuid, 'fb390000-0000-4000-8000-000000000022'::uuid, 'operator');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000021';
select public.update_memory_integration_settings('fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021', true, true, true, true, true, false, 'shared-context-v1', 'fb390000-0000-4000-8000-000000000941');

reset role;

insert into public.channel_analysis_runs (
  id, organization_id, window_start, window_end, period_grain, window_timezone,
  registry_version, detector_versions, metric_versions, input_digest, status, correlation_id
) values (
  'fb390000-0000-4000-8000-000000000383'::uuid, 'fb390000-0000-4000-8000-000000000221'::uuid,
  '2026-08-01', '2026-08-31', 'day', 'Asia/Dubai', 1, '[{"detectorKey": "kitchen.timing", "version": 1}]',
  '[]', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'completed',
  'fb390000-0000-4000-8000-000000000942'::uuid
);
insert into public.channel_findings (
  id, organization_id, analysis_run_id, detector_key, detector_version, kind,
  code, severity, priority, calculation_digest
) values (
  'fb390000-0000-4000-8000-000000000384'::uuid, 'fb390000-0000-4000-8000-000000000221'::uuid,
  'fb390000-0000-4000-8000-000000000383'::uuid, 'kitchen.timing', 1, 'finding',
  'LATE_PLATES', 'high', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
insert into public.memory_capture_events (
  id, organization_id, source_kind, channel_finding_id, source_revision, source_digest,
  event_kind, correlation_id, projection_document, sensitivity, reuse_class,
  status, completed_at, projected_item_id
) values (
  'fb390000-0000-4000-8000-000000000385'::uuid, 'fb390000-0000-4000-8000-000000000221'::uuid,
  'channel_finding', 'fb390000-0000-4000-8000-000000000384'::uuid, 1,
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'recorded', 'fb390000-0000-4000-8000-000000000943'::uuid,
  '{"kind": "finding", "title": "Late plates"}', 'internal', 'internal_reusable',
  'completed', now(), 'fb390000-0000-4000-8000-000000000386'::uuid
);
insert into public.memory_items (id, organization_id, memory_type, title, body, origin, knowledge_kind, capture_event_id) values
  ('fb390000-0000-4000-8000-000000000386'::uuid, 'fb390000-0000-4000-8000-000000000221'::uuid,
   'episode', 'Projected finding', 'Late plates at peak.', 'system_generated', 'observation',
   'fb390000-0000-4000-8000-000000000385'::uuid),
  ('fb390000-0000-4000-8000-000000000387'::uuid, 'fb390000-0000-4000-8000-000000000221'::uuid,
   'episode', 'Standalone note', 'Kept for the direct path.', 'system_generated', 'observation');

select public.prepare_memory_context(
  'fb390000-0000-4000-8000-000000000221', 'channel_advice', 'analysis_run',
  'fb390000-0000-4000-8000-000000000383', 'fb39-retention',
  'fb390000-0000-4000-8000-000000000944', null, null, null,
  'shared-context-v1',
  ('[' ||
    '{"sourceKind": "capture_event", "sourceId": "fb390000-0000-4000-8000-000000000385", "title": "Late plates", "summary": ' || to_jsonb((select projection_document::text from public.memory_capture_events where id = 'fb390000-0000-4000-8000-000000000385')) || ', "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
    '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000386", "title": "Projected finding", "summary": "Projected finding' || chr(10) || 'Late plates at peak.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"},' ||
    '{"sourceKind": "memory_item", "sourceId": "fb390000-0000-4000-8000-000000000387", "title": "Standalone note", "summary": "Standalone note' || chr(10) || 'Kept for the direct path.", "priority": 0, "optional": true, "section": "observations", "statementKind": "observation", "trustRank": 2, "freshness": "fresh", "sensitivity": "internal"}' ||
  ']')::jsonb,
  null
);

-- Erasure by capture identity, as the owner ------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000021';

select extensions.is(
  (select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'channel_finding', 'fb390000-0000-4000-8000-000000000384', 'fb39 rights request'
  )),
  ('{"sourceId": "fb390000-0000-4000-8000-000000000384", "erasedEvents": 1, "erasedItems": 1, "erasedEntries": 2}')::jsonb,
  'one call erases the event, the projected item, and both entries');

select extensions.is(
  (select projection_document from public.memory_capture_events
   where id = 'fb390000-0000-4000-8000-000000000385'),
  '{}'::jsonb, 'the projection document is nulled');
select extensions.is(
  (select body from public.memory_items where id = 'fb390000-0000-4000-8000-000000000386'),
  null, 'derived memory text is nulled');
select extensions.is(
  (select title from public.memory_items where id = 'fb390000-0000-4000-8000-000000000386'),
  'Projected finding', 'the permitted title metadata survives');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.memory_context_entries
   where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-retention')
     and safe_snapshot = '{}'::jsonb),
  2, 'both derived snapshots are nulled');
select extensions.ok(
  (select pg_catalog.bool_and(source_digest is not null) from public.memory_context_entries
   where manifest_id = (select id from public.memory_context_manifests where attempt_key = 'fb39-retention')
     and capture_event_id is not null),
  'capture digests survive where retention allows');
select extensions.is(
  (select safe_snapshot ->> 'summary' from public.memory_context_entries
   where memory_item_id = 'fb390000-0000-4000-8000-000000000386'),
  null, 'no invented original text survives erasure');
select extensions.is(
  (select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'channel_finding', 'fb390000-0000-4000-8000-000000000498', 'fb39 absent source'
  )),
  ('{"sourceId": "fb390000-0000-4000-8000-000000000498", "erasedEvents": 0, "erasedItems": 0, "erasedEntries": 0}')::jsonb,
  'an absent source erases nothing and still audits');
select extensions.is(
  (select pg_catalog.count(*)::integer from public.audit_events
   where organization_id = 'fb390000-0000-4000-8000-000000000221'
     and event_name = 'memory.source_content_erased'
     and entity_id = 'fb390000-0000-4000-8000-000000000498'),
  1, 'even a zero-work erasure writes its audit row');

-- Every call writes its audit row.
select extensions.is(
  (select pg_catalog.count(*)::integer from public.audit_events
   where organization_id = 'fb390000-0000-4000-8000-000000000221'
     and event_name = 'memory.source_content_erased'
     and entity_id = 'fb390000-0000-4000-8000-000000000384'),
  1, 'erasure writes exactly one audit row');
select extensions.is(
  (select payload ->> 'reason' from public.audit_events
   where organization_id = 'fb390000-0000-4000-8000-000000000221'
     and event_name = 'memory.source_content_erased'
     and entity_id = 'fb390000-0000-4000-8000-000000000384'),
  'fb39 rights request', 'the audit row carries the reason');

-- Descendant retrieval is blocked after erasure.
select extensions.is(
  (select public.revalidate_memory_context(
    'fb390000-0000-4000-8000-000000000221',
    (select id from public.memory_context_manifests where attempt_key = 'fb39-retention')
  ) ->> 'status'),
  'revoked', 'post-erasure revalidation reports revoked');

-- Erasure by direct item identity ------------------------------------------------------------------
select extensions.is(
  (select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'memory_item', 'fb390000-0000-4000-8000-000000000387', 'fb39 direct request'
  ) ->> 'erasedItems'),
  '1', 'a direct item erasure nulls the item');
select extensions.is(
  (select body from public.memory_items where id = 'fb390000-0000-4000-8000-000000000387'),
  null, 'the direct item body is nulled');

-- Refusals and boundaries -------------------------------------------------------------------------------
set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000022';
select extensions.is(
  pg_temp.state_of($$ select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000022',
    'memory_item', 'fb390000-0000-4000-8000-000000000387', 'fb39 operator attempt') $$),
  '42501', 'an operator cannot erase source content');
select extensions.is(
  pg_temp.state_of($$ select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'memory_item', 'fb390000-0000-4000-8000-000000000387', 'fb39 borrowed actor') $$),
  '42501', 'borrowing another actor identity is refused');

set local request.jwt.claim.sub = 'fb390000-0000-4000-8000-000000000021';
select extensions.is(
  pg_temp.state_of($$ select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'memory_item', 'fb390000-0000-4000-8000-000000000499', 'fb39 missing item') $$),
  'P0002', 'erasing an unknown item is not found');
select extensions.is(
  pg_temp.state_of($$ select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'channel', 'fb390000-0000-4000-8000-000000000384', 'fb39 bad kind') $$),
  '23514', 'an unknown source kind is refused');
select extensions.is(
  pg_temp.state_of($$ select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'channel_finding', 'fb390000-0000-4000-8000-000000000384', '') $$),
  '23514', 'an empty reason is refused');

-- Worker path: null actor rides service_role, a forged actor does not.
reset role;
select extensions.is(
  (select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', null,
    'channel_finding', 'fb390000-0000-4000-8000-000000000384', 'fb39 worker sweep'
  ) ->> 'erasedEvents'),
  '0', 'the worker path executes and reports honestly');
select extensions.is(
  pg_temp.state_of($$ select public.erase_memory_source_content(
    'fb390000-0000-4000-8000-000000000221', 'fb390000-0000-4000-8000-000000000021',
    'channel_finding', 'fb390000-0000-4000-8000-000000000384', 'fb39 forged worker') $$),
  '42501', 'the worker cannot forge an actor');

select * from extensions.finish();

rollback;
