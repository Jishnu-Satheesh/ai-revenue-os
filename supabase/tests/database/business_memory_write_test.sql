begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(57);

insert into auth.users (id)
values
  ('16000000-0000-4000-8000-000000000001'::uuid),
  ('16000000-0000-4000-8000-000000000002'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values (
  '26000000-0000-4000-8000-000000000001'::uuid,
  'Write tenant', 'write-tenant', 'testing', 'US', 'USD', 'UTC',
  '16000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('26000000-0000-4000-8000-000000000001'::uuid, '16000000-0000-4000-8000-000000000001'::uuid, 'operator'),
  ('26000000-0000-4000-8000-000000000001'::uuid, '16000000-0000-4000-8000-000000000002'::uuid, 'viewer');

insert into public.memory_items (
  id, organization_id, memory_type, title, body, origin, verification_state, sensitivity, created_by
)
values (
  '46000000-0000-4000-8000-000000000001'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'lesson', 'Original lesson', 'The first version.', 'user_verified', 'unverified', 'internal',
  '16000000-0000-4000-8000-000000000001'::uuid
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

-- Exercises the function for real. A schema-qualification bug in the body only
-- surfaces on a call, never on creation.
select extensions.lives_ok(
  $$select public.supersede_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000001'::uuid,
      'Corrected lesson',
      'The corrected version.',
      'internal',
      'The original overstated the limit.',
      'supersede-key-1',
      '56000000-0000-4000-8000-000000000010'::uuid
    )$$,
  'supersede_memory_item runs end to end'
);

reset role;

select extensions.is(
  (
    select superseded_by_id is not null and superseded_at is not null
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000001'::uuid
  ),
  true,
  'the original item is marked superseded'
);

select extensions.is(
  (
    select embedding_status
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000001'::uuid
  ),
  'skipped',
  'a superseded item stops waiting for an embedding'
);

select extensions.is(
  (
    select count(*)
    from public.memory_items
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and title = 'Corrected lesson'
      and verification_state = 'verified'
  ),
  1::bigint,
  'the replacement is inserted and verified in the same transaction'
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select (public.supersede_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000001'::uuid,
      'Corrected lesson',
      'The corrected version.',
      'internal',
      'The original overstated the limit.',
      'supersede-key-1',
      '56000000-0000-4000-8000-000000000011'::uuid
    )) ->> 'supersededId'
  ),
  '46000000-0000-4000-8000-000000000001',
  'replaying the same idempotency key returns the first result without writing again'
);

select extensions.is(
  (
    select count(*)
    from public.memory_items
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and title = 'Corrected lesson'
  ),
  1::bigint,
  'the replay did not create a second replacement'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.supersede_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000002'::uuid,
      '46000000-0000-4000-8000-000000000001'::uuid,
      'Viewer correction', null, 'internal', 'not allowed', 'supersede-key-2',
      '56000000-0000-4000-8000-000000000012'::uuid
    )$$,
  '42501',
  null,
  'a viewer cannot supersede memory'
);

reset role;

-- A proposal must carry the evidence it was derived from.
select extensions.throws_ok(
  $$select public.create_proposed_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid, null, 'lesson', 'Unsupported claim',
      null, null, 'ai_proposed', 'internal', 0.5, null, array[]::uuid[], null, null, null
    )$$,
  '23514',
  null,
  'a proposal without evidence is rejected'
);

select extensions.throws_ok(
  $$select public.create_proposed_memory_item(
      '26000000-0000-4000-8000-000000000001'::uuid, null, 'lesson', 'Forged user memory',
      null, null, 'user_verified', 'internal', 0.5, null,
      array['46000000-0000-4000-8000-000000000001'::uuid], null, null, null
    )$$,
  '23514',
  null,
  'the proposal path refuses a non-model origin'
);

