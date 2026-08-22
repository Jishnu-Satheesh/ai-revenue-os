begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

select extensions.has_table('public', 'organization_channels', 'organization-owned channels exist');
select extensions.has_table('public', 'organization_channel_branches', 'channel branch mappings exist');
select extensions.has_table('public', 'channel_source_aliases', 'channel source aliases exist');
select extensions.has_trigger('public', 'organization_channels', 'organization_channels_audit', 'channel identity writes are audited');
select extensions.has_trigger('public', 'organization_channel_branches', 'organization_channel_branches_audit', 'channel branch mappings are audited');
select extensions.has_trigger('public', 'channel_source_aliases', 'channel_source_aliases_audit', 'channel aliases are audited');
select extensions.has_column('public', 'normalized_metrics', 'channel_id', 'metrics retain channel identity');
select extensions.has_column('public', 'channel_economics_entries', 'channel_id', 'economics retain channel identity');
select extensions.has_column('public', 'cost_component_rates', 'channel_id', 'cost rates retain channel identity');
select extensions.is(
  (select tgenabled::text from pg_trigger where tgname = 'normalized_metrics_prevent_mutation'),
  'O',
  'the append-only metric guard is enabled after structural channel backfill'
);
select extensions.is(
  private.normalize_channel_alias('Talabat  UAE'),
  'talabat uae',
  'channel alias normalization collapses incidental whitespace'
);

insert into auth.users (id)
values
  ('cc000000-0000-4000-8000-000000000001'::uuid),
  ('cc000000-0000-4000-8000-000000000002'::uuid),
  ('cc000000-0000-4000-8000-000000000003'::uuid);

insert into public.accounts (id, name, slug, created_by)
values
  ('cc000000-0000-4000-8000-000000000101'::uuid, 'Channel test agency A', 'channel-test-agency-a', 'cc000000-0000-4000-8000-000000000001'::uuid),
  ('cc000000-0000-4000-8000-000000000102'::uuid, 'Channel test agency B', 'channel-test-agency-b', 'cc000000-0000-4000-8000-000000000003'::uuid);

insert into public.organizations (
  id, account_id, name, slug, industry, country_code, base_currency, default_timezone, created_by
)
values
  ('cc000000-0000-4000-8000-000000000201'::uuid, 'cc000000-0000-4000-8000-000000000101'::uuid, 'Channel test organization A', 'channel-test-organization-a', 'testing', 'AE', 'AED', 'Asia/Dubai', 'cc000000-0000-4000-8000-000000000001'::uuid),
  ('cc000000-0000-4000-8000-000000000202'::uuid, 'cc000000-0000-4000-8000-000000000102'::uuid, 'Channel test organization B', 'channel-test-organization-b', 'testing', 'AE', 'AED', 'Asia/Dubai', 'cc000000-0000-4000-8000-000000000003'::uuid);

insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
values
  ('cc000000-0000-4000-8000-000000000301'::uuid, 'cc000000-0000-4000-8000-000000000201'::uuid, 'Branch A', 'channel-test-branch-a', 'physical', 'Asia/Dubai', 'AED'),
  ('cc000000-0000-4000-8000-000000000302'::uuid, 'cc000000-0000-4000-8000-000000000202'::uuid, 'Branch B', 'channel-test-branch-b', 'physical', 'Asia/Dubai', 'AED');

insert into public.organization_channels (id, organization_id, key, display_name, category, created_by)
values (
  'cc000000-0000-4000-8000-000000000401'::uuid,
  'cc000000-0000-4000-8000-000000000201'::uuid,
  'talabat',
  'Talabat',
  'marketplace',
  'cc000000-0000-4000-8000-000000000001'::uuid
);

