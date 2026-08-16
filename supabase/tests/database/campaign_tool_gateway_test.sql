begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- One tenant, one approved campaign, one paid action. Everything runs inside
-- this transaction, so nothing survives it.
insert into auth.users (id) values ('7a000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
) values (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  'Tool gateway tenant', 'tool-gateway-tenant', 'testing', 'AE', 'AED', 'Asia/Dubai',
  '7a000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organization_memberships (organization_id, user_id, role)
values (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000001'::uuid,
  'operator'
);

insert into public.campaign_briefs (id, organization_id, objective, audience, created_by)
values (
  '7a000000-0000-4000-8000-000000000201'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  'Increase weekday lunch covers', 'Nearby office workers',
  '7a000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaigns (
  id, organization_id, title, source_kind, brief_id, created_by
) values (
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  'Lunch campaign', 'manual_brief',
  '7a000000-0000-4000-8000-000000000201'::uuid,
  '7a000000-0000-4000-8000-000000000001'::uuid
);

insert into public.campaign_source_snapshots (id, organization_id, campaign_id, facts, assertions)
values (
  '7a000000-0000-4000-8000-000000000401'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '{"currency":"AED"}'::jsonb, '[]'::jsonb
);

insert into public.campaign_bundle_versions (
  id, organization_id, campaign_id, version, source_snapshot_id, manifest, digest,
  generation_profile, execution_mode, total_spend_ceiling_minor, spend_currency
) values (
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  1,
  '7a000000-0000-4000-8000-000000000401'::uuid,
  jsonb_build_object(
    'version', 1,
    'campaignId', '7a000000-0000-4000-8000-000000000301',
    'generationProfile', 'brand_guided',
    'executionMode', 'best_effort'
  ),
  repeat('a', 64), 'brand_guided', 'best_effort', 150000, 'AED'
);

insert into public.campaign_creative_directions (
  organization_id, bundle_version_id, direction_key, kind, name, rationale
) values (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000601'::uuid,
  'control', 'House style', 'The reference treatment.'
);

insert into public.campaign_channel_actions (
  organization_id, bundle_version_id, action_key, direction_key, channel, placement,
  scheduled_for, requirement, spend_ceiling_minor, spend_currency
) values (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000701'::uuid,
  '7a000000-0000-4000-8000-000000000601'::uuid,
  'instagram', 'feed_image', pg_catalog.now() - interval '1 hour', 'required', 100000, 'AED'
);

-- Two more paid actions, used to exercise the failure and reconciliation paths.
-- Their ceilings fit inside the approved total alongside the first action, so a
-- refusal in those sections means what it says rather than an exhausted budget.
insert into public.campaign_channel_actions (
  organization_id, bundle_version_id, action_key, direction_key, channel, placement,
  scheduled_for, requirement, spend_ceiling_minor, spend_currency
) values (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000702'::uuid,
  '7a000000-0000-4000-8000-000000000601'::uuid,
  'instagram', 'feed_image', pg_catalog.now() - interval '1 hour', 'optional', 20000, 'AED'
), (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000703'::uuid,
  '7a000000-0000-4000-8000-000000000601'::uuid,
  'instagram', 'image_story', pg_catalog.now() - interval '1 hour', 'optional', 20000, 'AED'
);

insert into public.campaign_visual_attestations (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attested_by, statement
) values (
  '7a000000-0000-4000-8000-000000000801'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  repeat('a', 64), '7a000000-0000-4000-8000-000000000001'::uuid,
  'I reviewed every proposed image.'
);

insert into public.campaign_approvals (
  id, organization_id, campaign_id, bundle_version_id, bundle_digest, attestation_id,
  approved_by, expires_at, capability_grant_versions, action_keys,
  total_spend_ceiling_minor, spend_currency
) values (
  '7a000000-0000-4000-8000-000000000901'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  repeat('a', 64),
  '7a000000-0000-4000-8000-000000000801'::uuid,
  '7a000000-0000-4000-8000-000000000001'::uuid,
  pg_catalog.now() + interval '7 days',
  '{}'::jsonb,
  array[
    '7a000000-0000-4000-8000-000000000701'::uuid,
    '7a000000-0000-4000-8000-000000000702'::uuid,
    '7a000000-0000-4000-8000-000000000703'::uuid
  ],
  150000, 'AED'
);

insert into public.campaign_action_runs (
  id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for
) values (
  '7a000000-0000-4000-8000-000000000a01'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000701'::uuid,
  pg_catalog.now() - interval '1 hour'
), (
  '7a000000-0000-4000-8000-000000000a02'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000702'::uuid,
  pg_catalog.now() - interval '1 hour'
), (
  '7a000000-0000-4000-8000-000000000a03'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000301'::uuid,
  '7a000000-0000-4000-8000-000000000501'::uuid,
  '7a000000-0000-4000-8000-000000000703'::uuid,
  pg_catalog.now() - interval '1 hour'
);

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------

select extensions.ok(
  (
    select bool_and(relrowsecurity and relforcerowsecurity)
    from pg_catalog.pg_class
    where oid in (
      'public.campaign_action_runs'::regclass,
      'public.tool_invocations'::regclass,
      'public.provider_receipts'::regclass,
      'public.campaign_budget_reservations'::regclass,
      'private.tool_gateway_operations'::regclass
    )
  ),
  'every execution ledger table enables and forces RLS'
);

select extensions.table_privs_are(
  'public', 'campaign_action_runs', 'authenticated', array['SELECT'],
  'members read action runs and never write them directly'
);
select extensions.table_privs_are(
  'public', 'provider_receipts', 'anon', array[]::text[],
  'anonymous cannot reach provider receipts'
);
select extensions.table_privs_are(
  'private', 'tool_gateway_operations', 'service_role', array[]::text[],
  'even the worker reaches the operation ledger only through RPCs'
);
select extensions.function_privs_are(
  'public', 'claim_campaign_action', array['uuid', 'jsonb'], 'authenticated',
  array[]::text[], 'a browser session cannot claim a campaign action'
);
select extensions.function_privs_are(
  'public', 'claim_campaign_action', array['uuid', 'jsonb'], 'service_role',
  array['EXECUTE'], 'the worker may claim'
);

-- ---------------------------------------------------------------------------
-- The claim itself
-- ---------------------------------------------------------------------------

create temporary table gateway_state (key text primary key, value jsonb not null);

insert into gateway_state (key, value)
select 'first_claim', public.claim_campaign_action(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '7a000000-0000-4000-8000-000000000101',
    'action_run_id', '7a000000-0000-4000-8000-000000000a01',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

-- No capability grant exists for this organization, so the claim must refuse.
-- That is the honest state of the platform today: Meta is not grantable.
select extensions.is(
  (select value ->> 'outcome' from gateway_state where key = 'first_claim'),
  'refused'::text,
  'a channel with no capability grant cannot be claimed'
);
select extensions.ok(
  (
    select value -> 'reason_codes' @> '["capability_not_granted"]'::jsonb
    from gateway_state where key = 'first_claim'
  ),
  'the refusal names the missing capability rather than a generic failure'
);
select extensions.is(
  (
    select status from public.campaign_action_runs
    where id = '7a000000-0000-4000-8000-000000000a01'::uuid
  ),
  'blocked'::text,
  'a refused claim leaves the action blocked, not silently queued'
);
select extensions.is(
  (
    select count(*)::bigint from public.campaign_budget_reservations
    where organization_id = '7a000000-0000-4000-8000-000000000101'::uuid
  ),
  0::bigint,
  'a refused claim reserves no money'
);

-- Grant the capability so the rest of the decision can be exercised.
insert into public.integration_connections (
  id, organization_id, provider_key, adapter_version, connection_mode, status,
  external_account_id, external_account_label, created_by
) values (
  '7a000000-0000-4000-8000-000000000b01'::uuid,
  '7a000000-0000-4000-8000-000000000101'::uuid,
  'google_business_profile', 'v1', 'fixture', 'active', 'acct-1', 'Test account',
  '7a000000-0000-4000-8000-000000000001'::uuid
);

insert into public.integration_capability_grants (
  organization_id, connection_id, capability_key, maturity, availability,
  derived_from_adapter_version, derived_from_contract_version, grant_version
) values (
  '7a000000-0000-4000-8000-000000000101'::uuid,
  '7a000000-0000-4000-8000-000000000b01'::uuid,
  'publish_instagram', 'read-only', 'available', 'v1', 'v1', 1
);

insert into gateway_state (key, value)
select 'granted_claim', public.claim_campaign_action(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '7a000000-0000-4000-8000-000000000101',
    'action_run_id', '7a000000-0000-4000-8000-000000000a01',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select extensions.is(
  (select value ->> 'outcome' from gateway_state where key = 'granted_claim'),
  'claimed'::text,
  'a fully cleared action is claimed'
);
select extensions.is(
  (select (value ->> 'reservation_minor')::bigint from gateway_state where key = 'granted_claim'),
  100000::bigint,
  'the claim reserves the action ceiling before returning'
);
select extensions.is(
  (
    select reserved_minor from public.campaign_budget_reservations
    where action_run_id = '7a000000-0000-4000-8000-000000000a01'::uuid
  ),
  100000::bigint,
  'the reservation is written inside the same transaction as the claim'
);

-- A second claim while the lease is live must stand down rather than duplicate.
select extensions.is(
  (
    public.claim_campaign_action(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '7a000000-0000-4000-8000-000000000101',
        'action_run_id', '7a000000-0000-4000-8000-000000000a01',
        'capability_key', 'publish_instagram',
        'asserted_facts', jsonb_build_object(
          'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
        )
      )
    ) ->> 'outcome'
  ),
  'already_claimed'::text,
  'a concurrent claim stands down instead of duplicating the work'
);

-- ---------------------------------------------------------------------------
-- Fencing, receipts, and settlement
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    select public.record_tool_invocation(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'action_run_id', '7a000000-0000-4000-8000-000000000a01',
        'claim_token', '00000000-0000-4000-8000-000000000999',
        'tool_key', 'meta.publish_image',
        'idempotency_key', 'invocation-key-1',
        'request_digest', repeat('b', 64)
      )
    )
  $$,
  '42501', 'tool_gateway_claim_lost',
  'a worker whose lease was replaced cannot record an invocation'
);

