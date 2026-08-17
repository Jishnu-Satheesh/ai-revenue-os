-- What the Studio may honestly say about whether a channel can run.
--
-- The Tool Gateway decides this for real, inside a transaction that locks the
-- rows it reads and reserves money before it answers. A review screen cannot
-- call that: claiming an action to find out whether it could be claimed would
-- burn an attempt and leave a lease on work nobody asked for.
--
-- So this reads the same rows and returns the same refusal codes, and does
-- nothing else. No lock, no reservation, no write, no side effect of any kind.
-- Its whole purpose is to be safe to call every time a page renders.
--
-- SECURITY INVOKER on purpose. Every table below already carries a
-- members-only select policy, so the caller's own row level security decides
-- what they may see. A definer function would have had to re-implement that
-- membership check by hand, and a hand-written check is exactly how one tenant
-- ends up reading another tenant's connection state.
--
-- What it deliberately does NOT decide:
--
--   * tracking readiness and consent, which the worker asserts at send time
--     from state this schema does not hold;
--   * whether the approval covers the action, which is the approval envelope's
--     question and is already answered elsewhere on the screen.
--
-- Credential health is decided only as far as the connection row can prove it:
-- a revoked, disconnected or expired connection is genuinely unusable, and
-- anything subtler is re-checked at execution. The panel says so rather than
-- implying a clean bill of health it did not earn.

create or replace function public.campaign_version_channel_readiness(
  target_organization_id uuid,
  target_bundle_version_id uuid,
  input_channel_capabilities jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with channels as (
    select
      action.channel,
      pg_catalog.count(*) as action_count,
      pg_catalog.min(action.scheduled_for) as first_scheduled_for,
      pg_catalog.bool_or(action.requirement = 'required') as any_required
    from public.campaign_channel_actions action
    where action.organization_id = target_organization_id
      and action.bundle_version_id = target_bundle_version_id
    group by action.channel
  ),
  approval as (
    select scoped.capability_grant_versions
    from public.campaign_approvals scoped
    where scoped.organization_id = target_organization_id
      and scoped.bundle_version_id = target_bundle_version_id
      and scoped.revoked_at is null
    limit 1
  ),
  resolved as (
    select
      channels.channel,
      channels.action_count,
      channels.first_scheduled_for,
      channels.any_required,
      input_channel_capabilities ->> channels.channel as capability_key,
      grant_row.id as grant_id,
      grant_row.availability,
      grant_row.restriction_codes,
      grant_row.grant_version,
      connection.status as connection_status,
      connection.token_expires_at,
      connection.external_account_label,
      (
        select pg_catalog.count(*)
        from public.integration_account_mappings mapping
        where mapping.organization_id = target_organization_id
          and mapping.connection_id = grant_row.connection_id
          and mapping.status = 'mapped'
      ) as mapped_accounts,
      (select capability_grant_versions from approval) as approved_grant_versions
    from channels
    left join public.integration_capability_grants grant_row
      on grant_row.organization_id = target_organization_id
     and grant_row.capability_key = input_channel_capabilities ->> channels.channel
    left join public.integration_connections connection
      on connection.organization_id = target_organization_id
     and connection.id = grant_row.connection_id
  ),
  judged as (
    select
      resolved.*,
      (
        -- Built in the order an operator would work through them: is there a
        -- grant at all, is it usable, is it still the grant that was approved,
        -- is the connection alive, is an account actually chosen.
        case when resolved.capability_key is null
          then array['capability_not_registered']::text[] else '{}'::text[] end
        || case when resolved.capability_key is not null and resolved.grant_id is null
          then array['capability_not_granted']::text[] else '{}'::text[] end
        || case when resolved.grant_id is not null and resolved.availability <> 'available'
          then array['capability_not_granted']::text[] else '{}'::text[] end
        || case
             when resolved.grant_id is not null
              and pg_catalog.cardinality(resolved.restriction_codes) > 0
             then array['capability_restricted']::text[] else '{}'::text[] end
        || case
             when resolved.grant_id is not null
              and resolved.approved_grant_versions ? resolved.capability_key
              and (resolved.approved_grant_versions ->> resolved.capability_key)
                  is distinct from resolved.grant_version::text
             then array['capability_grant_changed']::text[] else '{}'::text[] end
        || case
             when resolved.grant_id is not null
              and (
                resolved.connection_status is null
                or resolved.connection_status in ('revoked', 'disconnected', 'pending')
                or (
                  resolved.token_expires_at is not null
                  and resolved.token_expires_at <= pg_catalog.now()
                )
              )
             then array['credential_unhealthy']::text[] else '{}'::text[] end
        || case
             when resolved.grant_id is not null and resolved.mapped_accounts = 0
             then array['account_not_mapped']::text[] else '{}'::text[] end
      ) as codes
    from resolved
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'channel', judged.channel,
        'capabilityKey', judged.capability_key,
        'actionCount', judged.action_count,
        'anyRequired', judged.any_required,
        'firstScheduledFor', judged.first_scheduled_for,
        'accountLabel', judged.external_account_label,
        'restrictionCodes', pg_catalog.to_jsonb(
          coalesce(judged.restriction_codes, '{}'::text[])
        ),
        'verdict', case
          when pg_catalog.cardinality(judged.codes) = 0 then 'ready' else 'blocked'
        end,
        'codes', pg_catalog.to_jsonb(judged.codes)
      )
      order by judged.channel
    ),
    '[]'::jsonb
  )
  from judged;
$$;

comment on function public.campaign_version_channel_readiness(uuid, uuid, jsonb) is
  'Read-only per-channel execution readiness for one bundle version. Never claims, locks, reserves, or writes.';

revoke all on function public.campaign_version_channel_readiness(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.campaign_version_channel_readiness(uuid, uuid, jsonb)
  to authenticated, service_role;
