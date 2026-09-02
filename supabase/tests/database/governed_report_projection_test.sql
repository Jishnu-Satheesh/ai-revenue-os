begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

select extensions.has_table('public', 'report_projection_versions', 'immutable projection declarations are versioned');
select extensions.has_table('public', 'report_projection_decisions', 'owner decisions are append-only');
select extensions.has_table('public', 'report_projection_bindings', 'active exact projection bindings are explicit');
select extensions.has_table('public', 'integration_report_projection_runs', 'projection runs retain bounded evidence');
select extensions.has_table('public', 'exact_range_metric_observations', 'exact-range aggregates have a dedicated ledger');
select extensions.has_table('public', 'report_projection_lineage', 'aggregate evidence retains safe source lineage');
select extensions.has_function('public', 'claim_governed_report_package_projection', 'worker claim is database-owned');
select extensions.has_function('public', 'complete_governed_report_package_projection', 'worker completion is database-owned');
select extensions.has_function('public', 'fail_governed_report_package_projection', 'worker failure path exists');
select extensions.has_function('public', 'request_governed_report_package_projection', 'authorized projection request exists');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.integration_report_projection_runs'::regclass), 'projection runs enforce RLS');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where oid = 'public.exact_range_metric_observations'::regclass), 'exact-range ledger forces RLS');
select extensions.ok(not pg_catalog.has_table_privilege('authenticated', 'public.exact_range_metric_observations', 'insert'), 'members cannot write aggregate evidence directly');
select extensions.ok(not pg_catalog.has_function_privilege('authenticated', 'public.claim_governed_report_package_projection(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)', 'execute'), 'members cannot claim projection work');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.claim_governed_report_package_projection(uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)', 'execute'), 'service worker can claim projection work');

set local role service_role;
select extensions.lives_ok(
  $$ select public.claim_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000702'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'report-projection-runtime-0001', 'f2000000-0000-4000-8000-000000000802'::uuid, 'f2000000-0000-4000-8000-000000000803'::uuid) $$,
  'claim function executes safely for an absent package'
);
set local request.jwt.claim.sub = 'f2000000-0000-4000-8000-000000000001';
select extensions.throws_ok(
  $$ select public.claim_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid, 'f2000000-0000-4000-8000-000000000702'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'report-projection-runtime-0001', 'f2000000-0000-4000-8000-000000000802'::uuid, 'f2000000-0000-4000-8000-000000000803'::uuid) $$,
  '42501', 'report projection claim is worker-only', 'claim function rejects a service-role request carrying an end-user identity'
);
set local request.jwt.claim.sub = '';
select extensions.lives_ok(
  $$ select public.complete_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000802'::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{"status":"failed","qualityState":"failed","completenessState":"unavailable","errorCodes":[],"warningCodes":[]}'::jsonb, '[]'::jsonb) $$,
  'completion function executes safely without an active lease'
);
select extensions.lives_ok(
  $$ select public.fail_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000802'::uuid, 'PROJECTION_PROCESSING_FAILED', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  'failure function executes safely without an active lease'
);
-- The two codes added for control totals and unsupported projection targets.
-- A code the failure function rejects would surface to the operator as the
-- generic processing failure, which tells them nothing they can act on.
select extensions.lives_ok(
  $$ select public.fail_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000802'::uuid, 'CONTROL_TOTAL_MISMATCH', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  'failure function accepts a control total mismatch'
);
select extensions.lives_ok(
  $$ select public.fail_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000802'::uuid, 'PROJECTION_OUTPUT_KIND_UNSUPPORTED', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  'failure function accepts an unsupported projection target'
);
select extensions.lives_ok(
  $$ select public.fail_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000802'::uuid, 'TOTALS_ROW_NOT_RESOLVED', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  'failure function accepts an unresolvable totals row'
);
select extensions.throws_ok(
  $$ select public.fail_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'f2000000-0000-4000-8000-000000000801'::uuid, 'f2000000-0000-4000-8000-000000000802'::uuid, 'CONTROL_TOTAL_INVENTED', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $$,
  '22023', 'report projection failure is invalid', 'failure function still refuses a code it does not know'
);
reset role;
select extensions.throws_ok(
  $$ select public.propose_governed_report_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000701'::uuid, '{}'::jsonb, 'report-projection-propose-0001', 'f2000000-0000-4000-8000-000000000803'::uuid) $$,
  '42501', 'report projection proposal is not authorized', 'proposal function rejects an unauthenticated caller'
);
select extensions.throws_ok(
  $$ select public.decide_governed_report_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000702'::uuid, 'approved', null, 'report-projection-decide-0001', 'f2000000-0000-4000-8000-000000000803'::uuid) $$,
  '42501', 'report projection decision is not authorized', 'decision function rejects an unauthenticated caller'
);
select extensions.throws_ok(
  $$ select public.request_governed_report_package_projection('f2000000-0000-4000-8000-000000000201'::uuid, 'f2000000-0000-4000-8000-000000000001'::uuid, 'f2000000-0000-4000-8000-000000000501'::uuid, 'report-projection-request-0001', 'f2000000-0000-4000-8000-000000000803'::uuid) $$,
  '42501', 'report projection request is not authorized', 'request function rejects an unauthenticated caller'
);

select * from extensions.finish();

rollback;
