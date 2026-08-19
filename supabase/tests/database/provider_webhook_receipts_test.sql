begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

insert into auth.users (id) values ('7c000000-0000-4000-8000-000000000001'::uuid);

-- Inert account fixture: organizations.account_id is NOT NULL, and nothing
-- below is about account scoping.
insert into public.accounts (id, name, slug, created_by)
values (
  '7c000000-0000-4000-8000-000000000301'::uuid,
  'Webhook account', 'webhook-account',
  '7c000000-0000-4000-8000-000000000001'::uuid
);

insert into public.organizations (
  id, name, slug, industry, country_code, base_currency, default_timezone, created_by, account_id
) values (
  '7c000000-0000-4000-8000-000000000101'::uuid,
  'Webhook tenant', 'webhook-tenant', 'testing', 'AE', 'AED', 'Asia/Dubai',
  '7c000000-0000-4000-8000-000000000001'::uuid,
  '7c000000-0000-4000-8000-000000000301'::uuid
);

-- Nobody reaches this table through a session -------------------------------

select extensions.ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.provider_webhook_receipts'::regclass),
  'inbound webhook receipts enable and force row level security'
);

select extensions.table_privs_are(
  'public', 'provider_webhook_receipts', 'authenticated', array[]::text[],
  'a member session cannot read another tenant''s delivery metadata'
);

select extensions.table_privs_are(
  'public', 'provider_webhook_receipts', 'anon', array[]::text[],
  'anonymous callers cannot reach webhook receipts at all'
);

select extensions.function_privs_are(
  'public', 'record_provider_webhook_receipt', array['jsonb'], 'authenticated', array[]::text[],
  'only the worker role may record a delivery'
);

-- The replay guard is the table, not the application ------------------------

select extensions.is(
  (public.record_provider_webhook_receipt(
    pg_catalog.jsonb_build_object(
      'provider_key', 'meta_campaign',
      'organization_id', '7c000000-0000-4000-8000-000000000101',
      'connection_id', '7c000000-0000-4000-8000-000000000201',
      'event_key', 'delivery-one',
      'body_sha256', pg_catalog.repeat('a', 64),
      'event_type', 'instagram.mentions',
      'status', 'accepted'
    )
  ) ->> 'outcome'),
  'recorded',
  'a first delivery is recorded'
);

select extensions.is(
  (public.record_provider_webhook_receipt(
    pg_catalog.jsonb_build_object(
      'provider_key', 'meta_campaign',
      'organization_id', '7c000000-0000-4000-8000-000000000101',
      'connection_id', '7c000000-0000-4000-8000-000000000201',
      'event_key', 'delivery-one',
      'body_sha256', pg_catalog.repeat('a', 64),
      'event_type', 'instagram.mentions',
      'status', 'accepted'
    )
  ) ->> 'outcome'),
  'replayed',
  'the same delivery a second time is a replay, not a second acceptance'
);

select extensions.is(
  (select pg_catalog.count(*)::integer from public.provider_webhook_receipts
   where event_key = 'delivery-one'),
  1,
  'a replayed delivery leaves exactly one row'
);

-- A quarantined delivery has no tenant, and an accepted one must ------------

select extensions.lives_ok(
  $$ select public.record_provider_webhook_receipt(
       pg_catalog.jsonb_build_object(
         'provider_key', 'meta_campaign',
         'event_key', 'unmapped-delivery',
         'body_sha256', pg_catalog.repeat('b', 64),
         'event_type', 'instagram.mentions',
         'status', 'quarantined_unknown_account',
         'quarantine_reason', 'unknown_account'
       )
     ) $$,
  'a verified delivery nothing maps to is kept rather than dropped'
);

select extensions.throws_ok(
  $$ insert into public.provider_webhook_receipts
       (provider_key, event_key, body_sha256, event_type, status)
     values ('meta_campaign', 'tenantless', repeat('c', 64), 'instagram.mentions', 'accepted') $$,
  '23514',
  null,
  'an accepted delivery with no tenant is refused, because nothing could act on it'
);

select extensions.throws_ok(
  $$ insert into public.provider_webhook_receipts
       (provider_key, organization_id, event_key, body_sha256, event_type, status, quarantine_reason)
     values (
       'meta_campaign', '7c000000-0000-4000-8000-000000000101'::uuid, 'both',
       repeat('d', 64), 'instagram.mentions', 'quarantined_unknown_account', 'unknown_account'
     ) $$,
  '23514',
  null,
  'a quarantined delivery may not carry a tenant it was never mapped to'
);

select extensions.throws_ok(
  $$ insert into public.provider_webhook_receipts
       (provider_key, organization_id, event_key, body_sha256, event_type, status)
     values (
       'meta_campaign', '7c000000-0000-4000-8000-000000000101'::uuid, 'bad-digest',
       'not-a-digest', 'instagram.mentions', 'accepted'
     ) $$,
  '23514',
  null,
  'a body digest that is not SHA-256 hex is refused'
);

select * from extensions.finish();
rollback;
