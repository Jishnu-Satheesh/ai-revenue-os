begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(26);

-- Two-tenant fixture. Every assertion below is about one tenant being unable to
-- see, consume, or influence the other's credential and handshake state.
insert into auth.users (id) values
  ('a0000000-0000-4000-8000-000000000001'::uuid),
  ('a0000000-0000-4000-8000-000000000002'::uuid),
  ('a0000000-0000-4000-8000-000000000003'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, but this
-- suite grants no account membership, so access still resolves purely from
-- the organization_memberships rows below -- exactly as it did before
-- accounts existed.
insert into public.accounts (id, name, slug, created_by)
values ('acc00000-0000-4000-8000-2a4117c36173'::uuid, 'Fixture agency', 'fixture-agency-integration-oauth-sessions-test', 'a0000000-0000-4000-8000-000000000001'::uuid);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
)
values
  ('b0000000-0000-4000-8000-000000000001', 'Oauth tenant one', 'oauth-tenant-one', 'testing', 'US', 'USD', 'UTC', 'a0000000-0000-4000-8000-000000000001',
    'acc00000-0000-4000-8000-2a4117c36173'::uuid),
  ('b0000000-0000-4000-8000-000000000002', 'Oauth tenant two', 'oauth-tenant-two', 'testing', 'US', 'USD', 'UTC', 'a0000000-0000-4000-8000-000000000002',
    'acc00000-0000-4000-8000-2a4117c36173'::uuid);

insert into public.organization_memberships (organization_id, user_id, role)
values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'owner'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'owner'),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'viewer');

-- ---------------------------------------------------------------------------
-- Table exposure
-- ---------------------------------------------------------------------------

select extensions.ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.integration_oauth_sessions', 'select'),
  'authenticated cannot read oauth sessions directly'
);
select extensions.ok(
  not pg_catalog.has_table_privilege('anon', 'public.integration_oauth_sessions', 'select'),
  'anon cannot read oauth sessions directly'
);
-- `authenticated` holds usage on the `private` schema because tenancy helpers
-- such as `private.has_organization_role` are granted to it. The protection
-- that matters is that the credential table itself is unreachable.
select extensions.ok(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.integration_credentials', 'select'
  ),
  'authenticated cannot read the credential table'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_integration_credential(uuid, text, text, uuid, text)',
    'execute'
  ),
  'authenticated cannot mint a credential'
);
select extensions.ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.resolve_integration_credential(uuid, text, uuid, uuid)',
    'execute'
  ),
  'authenticated cannot decrypt a credential'
);
select extensions.is(
  (select relrowsecurity and relforcerowsecurity
   from pg_catalog.pg_class where oid = 'public.integration_oauth_sessions'::regclass),
  true,
  'oauth sessions have forced row level security'
);

-- ---------------------------------------------------------------------------
-- Session creation is role gated
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}';

select extensions.throws_ok(
  $$select public.start_integration_oauth_session(
      'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider',
      repeat('a', 64), array['read_profile'], 'https://app.example.com/cb',
      'c0000000-0000-4000-8000-000000000001'::uuid, 600)$$,
  '42501',
  'not authorized to start an oauth session',
  'a viewer cannot start an oauth handshake'
);

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select extensions.throws_ok(
  $$select public.start_integration_oauth_session(
      'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider',
      repeat('b', 64), array['read_profile'], 'https://app.example.com/cb',
      'c0000000-0000-4000-8000-000000000001'::uuid, 600)$$,
  '42501',
  'not authorized to start an oauth session',
  'another tenant owner cannot start a handshake for tenant A'
);

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select extensions.throws_ok(
  $$select public.start_integration_oauth_session(
      'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider',
      repeat('c', 64), array['read_profile'], 'https://app.example.com/cb',
      'c0000000-0000-4000-8000-000000000001'::uuid, 30)$$,
  '23514',
  'oauth session ttl is out of range',
  'a session cannot be opened with an out-of-range lifetime'
);

select extensions.lives_ok(
  $$select public.start_integration_oauth_session(
      'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider',
      repeat('d', 64), array['read_profile'], 'https://app.example.com/cb',
      'c0000000-0000-4000-8000-000000000001'::uuid, 600)$$,
  'an owner can start an oauth handshake'
);

-- Direct table reads must run as an owner role: `authenticated` deliberately
-- holds no grant on this table, which is asserted above.
set local role postgres;

select extensions.is(
  (select count(*)::int from public.integration_oauth_sessions
   where state_digest = repeat('d', 64)),
  1,
  'exactly one session row exists for the digest'
);

select extensions.is(
  (select user_id from public.integration_oauth_sessions where state_digest = repeat('d', 64)),
  'a0000000-0000-4000-8000-000000000001'::uuid,
  'the session is bound to the user who started it'
);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Consumption is single use and re-checks the actor
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated"}';
select extensions.is(
  (select count(*)::int from public.consume_integration_oauth_session(
     repeat('d', 64), 'fake_provider', 'c0000000-0000-4000-8000-000000000002'::uuid)),
  0,
  'a different user cannot consume the session'
);

