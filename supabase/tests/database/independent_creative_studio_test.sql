begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- ---------------------------------------------------------------------------
-- Structure: all ten tables exist, and the load-bearing absences hold.
-- ---------------------------------------------------------------------------

select extensions.has_table('public', 'studio_documents', 'documents exist');
select extensions.has_table('public', 'studio_versions', 'versions exist');
select extensions.has_table('public', 'studio_runs', 'runs exist');
select extensions.has_table('public', 'studio_exports', 'exports exist');
select extensions.has_table(
  'public', 'studio_export_acceptances', 'export acceptances exist'
);
select extensions.has_table('public', 'studio_run_events', 'run events exist');
select extensions.has_table(
  'public', 'studio_preview_frames', 'preview frames exist'
);
select extensions.has_table('public', 'studio_uploads', 'uploads exist');
select extensions.has_table(
  'public', 'studio_continuations', 'continuations exist'
);
select extensions.has_table(
  'public', 'studio_generation_policies', 'generation policies exist'
);

-- A Studio version carries no approval of its own: approval is granted later
-- by human review and by the Campaign launch gate, never by generation.
select extensions.hasnt_column(
  'public', 'studio_versions', 'approved',
  'a version carries no approval flag'
);
select extensions.hasnt_column(
  'public', 'studio_versions', 'approved_at',
  'a version carries no approval timestamp'
);
-- A run never publishes: there is no public action a run row could trigger.
select extensions.hasnt_column(
  'public', 'studio_runs', 'auto_publish',
  'a run cannot trigger any public action'
);
select extensions.hasnt_column(
  'public', 'studio_runs', 'published_at',
  'a run records no publication'
);
-- Campaign linkage has no Task 3 home: selections arrive in Task 9.
select extensions.hasnt_column(
  'public', 'studio_runs', 'campaign_selection_id',
  'a run holds no linkage write, only the admitted request intent'
);

select extensions.ok(
  (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_catalog.pg_class
    where relname in (
      'studio_documents', 'studio_versions', 'studio_runs', 'studio_exports',
      'studio_export_acceptances', 'studio_run_events', 'studio_preview_frames',
      'studio_uploads', 'studio_continuations', 'studio_generation_policies'
    )
  ),
  'row level security is enabled and forced on all ten tables'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name like 'studio\_%'
      and grantee in ('anon', 'authenticated')
      and privilege_type <> 'SELECT'
  ),
  'no browser role holds a write grant on any studio table'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'studio_continuations'
      and grantee in ('anon', 'authenticated')
  ),
  'no browser role holds even a read grant on continuations'
);

select extensions.ok(
  not exists (
    select 1
    from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace space on space.oid = proc.pronamespace
    where space.nspname = 'public'
      and proc.proname in (
        'save_studio_document', 'reserve_studio_upload',
        'complete_studio_upload', 'save_studio_generation_policy',
        'admit_studio_run', 'claim_studio_run', 'heartbeat_studio_run',
        'append_studio_run_event', 'complete_studio_run', 'fail_studio_run',
        'cancel_studio_run', 'reconcile_studio_run', 'create_studio_export',
        'complete_studio_export', 'accept_studio_export'
      )
      and (
        not proc.prosecdef
        or coalesce(array_to_string(proc.proconfig, ','), '') not like '%search_path=%'
      )
  ),
  'all fifteen writers are security definer with an explicit search path'
);

select extensions.ok(
  not exists (
    select 1
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'complete_studio_upload', 'claim_studio_run', 'heartbeat_studio_run',
        'append_studio_run_event', 'complete_studio_run', 'fail_studio_run',
        'reconcile_studio_run', 'complete_studio_export'
      )
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  'no browser role may execute any of the eight worker-only writers'
);

select extensions.ok(
  (
    select count(*)
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'save_studio_document', 'reserve_studio_upload',
        'save_studio_generation_policy', 'admit_studio_run',
        'cancel_studio_run', 'create_studio_export', 'accept_studio_export'
      )
      and grantee = 'authenticated'
  ) = 7,
  'the seven user writers are each executable by authenticated members'
);

