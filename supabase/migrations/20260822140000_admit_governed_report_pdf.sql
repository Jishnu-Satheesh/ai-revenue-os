-- Admit machine-generated PDF as a governed report source.
--
-- ADR 0028 reverses the blanket PDF exclusion: the pilot client's offline
-- profit and loss is the only source of food cost and packaging and exists only
-- as PDF, and it is a wkhtmltopdf-rendered table with an intact text layer, so
-- extraction is deterministic and carries the same lineage guarantee a
-- spreadsheet does. Scans stay refused, in the worker, where the absence of a
-- text layer is a typed failure.
--
-- Nothing about an existing package changes. This widens three accepted values
-- and adds one MIME type; every constraint, policy, trigger, lease, and audit
-- path is untouched. Forward-only.

alter table public.integration_report_packages
  drop constraint integration_report_packages_file_kind_check,
  add constraint integration_report_packages_file_kind_check
    check (file_kind in ('csv', 'xlsx', 'pdf'));

-- The object path names the format, so it widens with it.
alter table public.integration_report_packages
  drop constraint integration_report_packages_storage_path_check,
  add constraint integration_report_packages_storage_path_check
    check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/1/original/report\.(csv|xlsx|pdf)$');

update storage.buckets
set allowed_mime_types = array[
  'text/csv',
  'application/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf'
]::text[]
where id = 'governed-report-packages';

-- Redefined only to accept the third file kind and its MIME type. The body is
-- otherwise byte-for-byte the one shipped in 20260820150246.
create or replace function public.start_governed_report_package_upload(
  p_organization_id uuid,
  p_actor_id uuid,
  p_channel_id uuid,
  p_branch_id uuid,
  p_report_type text,
  p_period_start date,
  p_period_end date,
  p_currency text,
  p_file_kind text,
  p_original_filename text,
  p_content_type text,
  p_content_length bigint,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.integration_report_write_operations;
  created public.integration_report_packages;
  fingerprint text;
  timezone_name text;
  has_mappings boolean;
  created_id uuid := pg_catalog.gen_random_uuid();
begin
  if (select auth.uid()) <> p_actor_id
    or not private.has_organization_permission(p_organization_id, 'report.upload') then
    raise exception 'report upload is not authorized' using errcode = '42501';
  end if;
  if p_period_end < p_period_start
    or p_content_length <= 0 or p_content_length > 52428800
    or p_file_kind not in ('csv', 'xlsx', 'pdf')
    or p_currency !~ '^[A-Z]{3}$'
    or char_length(p_report_type) not between 2 and 120
    or char_length(p_original_filename) not between 1 and 255
    or char_length(p_idempotency_key) not between 16 and 200 then
    raise exception 'report upload context is invalid' using errcode = '22023';
  end if;
  if (p_file_kind = 'csv' and p_content_type not in ('text/csv', 'application/csv'))
    or (p_file_kind = 'xlsx' and p_content_type <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    or (p_file_kind = 'pdf' and p_content_type <> 'application/pdf') then
    raise exception 'report upload file type is invalid' using errcode = '22023';
  end if;

  select o.default_timezone into timezone_name from public.organizations o where o.id = p_organization_id;
  if timezone_name is null then raise exception 'organization was not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.organization_channels c where c.organization_id = p_organization_id and c.id = p_channel_id and c.status = 'active') then
    raise exception 'channel was not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.branches b where b.organization_id = p_organization_id and b.id = p_branch_id and b.is_active) then
    raise exception 'branch was not found' using errcode = 'P0002';
  end if;
  select exists(
    select 1 from public.organization_channel_branches m
    where m.organization_id = p_organization_id and m.channel_id = p_channel_id and m.status = 'active'
  ) into has_mappings;
  if has_mappings and not exists (
    select 1 from public.organization_channel_branches m
    where m.organization_id = p_organization_id and m.channel_id = p_channel_id and m.branch_id = p_branch_id
      and m.status = 'active'
      and (m.effective_from is null or m.effective_from <= p_period_start)
      and (m.effective_to is null or m.effective_to >= p_period_end)
  ) then
    raise exception 'channel is not applicable to this branch for the declared period' using errcode = '23514';
  end if;

  fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', p_channel_id, p_branch_id, p_report_type, p_period_start, p_period_end, p_currency, p_file_kind, p_original_filename, p_content_type, p_content_length),
    'sha256'
  ), 'hex');
  select * into existing from private.integration_report_write_operations
  where organization_id = p_organization_id and operation_kind = 'upload_intent' and idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing.fingerprint <> fingerprint then raise exception 'idempotency key conflicts with another upload' using errcode = '23505'; end if;
    select * into created from public.integration_report_packages where organization_id = p_organization_id and id = existing.report_package_id;
    return pg_catalog.to_jsonb(created);
  end if;

  insert into public.integration_report_packages (
    id, organization_id, channel_id, branch_id, report_type, declared_period_start, declared_period_end, declared_currency,
    period_timezone, file_kind, original_filename, declared_content_type, declared_content_length, storage_path,
    upload_expires_at, created_by, correlation_id
  ) values (
    created_id, p_organization_id, p_channel_id, p_branch_id, p_report_type, p_period_start, p_period_end, p_currency,
    timezone_name, p_file_kind, p_original_filename, p_content_type, p_content_length,
    p_organization_id::text || '/' || p_channel_id::text || '/' || created_id::text || '/1/original/report.' || p_file_kind,
    now() + interval '2 hours', p_actor_id, p_correlation_id
  ) returning * into created;
  insert into private.integration_report_write_operations (
    organization_id, operation_kind, idempotency_key, fingerprint, report_package_id
  ) values (p_organization_id, 'upload_intent', p_idempotency_key, fingerprint, created.id);
  return pg_catalog.to_jsonb(created);
end;
$$;


revoke all on function public.start_governed_report_package_upload(uuid, uuid, uuid, uuid, text, date, date, text, text, text, text, bigint, text, uuid) from public, anon;
grant execute on function public.start_governed_report_package_upload(uuid, uuid, uuid, uuid, text, date, date, text, text, text, text, bigint, text, uuid) to authenticated;