-- The function is called once into a temporary table first. Calling it inside a
-- WHERE clause would evaluate it per candidate row, so an empty table would
-- never run it at all and the assertion would pass vacuously.
create temporary table proposal_result as
select public.create_proposed_memory_item(
  '26000000-0000-4000-8000-000000000001'::uuid, null, 'lesson', 'Supported claim',
  'Derived from the original lesson.', null, 'ai_proposed', 'internal', 0.5, null,
  array['46000000-0000-4000-8000-000000000001'::uuid], null, null, null
) as item_id;

select extensions.is(
  (
    select count(*)
    from public.memory_links link
    join proposal_result on proposal_result.item_id = link.from_item_id
    where link.organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and link.relation = 'derived_from'
      and link.to_item_id = '46000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'a proposal is written together with its evidence link'
);

select extensions.is(
  (
    select verification_state
    from public.memory_items item
    join proposal_result on proposal_result.item_id = item.id
  ),
  'proposed',
  'a model-authored item can only enter as proposed'
);

-- Proposal confirmation and fact promotion ---------------------------------

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  proposed_fact_key, proposed_fact_value, proposed_branch_id
)
values (
  '46000000-0000-4000-8000-000000000010'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'fact_proposal', 'Proposed hours update', 'provider_imported', 'proposed', 'internal',
  'google_business_profile.location.hours', '"09:00-17:00"'::jsonb, null
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (select (public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000010'::uuid,
      false, 'promotion-key-1', '56000000-0000-4000-8000-000000000001'::uuid
    )) ->> 'replayed'),
  'false',
  'the first confirmation response marks its committed mutation as non-replayed'
);

reset role;

select extensions.is(
  (
    select status::text = 'verified'
      and value = '"09:00-17:00"'::jsonb
      and updated_by = '16000000-0000-4000-8000-000000000001'::uuid
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and branch_id is null
      and fact_key = 'google_business_profile.location.hours'
  ),
  true,
  'confirmation writes a verified authoritative fact with the confirming actor'
);

select extensions.is(
  (
    select verification_state = 'verified'
      and verified_by = '16000000-0000-4000-8000-000000000001'::uuid
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000010'::uuid
  ),
  true,
  'confirmation verifies the proposal in the same operation'
);

select extensions.is(
  (
    select payload ?& array['proposalId', 'factId', 'overrodeVerified', 'factChanged']
      and payload::text not like '%09:00-17:00%'
    from public.audit_events
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and event_name = 'memory.fact_promoted'
      and entity_id = (
        select id from public.business_facts
        where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
          and fact_key = 'google_business_profile.location.hours'
      )
  ),
  true,
  'fact promotion appends a safe transactional audit record'
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select (public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000010'::uuid,
      false, 'promotion-key-1', '56000000-0000-4000-8000-000000000002'::uuid
    )) ->> 'itemId'
  ),
  '46000000-0000-4000-8000-000000000010',
  'replaying a promotion returns the original safe response'
);

select extensions.is(
  (
    select (public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000010'::uuid,
      false, 'promotion-key-1', '56000000-0000-4000-8000-000000000002'::uuid
    )) ->> 'replayed'
  ),
  'true',
  'a promotion replay is explicitly marked so it cannot emit a new event'
);

reset role;

select extensions.is(
  (
    select count(*)
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and fact_key = 'google_business_profile.location.hours'
  ),
  1::bigint,
  'replaying a promotion does not write a second fact'
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  proposed_fact_key, proposed_fact_value
)
values (
  '46000000-0000-4000-8000-000000000011'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'fact_proposal', 'Forced rollback proposal', 'provider_imported', 'proposed', 'internal',
  'google_business_profile.location.address', '"A rollback address"'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';
select pg_catalog.set_config('app.memory_promotion_force_failure', 'true', true);

select extensions.throws_ok(
  $$select public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000011'::uuid,
      false, 'promotion-force-failure', '56000000-0000-4000-8000-000000000003'::uuid
    )$$,
  'P0001', null,
  'a forced promotion failure rolls back its transaction'
);
select pg_catalog.set_config('app.memory_promotion_force_failure', 'false', true);
reset role;