select extensions.ok(
  exists (
    select 1 from storage.buckets
    where id = 'studio-assets' and public = false
  ) and exists (
    select 1 from storage.buckets
    where id = 'studio-previews' and public = false
  ) and exists (
    select 1 from storage.buckets
    where id = 'studio-uploads' and public = false
  ) and exists (
    select 1 from storage.buckets
    where id = 'studio-context' and public = false
  ),
  'the four studio buckets exist and are all private'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two tenants plus a viewer and an admin, so isolation and roles
-- are proved against real rows rather than assumed.
-- ---------------------------------------------------------------------------

insert into auth.users (id)
values
  ('d3170000-0000-4000-8000-000000000001'::uuid),
  ('d3170000-0000-4000-8000-000000000002'::uuid),
  ('d3170000-0000-4000-8000-000000000003'::uuid),
  ('d3170000-0000-4000-8000-000000000004'::uuid);

insert into public.accounts (id, name, slug, created_by)
values (
  'd317c000-0000-4000-8000-000000000001'::uuid,
  'Independent studio fixture agency',
  'independent-studio-fixture-agency',
  'd3170000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone,
  created_by, account_id
)
values
  (
    'd3170000-0000-4000-8000-000000000101'::uuid,
    'Studio tenant A', 'studio-tenant-a', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'd3170000-0000-4000-8000-000000000001'::uuid,
    'd317c000-0000-4000-8000-000000000001'::uuid
  ),
  (
    'd3170000-0000-4000-8000-000000000102'::uuid,
    'Studio tenant B', 'studio-tenant-b', 'testing', 'AE', 'AED', 'Asia/Dubai',
    'd3170000-0000-4000-8000-000000000003'::uuid,
    'd317c000-0000-4000-8000-000000000001'::uuid
  );

insert into public.organization_memberships (organization_id, user_id, role)
values
  (
    'd3170000-0000-4000-8000-000000000101'::uuid,
    'd3170000-0000-4000-8000-000000000001'::uuid,
    'operator'
  ),
  (
    'd3170000-0000-4000-8000-000000000101'::uuid,
    'd3170000-0000-4000-8000-000000000002'::uuid,
    'viewer'
  ),
  (
    'd3170000-0000-4000-8000-000000000102'::uuid,
    'd3170000-0000-4000-8000-000000000003'::uuid,
    'operator'
  ),
  (
    'd3170000-0000-4000-8000-000000000101'::uuid,
    'd3170000-0000-4000-8000-000000000004'::uuid,
    'admin'
  );

insert into public.campaigns (
  id, organization_id, title, source_kind, brief_id, created_by
)
values (
  'd3170000-0000-4000-8000-000000000201'::uuid,
  'd3170000-0000-4000-8000-000000000101'::uuid,
  'Tenant A launch campaign', 'manual_brief',
  'd3170000-0000-4000-8000-000000000202'::uuid,
  'd3170000-0000-4000-8000-000000000001'::uuid
);

create temporary table studio_fix (k text primary key, v text not null);
grant select, insert, update on studio_fix to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Documents: create, CAS update, stale conflict, viewer refusal.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000002';
    select public.save_studio_document(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      '{"title": "Viewer draft"}'::jsonb
    );
  $$,
  '42501', 'studio_document_forbidden',
  'a viewer cannot save a studio document'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'docA',
      (public.save_studio_document(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        '{"title": "Tenant A poster", "settings": {"ratio": "4:5"}}'::jsonb
      )->>'id');
  $$,
  'an operator creates a tenant A document'
);

reset role;

select extensions.ok(
  (select v from studio_fix where k = 'docA') is not null,
  'the created document id was captured for later calls'
);

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.save_studio_document(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'id', v, 'expectedRevision', 999, 'title', 'Stale write'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '23505', 'studio_document_stale_revision',
  'a compare-and-swap write against a stale revision conflicts'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    update studio_fix set v = (
      public.save_studio_document(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'id', v, 'expectedRevision', 1, 'title', 'Tenant A poster v2'
        ) from studio_fix where k = 'docA')
      )->>'revision'
    ) where k = 'docARev';
  $$,
  'a compare-and-swap write at the current revision succeeds'
);

reset role;

-- ---------------------------------------------------------------------------
-- Policies: admin-only versioning, nothing admitted without one.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.save_studio_generation_policy(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      '{"enabled": true}'::jsonb
    );
  $$,
  '42501', 'studio_policy_forbidden',
  'an operator cannot save a generation policy'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000004';
    insert into studio_fix (k, v) values ('policyA1', (
      public.save_studio_generation_policy(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'enabled', true, 'currency', 'AED', 'perRunCeilingMinor', 5000,
          'windowCeilingMinor', 20000, 'windowSeconds', 3600,
          'maxPending', 10, 'maxAttempts', 3
        )
      )->>'version'
    ));
  $$,
  'an admin saves tenant A policy version 1'
);

reset role;

select extensions.is(
  (select v from studio_fix where k = 'policyA1'),
  '1',
  'the first policy version is 1'
);

-- ---------------------------------------------------------------------------
-- Uploads: reservation rules and worker settlement.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.reserve_studio_upload(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'kind', 'design', 'declaredSize', 1024,
        'declaredMime', 'image/png', 'filename', 'hero.png',
        'rightsAttestation', jsonb_build_object('accepted', false)
      )
    );
  $$,
  '22023', 'studio_upload_invalid',
  'a reservation without rights acceptance is refused'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.reserve_studio_upload(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'kind', 'mystery', 'declaredSize', 1024,
        'declaredMime', 'image/png', 'filename', 'hero.png',
        'rightsAttestation', jsonb_build_object('accepted', true)
      )
    );
  $$,
  '22023', 'studio_upload_invalid',
  'a reservation with an unknown kind is refused'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'uploadReady',
      (public.reserve_studio_upload(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'kind', 'design', 'declaredSize', 1024,
          'declaredMime', 'image/png', 'filename', 'hero.png',
          'rightsAttestation', jsonb_build_object('accepted', true)
        )
      )->>'uploadId');
    insert into studio_fix (k, v)
    select 'uploadReject',
      (public.reserve_studio_upload(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'kind', 'product', 'declaredSize', 2048,
          'declaredMime', 'image/jpeg', 'filename', 'dish.jpg',
          'rightsAttestation', jsonb_build_object('accepted', true)
        )
      )->>'uploadId');
    insert into studio_fix (k, v)
    select 'uploadExpire',
      (public.reserve_studio_upload(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        jsonb_build_object(
          'kind', 'brand_mark', 'declaredSize', 512,
          'declaredMime', 'image/webp', 'filename', 'mark.webp',
          'rightsAttestation', jsonb_build_object('accepted', true)
        )
      )->>'uploadId');
  $$,
  'an operator reserves three uploads'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.complete_studio_upload(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select v::uuid from studio_fix where k = 'uploadReady'),
      '{"verdict": "ready"}'::jsonb
    );
  $$,
  '42501', null,
  'a member cannot execute the worker-only upload settlement at all'
);

reset role;

-- Age one reservation past its transfer window (direct write as the suite
-- owner; members hold no such grant).
update public.studio_uploads
set expires_at = now() - make_interval(mins => 1)
where id = (select v::uuid from studio_fix where k = 'uploadExpire');

