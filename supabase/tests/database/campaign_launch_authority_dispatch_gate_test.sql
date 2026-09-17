begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260917120000_campaign_launch_authority_dispatch_gate.sql`.
--
-- The rule under test: no run is created without a live launch authority, a
-- partial authority schedules only the actions it covers (one reviewed output
-- out of three actions stamps and clears exactly that action — never the
-- other two), and no authority-carrying run dispatches once its authority
-- stops being live or never covered it. Runs from before enforcement carry no
-- reference and keep flowing under the proposal approval, loudly: each such
-- claim leaves a `grandfathered` marker. Pauses are safety actions, not
-- publications, and stay out of both paths.

insert into auth.users (id) values
  ('d7000000-0000-4000-8000-000000000001'::uuid);

insert into public.accounts (id, name, slug, created_by) values (
  'd7000000-0000-4000-8000-000000000a01'::uuid,
  'Gate account', 'gate-account', 'd7000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values (
  'd7000000-0000-4000-8000-000000000101'::uuid, 'Gate tenant', 'gate-tenant',
  'testing', 'AE', 'AED', 'Asia/Dubai', 'd7000000-0000-4000-8000-000000000001'::uuid,
  'd7000000-0000-4000-8000-000000000a01'::uuid
);

insert into public.organization_memberships (organization_id, user_id, role) values (
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000001'::uuid, 'owner'
);

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values (
  'd7000000-0000-4000-8000-000000000201'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'Increase weekday lunch covers', 'Nearby office workers',
  'd7000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaigns (id, organization_id, title, source_kind, brief_id, created_by)
values (
  'd7000000-0000-4000-8000-000000000301'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'Lunch campaign', 'manual_brief',
  'd7000000-0000-4000-8000-000000000201'::uuid,
  'd7000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions)
values (
  'd7000000-0000-4000-8000-000000000401'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  '{}'::jsonb, '[]'::jsonb
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode
) values (
  'd7000000-0000-4000-8000-000000000501'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  1,
  'd7000000-0000-4000-8000-000000000401'::uuid,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 2, 'version', 1,
    'campaignId', 'd7000000-0000-4000-8000-000000000301',
    'generationProfile', 'brand_guided', 'executionMode', 'best_effort',
    'directions', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('key', 'a')
    ),
    'generationPolicy', pg_catalog.jsonb_build_object(
      'maxVariantsPerDirection', 2, 'maxVariantsTotal', 6,
      'policyExpiresAt', '2026-12-31T00:00:00Z'
    )
  ),
  repeat('c', 64), 'brand_guided', 'best_effort'
);

insert into public.campaign_creative_directions (
  organization_id, bundle_version_id, direction_key, kind, name, rationale
) values (
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  'd7000000-0000-4000-8000-000000000601'::uuid,
  'control', 'House style', 'The reference treatment.'
),
(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  'd7000000-0000-4000-8000-000000000602'::uuid,
  'control', 'Second angle', 'The alternative treatment.'
);

-- Three organic actions, all proposal-approved, deliberately split across
-- coverage: the first shares its direction and channel with the one reviewed
-- output below, the second uses another direction, the third another channel.
-- A partial authority must schedule the first and nothing else.
insert into public.campaign_channel_actions (
  organization_id, bundle_version_id, action_key, direction_key, channel, placement,
  scheduled_for, requirement
) values
  (
    'd7000000-0000-4000-8000-000000000101'::uuid,
    'd7000000-0000-4000-8000-000000000501'::uuid,
    'd7000000-0000-4000-8000-000000000701'::uuid,
    'd7000000-0000-4000-8000-000000000601'::uuid,
    'instagram', 'feed_image', pg_catalog.now() - interval '1 hour', 'required'
  ),
  (
    'd7000000-0000-4000-8000-000000000101'::uuid,
    'd7000000-0000-4000-8000-000000000501'::uuid,
    'd7000000-0000-4000-8000-000000000702'::uuid,
    'd7000000-0000-4000-8000-000000000602'::uuid,
    'instagram', 'feed_image', pg_catalog.now() - interval '1 hour', 'optional'
  ),
  (
    'd7000000-0000-4000-8000-000000000101'::uuid,
    'd7000000-0000-4000-8000-000000000501'::uuid,
    'd7000000-0000-4000-8000-000000000703'::uuid,
    'd7000000-0000-4000-8000-000000000601'::uuid,
    'facebook', 'feed_image', pg_catalog.now() - interval '1 hour', 'optional'
  );

insert into public.campaign_visual_attestations (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attested_by, statement
) values (
  'd7000000-0000-4000-8000-000000000801'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  repeat('c', 64), 'd7000000-0000-4000-8000-000000000001'::uuid,
  'I reviewed every proposed image.'
);

insert into public.campaign_approvals (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
  approved_by, expires_at, capability_grant_versions, action_keys
) values (
  'd7000000-0000-4000-8000-000000000901'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  repeat('c', 64),
  'd7000000-0000-4000-8000-000000000801'::uuid,
  'd7000000-0000-4000-8000-000000000001'::uuid,
  pg_catalog.now() + interval '7 days',
  '{}'::jsonb,
  array[
    'd7000000-0000-4000-8000-000000000701'::uuid,
    'd7000000-0000-4000-8000-000000000702'::uuid,
    'd7000000-0000-4000-8000-000000000703'::uuid
  ]
);

-- A granted capability so grandfathered and stamped claims can actually clear
-- every other check; what remains refused is then the authority verdict alone.
insert into public.integration_connections (
  id, organization_id, provider_key, adapter_version, connection_mode, status,
  external_account_id, external_account_label, created_by
) values (
  'd7000000-0000-4000-8000-000000000b01'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'google_business_profile', 'v1', 'fixture', 'active', 'acct-1', 'Test account',
  'd7000000-0000-4000-8000-000000000001'::uuid
);

insert into public.integration_capability_grants (
  organization_id, connection_id, capability_key, maturity, availability,
  derived_from_adapter_version, derived_from_contract_version, grant_version
) values (
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000b01'::uuid,
  'publish_instagram', 'read-only', 'available', 'v1', 'v1', 1
);

create temporary table gate_state (key text primary key, value jsonb not null);
grant select, insert, update on gate_state to authenticated, service_role;

set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- A proposal approval alone no longer schedules: the gate fails closed.
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    select public.schedule_campaign_actions(
      'd7000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'd7000000-0000-4000-8000-000000000101',
        'bundle_version_id', 'd7000000-0000-4000-8000-000000000501'
      )
    )
  $$,
  '22023', 'campaign_schedule_requires_launch_authority',
  'scheduling without a live launch authority fails closed rather than queueing unapproved work'
);

-- ---------------------------------------------------------------------------
-- The authority, then the runs stamped with it.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into gate_state (key, value)
select 'version', public.record_campaign_deliverable_version(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'd7000000-0000-4000-8000-000000000301',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'd7000000-0000-4000-8000-000000000501',
    'direction_key', 'd7000000-0000-4000-8000-000000000601',
    'source_kind', 'final_image',
    'final_asset_id', 'd7000000-0000-4000-8000-000000000c01',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 3),
    'render_digest', 'digest-one', 'content_hash', repeat('a', 64)
  )
);

set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000001';

insert into gate_state (key, value)
select 'review', public.review_campaign_deliverable_version(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'deliverable_version_id',
      (select value ->> 'deliverable_version_id' from gate_state where key = 'version'),
    'content_hash', repeat('a', 64),
    'decision', 'approved', 'idempotency_key', 'owner-reviews-d7'
  )
);

insert into gate_state (key, value)
select 'authority', public.approve_campaign_launch(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'd7000000-0000-4000-8000-000000000301',
    'bundle_version_id', 'd7000000-0000-4000-8000-000000000501',
    'manifest', pg_catalog.jsonb_build_object('schemaVersion', 1),
    'launch_digest', repeat('2', 64),
    'idempotency_key', 'owner-launches-d7',
    'selections', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'deliverable_version_id',
          (select value ->> 'deliverable_version_id' from gate_state where key = 'version'),
        'content_hash', repeat('a', 64)
      )
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gate_state where key = 'authority'),
  'saved',
  'the reviewed output authorizes publication'
);

-- Two runs placed directly, the way pre-enforcement rows look: one with no
-- reference at all, one with a corrupted stamp. Placed as the session owner
-- (superuser bypasses RLS), the way the gateway suite places its runs.
reset role;

insert into public.campaign_action_runs (
  id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for
) values (
  'd7000000-0000-4000-8000-000000000d02'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  'd7000000-0000-4000-8000-000000000702'::uuid,
  pg_catalog.now() - interval '1 hour'
);

insert into public.campaign_action_runs (
  id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for,
  launch_approval_id, launch_digest
) values (
  'd7000000-0000-4000-8000-000000000d03'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  'd7000000-0000-4000-8000-000000000703'::uuid,
  pg_catalog.now() - interval '1 hour',
  (select (value ->> 'launch_approval_id')::uuid from gate_state where key = 'authority'),
  repeat('9', 64)
);

-- Back to the member session: scheduling is a member act.
set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000001';

insert into gate_state (key, value)
select 'schedule', public.schedule_campaign_actions(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd7000000-0000-4000-8000-000000000101',
    'bundle_version_id', 'd7000000-0000-4000-8000-000000000501'
  )
);

select extensions.is(
  (select (value ->> 'created_count')::integer from gate_state where key = 'schedule'),
  1,
  'scheduling under a one-of-three authority creates only the covered action, not all three'
);

select extensions.is(
  (
    select count(*)::integer from public.campaign_action_runs
    where organization_id = 'd7000000-0000-4000-8000-000000000101'::uuid
      and launch_approval_id
        = (select (value ->> 'launch_approval_id')::uuid from gate_state where key = 'authority')
      -- The digest pins it to the schedule above: the directly placed row
      -- d03 carries the same authority id with a corrupted stamp, and must
      -- not be counted as scheduled work.
      and launch_digest = repeat('2', 64)
  ),
  1,
  'and stamps exactly one run — the uncovered actions get no run at all, never an unstamped one'
);

select extensions.is(
  (
    select launch_approval_id = (select (value ->> 'launch_approval_id')::uuid from gate_state where key = 'authority')
      and launch_digest = repeat('2', 64)
    from public.campaign_action_runs
    where id = (
      select id from public.campaign_action_runs
      where organization_id = 'd7000000-0000-4000-8000-000000000101'::uuid
        and action_key = 'd7000000-0000-4000-8000-000000000701'::uuid
    )
  ),
  true,
  'and stamps the new run with the authority it was scheduled under'
);

select extensions.is(
  (
    select launch_approval_id is null and launch_digest is null
    from public.campaign_action_runs
    where id = 'd7000000-0000-4000-8000-000000000d02'::uuid
  ),
  true,
  'while a pre-existing run keeps the empty stamp scheduling found, never a borrowed one'
);

-- ---------------------------------------------------------------------------
-- Claim time: grandfathered proceeds audibly, corrupted refuses, live clears.
-- Claims run as the session owner, the way the gateway suite calls them: the
-- claim RPC is worker-granted and member-denied by design.
-- ---------------------------------------------------------------------------

reset role;

insert into gate_state (key, value)
select 'grandfathered_claim', public.claim_campaign_action(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd7000000-0000-4000-8000-000000000101',
    'action_run_id', 'd7000000-0000-4000-8000-000000000d02',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gate_state where key = 'grandfathered_claim'),
  'claimed',
  'a pre-enforcement run without a reference still claims under the proposal approval'
);

select extensions.is(
  (
    select count(*)::integer from private.tool_gateway_operations
    where action_run_id = 'd7000000-0000-4000-8000-000000000d02'::uuid
      and operation = 'claim' and outcome = 'grandfathered'
  ),
  1,
  'and leaves one marker row saying it flowed without authority'
);

insert into gate_state (key, value)
select 'corrupt_claim', public.claim_campaign_action(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd7000000-0000-4000-8000-000000000101',
    'action_run_id', 'd7000000-0000-4000-8000-000000000d03',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gate_state where key = 'corrupt_claim'),
  'refused',
  'a run whose stamp no longer matches its authority is refused'
);

select extensions.ok(
  (
    select value -> 'reason_codes' @> '["launch_authority_digest_mismatch"]'::jsonb
    from gate_state where key = 'corrupt_claim'
  ),
  'and the refusal names the digest mismatch rather than a generic failure'
);

-- The covered action clears: its run was stamped by the schedule above and
-- the authority covers it, so the claim goes through.
insert into gate_state (key, value)
select 'covered_claim', public.claim_campaign_action(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd7000000-0000-4000-8000-000000000101',
    'action_run_id', (
      select id from public.campaign_action_runs
      where organization_id = 'd7000000-0000-4000-8000-000000000101'::uuid
        and action_key = 'd7000000-0000-4000-8000-000000000701'::uuid
    ),
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gate_state where key = 'covered_claim'),
  'claimed',
  'the one covered action claims under its stamped authority'
);

-- A correct-looking stamp for an action the authority never covered refuses.
-- Placed directly like the other pre-enforcement rows: the schedule above
-- would never create it, which is exactly the hole being closed.
reset role;

insert into public.campaign_action_runs (
  id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for,
  launch_approval_id, launch_digest
) values (
  'd7000000-0000-4000-8000-000000000d04'::uuid,
  'd7000000-0000-4000-8000-000000000101'::uuid,
  'd7000000-0000-4000-8000-000000000301'::uuid,
  'd7000000-0000-4000-8000-000000000501'::uuid,
  'd7000000-0000-4000-8000-000000000702'::uuid,
  pg_catalog.now() - interval '1 hour',
  (select (value ->> 'launch_approval_id')::uuid from gate_state where key = 'authority'),
  repeat('2', 64)
);

insert into gate_state (key, value)
select 'forged_claim', public.claim_campaign_action(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd7000000-0000-4000-8000-000000000101',
    'action_run_id', 'd7000000-0000-4000-8000-000000000d04',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gate_state where key = 'forged_claim'),
  'refused',
  'a run stamped under an authority that never covered its action does not dispatch'
);

select extensions.ok(
  (
    select value -> 'reason_codes' @> '["launch_authority_action_not_covered"]'::jsonb
    from gate_state where key = 'forged_claim'
  ),
  'and the refusal names the missing coverage rather than a generic failure'
);

-- Let the covered run's lease lapse so the supersession block below evaluates
-- it fully. A live lease would answer `already_claimed` and prove nothing
-- about the retired authority. Only the lease moves; the stamp is immutable.
-- Still the session owner, so no role change is needed for this update.
update public.campaign_action_runs
set lease_expires_at = pg_catalog.now() - interval '1 minute'
where id = (
  select id from public.campaign_action_runs
  where organization_id = 'd7000000-0000-4000-8000-000000000101'::uuid
    and action_key = 'd7000000-0000-4000-8000-000000000701'::uuid
);

-- ---------------------------------------------------------------------------
-- A later variant invalidates: the authority retires, schedules stop, claims stop.
-- ---------------------------------------------------------------------------

set local role service_role;

insert into gate_state (key, value)
select 'superseding', public.record_campaign_deliverable_version(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  pg_catalog.jsonb_build_object(
    'campaign_id', 'd7000000-0000-4000-8000-000000000301',
    'channel', 'instagram', 'placement', 'feed', 'language', 'en', 'format', 'feed',
    'bundle_version_id', 'd7000000-0000-4000-8000-000000000501',
    'direction_key', 'd7000000-0000-4000-8000-000000000601',
    'source_kind', 'final_image',
    'final_asset_id', 'd7000000-0000-4000-8000-000000000c02',
    'copy', pg_catalog.jsonb_build_object('caption', 'Lunch is on, again.'),
    'render_inputs', pg_catalog.jsonb_build_object('templateVersion', 4),
    'render_digest', 'digest-two', 'content_hash', repeat('d', 64)
  )
);

set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = 'd7000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select state from public.campaign_launch_approvals
    where id = (select (value ->> 'launch_approval_id')::uuid from gate_state where key = 'authority')
  ),
  'superseded',
  'recording a newer version retires the live authority covering that output'
);

-- The campaign row itself is untouched: invalidation ends power, not history.
select extensions.is(
  (
    select count(*)::integer from public.campaign_launch_approvals
    where organization_id = 'd7000000-0000-4000-8000-000000000101'::uuid
  ),
  1,
  'and retires rather than deletes, so exactly one record remains'
);

select extensions.throws_ok(
  $$
    select public.schedule_campaign_actions(
      'd7000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', 'd7000000-0000-4000-8000-000000000101',
        'bundle_version_id', 'd7000000-0000-4000-8000-000000000501'
      )
    )
  $$,
  '22023', 'campaign_schedule_requires_launch_authority',
  'a superseded authority admits no new schedules until the new bytes are approved'
);

-- Claims again as the session owner.
reset role;

insert into gate_state (key, value)
select 'stale_claim', public.claim_campaign_action(
  'd7000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', 'd7000000-0000-4000-8000-000000000101',
    'action_run_id', (
      select id from public.campaign_action_runs
      where organization_id = 'd7000000-0000-4000-8000-000000000101'::uuid
        and action_key = 'd7000000-0000-4000-8000-000000000701'::uuid
    ),
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gate_state where key = 'stale_claim'),
  'refused',
  'a run stamped under a retired authority no longer dispatches'
);

select extensions.ok(
  (
    select value -> 'reason_codes' @> '["launch_authority_superseded"]'::jsonb
    from gate_state where key = 'stale_claim'
  ),
  'and the refusal names the retired authority'
);

-- ---------------------------------------------------------------------------
-- The stamp cannot be rewritten to borrow different authority.
-- ---------------------------------------------------------------------------

set local role postgres;

select extensions.throws_ok(
  format(
    $$update public.campaign_action_runs set launch_digest = %L
      where id = 'd7000000-0000-4000-8000-000000000d02'::uuid$$,
    repeat('8', 64)
  ),
  '42501',
  'campaign_action_run_authority_immutable',
  'a run cannot be re-stamped to borrow authority granted for different terms'
);

select * from extensions.finish();

rollback;
