begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(111);

-- Contract, indexes, and grants ----------------------------------------------

select extensions.has_table(
  'public', 'growth_intelligence_research_projects',
  'independent research projects live in their own lifecycle envelope'
);
select extensions.has_table(
  'public', 'growth_intelligence_brief_revisions',
  'brief revisions live in an append-only per-project history'
);
select extensions.has_table(
  'public', 'growth_intelligence_reports',
  'monitoring reports pin one exact project, branch, revision and evidence identity'
);
select extensions.has_table(
  'public', 'growth_intelligence_draft_items',
  'report draft items carry the reviewable advice units'
);
select extensions.has_table(
  'public', 'growth_intelligence_acceptances',
  'explicit draft-item acceptance is recorded per acceptance key'
);
select extensions.has_function(
  'public', 'create_research_project',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'jsonb'],
  'projects start through one governed operation'
);
select extensions.has_function(
  'public', 'save_brief_revision',
  array['uuid', 'uuid', 'uuid', 'integer', 'jsonb', 'uuid'],
  'brief revisions save through one governed operation'
);
select extensions.has_function(
  'public', 'persist_report_version',
  array['uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'jsonb'],
  'report versions persist with their draft items in one transaction'
);
select extensions.has_function(
  'public', 'accept_draft_item',
  array['uuid', 'uuid', 'uuid', 'text', 'text'],
  'draft items accept idempotently per acceptance key'
);
select extensions.has_function(
  'private', 'assert_research_project_schedule',
  array['jsonb'],
  'recurring schedules validate cadence, time, timezone and end date'
);
select extensions.has_function(
  'private', 'assert_brief_revision_document',
  array['jsonb'],
  'brief documents validate against the Slice 1 contract beside the frozen profile validators'
);
select extensions.has_function(
  'private', 'assert_market_monitoring_report_content',
  array['jsonb'],
  'report content validates against the Slice 1 contract, estimate honesty parts included'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_research_projects'::regclass
  ),
  'research projects enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_brief_revisions'::regclass
  ),
  'brief revisions enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_reports'::regclass
  ),
  'monitoring reports enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_draft_items'::regclass
  ),
  'draft items enable and force RLS'
);
select extensions.ok(
  (
    select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation
    where relation.oid = 'public.growth_intelligence_acceptances'::regclass
  ),
  'acceptances enable and force RLS'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_research_projects', 'select'
  ),
  'authenticated members receive a research project read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_brief_revisions', 'select'
  ),
  'authenticated members receive a brief revision read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_reports', 'select'
  ),
  'authenticated members receive a monitoring report read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_draft_items', 'select'
  ),
  'authenticated members receive a draft item read grant'
);
select extensions.ok(
  pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_acceptances', 'select'
  ),
  'authenticated members receive an acceptance read grant'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_research_projects',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write projects directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_brief_revisions',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write brief revisions directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_reports',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write reports directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_draft_items',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write draft items directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'public.growth_intelligence_acceptances',
    'insert,update,delete'
  ),
  'authenticated sessions cannot write acceptances directly'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_research_project(uuid,uuid,uuid,text,text,text,jsonb)',
    'execute'
  ),
  'signed-in members may create research projects through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_brief_revision(uuid,uuid,uuid,integer,jsonb,uuid)',
    'execute'
  ),
  'signed-in members may save brief revisions through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.persist_report_version(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'execute'
  ),
  'signed-in members may persist report versions through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.accept_draft_item(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  'signed-in members may accept draft items through the governed RPC'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.create_research_project(uuid,uuid,uuid,text,text,text,jsonb)',
    'execute'
  ),
  'anonymous callers cannot create research projects'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.save_brief_revision(uuid,uuid,uuid,integer,jsonb,uuid)',
    'execute'
  ),
  'anonymous callers cannot save brief revisions'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.persist_report_version(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb)',
    'execute'
  ),
  'anonymous callers cannot persist report versions'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.accept_draft_item(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  'anonymous callers cannot accept draft items'
);
select extensions.has_index(
  'public', 'growth_intelligence_research_projects',
  'growth_intelligence_research_projects_active_list_idx',
  'the project list without archived rows has its own partial index'
);
select extensions.has_index(
  'public', 'growth_intelligence_reports',
  'growth_intelligence_reports_pending_review_idx',
  'pending-review reports have their own partial index'
);
select extensions.has_index(
  'public', 'growth_intelligence_brief_revisions',
  'growth_intelligence_brief_revisions_project_history_idx',
  'brief history paginates per project without scanning the tenant'
);
select extensions.has_index(
  'public', 'growth_intelligence_reports',
  'growth_intelligence_reports_project_history_idx',
  'report history paginates per project without scanning the tenant'
);
select extensions.ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_item.oid)
      like '%grants_execution_approval = FALSE%'
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_acceptances'::regclass
      and constraint_item.conname = 'growth_intelligence_acceptances_check'
  )
  or (
    select pg_catalog.bool_or(
      pg_catalog.pg_get_constraintdef(constraint_item.oid)
        like '%grants_execution_approval = false%'
    )
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_acceptances'::regclass
  ),
  'acceptance never grants execution approval at the check-constraint layer'
);
select extensions.ok(
  (
    select pg_catalog.bool_or(
      pg_catalog.pg_get_constraintdef(constraint_item.oid)
        like '%acceptance_key =%report_version_id%'
    )
    from pg_catalog.pg_constraint constraint_item
    where constraint_item.conrelid = 'public.growth_intelligence_acceptances'::regclass
  ),
  'the acceptance identity is exactly report version id plus item key'
);