insert into gateway_state (key, value)
select 'invocation', jsonb_build_object(
  'id',
  public.record_tool_invocation(
    '7a000000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'action_run_id', '7a000000-0000-4000-8000-000000000a01',
      'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'granted_claim'),
      'tool_key', 'meta.publish_image',
      'idempotency_key', 'invocation-key-1',
      'request_digest', repeat('b', 64)
    )
  )
);

select extensions.is(
  (
    select count(*)::bigint from public.tool_invocations
    where action_run_id = '7a000000-0000-4000-8000-000000000a01'::uuid
  ),
  1::bigint,
  'one invocation row exists after the first record'
);

-- The same business key replays rather than creating a second provider call.
select extensions.is(
  (
    select public.record_tool_invocation(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'action_run_id', '7a000000-0000-4000-8000-000000000a01',
        'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'granted_claim'),
        'tool_key', 'meta.publish_image',
        'idempotency_key', 'invocation-key-1',
        'request_digest', repeat('b', 64)
      )
    )
  ),
  (select (value ->> 'id')::uuid from gateway_state where key = 'invocation'),
  'a replayed idempotency key returns the same invocation'
);

select extensions.is(
  (
    select count(*)::bigint from public.tool_invocations
    where action_run_id = '7a000000-0000-4000-8000-000000000a01'::uuid
  ),
  1::bigint,
  'the replay created no second provider call'
);

