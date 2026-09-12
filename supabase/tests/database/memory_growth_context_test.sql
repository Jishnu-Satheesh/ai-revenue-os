begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

-- Swarm 3: per-item memory context associations. Fixture prefix fb42.
-- The table records governed manifest identity by reference only; memory
-- never changes priority or eligibility, claim/finding ids stay in their
-- evidence link tables, and research briefs stay distinguishable from
-- synthesis packs for operators.

select extensions.has_table('public', 'growth_intelligence_item_contexts', 'item context associations persist');
select extensions.has_column('public', 'growth_intelligence_item_contexts', 'organization_id', 'associations are tenant-scoped');
select extensions.has_column('public', 'growth_intelligence_item_contexts', 'growth_intelligence_item_id', 'associations key by item');
select extensions.has_column('public', 'growth_intelligence_item_contexts', 'manifest_id', 'associations record the manifest by reference');
select extensions.has_column('public', 'growth_intelligence_item_contexts', 'context_digest', 'associations record the pinned digest');
select extensions.has_column('public', 'growth_intelligence_item_contexts', 'purpose', 'associations name the memory purpose');
select extensions.has_column('public', 'growth_intelligence_item_contexts', 'kind', 'brief and synthesis stays distinguishable');
select extensions.hasnt_column('public', 'growth_intelligence_item_contexts', 'claim_id', 'claim ids stay in evidence fields');
select extensions.hasnt_column('public', 'growth_intelligence_item_contexts', 'finding_id', 'finding ids stay in evidence fields');
select extensions.hasnt_column('public', 'growth_intelligence_item_contexts', 'summary', 'no private bytes live here');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'growth_intelligence_item_contexts'), 'associations are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'growth_intelligence_item_contexts'), 'even from the table owner');
select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_item_contexts', 'select')
  and not pg_catalog.has_table_privilege('authenticated', 'public.growth_intelligence_item_contexts', 'insert,update,delete')
  and not pg_catalog.has_table_privilege('anon', 'public.growth_intelligence_item_contexts', 'select'),
  'client sessions hold no grants on associations'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('service_role', 'public.growth_intelligence_item_contexts', 'select,insert,update,delete'),
  'even the worker role holds no direct grants'
);
select extensions.has_index('public', 'growth_intelligence_item_contexts', 'growth_intelligence_item_contexts_pkey', 'associations key by item and manifest');
select extensions.ok(
  pg_catalog.strpos(
    pg_catalog.pg_get_constraintdef(
      (select oid from pg_catalog.pg_constraint where conname = 'growth_intelligence_item_contexts_kind_purpose'),
      true
    ),
    'brief'
  ) > 0,
  'brief maps to growth_research and synthesis to growth_synthesis'
);

select extensions.finish();
rollback;