-- Two-account fixtures ---------------------------------------------------------

insert into auth.users (id) values
  ('d6000000-0000-4000-8000-000000000001'::uuid),
  ('d6000000-0000-4000-8000-000000000002'::uuid),
  ('d6000000-0000-4000-8000-000000000003'::uuid),
  ('d6000000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by) values
  ('d6000000-0000-4000-8000-000000000101'::uuid, 'Monitoring agency A', 'monitoring-agency-a', 'd6000000-0000-4000-8000-000000000001'::uuid),
  ('d6000000-0000-4000-8000-000000000102'::uuid, 'Monitoring agency B', 'monitoring-agency-b', 'd6000000-0000-4000-8000-000000000004'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency,
  default_timezone, created_by
) values
  ('d6000000-0000-4000-8000-000000000201'::uuid, 'd6000000-0000-4000-8000-000000000101'::uuid, 'Monitoring client A', 'monitoring-client-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'd6000000-0000-4000-8000-000000000001'::uuid),
  ('d6000000-0000-4000-8000-000000000202'::uuid, 'd6000000-0000-4000-8000-000000000102'::uuid, 'Monitoring client B', 'monitoring-client-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'd6000000-0000-4000-8000-000000000004'::uuid);

insert into public.account_memberships (
  account_id, user_id, account_role, default_organization_role
) values
  ('d6000000-0000-4000-8000-000000000101'::uuid, 'd6000000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('d6000000-0000-4000-8000-000000000101'::uuid, 'd6000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator'),
  ('d6000000-0000-4000-8000-000000000101'::uuid, 'd6000000-0000-4000-8000-000000000003'::uuid, 'member', 'viewer'),
  ('d6000000-0000-4000-8000-000000000102'::uuid, 'd6000000-0000-4000-8000-000000000004'::uuid, 'owner', 'owner');

insert into public.branches (
  id, organization_id, name, slug, kind, timezone, currency, is_active
) values
  ('d6000000-0000-4000-8000-000000000301'::uuid, 'd6000000-0000-4000-8000-000000000201'::uuid, 'Dubai Marina', 'dubai-marina', 'physical', 'Asia/Dubai', 'AED', true),
  ('d6000000-0000-4000-8000-000000000302'::uuid, 'd6000000-0000-4000-8000-000000000201'::uuid, 'Downtown Dubai', 'downtown-dubai', 'physical', 'Asia/Dubai', 'AED', true),
  ('d6000000-0000-4000-8000-000000000303'::uuid, 'd6000000-0000-4000-8000-000000000202'::uuid, 'Other tenant branch', 'other-tenant-branch', 'physical', 'Asia/Dubai', 'AED', true);

create or replace function pg_temp.mm_brief(
  p_project_id uuid,
  p_org_id uuid,
  p_revision_number integer,
  p_pinned_id uuid default null
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'revisionId', pg_catalog.gen_random_uuid(),
    'projectId', p_project_id,
    'organizationId', p_org_id,
    'revisionNumber', p_revision_number,
    'question', 'What do Marina families want for Friday dinner?',
    'title', 'Marina Friday dinner',
    'eventDate', '2026-10-02',
    'locationId', 'd6000000-0000-4000-8000-000000000301',
    'researchArea', 'Family dining',
    'competitors', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', 'Marina Rival',
        'website', 'https://rival.example/menu',
        'locationHint', 'Pier 7',
        'source', 'operator_lead'
      )
    ),
    'investigationAreas', pg_catalog.jsonb_build_array('demand', 'reviews'),
    'evidencePeriods', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'label', 'Last quarter',
        'startDate', '2026-04-01',
        'endDate', '2026-06-30'
      )
    ),
    'businessContextSnapshotId', 'd6000000-0000-4000-8000-000000000401',
    'frequency', 'once',
    'pinnedToUpdateId',
      case when p_pinned_id is null then 'null'::jsonb else pg_catalog.to_jsonb(p_pinned_id) end,
    'createdAtUtc', '2026-09-13T10:00:00.000Z'
  );
