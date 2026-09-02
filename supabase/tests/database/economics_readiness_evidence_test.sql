-- Evidence readiness reads existing surfaces and adds none of its own.
--
-- No table, function, policy, or grant ships with the readiness slice: it is a
-- read model derived at request time from the governed exact-range ledger and
-- from the coverage function specs/012 section 7.3 already requires. This suite
-- is therefore about the guarantees that read depends on. Each one holding is
-- what makes readiness safe to expose to a viewer.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

-- The evidence readiness reads ------------------------------------------------

select extensions.has_table(
  'public', 'exact_range_metric_observations',
  'readiness reads exact-range evidence rather than a table of its own'
);
select extensions.has_column(
  'public', 'exact_range_metric_observations', 'reconciliation_state',
  'current, held, excluded, and superseded are distinguishable'
);
select extensions.has_column(
  'public', 'exact_range_metric_observations', 'period_timezone',
  'the exact local window is retained rather than inferred'
);
select extensions.has_column(
  'public', 'metric_definitions', 'economics_role',
  'which metric supplies which economics input is declared on the registry'
);

select extensions.ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.exact_range_metric_observations'::regclass),
  'the exact-range ledger forces row level security'
);
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.integration_report_packages'::regclass),
  'package lifecycle state is read under row level security'
);
select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.report_projection_reconciliations'::regclass),
  'overlap reconciliations are read under row level security'
);

-- Readiness is read-only ------------------------------------------------------

select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.exact_range_metric_observations', 'insert'),
  'no member may write exact-range evidence, readiness surface included'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.exact_range_metric_observations', 'update'),
  'nor amend it'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.exact_range_metric_observations', 'delete'),
  'nor remove it, so a rollback cannot lose evidence'
);

-- Cost coverage stays confidential --------------------------------------------

select extensions.has_function(
  'public', 'get_cost_component_coverage', array['uuid'],
  'coverage is read through the governed function, not the rate table'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.get_cost_component_coverage(uuid)', 'execute'),
  'any member may ask what is priced'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.get_cost_component_coverage(uuid)', 'execute'),
  'and nobody signed out may'
);

-- The function returns availability and a tier, and has no column that could
-- carry an amount. This is the structural half of the privacy rule: an operator
-- may learn that commission has a measured source, never what it is.
select extensions.bag_eq(
  $$
    select p.proargnames[i]
    from pg_catalog.pg_proc p,
         pg_catalog.generate_subscripts(p.proargnames, 1) i
    where p.oid = 'public.get_cost_component_coverage(uuid)'::regprocedure
      and p.proargmodes[i] = 't'
  $$,
  $$ values ('key'), ('label'), ('computation_kind'), ('has_rate'), ('weakest_tier') $$,
  'coverage returns availability and tier only, with no column for an amount'
);

select extensions.ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.cost_component_rates'::regclass),
  'the rate table itself stays behind row level security'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('anon', 'public.cost_component_rates', 'select'),
  'and is unreachable signed out'
);

select * from extensions.finish();
rollback;