set local role service_role;

select extensions.is(
  public.complete_studio_upload(
    'd3170000-0000-4000-8000-000000000101'::uuid,
    (select v::uuid from studio_fix where k = 'uploadExpire'),
    '{"verdict": "ready"}'::jsonb
  )->>'state',
  'expired',
  'settling an aged reservation reports expired instead of verifying'
);

select extensions.is(
  public.complete_studio_upload(
    'd3170000-0000-4000-8000-000000000101'::uuid,
    (select v::uuid from studio_fix where k = 'uploadReject'),
    '{"verdict": "rejected"}'::jsonb
  )->>'state',
  'rejected',
  'a rejected intake verdict settles the reservation as rejected'
);

select extensions.is(
  public.complete_studio_upload(
    'd3170000-0000-4000-8000-000000000101'::uuid,
    (select v::uuid from studio_fix where k = 'uploadReady'),
    jsonb_build_object(
      'verdict', 'ready', 'finalHash', repeat('b', 64),
      'finalMime', 'image/png', 'finalWidth', 1080, 'finalHeight', 1350,
      'finalBytes', 900000
    )
  )->>'state',
  'ready',
  'a verified intake receipt settles the reservation as ready'
);

reset role;

select extensions.is(
  (select final_hash from public.studio_uploads
   where id = (select v::uuid from studio_fix where k = 'uploadReady')),
  repeat('b', 64),
  'the ready upload pins its verified bytes hash'
);

-- ---------------------------------------------------------------------------
-- Admission refusals: roles, policy presence, ceilings, stale and foreign
-- references. None of these writes a run.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000002';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'generate', 'idempotencyKey', 'viewer-key-0001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '42501', 'studio_run_forbidden',
  'a viewer cannot admit a studio run'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000003';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000102'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', 2, 'operation', 'generate',
        'idempotencyKey', 'nopolicy-key-0001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_document_not_found',
  'a tenant B actor cannot admit against a tenant A document'
);

reset role;

-- Tenant B owns a document but no policy: admission stops at the policy gate.
select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000003';
    insert into studio_fix (k, v)
    select 'docB',
      (public.save_studio_document(
        'd3170000-0000-4000-8000-000000000102'::uuid,
        '{"title": "Tenant B poster"}'::jsonb
      )->>'id');
  $$,
  'a tenant B operator creates a tenant B document'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000003';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000102'::uuid,
      (select jsonb_build_object(
        'documentId', v, 'expectedRevision', 1, 'operation', 'generate',
        'idempotencyKey', 'nopolicy-key-0002',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docB')
    );
  $$,
  '22023', 'studio_run_no_policy',
  'nothing is admitted without an explicit generation policy'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'generate', 'idempotencyKey', 'ceiling-key-0001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 999999, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_per_run_ceiling_exceeded',
  'an estimate above the per-run ceiling is refused'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v, 'expectedRevision', 999, 'operation', 'generate',
        'idempotencyKey', 'stale-key-000001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '23505', 'studio_run_stale_revision',
  'admission against a stale document revision conflicts'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'edit',
        'parentVersionId', 'd3170000-0000-4000-8000-000000000399',
        'idempotencyKey', 'parent-key-00001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_parent_not_found',
  'an edit naming a nonexistent parent version is refused'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'generate', 'idempotencyKey', 'campaign-key-0001',
        'requestedCampaignId', 'd3170000-0000-4000-8000-000000000399',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_campaign_not_found',
  'a selected campaign that does not exist is refused'
);

reset role;

-- ---------------------------------------------------------------------------
-- Happy admission: replay converges, digest mismatch conflicts, and a second
-- image run on a busy document is refused while suggestions stay admissible.
-- ---------------------------------------------------------------------------

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'runImg1',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'generate', 'idempotencyKey', 'run1-key-00000001',
          'requestedCampaignId', 'd3170000-0000-4000-8000-000000000201',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 1000, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
  $$,
  'an operator admits a campaign-linked image run on tenant A'
);

reset role;

-- Replay as the same operator: same key plus same digest converges.
select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'runImg1Replay',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'generate', 'idempotencyKey', 'run1-key-00000001',
          'requestedCampaignId', 'd3170000-0000-4000-8000-000000000201',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('a', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 1000, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
  $$,
  'the operator replays the same admission'
);

reset role;

select extensions.is(
  (select v from studio_fix where k = 'runImg1Replay'),
  (select v from studio_fix where k = 'runImg1'),
  'replay converges on the original run id'
);

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'generate', 'idempotencyKey', 'run1-key-00000001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('f', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '23505', 'studio_run_key_conflict',
  'the same key with another digest is a conflict, never a second run'
);

reset role;

-- A directly-inserted version on tenant B proves cross-document parents fail.
insert into public.studio_runs (
  id, organization_id, document_id, actor_id, operation, expected_revision,
  request, request_digest, idempotency_key, profile_id, policy_version,
  reserved_minor, currency, state
)
values (
  'd3170000-0000-4000-8000-000000000401'::uuid,
  (select v::uuid from studio_fix where k = 'docB'),
  'd3170000-0000-4000-8000-000000000003'::uuid,
  'generate', 1, '{}'::jsonb, repeat('d', 64), 'seed-key-000000001',
  'd3170000-0000-4000-8000-000000000301'::uuid, 1, 0, 'AED', 'ready'
);