select extensions.is(
  (
    select count(*)
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and fact_key = 'google_business_profile.location.address'
  ),
  0::bigint,
  'promotion rolls back the fact and proposal together before writing the fact'
);

select extensions.is(
  (
    select verification_state
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000011'::uuid
  ),
  'proposed',
  'promotion rollback leaves the proposal pending'
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$select public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000002'::uuid,
      '46000000-0000-4000-8000-000000000011'::uuid,
      false, 'viewer-promotion-key', '56000000-0000-4000-8000-000000000004'::uuid
    )$$,
  '42501', null,
  'a viewer cannot promote a fact proposal'
);

reset role;

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values (
  '26000000-0000-4000-8000-000000000002'::uuid,
  'Other write tenant', 'other-write-tenant', 'testing', 'US', 'USD', 'UTC',
  '16000000-0000-4000-8000-000000000002'::uuid
);
insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  proposed_fact_key, proposed_fact_value
)
values (
  '46000000-0000-4000-8000-000000000012'::uuid,
  '26000000-0000-4000-8000-000000000002'::uuid,
  'fact_proposal', 'Other tenant proposal', 'provider_imported', 'proposed', 'internal',
  'google_business_profile.location.phone', '"555-0100"'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000012'::uuid,
      false, 'cross-tenant-promotion-key', '56000000-0000-4000-8000-000000000005'::uuid
    )$$,
  'P0002', null,
  'cannot promote another organization fact proposal'
);

reset role;

select extensions.is(
  (
    select count(*)
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000002'::uuid
      and fact_key = 'google_business_profile.location.phone'
  ),
  0::bigint,
  'a cross-tenant refusal cannot write the other organization fact'
);

insert into public.business_facts (
  organization_id, fact_key, value, source, status, created_by, updated_by, last_verified_at
)
values (
  '26000000-0000-4000-8000-000000000001'::uuid,
  'google_business_profile.location.phone', '"555-0000"'::jsonb, 'operator', 'verified',
  '16000000-0000-4000-8000-000000000001'::uuid,
  '16000000-0000-4000-8000-000000000001'::uuid, now()
);
insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  proposed_fact_key, proposed_fact_value
)
values (
  '46000000-0000-4000-8000-000000000013'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'fact_proposal', 'Conflicting verified phone', 'provider_imported', 'proposed', 'internal',
  'google_business_profile.location.phone', '"555-0100"'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000013'::uuid,
      false, 'verified-no-override-key', '56000000-0000-4000-8000-000000000006'::uuid
    )$$,
  '23505', null,
  'a verified fact cannot be replaced without an explicit override'
);

reset role;

select extensions.is(
  (
    select value
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and fact_key = 'google_business_profile.location.phone'
  ),
  '"555-0000"'::jsonb,
  'a rejected override attempt preserves the verified fact'
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$select public.confirm_memory_fact_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000013'::uuid,
      true, 'verified-override-key', '56000000-0000-4000-8000-000000000007'::uuid
    )$$,
  'an explicit override can replace a verified fact'
);

reset role;

select extensions.is(
  (
    select value
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and fact_key = 'google_business_profile.location.phone'
  ),
  '"555-0100"'::jsonb,
  'an explicit override writes the proposed verified value'
);

insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  proposed_fact_key, proposed_fact_value
)
values (
  '46000000-0000-4000-8000-000000000014'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'fact_proposal', 'Rejected proposal', 'provider_imported', 'proposed', 'internal',
  'google_business_profile.location.primary_category', '"bakery"'::jsonb
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (select (public.reject_memory_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000014'::uuid,
      'The source is stale.', 'rejection-key-1', '56000000-0000-4000-8000-000000000008'::uuid
    )) ->> 'replayed'),
  'false',
  'the first rejection response marks its committed mutation as non-replayed'
);

reset role;