select public.complete_tool_invocation(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'action_run_id', '7a000000-0000-4000-8000-000000000a01',
    'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'granted_claim'),
    'invocation_id', (select value ->> 'id' from gateway_state where key = 'invocation'),
    'external_reference', 'ig_media_1',
    'provider_status', 'PUBLISHED',
    'payload_digest', repeat('c', 64),
    'settled_minor', 60000
  )
);

select extensions.is(
  (
    select status from public.campaign_action_runs
    where id = '7a000000-0000-4000-8000-000000000a01'::uuid
  ),
  'confirmed'::text,
  'a completed invocation confirms the action'
);
select extensions.is(
  (
    select reserved_minor || '/' || settled_minor
    from public.campaign_budget_reservations
    where action_run_id = '7a000000-0000-4000-8000-000000000a01'::uuid
  ),
  '100000/60000'::text,
  'settlement records actual spend beside the committed amount rather than erasing it'
);

select extensions.throws_ok(
  $$
    update public.provider_receipts set provider_status = 'RETRACTED'
    where organization_id = '7a000000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'tool_ledger_is_append_only',
  'a provider receipt cannot be rewritten'
);

select extensions.throws_ok(
  $$
    update public.campaign_budget_reservations set reserved_minor = 1
    where organization_id = '7a000000-0000-4000-8000-000000000101'::uuid
  $$,
  '23514', 'budget_reservation_is_immutable',
  'the committed amount cannot be edited after the fact'
);