insert into public.studio_versions (
  id, organization_id, document_id, ordinal, run_id, input_manifest,
  input_digest, provider_profile_id, output_path, output_hash, output_mime,
  output_width, output_height, output_bytes, exact_text_copy
)
values (
  'd3170000-0000-4000-8000-000000000402'::uuid,
  'd3170000-0000-4000-8000-000000000102'::uuid,
  (select v::uuid from studio_fix where k = 'docB'),
  1, 'd3170000-0000-4000-8000-000000000401'::uuid, '{}'::jsonb,
  repeat('d', 64), 'd3170000-0000-4000-8000-000000000301'::uuid,
  'seed/final.png', repeat('d', 64), 'image/png', 1080, 1350, 500000, ''
);

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'edit',
        'parentVersionId', 'd3170000-0000-4000-8000-000000000402',
        'idempotencyKey', 'xdoc-key-00000001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('c', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_parent_not_found',
  'a parent version from another document is refused'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'generate', 'idempotencyKey', 'busy-key-00000002',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('e', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 1000, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '23505', 'studio_run_document_busy',
  'a second image run on a busy document is refused'
);

reset role;

-- ---------------------------------------------------------------------------
-- Policy ceilings: attempts, pending count, and window spend.
-- ---------------------------------------------------------------------------

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'attempt' || n,
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'enhance',
          'idempotencyKey', 'attempt-key-0000000' || n,
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('9', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 100, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId')
    from generate_series(1, 3) n;
  $$,
  'three same-request suggestion runs admit within the attempt budget'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'enhance', 'idempotencyKey', 'attempt-key-00000004',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('9', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 100, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_attempt_limit_exceeded',
  'the fourth same-request attempt is refused'
);

reset role;

-- Settle the three attempt runs so later counts stay legible.
set local role service_role;

select extensions.is(
  (select count(*) from (
    select public.claim_studio_run(
      v::uuid, 'worker-attempt-sweep', 600
    ) from studio_fix where k in ('attempt1', 'attempt2', 'attempt3')
  ) claims),
  3::bigint,
  'the worker claims the three attempt runs'
);

select extensions.is(
  (select count(*) from (
    select public.fail_studio_run(
      run.id, run.lease_token,
      '{"safeCode": "provider_failed", "certainty": "definite"}'::jsonb
    )
    from public.studio_runs run
    join studio_fix fix on fix.v::uuid = run.id
    where fix.k in ('attempt1', 'attempt2', 'attempt3')
  ) failures),
  3::bigint,
  'the three attempt runs settle as definite failures'
);

reset role;

-- A tighter policy version takes effect immediately for new admissions.
select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000004';
    select public.save_studio_generation_policy(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'enabled', true, 'currency', 'AED', 'perRunCeilingMinor', 5000,
        'windowCeilingMinor', 20000, 'windowSeconds', 3600,
        'maxPending', 1, 'maxAttempts', 3
      )
    );
  $$,
  'an admin tightens tenant A to policy version 2 (one pending run)'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'enhance', 'idempotencyKey', 'pending-key-0000001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('8', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 100, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_too_many_pending',
  'a pending run beyond the tightened cap blocks new admissions'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000004';
    select public.save_studio_generation_policy(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'enabled', true, 'currency', 'AED', 'perRunCeilingMinor', 5000,
        'windowCeilingMinor', 100, 'windowSeconds', 3600,
        'maxPending', 10, 'maxAttempts', 3
      )
    );
  $$,
  'an admin saves policy version 3 with a tiny spend window'
);

reset role;

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.admit_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'documentId', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'operation', 'enhance', 'idempotencyKey', 'window-key-00000001',
        'profileId', 'd3170000-0000-4000-8000-000000000301',
        'requestDigest', repeat('7', 64), 'request', '{}'::jsonb,
        'estimatedCostMinor', 100, 'currency', 'AED'
      ) from studio_fix where k = 'docA')
    );
  $$,
  '22023', 'studio_run_window_ceiling_exceeded',
  'spend already reserved inside the window blocks new admissions'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000004';
    select public.save_studio_generation_policy(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'enabled', true, 'currency', 'AED', 'perRunCeilingMinor', 5000,
        'windowCeilingMinor', 20000, 'windowSeconds', 3600,
        'maxPending', 10, 'maxAttempts', 3
      )
    );
  $$,
  'an admin restores headroom with policy version 4'
);

reset role;

select extensions.is(
  (select max(version) from public.studio_generation_policies
   where organization_id = 'd3170000-0000-4000-8000-000000000101'::uuid),
  4,
  'four immutable policy versions now exist for tenant A'
);

-- ---------------------------------------------------------------------------
-- Worker lifecycle: leases fence every step, transitions follow the graph,
-- and completion commits the immutable version atomically.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into studio_fix (k, v)
select 'leaseImg1',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runImg1'),
    'worker-lifecycle-1', 600
  )->>'leaseToken');

select extensions.ok(
  (select v from studio_fix where k = 'leaseImg1') is not null,
  'the worker claims the queued image run'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.claim_studio_run(
      (select v::uuid from studio_fix where k = 'runImg1'),
      'worker-lifecycle-2', 600
    );
  $$,
  '23505', 'studio_run_lease_held',
  'a second worker cannot claim a leased run'
);

reset role;

set local role service_role;

select extensions.is(
  public.heartbeat_studio_run(
    (select v::uuid from studio_fix where k = 'runImg1'),
    (select v::uuid from studio_fix where k = 'leaseImg1')
  ),
  true,
  'the owning worker extends its live lease'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.heartbeat_studio_run(
      (select v::uuid from studio_fix where k = 'runImg1'),
      'd3170000-0000-4000-8000-000000000399'::uuid
    );
  $$,
  '22023', 'studio_run_lease_lost',
  'a heartbeat with the wrong token is refused'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.append_studio_run_event(
      (select v::uuid from studio_fix where k = 'runImg1'),
      (select v::uuid from studio_fix where k = 'leaseImg1'),
      '{"kind": "studio.run.generation_started"}'::jsonb
    );
  $$,
  '22023', 'studio_run_illegal_transition',
  'generation cannot start before references are prepared'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.append_studio_run_event(
      (select v::uuid from studio_fix where k = 'runImg1'),
      (select v::uuid from studio_fix where k = 'leaseImg1'),
      '{"kind": "studio.run.references_prepared",
        "safePayload": {"stage": "preparing", "prompt": "smuggled"}}'::jsonb
    );
  $$,
  '22023', 'studio_run_event_forbidden_key',
  'an event payload carrying a prompt is refused'
);