select extensions.is(
  (
    select verification_state = 'rejected'
      and rejection_reason = 'The source is stale.'
      and embedding_status = 'skipped'
    from public.memory_items
    where id = '46000000-0000-4000-8000-000000000014'::uuid
  ),
  true,
  'a governed rejection records its required reason and stops embedding'
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (
    select (public.reject_memory_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000014'::uuid,
      'The source is stale.', 'rejection-key-1', '56000000-0000-4000-8000-000000000009'::uuid
    )) ->> 'itemId'
  ),
  '46000000-0000-4000-8000-000000000014',
  'replaying a rejection returns the original safe response'
);

select extensions.is(
  (
    select (public.reject_memory_proposal(
      '26000000-0000-4000-8000-000000000001'::uuid,
      '16000000-0000-4000-8000-000000000001'::uuid,
      '46000000-0000-4000-8000-000000000014'::uuid,
      'The source is stale.', 'rejection-key-1', '56000000-0000-4000-8000-000000000009'::uuid
    )) ->> 'replayed'
  ),
  'true',
  'a rejection replay is explicitly marked so it cannot emit a new event'
);

reset role;

select extensions.is(
  (
    select count(*)
    from public.business_facts
    where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
      and fact_key = 'google_business_profile.location.primary_category'
  ),
  0::bigint,
  'rejecting a proposal never writes business facts'
);

-- Authenticated item writes share the existing operation ledger with
-- supersession, so retries return the committed response without a new write.
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.is(
  (select (public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Authenticated note', 'Only once.', null, 'internal', true,
    null, null, 'authenticated-create-key', '56000000-0000-4000-8000-000000000013'::uuid
  )) ->> 'replayed'),
  'false',
  'the first authenticated memory create is not a replay'
);

select extensions.is(
  (select (public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Authenticated note', 'Only once.', null, 'internal', true,
    null, null, 'authenticated-create-key', '56000000-0000-4000-8000-000000000014'::uuid
  )) ->> 'replayed'),
  'true',
  'replaying an authenticated memory create does not duplicate the item'
);

select extensions.is(
  (select count(*) from public.memory_items where organization_id = '26000000-0000-4000-8000-000000000001'::uuid and title = 'Authenticated note'),
  1::bigint,
  'an authenticated create replay leaves one item'
);

select extensions.throws_ok(
  $$select public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Different authenticated note', null, null, 'internal', true,
    null, null, 'authenticated-create-key', '56000000-0000-4000-8000-000000000015'::uuid
  )$$,
  '23505', null,
  'a reused authenticated memory write key conflicts'
);

select extensions.lives_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    (select id from public.memory_items where title = 'Authenticated note'),
    'reclassify', null, 'internal', null, false, 'authenticated-update-key',
    '56000000-0000-4000-8000-000000000016'::uuid
  )$$,
  'the authenticated memory update RPC runs end to end'
);

select extensions.throws_ok(
  $$insert into public.memory_items (organization_id, memory_type, title, origin, sensitivity, verification_state, created_by)
    values ('26000000-0000-4000-8000-000000000001'::uuid, 'note', 'Bypass attempt', 'user_verified', 'internal', 'verified', '16000000-0000-4000-8000-000000000001'::uuid)$$,
  '42501', null,
  'direct REST cannot create a governed memory item'
);

reset role;

