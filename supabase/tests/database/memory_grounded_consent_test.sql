begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(43);

-- Consent-gated grounded share (Spec 024). Tables start empty, so every
-- organization defaults to internal-only until an owner/admin grant plus a
-- current Google qualification both exist. Everything privileged is exercised
-- as real sessions because the point is who may disclose what to a third
-- party: identity from the session, never from an argument.

-- Structure ------------------------------------------------------------------

select extensions.has_table('public', 'grounded_share_consents', 'consent is database-owned');
select extensions.has_table('public', 'grounded_share_qualifications', 'so is qualification');
select extensions.has_function('public', 'grant_grounded_share_consent', 'grant is database-owned');
select extensions.has_function('public', 'revoke_grounded_share_consent', 'so is revoke');
select extensions.has_function('public', 'record_grounded_share_qualification', 'so is qualification');
select extensions.has_function('public', 'grounded_share_status', 'and the safe status read');

select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.grant_grounded_share_consent(uuid,uuid,text,text,uuid)', 'execute'), 'members hold the grant path');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.revoke_grounded_share_consent(uuid,uuid,uuid,text,uuid)', 'execute'), 'and the revoke path');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.record_grounded_share_qualification(uuid,uuid,text,text,text,timestamptz,text,uuid)', 'execute'), 'and the qualification path');
select extensions.ok(pg_catalog.has_function_privilege('authenticated', 'public.grounded_share_status(uuid)', 'execute'), 'and the status read');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.grant_grounded_share_consent(uuid,uuid,text,text,uuid)', 'execute'), 'anonymous callers hold no grant');
select extensions.ok(not pg_catalog.has_function_privilege('anon', 'public.grounded_share_status(uuid)', 'execute'), 'nor the status read');
select extensions.ok(pg_catalog.has_function_privilege('service_role', 'public.grounded_share_status(uuid)', 'execute'), 'the worker holds the status read');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.grant_grounded_share_consent(uuid,uuid,text,text,uuid)', 'execute'), 'but never grants on anyone''s behalf');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.revoke_grounded_share_consent(uuid,uuid,uuid,text,uuid)', 'execute'), 'nor revokes');
select extensions.ok(not pg_catalog.has_function_privilege('service_role', 'public.record_grounded_share_qualification(uuid,uuid,text,text,text,timestamptz,text,uuid)', 'execute'), 'nor records qualifications');

select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'grounded_share_consents'), 'consent rows are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'grounded_share_consents'), 'even from the table owner');
select extensions.ok((select relrowsecurity from pg_catalog.pg_class where relname = 'grounded_share_qualifications'), 'qualification rows are RLS-protected');
select extensions.ok((select relforcerowsecurity from pg_catalog.pg_class where relname = 'grounded_share_qualifications'), 'even from the table owner');
select extensions.ok(exists (select 1 from pg_catalog.pg_indexes where indexname = 'grounded_share_consents_one_active'), 'one active grant per organization');
select extensions.ok(exists (select 1 from pg_catalog.pg_indexes where indexname = 'grounded_share_qualifications_one_current'), 'one current qualification per organization');

-- Fixtures --------------------------------------------------------------------

insert into auth.users (id) values
  ('fb330000-0000-4000-8000-000000000001'::uuid),
  ('fb330000-0000-4000-8000-000000000002'::uuid),
  ('fb330000-0000-4000-8000-000000000003'::uuid),
  ('fb330000-0000-4000-8000-000000000004'::uuid);
insert into public.accounts (id, name, slug, created_by) values
  ('fb330000-0000-4000-8000-000000000101'::uuid, 'Share verifier', 'share-verifier', 'fb330000-0000-4000-8000-000000000001'::uuid),
  ('fb330000-0000-4000-8000-000000000102'::uuid, 'Share outsider', 'share-outsider', 'fb330000-0000-4000-8000-000000000002'::uuid);
insert into public.organizations (id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by) values
  ('fb330000-0000-4000-8000-000000000201'::uuid, 'fb330000-0000-4000-8000-000000000101'::uuid, 'Share verifier', 'share-verifier', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb330000-0000-4000-8000-000000000001'::uuid),
  ('fb330000-0000-4000-8000-000000000202'::uuid, 'fb330000-0000-4000-8000-000000000102'::uuid, 'Share outsider', 'share-outsider', 'testing', 'AE', 'AED', 'Asia/Dubai', 'fb330000-0000-4000-8000-000000000002'::uuid);
insert into public.account_memberships (account_id, user_id, account_role, default_organization_role) values
  ('fb330000-0000-4000-8000-000000000101'::uuid, 'fb330000-0000-4000-8000-000000000001'::uuid, 'owner', 'owner'),
  ('fb330000-0000-4000-8000-000000000102'::uuid, 'fb330000-0000-4000-8000-000000000002'::uuid, 'owner', 'owner');
insert into public.organization_memberships (organization_id, user_id, role) values
  ('fb330000-0000-4000-8000-000000000201'::uuid, 'fb330000-0000-4000-8000-000000000003'::uuid, 'viewer'),
  ('fb330000-0000-4000-8000-000000000201'::uuid, 'fb330000-0000-4000-8000-000000000004'::uuid, 'operator');

-- Role gates -------------------------------------------------------------------

reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'fb330000-0000-4000-8000-000000000004';

select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000004', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-op-key', 'fb330000-0000-4000-8000-000000000901') $$,
  '42501', 'grounded share consent is not authorized', 'an operator cannot opt an organization into third-party sharing');