$$;

create or replace function pg_temp.mm_report(
  p_version_id uuid,
  p_org_id uuid,
  p_project_id uuid,
  p_branch_id uuid,
  p_revision_id uuid,
  p_digest text
)
returns jsonb
language sql
as $$
  select pg_catalog.jsonb_build_object(
    'reportId', pg_catalog.gen_random_uuid(),
    'reportVersionId', p_version_id,
    'organizationId', p_org_id,
    'projectId', p_project_id,
    'locationId', p_branch_id,
    'briefRevisionId', p_revision_id,
    'evidenceDigest', p_digest,
    'summary', 'Marina families book early for Friday dinner.',
    'localMeaning', 'An early-bird family offer fits the Marina week.',
    'findings', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'early-booking',
        'statement', 'Rival listings show Friday slots filling by Thursday.',
        'citationSlots', pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'claimId', 'd6000000-0000-4000-8000-000000000501',
            'sourceRef', 'src-one'
          )
        )
      )
    ),
    'competitorComparison', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'competitorName', 'Marina Rival',
        'summary', 'Rival pushes Friday family platters.'
      )
    ),
    'speculativeEstimate', pg_catalog.jsonb_build_object(
      'label', 'Speculative range, not observed revenue',
      'range', pg_catalog.jsonb_build_object(
        'lowMinorUnits', 100000,
        'highMinorUnits', 200000,
        'currency', 'AED'
      ),
      'assumptions', pg_catalog.jsonb_build_array('Ten covers a night at AED 100.'),
      'reasoning', 'Visible queues on two walk-bys, scaled by menu prices.'
    ),
    'gaps', pg_catalog.jsonb_build_array(),
    'draftAdvice', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'itemKey', 'fix-queues',
        'kind', 'action',
        'title', 'Open a second till on Fridays',
        'detail', 'Queues form after 19:00 on Fridays.'
      ),
      pg_catalog.jsonb_build_object(
        'itemKey', 'lunch-crowd',
        'kind', 'finding',
        'title', 'Lunch crowd skews office workers',
        'detail', 'Midday covers are mostly nearby offices.'
      )
    ),
    'sources', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'sourceRef', 'src-one',
        'url', 'https://directory.example/marina-rival',
        'retrievedAtUtc', '2026-09-13T09:00:00.000Z'
      ),
      pg_catalog.jsonb_build_object('sourceRef', 'src-two')
    ),
    'plainLanguageRequired', true
  );
$$;

-- Document and content validators ----------------------------------------------