-- A finished action replays its receipt rather than being claimed again.
select extensions.is(
  (
    public.claim_campaign_action(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '7a000000-0000-4000-8000-000000000101',
        'action_run_id', '7a000000-0000-4000-8000-000000000a01',
        'capability_key', 'publish_instagram',
        'asserted_facts', '{}'::jsonb
      )
    ) ->> 'outcome'
  ),
  'already_completed'::text,
  'a completed action replays its receipt instead of running again'
);

-- ---------------------------------------------------------------------------
-- Ambiguity and reconciliation
--
-- These paths run only when something has already gone wrong, so they are the
-- least likely to be exercised by accident and the most expensive to get wrong.
-- plpgsql resolves record fields at execution time, which means a reference to
-- a column that does not exist installs cleanly and fails on the first real
-- call — during an incident, which is the worst possible moment to find out.
-- ---------------------------------------------------------------------------

insert into gateway_state (key, value)
select 'unknown_claim', public.claim_campaign_action(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '7a000000-0000-4000-8000-000000000101',
    'action_run_id', '7a000000-0000-4000-8000-000000000a02',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

insert into gateway_state (key, value)
select 'unknown_invocation', jsonb_build_object(
  'id',
  public.record_tool_invocation(
    '7a000000-0000-4000-8000-000000000101'::uuid,
    jsonb_build_object(
      'action_run_id', '7a000000-0000-4000-8000-000000000a02',
      'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'unknown_claim'),
      'tool_key', 'meta.publish_image',
      'idempotency_key', 'invocation-key-2',
      'request_digest', repeat('d', 64)
    )
  )
);

select public.fail_tool_invocation(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'action_run_id', '7a000000-0000-4000-8000-000000000a02',
    'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'unknown_claim'),
    'invocation_id', (select value ->> 'id' from gateway_state where key = 'unknown_invocation'),
    'failure_code', 'adapter_threw',
    'outcome_unknown', true
  )
);

select extensions.is(
  (select status from public.campaign_action_runs
   where id = '7a000000-0000-4000-8000-000000000a02'::uuid),
  'provider_outcome_unknown'::text,
  'a call that may have gone through is left ambiguous rather than called failed'
);

-- The money stays committed. Releasing it here is how a campaign overspends:
-- the post may already be live, and a retry would buy the same placement twice.
select extensions.is(
  (select state from public.campaign_budget_reservations
   where action_run_id = '7a000000-0000-4000-8000-000000000a02'::uuid),
  'reserved'::text,
  'an unknown outcome keeps its reservation'
);

-- Nothing may move until a person or a reconciler has looked at the provider.
select extensions.is(
  (
    public.claim_campaign_action(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '7a000000-0000-4000-8000-000000000101',
        'action_run_id', '7a000000-0000-4000-8000-000000000a02',
        'capability_key', 'publish_instagram',
        'asserted_facts', '{}'::jsonb
      )
    ) ->> 'outcome'
  ),
  'provider_outcome_unknown'::text,
  'an ambiguous action blocks every later claim until it is reconciled'
);

select extensions.throws_ok(
  $$
    select public.reconcile_tool_invocation(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'action_run_id', '7a000000-0000-4000-8000-000000000a02',
        'invocation_id', '7a000000-0000-4000-8000-000000000fff',
        'finding', 'probably_fine'
      )
    )
  $$,
  '22023', 'tool_gateway_reconciliation_finding_invalid',
  'reconciliation refuses a finding that is not a finding'
);