reset role;

set local role service_role;

select extensions.is(
  (select state from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runImg1')),
  'queued',
  'refused appends leave the run state untouched'
);

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runImg1'),
  (select v::uuid from studio_fix where k = 'leaseImg1'),
  '{"kind": "studio.run.references_prepared",
    "safePayload": {"stage": "preparing"}}'::jsonb
);

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runImg1'),
  (select v::uuid from studio_fix where k = 'leaseImg1'),
  '{"kind": "studio.run.generation_started",
    "safePayload": {"stage": "generating"}}'::jsonb
);

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runImg1'),
  (select v::uuid from studio_fix where k = 'leaseImg1'),
  jsonb_build_object(
    'kind', 'studio.run.preview_available',
    'safePayload', jsonb_build_object('stage', 'previewing', 'frameIndex', 0),
    'preview', jsonb_build_object(
      'frameIndex', 0,
      'privatePath', 'd3170000-0000-4000-8000-000000000101/runImg1/frame0.png',
      'contentHash', repeat('e', 64), 'mime', 'image/png',
      'width', 540, 'height', 675
    )
  )
);

-- Redelivered previews are idempotent: the same frame receipt twice stores
-- one frame row.
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runImg1'),
  (select v::uuid from studio_fix where k = 'leaseImg1'),
  jsonb_build_object(
    'kind', 'studio.run.preview_available',
    'safePayload', jsonb_build_object('stage', 'previewing', 'frameIndex', 0),
    'preview', jsonb_build_object(
      'frameIndex', 0,
      'privatePath', 'd3170000-0000-4000-8000-000000000101/runImg1/frame0.png',
      'contentHash', repeat('e', 64), 'mime', 'image/png',
      'width', 540, 'height', 675
    )
  )
);

select extensions.is(
  (select count(*) from public.studio_preview_frames
   where run_id = (select v::uuid from studio_fix where k = 'runImg1')),
  1::bigint,
  'a redelivered preview receipt stores exactly one frame row'
);

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runImg1'),
  (select v::uuid from studio_fix where k = 'leaseImg1'),
  '{"kind": "studio.run.output_validated",
    "safePayload": {"stage": "validating"}}'::jsonb
);

insert into studio_fix (k, v)
select 'completeImg1',
  (public.complete_studio_run(
    (select v::uuid from studio_fix where k = 'runImg1'),
    (select v::uuid from studio_fix where k = 'leaseImg1'),
    jsonb_build_object(
      'actualCostMinor', 800,
      'output', jsonb_build_object(
        'outputHash', repeat('c', 64), 'outputMime', 'image/png',
        'outputWidth', 1080, 'outputHeight', 1350, 'outputBytes', 1200000,
        'outputPath', 'd3170000-0000-4000-8000-000000000101/docA/v1/final.png',
        'inputDigest', repeat('a', 64), 'exactTextCopy', 'Grand opening!'
      ),
      'continuation', jsonb_build_object(
        'privateObjectPath',
        'd3170000-0000-4000-8000-000000000101/docA/v1/context.bin',
        'privateObjectHash', repeat('d', 64)
      ),
      'verification', jsonb_build_object('ocrChecked', true)
    )
  )->>'versionId');

select extensions.ok(
  (select v from studio_fix where k = 'completeImg1') is not null,
  'image completion commits a version'
);

select extensions.is(
  (select ordinal from public.studio_versions
   where id = (select v::uuid from studio_fix where k = 'completeImg1')),
  1,
  'the first version of the document carries ordinal 1'
);

select extensions.is(
  (select current_version_id from public.studio_documents
   where id = (select v::uuid from studio_fix where k = 'docA')),
  (select v::uuid from studio_fix where k = 'completeImg1'),
  'completion advances the document current-version pointer'
);

select extensions.is(
  (select count(*) from public.studio_continuations
   where version_id = (select v::uuid from studio_fix where k = 'completeImg1')
     and state = 'usable'),
  1::bigint,
  'completion stores a usable private continuation'
);

select extensions.is(
  (select count(*) from public.studio_run_events
   where run_id = (select v::uuid from studio_fix where k = 'runImg1')),
  6::bigint,
  'accepted, prepared, started, two previews, validated, completed: six events'
);

select extensions.ok(
  not exists (
    select 1 from public.studio_run_events
    where run_id = (select v::uuid from studio_fix where k = 'runImg1')
      and safe_payload ? 'anomaly'
  ),
  'a run with real previews completes without the missing-preview anomaly'
);

reset role;

-- The requested campaign survives completion as intent, never as linkage.
select extensions.is(
  (select requested_campaign_id from public.studio_versions
   where id = (select v::uuid from studio_fix where k = 'completeImg1')),
  'd3170000-0000-4000-8000-000000000201'::uuid,
  'the admitted campaign request is preserved on the version row'
);

-- ---------------------------------------------------------------------------
-- Branch completion: a revision that moved on saves history, honestly flagged.
-- ---------------------------------------------------------------------------

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'runBranch',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'generate', 'idempotencyKey', 'branch-key-0000001',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('b', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 100, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
  $$,
  'a second image run admits against the current revision'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.save_studio_document(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'id', v,
        'expectedRevision', (select revision from public.studio_documents
         where id = (select v::uuid from studio_fix where k = 'docA')),
        'title', 'Tenant A poster v3'
      ) from studio_fix where k = 'docA')
    );
  $$,
  'the document revision moves on while the run is still working'
);