select extensions.lives_ok(
  $$ select private.assert_brief_revision_document(pg_temp.mm_brief(
    'd6000000-0000-4000-8000-000000000601'::uuid,
    'd6000000-0000-4000-8000-000000000201'::uuid,
    1
  )) $$,
  'a complete brief revision document validates'
);
select extensions.throws_ok(
  $$ select private.assert_brief_revision_document(pg_temp.mm_brief(
    'd6000000-0000-4000-8000-000000000601'::uuid,
    'd6000000-0000-4000-8000-000000000201'::uuid,
    1
  ) || '{"unapprovedField":"expand scope"}'::jsonb) $$,
  '22023', null,
  'the brief validator refuses a field outside the allowlist'
);
select extensions.throws_ok(
  $$ select private.assert_brief_revision_document(pg_catalog.jsonb_set(
    pg_temp.mm_brief(
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    '{competitors}',
    (pg_temp.mm_brief(
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ) -> 'competitors') || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name', '  marina RIVAL ', 'source', 'suggestion')
    )
  )) $$,
  '22023', null,
  'competitor names stay unique after case and whitespace folding'
);
select extensions.throws_ok(
  $$ select private.assert_brief_revision_document(pg_catalog.jsonb_set(
    pg_temp.mm_brief(
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    '{competitors,0,website}',
    '"ftp://rival.example/menu"'
  )) $$,
  '22023', null,
  'competitor websites stay public HTTP or HTTPS without credentials or fragments'
);
select extensions.throws_ok(
  $$ select private.assert_brief_revision_document(pg_temp.mm_brief(
    'd6000000-0000-4000-8000-000000000601'::uuid,
    'd6000000-0000-4000-8000-000000000201'::uuid,
    1
  ) || '{"investigationAreas":["telepathy"]}'::jsonb) $$,
  '22023', null,
  'investigation areas stay inside the five approved dimensions'
);
select extensions.throws_ok(
  $$ select private.assert_brief_revision_document(pg_catalog.jsonb_set(
    pg_temp.mm_brief(
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    '{evidencePeriods,0,endDate}',
    '"2026-01-01"'
  )) $$,
  '22023', null,
  'an evidence period cannot end before it starts'
);
select extensions.lives_ok(
  $$ select private.assert_research_project_schedule(
    '{"cadence":"weekly","localTime":"07:00","timeZone":"Asia/Dubai","endDate":"2026-12-31"}'::jsonb
  ) $$,
  'a weekly recurring schedule with an end date validates'
);
select extensions.throws_ok(
  $$ select private.assert_research_project_schedule(
    '{"cadence":"weekly","localTime":"07:00","timeZone":"Mars/Olympus"}'::jsonb
  ) $$,
  '22023', null,
  'schedule timezones stay inside the IANA database'
);
select extensions.lives_ok(
  $$ select private.assert_market_monitoring_report_content(pg_temp.mm_report(
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000601'::uuid,
    'd6000000-0000-4000-8000-000000000301'::uuid,
    'd6000000-0000-4000-8000-000000000801'::uuid,
    'digest-one'
  )) $$,
  'a complete report version with a labelled estimate validates'
);
select extensions.throws_ok(
  $$ select private.assert_market_monitoring_report_content(pg_temp.mm_report(
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000601'::uuid,
    'd6000000-0000-4000-8000-000000000301'::uuid,
    'd6000000-0000-4000-8000-000000000801'::uuid,
    'digest-one'
  ) || '{"speculativeEstimate":{"label":"Guess"}}'::jsonb) $$,
  '22023', null,
  'a partial estimate block without assumptions and reasoning is refused'
);
select extensions.throws_ok(
  $$ select private.assert_market_monitoring_report_content(pg_catalog.jsonb_set(
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000301'::uuid,
      'd6000000-0000-4000-8000-000000000801'::uuid,
      'digest-one'
    ),
    '{speculativeEstimate,range,lowMinorUnits}',
    '300000'
  )) $$,
  '22023', null,
  'a speculative range must run from low to high'
);
select extensions.throws_ok(
  $$ select private.assert_market_monitoring_report_content(pg_catalog.jsonb_set(
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000301'::uuid,
      'd6000000-0000-4000-8000-000000000801'::uuid,
      'digest-one'
    ),
    '{findings}',
    (pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000301'::uuid,
      'd6000000-0000-4000-8000-000000000801'::uuid,
      'digest-one'
    ) -> 'findings') || (pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000301'::uuid,
      'd6000000-0000-4000-8000-000000000801'::uuid,
      'digest-one'
    ) -> 'findings')
  )) $$,
  '22023', null,
  'finding keys stay unique within a report version'
);
select extensions.throws_ok(
  $$ select private.assert_market_monitoring_report_content(pg_catalog.jsonb_set(
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000301'::uuid,
      'd6000000-0000-4000-8000-000000000801'::uuid,
      'digest-one'
    ),
    '{sources,1,sourceRef}',
    '"SRC-ONE"'
  )) $$,
  '22023', null,
  'source references stay unique case-insensitively within a report version'
);
select extensions.throws_ok(
  $$ select private.assert_market_monitoring_report_content(pg_catalog.jsonb_set(
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      'd6000000-0000-4000-8000-000000000601'::uuid,
      'd6000000-0000-4000-8000-000000000301'::uuid,
      'd6000000-0000-4000-8000-000000000801'::uuid,
      'digest-one'
    ),
    '{speculativeEstimate,range,currency}',
    '"AEDX"'
  )) $$,
  '22023', null,
  'estimate currencies stay three-letter ISO codes'
);

-- Project creation through the fenced RPC ---------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

create temp table pg_temp.mm_projects as
select 'one-time' as label, public.create_research_project(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  'd6000000-0000-4000-8000-000000000301'::uuid,
  'Marina Friday dinner',
  'What do Marina families want for Friday dinner?',
  'one-time',
  null
) as r
union all
select 'recurring', public.create_research_project(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  'd6000000-0000-4000-8000-000000000302'::uuid,
  'Downtown lunch watch',
  'Where do Downtown offices eat lunch?',
  'recurring',
  '{"cadence":"weekly","localTime":"07:00","timeZone":"Asia/Dubai","endDate":"2026-12-31"}'::jsonb
)
union all
select 'other', public.create_research_project(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  'd6000000-0000-4000-8000-000000000301'::uuid,
  'Marina breakfast watch',
  'What do Marina hotels serve for breakfast?',
  'one-time',
  null
);

