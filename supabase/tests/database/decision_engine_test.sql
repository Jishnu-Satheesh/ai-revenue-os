begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(21);

select extensions.has_table('public', 'playbook_definitions', 'playbook definitions are persisted');
select extensions.has_table('public', 'playbook_versions', 'playbook versions are persisted');
select extensions.has_table('public', 'artifact_versions', 'artifact versions are persisted');
select extensions.has_table('public', 'decision_cycles', 'decision cycles are persisted');
select extensions.has_table('public', 'decision_records', 'no_action and needs_data decisions are persisted');
select extensions.has_table('public', 'decision_candidates', 'scored candidates are persisted');
select extensions.has_table('public', 'decision_feedback', 'operator feedback is persisted');
select extensions.has_table('public', 'candidate_suppressions', 'candidate suppression state is persisted');
select extensions.has_table('public', 'opportunities', 'feed opportunities are persisted');

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.opportunities'::regclass),
  'the feed table has RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.decision_records'::regclass),
  'the decision ledger has RLS enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.artifact_versions'::regclass),
  'artifacts have RLS enabled'
);

select extensions.function_privs_are(
  'public', 'persist_decision_record', array['uuid', 'jsonb'], 'authenticated', array[]::text[],
  'authenticated cannot invoke the worker-only record RPC'
);
select extensions.function_privs_are(
  'public', 'start_decision_cycle', array['uuid', 'jsonb'], 'authenticated', array[]::text[],
  'authenticated cannot invoke the worker-only cycle RPC'
);
select extensions.function_privs_are(
  'public', 'append_decision_feedback', array['uuid', 'uuid', 'text', 'text', 'jsonb', 'uuid'], 'authenticated', array['EXECUTE'],
  'authenticated can append feedback through the constrained RPC'
);

select extensions.has_index('public', 'opportunities', 'opportunities_feed_idx', 'the active feed has an organization-scoped ordering index');
select extensions.has_index('public', 'candidate_suppressions', 'candidate_suppressions_active_idx', 'active suppression lookup is indexed');

select extensions.ok(
  exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.decision_cycles'::regclass and tgname = 'audit_decision_cycle'),
  'cycle creation writes an audit event'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.decision_records'::regclass and tgname = 'audit_decision_record'),
  'record creation writes an audit event'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.opportunities'::regclass and tgname = 'audit_opportunity'),
  'opportunity changes write an audit event'
);
select extensions.ok(
  exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'public.decision_feedback'::regclass and tgname = 'audit_decision_feedback'),
  'feedback creation writes an audit event'
);

select * from extensions.finish();
rollback;
