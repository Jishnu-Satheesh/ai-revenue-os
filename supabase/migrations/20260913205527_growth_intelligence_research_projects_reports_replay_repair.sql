-- Repair: idempotent-replay identity exclusion for growth-intelligence RPCs.
-- The base migration 20260913202720 was already applied to shared staging
-- before this fix, so the fix ships here as a forward migration instead of
-- editing the applied file. Replay comparisons now exclude the
-- per-call minted identity keys (document.revisionId, content.reportId);
-- every other line matches the applied versions.

create or replace function public.save_brief_revision(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_revision_number integer,
  p_document jsonb,
  p_pinned_to_update_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.growth_intelligence_brief_revisions;
  saved public.growth_intelligence_brief_revisions;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'brief_revision_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_project_id is null
    or p_revision_number is null
    or p_revision_number < 1
    or p_document is null then
    raise exception 'brief_revision_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.growth_intelligence_research_projects project
    where project.organization_id = p_organization_id
      and project.id = p_project_id
  ) then
    raise exception 'research_project_not_found' using errcode = '42501';
  end if;

  perform private.assert_brief_revision_document(p_document);
  -- The document carries its own tenant binding; a document naming another
  -- organization or project is refused, never re-scoped.
  if pg_catalog.lower(p_document ->> 'organizationId') is distinct from pg_catalog.lower(p_organization_id::text)
    or pg_catalog.lower(p_document ->> 'projectId') is distinct from pg_catalog.lower(p_project_id::text)
    or (p_document ->> 'revisionNumber')::numeric is distinct from p_revision_number then
    raise exception 'brief_revision_context_mismatch' using errcode = '42501';
  end if;
  if p_pinned_to_update_id is not null
    and pg_catalog.lower(p_document ->> 'pinnedToUpdateId') is distinct from pg_catalog.lower(p_pinned_to_update_id::text) then
    raise exception 'brief_revision_context_mismatch' using errcode = '42501';
  end if;
  if p_pinned_to_update_id is null
    and pg_catalog.jsonb_typeof(p_document -> 'pinnedToUpdateId') <> 'null' then
    raise exception 'brief_revision_context_mismatch' using errcode = '42501';
  end if;

  -- One serialized save per organization, project and revision number, so a
  -- retried request converges instead of doubling the revision.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'save_brief_revision',
      p_organization_id, p_project_id, p_revision_number
    ),
    0
  ));

  select revision.* into existing
  from public.growth_intelligence_brief_revisions revision
  where revision.organization_id = p_organization_id
    and revision.project_id = p_project_id
    and revision.revision_number = p_revision_number
  for update;
  if found then
    -- A pinned revision can never be edited afterwards: even a byte-identical
    -- rewrite is refused so history entries keep opening exactly what ran.
    if existing.pinned_to_update_id is not null then
      raise exception 'brief_revision_pinned' using errcode = '23505';
    end if;
    if (existing.document - 'revisionId') = (p_document - 'revisionId') then
      return pg_catalog.jsonb_build_object(
        'revisionId', existing.id,
        'projectId', existing.project_id,
        'revisionNumber', existing.revision_number,
        'replayed', true
      );
    end if;
    raise exception 'brief_revision_conflict' using errcode = '23505';
  end if;

  insert into public.growth_intelligence_brief_revisions (
    organization_id, project_id, revision_number, document,
    pinned_to_update_id, created_by
  ) values (
    p_organization_id, p_project_id, p_revision_number, p_document,
    p_pinned_to_update_id, p_actor_id
  ) returning * into saved;

  return pg_catalog.jsonb_build_object(
    'revisionId', saved.id,
    'projectId', saved.project_id,
    'revisionNumber', saved.revision_number,
    'replayed', false
  );
end;
$$;