select extensions.is(
  (select r ->> 'lifecycle' from pg_temp.mm_projects where label = 'one-time'),
  'active',
  'a one-time project starts active without a schedule'
);
select extensions.is(
  (select r ->> 'lifecycle' from pg_temp.mm_projects where label = 'recurring'),
  'active',
  'a recurring project starts active with a validated schedule'
);
select extensions.throws_ok(
  $$ select public.create_research_project(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000301'::uuid,
    'Headless weekly',
    'A weekly project with no schedule.',
    'recurring',
    null
  ) $$,
  '22023', null,
  'a recurring project without a schedule is refused'
);
select extensions.throws_ok(
  $$ select public.create_research_project(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000301'::uuid,
    'Scheduled once',
    'A one-time project carrying a schedule.',
    'one-time',
    '{"cadence":"weekly","localTime":"07:00","timeZone":"Asia/Dubai"}'::jsonb
  ) $$,
  '22023', null,
  'a one-time project carrying a schedule is refused'
);
select extensions.throws_ok(
  $$ select public.create_research_project(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000303'::uuid,
    'Foreign branch project',
    'A project anchored to another tenant branch.',
    'one-time',
    null
  ) $$,
  '42501', null,
  'a project anchored to another organization branch is refused'
);

set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.create_research_project(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000003'::uuid,
    'd6000000-0000-4000-8000-000000000301'::uuid,
    'Viewer project',
    'A viewer starting their own project.',
    'one-time',
    null
  ) $$,
  '42501', null,
  'a viewer without manage permission cannot start a project'
);

set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000004';

create temp table pg_temp.mm_projects_b as
select public.create_research_project(
  'd6000000-0000-4000-8000-000000000202'::uuid,
  'd6000000-0000-4000-8000-000000000004'::uuid,
  'd6000000-0000-4000-8000-000000000303'::uuid,
  'Other tenant watch',
  'What does the other tenant research?',
  'one-time',
  null
) as r;

select extensions.is(
  (select r ->> 'lifecycle' from pg_temp.mm_projects_b),
  'active',
  'the second tenant starts its own project in its own scope'
);

reset role;

-- Brief revisions through the fenced RPC -----------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

create temp table pg_temp.mm_revisions as
select 'one-r1' as label, public.save_brief_revision(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
  1,
  pg_temp.mm_brief(
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000201'::uuid,
    1
  ),
  null
) as r
union all
select 'other-r1', public.save_brief_revision(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'other'),
  1,
  pg_temp.mm_brief(
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'other'),
    'd6000000-0000-4000-8000-000000000201'::uuid,
    1
  ),
  null
);

