-- Time-based content redaction for capture projection documents (Spec 023 §14).
--
-- Rights-driven erasure (withdrawal, expiry-of-rights, retention blocks) rides
-- the existing erase path event by event. This RPC covers the other axis:
-- age. A projection document older than its source's retain_until, or older
-- than 90 days when no stricter date was stored, is redacted to the empty
-- document. Identifiers, digests, revisions, links, and statuses survive, so
-- lineage and replay identity are intact; only the stored copy of the source
-- text goes. Fresh rows, future retain_until rows, and already-empty rows are
-- untouched. Bounded per call; the daily schedule pages organizations, not
-- the whole table at once.
--
-- v_ prefixes every plpgsql local; empty search_path; bare coalesce (syntax,
-- never schema-qualified). Worker-only: authenticated sessions read
-- provenance through member RLS, never through this redactor.

create function public.redact_expired_capture_documents(
  p_organization_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_redacted integer;
begin
  if p_organization_id is null then
    raise exception 'capture retention sweep input is invalid' using errcode = '22023';
  end if;

  v_limit := p_limit;
  if v_limit is null or v_limit < 1 then
    raise exception 'capture retention sweep input is invalid' using errcode = '22023';
  end if;
  if v_limit > 100 then
    v_limit := 100;
  end if;

  with due as (
    select expired_event.id
    from public.memory_capture_events expired_event
    where expired_event.organization_id = p_organization_id
      and expired_event.projection_document is distinct from '{}'::jsonb
      and (
        (
          expired_event.retain_until is not null
          and expired_event.retain_until <= pg_catalog.now()
        )
        or (
          expired_event.retain_until is null
          and expired_event.created_at <= pg_catalog.now() - pg_catalog.make_interval(days => 90)
        )
      )
    order by expired_event.created_at asc
    limit v_limit
    for update skip locked
  )
  update public.memory_capture_events redacted_event
  set projection_document = '{}'::jsonb
  from due
  where redacted_event.id = due.id;

  get diagnostics v_redacted = row_count;

  return pg_catalog.jsonb_build_object(
    'organizationId', p_organization_id,
    'redacted', v_redacted
  );
end;
$$;

revoke all on function public.redact_expired_capture_documents(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.redact_expired_capture_documents(uuid, integer)
  to service_role;