create or replace function public.persist_report_version(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_branch_id uuid,
  p_brief_revision_id uuid,
  p_report_version_id uuid,
  p_evidence_digest text,
  p_content jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_row public.growth_intelligence_brief_revisions;
  existing public.growth_intelligence_reports;
  saved public.growth_intelligence_reports;
  draft_entry jsonb;
  draft_count integer := 0;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'monitoring_report_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_project_id is null
    or p_branch_id is null
    or p_brief_revision_id is null
    or p_report_version_id is null
    or p_evidence_digest is null
    or p_content is null then
    raise exception 'monitoring_report_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.growth_intelligence_research_projects project
    where project.organization_id = p_organization_id
      and project.id = p_project_id
  ) then
    raise exception 'research_project_not_found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id
      and branch.id = p_branch_id
  ) then
    raise exception 'monitoring_report_scope_not_found' using errcode = '42501';
  end if;
  select revision.* into revision_row
  from public.growth_intelligence_brief_revisions revision
  where revision.organization_id = p_organization_id
    and revision.id = p_brief_revision_id;
  if not found then
    raise exception 'brief_revision_not_found' using errcode = '42501';
  end if;
  -- The brief revision belongs to the same project: a report can never pin a
  -- revision that ran for another project, even in the same organization.
  if revision_row.project_id is distinct from p_project_id then
    raise exception 'monitoring_report_context_mismatch' using errcode = '42501';
  end if;

  perform private.assert_market_monitoring_report_content(p_content);
  -- The content carries its own pinned identity; every pin must name the
  -- exact project, branch, brief revision and report version it persists.
  if pg_catalog.lower(p_content ->> 'organizationId') is distinct from pg_catalog.lower(p_organization_id::text)
    or pg_catalog.lower(p_content ->> 'projectId') is distinct from pg_catalog.lower(p_project_id::text)
    or pg_catalog.lower(p_content ->> 'locationId') is distinct from pg_catalog.lower(p_branch_id::text)
    or pg_catalog.lower(p_content ->> 'briefRevisionId') is distinct from pg_catalog.lower(p_brief_revision_id::text)
    or pg_catalog.lower(p_content ->> 'reportVersionId') is distinct from pg_catalog.lower(p_report_version_id::text)
    or p_content ->> 'evidenceDigest' is distinct from p_evidence_digest then
    raise exception 'monitoring_report_context_mismatch' using errcode = '42501';
  end if;

  -- One serialized persist per report version: synthesis retries converge on
  -- the kept version instead of doubling content rows and draft items.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'persist_report_version',
      p_organization_id, p_report_version_id
    ),
    0
  ));

  select report.* into existing
  from public.growth_intelligence_reports report
  where report.organization_id = p_organization_id
    and report.report_version_id = p_report_version_id
  for update;
  if found then
    if existing.evidence_digest is distinct from p_evidence_digest
      or (existing.content - 'reportId') is distinct from (p_content - 'reportId') then
      raise exception 'monitoring_report_version_conflict' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object(
      'reportId', existing.id,
      'reportVersionId', existing.report_version_id,
      'reviewState', existing.review_state,
      'replayed', true
    );
  end if;

  insert into public.growth_intelligence_reports (
    organization_id, project_id, branch_id, brief_revision_id,
    report_version_id, evidence_digest, content, created_by
  ) values (
    p_organization_id, p_project_id, p_branch_id, p_brief_revision_id,
    p_report_version_id, p_evidence_digest, p_content, p_actor_id
  ) returning * into saved;

  for draft_entry in
    select value
    from pg_catalog.jsonb_array_elements(
      coalesce(p_content -> 'draftAdvice', '[]'::jsonb)
    )
  loop
    insert into public.growth_intelligence_draft_items (
      organization_id, report_version_id, item_key, kind, title, detail
    ) values (
      p_organization_id,
      p_report_version_id,
      draft_entry ->> 'itemKey',
      draft_entry ->> 'kind',
      draft_entry ->> 'title',
      draft_entry ->> 'detail'
    );
    draft_count := draft_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'reportId', saved.id,
    'reportVersionId', saved.report_version_id,
    'reviewState', saved.review_state,
    'draftItemCount', draft_count,
    'replayed', false
  );
end;
$$;