set local request.jwt.claim.sub = 'fb330000-0000-4000-8000-000000000003';

select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000003', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-viewer-key', 'fb330000-0000-4000-8000-000000000902') $$,
  '42501', 'grounded share consent is not authorized', 'a viewer cannot either');

set local request.jwt.claim.sub = 'fb330000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000002', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-outsider-key', 'fb330000-0000-4000-8000-000000000903') $$,
  '42501', 'grounded share consent is not authorized', 'another organization''s owner cannot opt this one in');

set local request.jwt.claim.sub = 'fb330000-0000-4000-8000-000000000001';

select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', 'not-a-hash', 'share-bad-hash-key', 'fb330000-0000-4000-8000-000000000904') $$,
  '23514', 'grounded share consent input is invalid', 'a malformed wording hash is refused before any authorization');

-- Grant, replay, conflicts -------------------------------------------------------

select extensions.is(
  (select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-first-key', 'fb330000-0000-4000-8000-000000000905') ->> 'status'),
  'granted', 'the owner''s grant lands');
select extensions.is(
  (select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-first-key', 'fb330000-0000-4000-8000-000000000905') ->> 'replayed'),
  'true', 'repeating the same grant replays instead of duplicating');
select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'share-first-key', 'fb330000-0000-4000-8000-000000000906') $$,
  '23505', 'grounded share consent is already granted', 'the same key with different content is a conflict, not a replay');
select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-second-key', 'fb330000-0000-4000-8000-000000000907') $$,
  '23505', 'grounded share consent is already granted', 'a second active grant is refused while one stands');

-- Status before qualification ------------------------------------------------------

select extensions.is(
  (select public.grounded_share_status('fb330000-0000-4000-8000-000000000201') ->> 'shareActive'),
  'false', 'consent alone never activates sharing');
select extensions.is(
  (select public.grounded_share_status('fb330000-0000-4000-8000-000000000201') ->> 'consentGranted'),
  'true', 'but the granted consent is visible');

-- Qualification ----------------------------------------------------------------------

select extensions.is(
  (select public.record_grounded_share_qualification('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', 'gemini-2.5-flash', 'google-terms-2026-03-23', 'grounding-with-google-search:storage-exception', now() + interval '90 days', null, 'fb330000-0000-4000-8000-000000000908') ->> 'status'),
  'current', 'the owner records a current Google qualification');
select extensions.is(
  (select public.grounded_share_status('fb330000-0000-4000-8000-000000000201') ->> 'shareActive'),
  'true', 'consent plus current qualification activates sharing');

select set_config('app.test_consent_1', (select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-first-key', 'fb330000-0000-4000-8000-000000000905') ->> 'consentId'), true);

-- Revoke -------------------------------------------------------------------------------

select extensions.is(
  (select public.revoke_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', current_setting('app.test_consent_1')::uuid, null, 'fb330000-0000-4000-8000-000000000909') ->> 'status'),
  'revoked', 'revocation lands');
select extensions.is(
  (select public.grounded_share_status('fb330000-0000-4000-8000-000000000201') ->> 'shareActive'),
  'false', 'revocation stops sharing immediately');
select extensions.is(
  (select public.revoke_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', current_setting('app.test_consent_1')::uuid, null, 'fb330000-0000-4000-8000-000000000910') ->> 'replayed'),
  'true', 'repeating a revocation replays');
select extensions.is(
  (select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-third-key', 'fb330000-0000-4000-8000-000000000911') ->> 'status'),
  'granted', 'a fresh grant after revocation works');
select extensions.throws_ok(
  $$ select public.record_grounded_share_qualification('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', 'gemini-2.5-flash', 'google-terms-2026-03-23', 'grounding-with-google-search:storage-exception', now() - interval '1 day', null, 'fb330000-0000-4000-8000-000000000912') $$,
  '23514', 'grounded share qualification input is invalid', 'an already-expired qualification is refused');

-- Tenant isolation ---------------------------------------------------------------------

select extensions.throws_ok(
  $$ insert into public.grounded_share_consents (organization_id, wording_hash, actor_id, status, idempotency_key, request_fingerprint) values ('fb330000-0000-4000-8000-000000000201', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'fb330000-0000-4000-8000-000000000001', 'granted', 'direct-write-key', 'fp') $$,
  '42501', 'permission denied for table grounded_share_consents', 'no browser session writes consent rows directly');

set local request.jwt.claim.sub = 'fb330000-0000-4000-8000-000000000002';

select extensions.throws_ok(
  $$ select public.grounded_share_status('fb330000-0000-4000-8000-000000000201') $$,
  '42501', 'grounded share status is not authorized', 'another organization''s member reads none of this status');

reset role;
set local role anon;

select extensions.throws_ok(
  $$ select public.grant_grounded_share_consent('fb330000-0000-4000-8000-000000000201', 'fb330000-0000-4000-8000-000000000001', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'share-anon-key', 'fb330000-0000-4000-8000-000000000913') $$,
  '42501', 'permission denied for function grant_grounded_share_consent', 'anonymous callers hold no grant path');

reset role;
set local role service_role;

select extensions.is(
  (select public.grounded_share_status('fb330000-0000-4000-8000-000000000201') ->> 'shareActive'),
  'true', 'the worker reads active share state for its own run scope');

select * from extensions.finish();

rollback;