reset role;

set local role service_role;

insert into studio_fix (k, v)
select 'leaseBranch',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runBranch'),
    'worker-branch-1', 600
  )->>'leaseToken');

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runBranch'),
  (select v::uuid from studio_fix where k = 'leaseBranch'),
  '{"kind": "studio.run.references_prepared"}'::jsonb
);
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runBranch'),
  (select v::uuid from studio_fix where k = 'leaseBranch'),
  '{"kind": "studio.run.generation_started"}'::jsonb
);
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runBranch'),
  (select v::uuid from studio_fix where k = 'leaseBranch'),
  '{"kind": "studio.run.output_validated"}'::jsonb
);

insert into studio_fix (k, v)
select 'branchFlag',
  (public.complete_studio_run(
    (select v::uuid from studio_fix where k = 'runBranch'),
    (select v::uuid from studio_fix where k = 'leaseBranch'),
    jsonb_build_object(
      'output', jsonb_build_object(
        'outputHash', repeat('f', 64), 'outputMime', 'image/png',
        'outputWidth', 1080, 'outputHeight', 1350, 'outputBytes', 1100000,
        'outputPath', 'd3170000-0000-4000-8000-000000000101/docA/v2/final.png',
        'inputDigest', repeat('b', 64), 'exactTextCopy', ''
      ),
      'continuation', jsonb_build_object(
        'privateObjectPath',
        'd3170000-0000-4000-8000-000000000101/docA/v2/context.bin',
        'privateObjectHash', repeat('a', 64)
      )
    )
  )->>'branch');

select extensions.is(
  (select v from studio_fix where k = 'branchFlag'),
  'true',
  'completion against a moved revision reports a historical branch'
);

select extensions.ok(
  exists (
    select 1 from public.studio_run_events
    where run_id = (select v::uuid from studio_fix where k = 'runBranch')
      and safe_payload->>'anomaly' = 'missing_progressive_preview'
  ),
  'a final without previews is saved and flagged, never faked'
);

reset role;

select extensions.is(
  (select current_version_id from public.studio_documents
   where id = (select v::uuid from studio_fix where k = 'docA')),
  (select v::uuid from studio_fix where k = 'completeImg1'),
  'the branch completion leaves the current pointer on version 1'
);

-- ---------------------------------------------------------------------------
-- Suggestions, definite failure, unknown outcomes, cancellation, recovery.
-- ---------------------------------------------------------------------------

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'runSuggest',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'enhance', 'idempotencyKey', 'suggest-key-000001',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('0', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 50, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
    insert into studio_fix (k, v)
    select 'runFail',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'generate', 'idempotencyKey', 'fail-key-000000001',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('1', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 50, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
    insert into studio_fix (k, v)
    select 'runUnknown',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'enhance', 'idempotencyKey', 'unknown-key-0000001',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('2', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 50, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
    insert into studio_fix (k, v)
    select 'runCancel',
      (public.admit_studio_run(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'documentId', v,
          'expectedRevision', (select revision from public.studio_documents
           where id = (select v::uuid from studio_fix where k = 'docA')),
          'operation', 'generate', 'idempotencyKey', 'cancel-key-0000001',
          'profileId', 'd3170000-0000-4000-8000-000000000301',
          'requestDigest', repeat('3', 64), 'request', '{}'::jsonb,
          'estimatedCostMinor', 50, 'currency', 'AED'
        ) from studio_fix where k = 'docA')
      )->>'runId');
  $$,
  'four runs admit for the suggestion, failure, unknown, and cancel paths'
);

reset role;

set local role service_role;

insert into studio_fix (k, v)
select 'leaseSuggest',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runSuggest'),
    'worker-suggest-1', 600
  )->>'leaseToken');
insert into studio_fix (k, v)
select 'leaseFail',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runFail'),
    'worker-fail-1', 600
  )->>'leaseToken');
insert into studio_fix (k, v)
select 'leaseUnknown',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runUnknown'),
    'worker-unknown-1', 600
  )->>'leaseToken');

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runSuggest'),
  (select v::uuid from studio_fix where k = 'leaseSuggest'),
  '{"kind": "studio.run.references_prepared"}'::jsonb
);
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runSuggest'),
  (select v::uuid from studio_fix where k = 'leaseSuggest'),
  '{"kind": "studio.run.generation_started"}'::jsonb
);
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runSuggest'),
  (select v::uuid from studio_fix where k = 'leaseSuggest'),
  '{"kind": "studio.run.output_validated"}'::jsonb
);

select extensions.is(
  public.complete_studio_run(
    (select v::uuid from studio_fix where k = 'runSuggest'),
    (select v::uuid from studio_fix where k = 'leaseSuggest'),
    jsonb_build_object(
      'suggestion', jsonb_build_object(
        'originalPromptDigest', repeat('0', 64),
        'suggestedPrompt', 'A calmer hero line.',
        'operation', 'enhance'
      )
    )
  )->>'suggestion',
  'true',
  'a suggestion run completes with a typed result'
);

select extensions.is(
  (select result_version_id from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runSuggest')),
  null,
  'a suggestion completion creates no image version'
);

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runFail'),
  (select v::uuid from studio_fix where k = 'leaseFail'),
  '{"kind": "studio.run.references_prepared"}'::jsonb
);
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runFail'),
  (select v::uuid from studio_fix where k = 'leaseFail'),
  '{"kind": "studio.run.generation_started"}'::jsonb
);