select extensions.is(
  (select (r ->> 'replayed')::boolean from pg_temp.mm_revisions where label = 'one-r1'),
  false,
  'the first brief revision saves without replay'
);
select extensions.is(
  (select public.save_brief_revision(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    1,
    pg_temp.mm_brief(
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    null
  ) ->> 'replayed'),
  'true',
  'resaving the identical revision replays instead of doubling it'
);
select extensions.throws_ok(
  $$ select public.save_brief_revision(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    1,
    pg_temp.mm_brief(
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ) || '{"question":"A rewritten question for the same number."}'::jsonb,
    null
  ) $$,
  '23505', null,
  'a different document on a kept revision number is a conflict, never an overwrite'
);
select extensions.throws_ok(
  $$ select public.save_brief_revision(
    'd6000000-0000-4000-8000-000000999999'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000699'::uuid,
    1,
    pg_temp.mm_brief(
      'd6000000-0000-4000-8000-000000000699'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    null
  ) $$,
  '42501', null,
  'a revision for an unknown project is refused'
);
select extensions.throws_ok(
  $$ select public.save_brief_revision(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'other'),
    1,
    pg_temp.mm_brief(
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000201'::uuid,
      1
    ),
    null
  ) $$,
  '42501', null,
  'a document naming another project is refused, never re-scoped'
);
select extensions.throws_ok(
  $$ select public.save_brief_revision(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    2,
    pg_temp.mm_brief(
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000202'::uuid,
      2
    ),
    null
  ) $$,
  '42501', null,
  'a document naming another organization is refused, never re-scoped'
);

select public.save_brief_revision(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
  2,
  pg_temp.mm_brief(
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000201'::uuid,
    2,
    'd6000000-0000-4000-8000-000000000901'::uuid
  ),
  'd6000000-0000-4000-8000-000000000901'::uuid
);

select extensions.is(
  (
    select revision_number::bigint
    from public.growth_intelligence_brief_revisions
    where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
      and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
      and pinned_to_update_id = 'd6000000-0000-4000-8000-000000000901'::uuid
  ),
  2::bigint,
  'the pinned second revision lands with its update pin'
);
select extensions.throws_ok(
  $$ select public.save_brief_revision(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    2,
    pg_temp.mm_brief(
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000201'::uuid,
      2,
      'd6000000-0000-4000-8000-000000000901'::uuid
    ),
    'd6000000-0000-4000-8000-000000000901'::uuid
  ) $$,
  '23505', null,
  'even an identical rewrite of a pinned revision is refused'
);
-- Direct-write guards run in both roles: least-privilege sessions fail the
-- table-privilege check (42501) before any trigger fires, while the table
-- owner reaches the append-only guard itself (55000).
select extensions.throws_ok(
  $$ update public.growth_intelligence_brief_revisions
     set document = document || '{"title":"Silent edit"}'::jsonb
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'brief revisions reject direct updates without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ update public.growth_intelligence_brief_revisions
     set document = document || '{"title":"Silent edit"}'::jsonb
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'brief revisions reject direct updates as append-only history'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ delete from public.growth_intelligence_brief_revisions
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'brief revisions reject direct deletes without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ delete from public.growth_intelligence_brief_revisions
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'brief revisions reject direct deletes as append-only history'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

reset role;

-- Report versions through the fenced RPC -----------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000004';

select public.save_brief_revision(
  'd6000000-0000-4000-8000-000000000202'::uuid,
  'd6000000-0000-4000-8000-000000000004'::uuid,
  (select (r ->> 'projectId')::uuid from pg_temp.mm_projects_b),
  1,
  pg_temp.mm_brief(
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects_b),
    'd6000000-0000-4000-8000-000000000202'::uuid,
    1
  ),
  null
);

create temp table pg_temp.mm_b_rev as
select id
from public.growth_intelligence_brief_revisions
where organization_id = 'd6000000-0000-4000-8000-000000000202'::uuid;

set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

create temp table pg_temp.mm_reports as
select public.persist_report_version(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
  'd6000000-0000-4000-8000-000000000301'::uuid,
  (select id from public.growth_intelligence_brief_revisions
    where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
      and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
      and revision_number = 1),
  'd6000000-0000-4000-8000-000000000701'::uuid,
  'digest-one',
  pg_temp.mm_report(
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'd6000000-0000-4000-8000-000000000201'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000301'::uuid,
    (select id from public.growth_intelligence_brief_revisions
      where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
        and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
        and revision_number = 1),
    'digest-one'
  )
) as r;

select extensions.is(
  (select r ->> 'reviewState' from pg_temp.mm_reports),
  'pending_review',
  'a persisted report version opens in pending review'
);
select extensions.is(
  (select (r ->> 'draftItemCount')::bigint from pg_temp.mm_reports),
  2::bigint,
  'persisting a report version writes its draft items in the same transaction'
);
select extensions.is(
  (select public.persist_report_version(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000301'::uuid,
    (select id from public.growth_intelligence_brief_revisions
      where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
        and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
        and revision_number = 1),
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'digest-one',
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000301'::uuid,
      (select id from public.growth_intelligence_brief_revisions
        where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
          and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
          and revision_number = 1),
      'digest-one'
    )
  ) ->> 'replayed'),
  'true',
  'replaying the identical report version returns the kept version'
);
select extensions.is(
  (
    select count(*)::bigint
    from public.growth_intelligence_draft_items
    where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
      and report_version_id = 'd6000000-0000-4000-8000-000000000701'::uuid
  ),
  2::bigint,
  'a replayed persist never doubles the draft items'
);
select extensions.throws_ok(
  $$ select public.persist_report_version(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000301'::uuid,
    (select id from public.growth_intelligence_brief_revisions
      where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
        and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
        and revision_number = 1),
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'digest-changed',
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000701'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000301'::uuid,
      (select id from public.growth_intelligence_brief_revisions
        where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
          and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
          and revision_number = 1),
      'digest-changed'
    )
  ) $$,
  '23505', null,
  'changed content on a kept report version is a conflict, never a rewrite'
);
select extensions.throws_ok(
  $$ select public.persist_report_version(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000303'::uuid,
    (select id from public.growth_intelligence_brief_revisions
      where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
        and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
        and revision_number = 1),
    'd6000000-0000-4000-8000-000000000702'::uuid,
    'digest-two',
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000702'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000303'::uuid,
      (select id from public.growth_intelligence_brief_revisions
        where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
          and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
          and revision_number = 1),
      'digest-two'
    )
  ) $$,
  '42501', null,
  'a report pinned to another organization branch is refused'
);
select extensions.throws_ok(
  $$ select public.persist_report_version(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000301'::uuid,
    (select id from public.growth_intelligence_brief_revisions
      where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
        and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'other')
        and revision_number = 1),
    'd6000000-0000-4000-8000-000000000703'::uuid,
    'digest-three',
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000703'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000301'::uuid,
      (select (r ->> 'revisionId')::uuid from pg_temp.mm_revisions where label = 'other-r1'),
      'digest-three'
    )
  ) $$,
  '42501', null,
  'a report pinning a revision from another project is refused'
);
select extensions.throws_ok(
  $$ select public.persist_report_version(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
    'd6000000-0000-4000-8000-000000000301'::uuid,
    (select id from pg_temp.mm_b_rev),
    'd6000000-0000-4000-8000-000000000704'::uuid,
    'digest-four',
    pg_temp.mm_report(
      'd6000000-0000-4000-8000-000000000704'::uuid,
      'd6000000-0000-4000-8000-000000000201'::uuid,
      (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time'),
      'd6000000-0000-4000-8000-000000000301'::uuid,
      (select (r ->> 'revisionId')::uuid from pg_temp.mm_revisions where label = 'other-r1'),
      'digest-four'
    )
  ) $$,
  '42501', null,
  'a report pinning another tenant revision is refused'
);
-- Direct-write guards run in both roles: least-privilege sessions fail the
-- table-privilege check (42501) before any trigger fires, while the table
-- owner reaches the guard itself (55000).
select extensions.throws_ok(
  $$ update public.growth_intelligence_reports
     set content = content || '{"summary":"Rewritten after the fact."}'::jsonb
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'report content rejects rewrites without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ update public.growth_intelligence_reports
     set content = content || '{"summary":"Rewritten after the fact."}'::jsonb
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'report content rejects rewrites once ready'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ update public.growth_intelligence_reports
     set evidence_digest = 'tampered'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'report evidence identity rejects rewrites without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ update public.growth_intelligence_reports
     set evidence_digest = 'tampered'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'report evidence identity rejects rewrites once ready'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ delete from public.growth_intelligence_reports
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'reports reject direct deletes without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ delete from public.growth_intelligence_reports
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'reports reject direct deletes so history entries keep opening'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ update public.growth_intelligence_draft_items
     set title = 'Rewritten advice'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'draft items reject direct updates without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ update public.growth_intelligence_draft_items
     set title = 'Rewritten advice'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'draft items reject direct updates as append-only history'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

reset role;

-- Acceptance through the fenced RPC ---------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

create temp table pg_temp.mm_accept as
select public.accept_draft_item(
  'd6000000-0000-4000-8000-000000000201'::uuid,
  'd6000000-0000-4000-8000-000000000002'::uuid,
  'd6000000-0000-4000-8000-000000000701'::uuid,
  'fix-queues',
  'action'
) as r;

select extensions.is(
  (select r ->> 'outcome' from pg_temp.mm_accept),
  'accepted',
  'accepting an action draft item records the acceptance'
);
select extensions.is(
  (select r ->> 'destination' from pg_temp.mm_accept),
  'Recommendations',
  'action advice routes to Recommendations by type'
);
select extensions.is(
  (select (r ->> 'grantsExecutionApproval')::boolean from pg_temp.mm_accept),
  false,
  'acceptance records carry no execution approval'
);
select extensions.is(
  (select public.accept_draft_item(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'fix-queues',
    'action'
  ) ->> 'outcome'),
  'already_accepted',
  'replaying a kept acceptance key returns the kept row without duplicating'
);
select extensions.throws_ok(
  $$ select public.accept_draft_item(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'lunch-crowd',
    'action'
  ) $$,
  '23505', null,
  'a key presented for another draft item type is a conflict, never an overwrite'
);
select extensions.throws_ok(
  $$ select public.accept_draft_item(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'no-such-item',
    'action'
  ) $$,
  '42501', null,
  'accepting an unknown draft item is refused'
);
select extensions.throws_ok(
  $$ insert into public.growth_intelligence_acceptances (
       organization_id, acceptance_key, report_version_id, item_key,
       kind, destination
     ) values (
       'd6000000-0000-4000-8000-000000000201'::uuid,
       'd6000000-0000-4000-8000-000000000701:fix-queues',
       'd6000000-0000-4000-8000-000000000701'::uuid,
       'fix-queues', 'action', 'Recommendations'
     ) $$,
  '42501', null,
  'acceptances reject direct inserts outside the idempotent RPC'
);
select extensions.is(
  (select public.accept_draft_item(
    'd6000000-0000-4000-8000-000000000201'::uuid,
    'd6000000-0000-4000-8000-000000000002'::uuid,
    'd6000000-0000-4000-8000-000000000701'::uuid,
    'lunch-crowd',
    'finding'
  ) ->> 'outcome'),
  'accepted',
  'accepting the remaining finding item records the acceptance'
);
select extensions.is(
  (
    select review_state
    from public.growth_intelligence_reports
    where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
      and report_version_id = 'd6000000-0000-4000-8000-000000000701'::uuid
  ),
  'accepted',
  'the report leaves pending review once every draft item is accepted'
);
-- True concurrency (two sessions accepting the final two items at once) cannot
-- run inside this single-session pgTAP suite: the report-scoped advisory lock
-- plus the replay-path flip retry are exercised at the staging-run level.
select extensions.diag(
  'concurrency note: overlapping final accepts converge via the report lock; '
  'verify with two concurrent staging sessions before push'
);
-- Direct-write guards run in both roles: least-privilege sessions fail the
-- table-privilege check (42501) before any trigger fires, while the table
-- owner reaches the guard itself (55000).
select extensions.throws_ok(
  $$ update public.growth_intelligence_reports
     set review_state = 'pending_review'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
       and report_version_id = 'd6000000-0000-4000-8000-000000000701'::uuid $$,
  '42501', null,
  'an accepted report never slides back into pending review without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ update public.growth_intelligence_reports
     set review_state = 'pending_review'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
       and report_version_id = 'd6000000-0000-4000-8000-000000000701'::uuid $$,
  '55000', null,
  'an accepted report never slides back into pending review'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';
select extensions.throws_ok(
  $$ update public.growth_intelligence_acceptances
     set destination = 'Insights'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'acceptances reject direct updates without a write grant'
);
reset role;
select extensions.throws_ok(
  $$ update public.growth_intelligence_acceptances
     set destination = 'Insights'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '55000', null,
  'acceptances reject direct updates as append-only history'
);
set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000002';

reset role;

-- Tenant-fenced reads and history after archive -----------------------------------

set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000003';

select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_research_projects
  ),
  3::bigint,
  'a viewer reads their own organization projects and nothing else'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_reports
  ),
  1::bigint,
  'a viewer reads their own organization reports and nothing else'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_research_projects
    where organization_id = 'd6000000-0000-4000-8000-000000000202'::uuid
  ),
  0::bigint,
  'RLS hides another tenant project from the viewer'
);
select extensions.throws_ok(
  $$ insert into public.growth_intelligence_research_projects (
       organization_id, branch_id, title, question, mode
     ) values (
       'd6000000-0000-4000-8000-000000000201'::uuid,
       'd6000000-0000-4000-8000-000000000301'::uuid,
       'Sneaky project', 'A direct write.', 'one-time'
     ) $$,
  '42501', null,
  'viewers cannot insert projects outside the governed RPC'
);
select extensions.throws_ok(
  $$ update public.growth_intelligence_research_projects
     set title = 'Sneaky rename'
     where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid $$,
  '42501', null,
  'viewers cannot rename projects outside the governed RPC'
);

reset role;

update public.growth_intelligence_research_projects
set lifecycle = 'archived'
where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
  and id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time');

set local role authenticated;
set local request.jwt.claim.sub = 'd6000000-0000-4000-8000-000000000003';

select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_brief_revisions
    where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
      and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
  ),
  2::bigint,
  'brief history stays readable after the project archives'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_reports
    where organization_id = 'd6000000-0000-4000-8000-000000000201'::uuid
      and project_id = (select (r ->> 'projectId')::uuid from pg_temp.mm_projects where label = 'one-time')
  ),
  1::bigint,
  'report history stays readable after the project archives'
);
select extensions.is(
  (
    select count(*)::bigint from public.growth_intelligence_research_projects
  ),
  3::bigint,
  'the archived project itself stays readable to the viewer'
);

reset role;

select * from extensions.finish();

rollback;