-- The generic authenticated PATCH RPC is intentionally not a proposal review
-- path: only the Task 10 confirmation/rejection RPCs may transition proposals.
insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity,
  proposed_fact_key, proposed_fact_value
)
values (
  '46000000-0000-4000-8000-000000000021'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'fact_proposal', 'Generic patch target', 'provider_imported', 'proposed', 'internal',
  'generic.patch.regression', '"never promoted"'::jsonb
);
insert into public.memory_items (
  id, organization_id, memory_type, title, origin, verification_state, sensitivity
)
values (
  '46000000-0000-4000-8000-000000000022'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Confidential UUID target', 'provider_imported', 'unverified', 'confidential'
), (
  '46000000-0000-4000-8000-000000000023'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Legacy supersede original', 'user_verified', 'unverified', 'internal'
), (
  '46000000-0000-4000-8000-000000000024'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Legacy supersede replacement', 'user_verified', 'unverified', 'internal'
), (
  '46000000-0000-4000-8000-000000000025'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Confidential supersede original', 'user_verified', 'unverified', 'confidential'
), (
  '46000000-0000-4000-8000-000000000026'::uuid,
  '26000000-0000-4000-8000-000000000001'::uuid,
  'note', 'Sensitive snapshot replay target', 'user_verified', 'unverified', 'internal'
);
insert into public.memory_write_operations (
  organization_id, idempotency_key, request_fingerprint, response
)
values (
  '26000000-0000-4000-8000-000000000001'::uuid,
  'legacy-supersede-key',
  pg_catalog.encode(extensions.digest(pg_catalog.concat_ws(
    '|', '46000000-0000-4000-8000-000000000023', 'Legacy correction', 'Legacy body', 'internal'
  ), 'sha256'), 'hex'),
  pg_catalog.jsonb_build_object(
    'fingerprint', pg_catalog.encode(extensions.digest(pg_catalog.concat_ws(
      '|', '46000000-0000-4000-8000-000000000023', 'Legacy correction', 'Legacy body', 'internal'
    ), 'sha256'), 'hex'),
    'replacementId', '46000000-0000-4000-8000-000000000024',
    'supersededId', '46000000-0000-4000-8000-000000000023'
  )
);

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000021'::uuid,
    'verify', null, null, null, false, 'generic-proposal-verify-key',
    '56000000-0000-4000-8000-000000000021'::uuid
  )$$,
  '23505', null,
  'generic PATCH cannot verify a fact proposal'
);

select extensions.throws_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000021'::uuid,
    'reject', 'Not through generic PATCH.', null, null, false, 'generic-proposal-reject-key',
    '56000000-0000-4000-8000-000000000022'::uuid
  )$$,
  '23505', null,
  'generic PATCH cannot reject a fact proposal'
);

select extensions.is(
  (select count(*) from public.business_facts where organization_id = '26000000-0000-4000-8000-000000000001'::uuid and fact_key = 'generic.patch.regression'),
  0::bigint,
  'generic proposal PATCH leaves business facts unchanged'
);

select extensions.throws_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000022'::uuid,
    'verify', null, 'internal', null, false, 'confidential-update-key',
    '56000000-0000-4000-8000-000000000023'::uuid
  )$$,
  '42501', null,
  'an operator cannot update a confidential item by UUID'
);

select extensions.throws_ok(
  $$select public.supersede_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000022'::uuid,
    'Unauthorized replacement', null, 'internal', 'Not authorized.', 'confidential-supersede-key',
    '56000000-0000-4000-8000-000000000024'::uuid
  )$$,
  '42501', null,
  'an operator cannot supersede a confidential item by UUID'
);

select extensions.is(
  (select (public.supersede_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000023'::uuid,
    'Legacy correction', 'Legacy body', 'internal', 'Legacy reason.', 'legacy-supersede-key',
    '56000000-0000-4000-8000-000000000025'::uuid
  )) ->> 'replayed'),
  'true',
  'legacy supersede RPC executes with extensions.digest; a matching legacy supersede operation replays safely'
);

select extensions.is(
  (select public.supersede_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000023'::uuid,
    'Legacy correction', 'Legacy body', 'internal', 'Legacy reason.', 'legacy-supersede-key',
    '56000000-0000-4000-8000-000000000026'::uuid
  ) ? 'fingerprint'),
  false,
  'legacy supersede replay does not expose its stored fingerprint'
);

select extensions.throws_ok(
  $$select public.supersede_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000023'::uuid,
    'Mismatched correction', 'Legacy body', 'internal', 'Legacy reason.', 'legacy-supersede-key',
    '56000000-0000-4000-8000-000000000027'::uuid
  )$$,
  '23505', null,
  'a mismatched legacy supersede request conflicts'
);

reset role;

-- Replays are tenant-keyed rather than actor-keyed, but they must still be
-- authorized against the current item sensitivity after an actor changes role.
update public.organization_memberships
set role = 'admin'
where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
  and user_id = '16000000-0000-4000-8000-000000000001'::uuid;