select public.reconcile_tool_invocation(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'action_run_id', '7a000000-0000-4000-8000-000000000a02',
    'invocation_id', (select value ->> 'id' from gateway_state where key = 'unknown_invocation'),
    'finding', 'confirmed',
    'external_reference', 'ig_media_2',
    'provider_status', 'PUBLISHED',
    'payload_digest', repeat('e', 64)
  )
);

select extensions.is(
  (select status from public.campaign_action_runs
   where id = '7a000000-0000-4000-8000-000000000a02'::uuid),
  'reconciled'::text,
  'a confirmed finding resolves the ambiguity'
);

select extensions.is(
  (
    select count(*)::bigint from public.provider_receipts
    where invocation_id = (
      select (value ->> 'id')::uuid from gateway_state where key = 'unknown_invocation'
    )
  ),
  1::bigint,
  'reconciliation records the receipt that was missing'
);

select extensions.throws_ok(
  $$
    select public.reconcile_tool_invocation(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'action_run_id', '7a000000-0000-4000-8000-000000000a02',
        'invocation_id', '7a000000-0000-4000-8000-000000000fff',
        'finding', 'confirmed'
      )
    )
  $$,
  '22023', 'tool_gateway_nothing_to_reconcile',
  'an action that is not ambiguous cannot be reconciled twice'
);

-- An unambiguous failure is the opposite case: nothing reached the provider, so
-- the money must go back or the campaign loses budget it never spent.
insert into gateway_state (key, value)
select 'failed_claim', public.claim_campaign_action(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'organization_id', '7a000000-0000-4000-8000-000000000101',
    'action_run_id', '7a000000-0000-4000-8000-000000000a03',
    'capability_key', 'publish_instagram',
    'asserted_facts', jsonb_build_object(
      'credential_healthy', true, 'tracking_ready', true, 'consent_withdrawn', false
    )
  )
);

select public.fail_tool_invocation(
  '7a000000-0000-4000-8000-000000000101'::uuid,
  jsonb_build_object(
    'action_run_id', '7a000000-0000-4000-8000-000000000a03',
    'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'failed_claim'),
    'invocation_id',
    public.record_tool_invocation(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'action_run_id', '7a000000-0000-4000-8000-000000000a03',
        'claim_token', (select value ->> 'claim_token' from gateway_state where key = 'failed_claim'),
        'tool_key', 'meta.publish_image',
        'idempotency_key', 'invocation-key-3',
        'request_digest', repeat('f', 64)
      )
    ),
    'failure_code', 'provider_rejected',
    'outcome_unknown', false
  )
);

select extensions.is(
  (select status from public.campaign_action_runs
   where id = '7a000000-0000-4000-8000-000000000a03'::uuid),
  'failed'::text,
  'a refused call is recorded as failed rather than ambiguous'
);

select extensions.is(
  (select state from public.campaign_budget_reservations
   where action_run_id = '7a000000-0000-4000-8000-000000000a03'::uuid),
  'released'::text,
  'a clean failure gives the money back'
);

-- ---------------------------------------------------------------------------
-- Tenant boundary and audit
-- ---------------------------------------------------------------------------

select extensions.throws_ok(
  $$
    select public.claim_campaign_action(
      '7a000000-0000-4000-8000-000000000101'::uuid,
      jsonb_build_object(
        'organization_id', '00000000-0000-4000-8000-000000000000',
        'action_run_id', '7a000000-0000-4000-8000-000000000a01'
      )
    )
  $$,
  '42501', 'tool_gateway_organization_mismatch',
  'a body cannot redirect a claim to another tenant'
);

select extensions.ok(
  not exists (
    select 1 from public.audit_events
    where organization_id = '7a000000-0000-4000-8000-000000000101'::uuid
      and entity_type = 'campaign_action_runs'
      and (
        payload ?| array['claim_token', 'asserted_facts', 'payload_digest']
        or payload::text ilike '%ig_media_1%'
      )
  ),
  'execution audit rows carry no claim token, asserted facts, or provider reference'
);

select * from extensions.finish();
rollback;