set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select extensions.is(
  (select count(*)::int from public.consume_integration_oauth_session(
     repeat('d', 64), 'other_provider', 'c0000000-0000-4000-8000-000000000002'::uuid)),
  0,
  'a session cannot be consumed under a different provider'
);

select extensions.is(
  (select organization_id from public.consume_integration_oauth_session(
     repeat('d', 64), 'fake_provider', 'c0000000-0000-4000-8000-000000000002'::uuid)),
  'b0000000-0000-4000-8000-000000000001'::uuid,
  'the starting user consumes the session exactly once'
);

select extensions.is(
  (select count(*)::int from public.consume_integration_oauth_session(
     repeat('d', 64), 'fake_provider', 'c0000000-0000-4000-8000-000000000002'::uuid)),
  0,
  'replaying the same redirect returns nothing'
);

set local role postgres;
select extensions.isnt(
  (select consumed_at from public.integration_oauth_sessions where state_digest = repeat('d', 64)),
  null,
  'the consumed session is marked'
);
set local role authenticated;

-- An expired session is never consumable. The row is seeded already-expired
-- because `expires_at` is immutable once written, which the identity trigger
-- enforces and the assertions below prove.
set local role postgres;
insert into public.integration_oauth_sessions (
  organization_id, user_id, provider_key, state_digest, requested_scopes,
  callback_url, correlation_id, created_at, expires_at
) values (
  'b0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'fake_provider',
  repeat('e', 64),
  array['read_profile'],
  'https://app.example.com/cb',
  'c0000000-0000-4000-8000-000000000003',
  pg_catalog.now() - interval '10 minutes',
  pg_catalog.now() - interval '1 minute'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}';
select extensions.is(
  (select count(*)::int from public.consume_integration_oauth_session(
     repeat('e', 64), 'fake_provider', 'c0000000-0000-4000-8000-000000000004'::uuid)),
  0,
  'an expired session cannot be consumed'
);

-- ---------------------------------------------------------------------------
-- Session immutability
-- ---------------------------------------------------------------------------

set local role postgres;
select extensions.throws_ok(
  $$update public.integration_oauth_sessions
    set organization_id = 'b0000000-0000-4000-8000-000000000002'
    where state_digest = repeat('e', 64)$$,
  '23514',
  'integration oauth session identity is immutable',
  'a session cannot be re-pointed at another tenant'
);

-- A distinctly later timestamp is required here: `now()` is fixed for the whole
-- transaction, so reusing it would write the identical value and prove nothing.
select extensions.throws_ok(
  $$update public.integration_oauth_sessions
    set consumed_at = pg_catalog.now() + interval '1 hour'
    where state_digest = repeat('d', 64)$$,
  '23514',
  'integration oauth session is already consumed',
  'a consumed session cannot be re-consumed by direct write'
);

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

select extensions.is(
  public.create_integration_credential(
    'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider', 'secret-value',
    'c0000000-0000-4000-8000-000000000005'::uuid, 'connect-1'),
  public.create_integration_credential(
    'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider', 'secret-value',
    'c0000000-0000-4000-8000-000000000005'::uuid, 'connect-1'),
  'a repeated create with the same idempotency key returns the same reference'
);

select extensions.is(
  (select count(*)::int from private.integration_credentials
   where organization_id = 'b0000000-0000-4000-8000-000000000001'
     and idempotency_key = 'connect-1'),
  1,
  'the retried create left exactly one credential behind'
);

select extensions.is(
  public.resolve_integration_credential(
    'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider',
    (select id from private.integration_credentials where idempotency_key = 'connect-1'),
    'c0000000-0000-4000-8000-000000000006'::uuid),
  'secret-value',
  'the owning organization resolves its own credential'
);

select extensions.throws_ok(
  format(
    $$select public.resolve_integration_credential(
        'b0000000-0000-4000-8000-000000000002'::uuid, 'fake_provider', %L::uuid,
        'c0000000-0000-4000-8000-000000000007'::uuid)$$,
    (select id from private.integration_credentials where idempotency_key = 'connect-1')
  ),
  'P0002',
  'credential not found',
  'another tenant cannot resolve the credential by reference'
);

select extensions.lives_ok(
  format(
    $$select public.revoke_integration_credential(
        'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider', %L::uuid,
        'c0000000-0000-4000-8000-000000000008'::uuid);
      select public.revoke_integration_credential(
        'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider', %L::uuid,
        'c0000000-0000-4000-8000-000000000009'::uuid)$$,
    (select id from private.integration_credentials where idempotency_key = 'connect-1'),
    (select id from private.integration_credentials where idempotency_key = 'connect-1')
  ),
  'revoking twice is safe'
);

select extensions.throws_ok(
  format(
    $$select public.resolve_integration_credential(
        'b0000000-0000-4000-8000-000000000001'::uuid, 'fake_provider', %L::uuid,
        'c0000000-0000-4000-8000-00000000000a'::uuid)$$,
    (select id from private.integration_credentials where idempotency_key = 'connect-1')
  ),
  'P0002',
  'credential not found',
  'a revoked credential can no longer be resolved'
);

select * from extensions.finish();

rollback;