update public.organization_memberships
set role = 'operator'
where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
  and user_id = '16000000-0000-4000-8000-000000000002'::uuid;

set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$select public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Admin confidential replay target', null, null, 'confidential', true,
    null, null, 'admin-confidential-create-key', '56000000-0000-4000-8000-000000000028'::uuid
  )$$,
  'an admin can create a confidential replay target'
);

select extensions.lives_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000022'::uuid,
    'reclassify', null, 'confidential', null, false, 'admin-confidential-update-key',
    '56000000-0000-4000-8000-000000000029'::uuid
  )$$,
  'an admin can update a confidential replay target'
);

select extensions.lives_ok(
  $$select public.supersede_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000025'::uuid,
    'Admin confidential replacement', null, 'confidential', 'Admin correction.',
    'admin-confidential-supersede-key', '56000000-0000-4000-8000-000000000030'::uuid
  )$$,
  'an admin can supersede a confidential replay target'
);

select extensions.lives_ok(
  $$select public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Shared replay target', null, null, 'internal', true,
    null, null, 'same-org-shared-key', '56000000-0000-4000-8000-000000000031'::uuid
  )$$,
  'an admin can create an allowed same-org replay target'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000002';

select extensions.is(
  (select (public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000002'::uuid,
    'note', 'Shared replay target', null, null, 'internal', true,
    null, null, 'same-org-shared-key', '56000000-0000-4000-8000-000000000032'::uuid
  )) ->> 'replayed'),
  'true',
  'a same-org operator can replay an allowed known key'
);

reset role;
update public.organization_memberships
set role = 'operator'
where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
  and user_id = '16000000-0000-4000-8000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.create_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    'note', 'Admin confidential replay target', null, null, 'confidential', true,
    null, null, 'admin-confidential-create-key', '56000000-0000-4000-8000-000000000033'::uuid
  )$$,
  '42501', null,
  'an operator cannot replay an admin confidential create'
);

select extensions.throws_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000022'::uuid,
    'reclassify', null, 'confidential', null, false, 'admin-confidential-update-key',
    '56000000-0000-4000-8000-000000000034'::uuid
  )$$,
  '42501', null,
  'an operator cannot replay a confidential update'
);

select extensions.throws_ok(
  $$select public.supersede_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000025'::uuid,
    'Admin confidential replacement', null, 'confidential', 'Admin correction.',
    'admin-confidential-supersede-key', '56000000-0000-4000-8000-000000000035'::uuid
  )$$,
  '42501', null,
  'an operator cannot replay a confidential supersede'
);

reset role;

-- The saved update response itself can be more sensitive than the row is now.
-- Replay must inspect that immutable snapshot before returning it.
update public.organization_memberships
set role = 'admin'
where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
  and user_id = '16000000-0000-4000-8000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.lives_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000026'::uuid,
    'reclassify', null, 'confidential', null, false, 'confidential-snapshot-update-key',
    '56000000-0000-4000-8000-000000000036'::uuid
  )$$,
  'an admin can save a confidential update replay snapshot'
);

reset role;
update public.memory_items
set sensitivity = 'internal'
where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
  and id = '46000000-0000-4000-8000-000000000026'::uuid;
update public.organization_memberships
set role = 'operator'
where organization_id = '26000000-0000-4000-8000-000000000001'::uuid
  and user_id = '16000000-0000-4000-8000-000000000001'::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '16000000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$select public.update_authenticated_memory_item(
    '26000000-0000-4000-8000-000000000001'::uuid,
    '16000000-0000-4000-8000-000000000001'::uuid,
    '46000000-0000-4000-8000-000000000026'::uuid,
    'reclassify', null, 'confidential', null, false, 'confidential-snapshot-update-key',
    '56000000-0000-4000-8000-000000000037'::uuid
  )$$,
  '42501', null,
  'an operator cannot replay a confidential update snapshot after the row is lowered'
);

reset role;

select * from extensions.finish();

rollback;