select extensions.is(
  public.fail_studio_run(
    (select v::uuid from studio_fix where k = 'runFail'),
    (select v::uuid from studio_fix where k = 'leaseFail'),
    '{"safeCode": "provider_failed", "certainty": "definite",
      "actualCostMinor": 500}'::jsonb
  )->>'state',
  'failed',
  'a definite failure settles the run as failed'
);

select extensions.is(
  (select actual_cost_minor from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runFail')),
  500::bigint,
  'a definite failure records its settled spend'
);

select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runUnknown'),
  (select v::uuid from studio_fix where k = 'leaseUnknown'),
  '{"kind": "studio.run.references_prepared"}'::jsonb
);
select public.append_studio_run_event(
  (select v::uuid from studio_fix where k = 'runUnknown'),
  (select v::uuid from studio_fix where k = 'leaseUnknown'),
  '{"kind": "studio.run.generation_started"}'::jsonb
);

select extensions.is(
  public.fail_studio_run(
    (select v::uuid from studio_fix where k = 'runUnknown'),
    (select v::uuid from studio_fix where k = 'leaseUnknown'),
    '{"safeCode": "stream_lost", "certainty": "unknown"}'::jsonb
  )->>'state',
  'outcome_unknown',
  'an uncertain paid outcome is parked as unknown, never guessed'
);

select extensions.is(
  (select actual_cost_minor from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runUnknown')),
  null,
  'an unknown outcome keeps spend unsettled rather than zeroed'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.fail_studio_run(
      (select v::uuid from studio_fix where k = 'runUnknown'),
      (select v::uuid from studio_fix where k = 'leaseUnknown'),
      '{"safeCode": "stream_lost", "certainty": "unknown",
        "actualCostMinor": 100}'::jsonb
    );
  $$,
  '22023', 'studio_run_invalid',
  'an unknown outcome cannot settle spend it never observed'
);

reset role;

-- Cancellation is a request: the worker still settles the real outcome.
select extensions.is(
  (select state from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runCancel')),
  'queued',
  'the cancel-path run starts queued'
);

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.cancel_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select v::uuid from studio_fix where k = 'runCancel')
    );
  $$,
  'the operator requests cancellation'
);

reset role;

select extensions.is(
  (select state from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runCancel')),
  'cancel_requested',
  'cancellation lands as a request, not a settlement'
);

select extensions.is(
  (select count(*) from public.studio_run_events
   where run_id = (select v::uuid from studio_fix where k = 'runCancel')
     and kind = 'studio.run.cancel_requested'),
  1::bigint,
  'the cancel request is a durable event'
);

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.cancel_studio_run(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select v::uuid from studio_fix where k = 'runCancel')
    );
  $$,
  'a repeated cancel request is an idempotent no-op'
);

reset role;

select extensions.is(
  (select count(*) from public.studio_run_events
   where run_id = (select v::uuid from studio_fix where k = 'runCancel')
     and kind = 'studio.run.cancel_requested'),
  1::bigint,
  'the repeated request emits no second event'
);

-- An expired lease may be reclaimed by a new worker; the attempt counter
-- climbs so retries stay bounded by policy.
set local role service_role;

insert into studio_fix (k, v)
select 'leaseCancel1',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runCancel'),
    'worker-cancel-1', 600
  )->>'leaseToken');

reset role;

update public.studio_runs
set lease_expires_at = now() - make_interval(mins => 1)
where id = (select v::uuid from studio_fix where k = 'runCancel');

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.heartbeat_studio_run(
      (select v::uuid from studio_fix where k = 'runCancel'),
      (select v::uuid from studio_fix where k = 'leaseCancel1')
    );
  $$,
  '22023', 'studio_run_lease_lost',
  'a heartbeat on an expired lease is refused'
);

reset role;

set local role service_role;

insert into studio_fix (k, v)
select 'leaseCancel2',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'runCancel'),
    'worker-cancel-2', 600
  )->>'leaseToken');

select extensions.is(
  (select attempt from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'runCancel')),
  2,
  'reclaiming an expired lease starts attempt 2'
);

reset role;

-- Recovery: the unknown run settles failed from a documented retrieval.
set local role service_role;

select extensions.is(
  public.reconcile_studio_run(
    (select v::uuid from studio_fix where k = 'runUnknown'),
    '{"settled": "failed", "safeCode": "provider_failed"}'::jsonb
  )->>'state',
  'failed',
  'reconciliation settles the unknown run as failed'
);

reset role;

select extensions.throws_ok(
  $$
    set local role service_role;
    select public.reconcile_studio_run(
      (select v::uuid from studio_fix where k = 'runImg1'),
      '{"settled": "completed",
        "versionId": "d3170000-0000-4000-8000-000000000399"}'::jsonb
    );
  $$,
  '22023', 'studio_run_not_reconcilable',
  'a settled run cannot be reconciled, and success cannot be invented'
);

reset role;

-- ---------------------------------------------------------------------------
-- Exports: deterministic admission, worker finalization, pinned consent.
-- ---------------------------------------------------------------------------

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'exportRun',
      (public.create_studio_export(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'versionId', v, 'transformVersion', 1,
          'transform', jsonb_build_object(
            'kind', 'proportional_resize',
            'targetWidth', 1080, 'targetHeight', 1350
          ),
          'preset', 'instagram_feed', 'presetVersion', 1,
          'idempotencyKey', 'export-key-00000001',
          'requestDigest', repeat('4', 64)
        ) from studio_fix where k = 'completeImg1')
      )->>'runId');
    insert into studio_fix (k, v)
    select 'exportId',
      result->>'exportId'
    from public.create_studio_export(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select jsonb_build_object(
        'versionId', v, 'transformVersion', 1,
        'transform', jsonb_build_object(
          'kind', 'proportional_resize',
          'targetWidth', 1080, 'targetHeight', 1350
        ),
        'preset', 'instagram_feed', 'presetVersion', 1,
        'idempotencyKey', 'export-key-00000001',
        'requestDigest', repeat('4', 64)
      ) from studio_fix where k = 'completeImg1')
    ) as result(result);
  $$,
  'export admission preassigns the immutable export id (replay converges)'
);

