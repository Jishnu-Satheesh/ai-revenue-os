-- Inbound provider webhooks, recorded before anything acts on them.
--
-- Two jobs. It is the replay guard: a provider that retries a delivery, or an
-- attacker replaying a captured one, must not cause the work twice. And it is
-- the quarantine: a payload that verified but cannot be mapped to exactly one
-- organization is kept for an operator to look at rather than dropped, because
-- silently discarding a genuine provider event loses real state.
--
-- Rows are written by the webhook route under the service role. No browser
-- session reaches this table: an organization member has no business reading
-- another tenant's delivery metadata, and quarantined rows have no tenant yet.

create table public.provider_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null check (char_length(provider_key) between 1 and 60),

  -- Null until the payload is mapped. A quarantined delivery has no tenant,
  -- which is exactly why it cannot be exposed through a tenant-scoped policy.
  organization_id uuid references public.organizations(id) on delete cascade,
  connection_id uuid,

  -- The provider's own event identity, used for deduplication. Providers do
  -- not all supply one, so a digest of the verified body is the fallback.
  event_key text not null check (char_length(event_key) between 1 and 200),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),

  event_type text not null check (char_length(event_type) between 1 and 120),

  -- Ordering metadata. Providers deliver out of order, so an older event must
  -- not overwrite a newer one downstream.
  provider_sent_at timestamptz,
  received_at timestamptz not null default now(),

  status text not null default 'accepted' check (
    status in ('accepted', 'quarantined_unknown_account', 'quarantined_unknown_event', 'processed')
  ),
  -- Stable code only. A provider message can echo content back.
  quarantine_reason text check (
    quarantine_reason is null or char_length(quarantine_reason) between 1 and 80
  ),

  processed_at timestamptz,

  -- A verified duplicate is the same delivery, so the pair is unique. This is
  -- the replay guard itself rather than a check the application performs.
  unique (provider_key, event_key),

  check ((status = 'processed') = (processed_at is not null)),
  check (
    (status like 'quarantined%') = (quarantine_reason is not null)
  ),
  -- A quarantined row has no tenant; an accepted one must have one, or nothing
  -- downstream could tell whose event it is.
  check (
    (status like 'quarantined%' and organization_id is null)
    or (status not like 'quarantined%' and organization_id is not null)
  )
);

create index provider_webhook_receipts_org_idx
  on public.provider_webhook_receipts (organization_id, received_at desc);
create index provider_webhook_receipts_quarantine_idx
  on public.provider_webhook_receipts (status, received_at desc)
  where status like 'quarantined%';

alter table public.provider_webhook_receipts enable row level security;
alter table public.provider_webhook_receipts force row level security;

revoke all on public.provider_webhook_receipts from anon, authenticated;

comment on table public.provider_webhook_receipts is
  'Inbound provider deliveries. Written by the webhook route under the service role; unique (provider_key, event_key) is the replay guard. No tenant-scoped read policy exists because quarantined rows have no tenant.';

-- Record a verified delivery, or report that it is a replay ---------------
--
-- The insert and the duplicate check are the same statement, so two concurrent
-- deliveries of the same event cannot both pass a prior existence check.
create function public.record_provider_webhook_receipt(
  input_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
begin
  insert into public.provider_webhook_receipts (
    provider_key, organization_id, connection_id, event_key, body_sha256,
    event_type, provider_sent_at, status, quarantine_reason
  ) values (
    input_receipt ->> 'provider_key',
    (input_receipt ->> 'organization_id')::uuid,
    (input_receipt ->> 'connection_id')::uuid,
    input_receipt ->> 'event_key',
    input_receipt ->> 'body_sha256',
    input_receipt ->> 'event_type',
    (input_receipt ->> 'provider_sent_at')::timestamptz,
    coalesce(input_receipt ->> 'status', 'accepted'),
    input_receipt ->> 'quarantine_reason'
  )
  on conflict (provider_key, event_key) do nothing
  returning id into saved_id;

  if saved_id is null then
    -- Already delivered. Not an error: providers retry by design, and the
    -- honest answer is that this work was already accepted.
    return pg_catalog.jsonb_build_object('outcome', 'replayed');
  end if;

  return pg_catalog.jsonb_build_object('outcome', 'recorded', 'receipt_id', saved_id);
end;
$$;

revoke all on function public.record_provider_webhook_receipt(jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_webhook_receipt(jsonb) to service_role;