select extensions.throws_ok(
  $$
    insert into public.organization_channels (organization_id, key, display_name, category, created_by)
    values (
      'cc000000-0000-4000-8000-000000000201'::uuid,
      'talabat', 'Talabat duplicate', 'marketplace', 'cc000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23505', null,
  'a stable channel key is unique inside its organization'
);

select extensions.throws_ok(
  $$
    update public.organization_channels
    set key = 'talabat-renamed'
    where id = 'cc000000-0000-4000-8000-000000000401'::uuid
  $$,
  '23514', null,
  'a channel key remains immutable after creation'
);

select extensions.lives_ok(
  $$
    insert into public.channel_economics_entries (
      organization_id, grain, channel, period_start, period_end, period_timezone,
      gross_revenue_minor, transaction_count, currency, margin_source,
      completeness_grade, contribution_margin_minor
    )
    values (
      'cc000000-0000-4000-8000-000000000201'::uuid, 'period', 'Talabat',
      timestamptz '2026-01-01 00:00+00', timestamptz '2026-01-02 00:00+00', 'Asia/Dubai',
      1000, 1, 'AED', 'derived', 'complete', 500
    )
  $$,
  'a legacy-label economics write remains valid while the compatibility path is enabled'
);

select extensions.is(
  (
    select channel_label_snapshot
    from public.channel_economics_entries
    where organization_id = 'cc000000-0000-4000-8000-000000000201'::uuid
      and channel = 'Talabat'
  ),
  'Talabat',
  'a new legacy-label write captures an immutable source snapshot'
);

select extensions.lives_ok(
  $$
    insert into public.organization_channel_branches (organization_id, channel_id, branch_id, created_by)
    values (
      'cc000000-0000-4000-8000-000000000201'::uuid,
      'cc000000-0000-4000-8000-000000000401'::uuid,
      'cc000000-0000-4000-8000-000000000301'::uuid,
      'cc000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  'a channel can be mapped to one of its organization branches'
);

select extensions.throws_ok(
  $$
    insert into public.organization_channel_branches (organization_id, channel_id, branch_id, created_by)
    values (
      'cc000000-0000-4000-8000-000000000201'::uuid,
      'cc000000-0000-4000-8000-000000000401'::uuid,
      'cc000000-0000-4000-8000-000000000302'::uuid,
      'cc000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23503', null,
  'a channel cannot map to another organization branch'
);

insert into public.channel_source_aliases (
  organization_id, channel_id, alias, normalized_alias, source_scope, created_by
)
values (
  'cc000000-0000-4000-8000-000000000201'::uuid,
  'cc000000-0000-4000-8000-000000000401'::uuid,
  'Talabat UAE', 'talabat uae', 'manual', 'cc000000-0000-4000-8000-000000000001'::uuid
);

select extensions.throws_ok(
  $$
    insert into public.channel_source_aliases (
      organization_id, channel_id, alias, normalized_alias, source_scope, created_by
    )
    values (
      'cc000000-0000-4000-8000-000000000201'::uuid,
      'cc000000-0000-4000-8000-000000000401'::uuid,
      'Talabat  UAE', 'talabat uae', 'manual', 'cc000000-0000-4000-8000-000000000001'::uuid
    )
  $$,
  '23505', null,
  'an active normalized alias is unique within its source scope'
);

select extensions.throws_ok(
  $$
    delete from public.organization_channels
    where id = 'cc000000-0000-4000-8000-000000000401'::uuid
  $$,
  '55000', null,
  'channels are archived rather than hard-deleted'
);

insert into public.account_memberships (account_id, user_id, account_role, default_organization_role)
values
  ('cc000000-0000-4000-8000-000000000101'::uuid, 'cc000000-0000-4000-8000-000000000001'::uuid, 'owner', null),
  ('cc000000-0000-4000-8000-000000000101'::uuid, 'cc000000-0000-4000-8000-000000000002'::uuid, 'member', 'operator');

set local role authenticated;
set local request.jwt.claim.sub = 'cc000000-0000-4000-8000-000000000002';

select extensions.ok(
  private.has_organization_permission('cc000000-0000-4000-8000-000000000201'::uuid, 'channel.read'),
  'an operator can read organization channels'
);
select extensions.ok(
  private.has_organization_permission('cc000000-0000-4000-8000-000000000201'::uuid, 'report.upload'),
  'an operator can upload a governed report package'
);
select extensions.ok(
  not private.has_organization_permission('cc000000-0000-4000-8000-000000000201'::uuid, 'channel.manage'),
  'an operator cannot create, rename, archive, or restore a channel'
);
select extensions.ok(
  not private.has_organization_permission('cc000000-0000-4000-8000-000000000201'::uuid, 'report.contract_approve'),
  'an operator cannot approve financial contract semantics'
);

select extensions.lives_ok(
  $$
    update public.organization_channel_branches
    set status = 'inactive'
    where organization_id = 'cc000000-0000-4000-8000-000000000201'::uuid
      and channel_id = 'cc000000-0000-4000-8000-000000000401'::uuid
      and branch_id = 'cc000000-0000-4000-8000-000000000301'::uuid
  $$,
  'an operator can retain a historical branch mapping as inactive'
);

select extensions.is(
  (
    select status
    from public.organization_channel_branches
    where organization_id = 'cc000000-0000-4000-8000-000000000201'::uuid
      and channel_id = 'cc000000-0000-4000-8000-000000000401'::uuid
      and branch_id = 'cc000000-0000-4000-8000-000000000301'::uuid
  ),
  'inactive',
  'the inactive branch mapping remains visible to its organization'
);

select extensions.lives_ok(
  $$
    insert into public.channel_source_aliases (
      organization_id, channel_id, alias, normalized_alias, source_scope, created_by
    )
    values (
      'cc000000-0000-4000-8000-000000000201'::uuid,
      'cc000000-0000-4000-8000-000000000401'::uuid,
      'Talabat Operator Label', 'talabat operator label', 'manual',
      'cc000000-0000-4000-8000-000000000002'::uuid
    )
  $$,
  'an operator can create a source alias that satisfies the normalizer check'
);

select * from extensions.finish();

rollback;