reset role;

select extensions.is(
  (select reserved_minor from public.studio_runs
   where id = (select v::uuid from studio_fix where k = 'exportRun')),
  0::bigint,
  'the export run reserves zero provider spend'
);

set local role service_role;

insert into studio_fix (k, v)
select 'leaseExport',
  (public.claim_studio_run(
    (select v::uuid from studio_fix where k = 'exportRun'),
    'worker-export-1', 600
  )->>'leaseToken');

select extensions.is(
  public.complete_studio_export(
    'd3170000-0000-4000-8000-000000000101'::uuid,
    (select v::uuid from studio_fix where k = 'exportId'),
    (select jsonb_build_object(
      'versionId', v, 'transformVersion', 1, 'presetVersion', 1,
      'transform', jsonb_build_object(
        'kind', 'proportional_resize',
        'targetWidth', 1080, 'targetHeight', 1350
      ),
      'output', jsonb_build_object(
        'outputHash', repeat('5', 64), 'outputMime', 'image/jpeg',
        'outputWidth', 1080, 'outputHeight', 1350, 'outputBytes', 400000,
        'outputPath',
        'd3170000-0000-4000-8000-000000000101/docA/v1/export-1080.jpg'
      )
    ) from studio_fix where k = 'completeImg1')
  )->>'state',
  'ready',
  'the worker finalizes the validated derivative'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'exportReplay',
      (public.create_studio_export(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select jsonb_build_object(
          'versionId', v, 'transformVersion', 1,
          'transform', jsonb_build_object(
            'kind', 'proportional_resize',
            'targetWidth', 1080, 'targetHeight', 1350
          ),
          'preset', 'instagram_feed', 'presetVersion', 1,
          'idempotencyKey', 'export-key-00000002',
          'requestDigest', repeat('6', 64)
        ) from studio_fix where k = 'completeImg1')
      )->>'exportId');
  $$,
  'the same export inputs reuse the same immutable export'
);

reset role;

select extensions.is(
  (select v from studio_fix where k = 'exportReplay'),
  (select v from studio_fix where k = 'exportId'),
  'export dedup returns the original export id'
);

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.accept_studio_export(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select v::uuid from studio_fix where k = 'exportId'),
      repeat('0', 64),
      'accept-key-000000001'
    );
  $$,
  '22023', 'studio_export_hash_mismatch',
  'consent against the wrong bytes is refused'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'acceptance',
      (public.accept_studio_export(
        'd3170000-0000-4000-8000-000000000101'::uuid,
        (select v::uuid from studio_fix where k = 'exportId'),
        repeat('5', 64),
        'accept-key-000000001'
      )->>'acceptanceId');
  $$,
  'the operator pins consent to the exact export bytes'
);

reset role;

select extensions.is(
  (select v from studio_fix where k = 'acceptance') is not null,
  true,
  'the acceptance receipt id was captured'
);

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    select public.accept_studio_export(
      'd3170000-0000-4000-8000-000000000101'::uuid,
      (select v::uuid from studio_fix where k = 'exportId'),
      repeat('5', 64),
      'accept-key-000000002'
    );
  $$,
  'accepting the same export again replays the receipt'
);

reset role;

-- ---------------------------------------------------------------------------
-- Isolation: foreign rows are invisible, direct writes are refused, and
-- continuations stay secret from every member role.
-- ---------------------------------------------------------------------------

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000003';
    insert into studio_fix (k, v)
    select 'foreignVisible', count(*)::text
    from public.studio_documents
    where organization_id = 'd3170000-0000-4000-8000-000000000101'::uuid;
  $$,
  'a tenant B operator queries tenant A documents'
);

reset role;

select extensions.is(
  (select v from studio_fix where k = 'foreignVisible'),
  '0',
  'tenant B sees none of tenant A documents'
);

select extensions.throws_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into public.studio_documents (organization_id, creator_id, title)
    values (
      'd3170000-0000-4000-8000-000000000101'::uuid,
      'd3170000-0000-4000-8000-000000000001'::uuid,
      'Sneaky direct write'
    );
  $$,
  '42501', null,
  'a member cannot write a document directly, only through the RPC'
);

reset role;

select extensions.lives_ok(
  $$
    set local role authenticated;
    set local request.jwt.claim.sub = 'd3170000-0000-4000-8000-000000000001';
    insert into studio_fix (k, v)
    select 'continuationsVisible', count(*)::text
    from public.studio_continuations
    where organization_id = 'd3170000-0000-4000-8000-000000000101'::uuid;
  $$,
  'a tenant A operator queries tenant A continuations'
);

reset role;

select extensions.is(
  (select v from studio_fix where k = 'continuationsVisible'),
  '0',
  'members read zero continuations: no policy, no grant'
);

select extensions.ok(
  (select count(*) from public.studio_continuations
   where organization_id = 'd3170000-0000-4000-8000-000000000101'::uuid) >= 1::bigint,
  'continuations exist that members cannot see (proved from the owner side)'
);

set local role service_role;

select extensions.ok(
  (select count(*) from public.studio_continuations
   where organization_id = 'd3170000-0000-4000-8000-000000000101'::uuid) >= 1::bigint,
  'the worker role reads continuations for dispatch'
);

reset role;

select * from extensions.finish();

rollback;
