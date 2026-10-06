-- Slice 2: research projects, brief revisions, reports, draft items, acceptances.
--
-- Persistence and tenant boundaries for the Market Monitoring
-- research-and-report experience. Five org-scoped tables with composite
-- tenant foreign keys, explicit least-privilege grants and forced RLS:
--
-- 1. growth_intelligence_research_projects is the independent lifecycle
--    envelope at one location: title, question, mode (one-time | recurring),
--    a recurring-only schedule document, and lifecycle
--    (active | paused | archived). The branch anchor follows the same
--    composite (organization_id, branch_id) approach as
--    organization_market_profiles, so a project can never point at another
--    tenant's branch. Identity (org, branch, mode) is immutable; lifecycle,
--    title, question and schedule stay writable. Deletes are forbidden so
--    archived history stays readable.
-- 2. growth_intelligence_brief_revisions is append-only: one immutable
--    document per (project, revision number), validated by a Postgres
--    allowlist mirroring briefRevisionSchema key-for-key. A revision pinned
--    to an update can never be edited afterwards.
-- 3. growth_intelligence_reports pins project, branch, brief revision and
--    evidence identity per report version. Content is validated by a
--    Postgres allowlist mirroring marketMonitoringReportSchema key-for-key
--    (a partial estimate block is refused at the DB layer too). Content rows
--    are immutable once written; only the review_state may move, and only
--    from pending_review to accepted.
-- 4. growth_intelligence_draft_items carries the report version's reviewable
--    advice units, unique per (report version, item key), append-only.
-- 5. growth_intelligence_acceptances records explicit acceptance per
--    (organization, acceptance key) where the key is exactly
--    report_version_id:item_key. Replay-safe: inserting a kept key returns
--    the kept row; a kind mismatch on the same key is a conflict error,
--    never a silent overwrite. grants_execution_approval is always false.
--
-- Four fenced RPCs (fixed search_path, explicit grants, tenant checks
-- inside): create_research_project, save_brief_revision (refuses edits to
-- pinned revisions), persist_report_version, accept_draft_item (idempotent
-- per key). Reads go through forced RLS SELECT policies; no session role
-- holds any write grant. No list RPC exists: bounded reads use the partial
-- and tenant-leading indexes below with caller-side limits.

-- Schedule validator ----------------------------------------------------------
--
-- Mirrors researchProjectScheduleSchema key-for-key: cadence, local time,
-- IANA timezone and an optional real calendar end date. Recurring-only is
-- enforced by the table check below; this function validates the document
-- shape. Timezone existence is checked against pg_timezone_names, the same
-- authority the v1/v2 cadence validators use.

create function private.assert_research_project_schedule(
  p_schedule jsonb
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  schedule_end_date text;
begin
  if p_schedule is null then
    raise exception 'research_project_schedule_invalid' using errcode = '22023';
  end if;
  if not private.jsonb_object_has_exact_keys(
    p_schedule,
    case when p_schedule ? 'endDate'
      then array['cadence', 'localTime', 'timeZone', 'endDate']::text[]
      else array['cadence', 'localTime', 'timeZone']::text[] end
  )
  or p_schedule ->> 'cadence' not in ('daily', 'weekly', 'monthly')
  or pg_catalog.jsonb_typeof(p_schedule -> 'localTime') <> 'string'
  or coalesce(p_schedule ->> 'localTime', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  or pg_catalog.jsonb_typeof(p_schedule -> 'timeZone') <> 'string'
  or pg_catalog.char_length(coalesce(p_schedule ->> 'timeZone', '')) not between 1 and 100
  or not exists (
    select 1 from pg_catalog.pg_timezone_names zone
    where zone.name = p_schedule ->> 'timeZone'
  ) then
    raise exception 'research_project_schedule_invalid' using errcode = '22023';
  end if;

  if p_schedule ? 'endDate' then
    if pg_catalog.jsonb_typeof(p_schedule -> 'endDate') <> 'string'
      or coalesce(p_schedule ->> 'endDate', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      or pg_catalog.to_char(
        pg_catalog.to_date(p_schedule ->> 'endDate', 'YYYY-MM-DD'),
        'YYYY-MM-DD'
      ) is distinct from p_schedule ->> 'endDate' then
      raise exception 'research_project_schedule_invalid' using errcode = '22023';
    end if;
  end if;
end;
$$;

revoke all on function private.assert_research_project_schedule(jsonb)
  from public, anon, authenticated, service_role;

-- Brief revision document validator -------------------------------------------
--
-- Mirrors briefRevisionSchema key-for-key: exact top-level keys with optional
-- title/eventDate, uuid bindings, trimmed text bounds, a real calendar event
-- date, at most 20 competitors with public http(s) websites and
-- suggestion/operator_lead provenance, 1-5 unique investigation areas, at
-- most 12 evidence periods with ordered dates, and case-insensitive
-- uniqueness for competitor names and period labels. Zod trims text before
-- checking it, so the application sends trimmed values and this validator
-- requires the trimmed form, exactly like the v1/v2 profile validators.

create function private.assert_brief_revision_document(
  p_document jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  brief_expected_keys text[] := array[
    'revisionId', 'projectId', 'organizationId', 'revisionNumber', 'question',
    'locationId', 'researchArea', 'competitors', 'investigationAreas',
    'evidencePeriods', 'businessContextSnapshotId', 'frequency',
    'pinnedToUpdateId', 'createdAtUtc'
  ]::text[];
  brief_competitor jsonb;
  brief_competitor_expected text[];
  brief_period jsonb;
  brief_period_expected text[];
  brief_item text;
  brief_timestamp text;
begin
  if p_document is null then
    raise exception 'brief_revision_document_invalid' using errcode = '22023';
  end if;
  if p_document ? 'title' then
    brief_expected_keys := brief_expected_keys || 'title'::text;
  end if;
  if p_document ? 'eventDate' then
    brief_expected_keys := brief_expected_keys || 'eventDate'::text;
  end if;

  if not private.jsonb_object_has_exact_keys(p_document, brief_expected_keys)
    or pg_catalog.jsonb_typeof(p_document -> 'revisionId') <> 'string'
    or coalesce(p_document ->> 'revisionId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_document -> 'projectId') <> 'string'
    or coalesce(p_document ->> 'projectId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_document -> 'organizationId') <> 'string'
    or coalesce(p_document ->> 'organizationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_document -> 'locationId') <> 'string'
    or coalesce(p_document ->> 'locationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_document -> 'businessContextSnapshotId') <> 'string'
    or coalesce(p_document ->> 'businessContextSnapshotId', '') !~ '^[0-9a-fA-F-]{36}$'
    or (
      pg_catalog.jsonb_typeof(p_document -> 'pinnedToUpdateId') <> 'null'
      and (
        pg_catalog.jsonb_typeof(p_document -> 'pinnedToUpdateId') <> 'string'
        or coalesce(p_document ->> 'pinnedToUpdateId', '') !~ '^[0-9a-fA-F-]{36}$'
      )
    )
    or pg_catalog.jsonb_typeof(p_document -> 'revisionNumber') <> 'number'
    or (p_document ->> 'revisionNumber')::numeric
      <> pg_catalog.trunc((p_document ->> 'revisionNumber')::numeric)
    or (p_document ->> 'revisionNumber')::numeric < 1
    or pg_catalog.jsonb_typeof(p_document -> 'question') <> 'string'
    or p_document ->> 'question' is distinct from pg_catalog.btrim(p_document ->> 'question')
    or pg_catalog.char_length(coalesce(p_document ->> 'question', '')) not between 1 and 2000
    or pg_catalog.jsonb_typeof(p_document -> 'researchArea') <> 'string'
    or p_document ->> 'researchArea' is distinct from pg_catalog.btrim(p_document ->> 'researchArea')
    or pg_catalog.char_length(coalesce(p_document ->> 'researchArea', '')) not between 1 and 160
    or p_document ->> 'frequency' not in ('once', 'daily', 'weekly', 'monthly')
    or pg_catalog.jsonb_typeof(p_document -> 'createdAtUtc') <> 'string' then
    raise exception 'brief_revision_document_invalid' using errcode = '22023';
  end if;

  brief_timestamp := p_document ->> 'createdAtUtc';
  begin
    perform brief_timestamp::pg_catalog.timestamptz;
  exception when others then
    raise exception 'brief_revision_document_invalid' using errcode = '22023';
  end;
  if brief_timestamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$' then
    raise exception 'brief_revision_document_invalid' using errcode = '22023';
  end if;

  if p_document ? 'title' then
    if pg_catalog.jsonb_typeof(p_document -> 'title') <> 'string'
      or p_document ->> 'title' is distinct from pg_catalog.btrim(p_document ->> 'title')
      or pg_catalog.char_length(coalesce(p_document ->> 'title', '')) not between 1 and 200 then
      raise exception 'brief_revision_document_invalid' using errcode = '22023';
    end if;
  end if;

  if p_document ? 'eventDate' then
    if pg_catalog.jsonb_typeof(p_document -> 'eventDate') <> 'string'
      or coalesce(p_document ->> 'eventDate', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      or pg_catalog.to_char(
        pg_catalog.to_date(p_document ->> 'eventDate', 'YYYY-MM-DD'),
        'YYYY-MM-DD'
      ) is distinct from p_document ->> 'eventDate' then
      raise exception 'brief_revision_document_invalid' using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'competitors') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'competitors') > 20 then
    raise exception 'brief_revision_competitor_invalid' using errcode = '22023';
  end if;
  for brief_competitor in
    select value from pg_catalog.jsonb_array_elements(p_document -> 'competitors')
  loop
    brief_competitor_expected := array['name', 'source']::text[];
    if brief_competitor ? 'website' then
      brief_competitor_expected := brief_competitor_expected || 'website'::text;
    end if;
    if brief_competitor ? 'locationHint' then
      brief_competitor_expected := brief_competitor_expected || 'locationHint'::text;
    end if;
    if not private.jsonb_object_has_exact_keys(brief_competitor, brief_competitor_expected)
      or pg_catalog.jsonb_typeof(brief_competitor -> 'name') <> 'string'
      or brief_competitor ->> 'name' is distinct from pg_catalog.btrim(brief_competitor ->> 'name')
      or pg_catalog.char_length(coalesce(brief_competitor ->> 'name', '')) not between 1 and 160
      or brief_competitor ->> 'source' not in ('suggestion', 'operator_lead')
      or (brief_competitor ? 'website' and (
        pg_catalog.jsonb_typeof(brief_competitor -> 'website') <> 'string'
        or pg_catalog.char_length(brief_competitor ->> 'website') not between 1 and 2048
        or brief_competitor ->> 'website' !~ '^https?://[^/@]+(?:/|$)'
        or brief_competitor ->> 'website' ~ '^https?://[^/]*@'
        or brief_competitor ->> 'website' like '%#%'
      ))
      or (brief_competitor ? 'locationHint' and (
        pg_catalog.jsonb_typeof(brief_competitor -> 'locationHint') <> 'string'
        or brief_competitor ->> 'locationHint'
          is distinct from pg_catalog.btrim(brief_competitor ->> 'locationHint')
        or pg_catalog.char_length(coalesce(brief_competitor ->> 'locationHint', ''))
          not between 1 and 240
      )) then
      raise exception 'brief_revision_competitor_invalid' using errcode = '22023';
    end if;
  end loop;
  -- Duplicate detection folds case and whitespace only, mirroring
  -- normalizeCompetitorName: distinct non-Latin names stay distinct.
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(p_document -> 'competitors') competitor(value)
  ) <> (
    select pg_catalog.count(distinct pg_catalog.lower(
      pg_catalog.regexp_replace(pg_catalog.btrim(value ->> 'name'), '\s+', ' ', 'g')
    ))
    from pg_catalog.jsonb_array_elements(p_document -> 'competitors') competitor(value)
  ) then
    raise exception 'brief_revision_competitors_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'investigationAreas') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'investigationAreas') not between 1 and 5 then
    raise exception 'brief_revision_investigation_invalid' using errcode = '22023';
  end if;
  for brief_item in
    select value from pg_catalog.jsonb_array_elements_text(p_document -> 'investigationAreas')
  loop
    if brief_item not in ('demand', 'presence', 'offers', 'reviews', 'observable_performance') then
      raise exception 'brief_revision_investigation_invalid' using errcode = '22023';
    end if;
  end loop;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements_text(p_document -> 'investigationAreas')
  ) <> (
    select pg_catalog.count(distinct value)
    from pg_catalog.jsonb_array_elements_text(p_document -> 'investigationAreas') area(value)
  ) then
    raise exception 'brief_revision_investigation_invalid' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_document -> 'evidencePeriods') <> 'array'
    or pg_catalog.jsonb_array_length(p_document -> 'evidencePeriods') > 12 then
    raise exception 'brief_revision_evidence_period_invalid' using errcode = '22023';
  end if;
  for brief_period in
    select value from pg_catalog.jsonb_array_elements(p_document -> 'evidencePeriods')
  loop
    brief_period_expected := array['label']::text[];
    if brief_period ? 'startDate' then
      brief_period_expected := brief_period_expected || 'startDate'::text;
    end if;
    if brief_period ? 'endDate' then
      brief_period_expected := brief_period_expected || 'endDate'::text;
    end if;
    if not private.jsonb_object_has_exact_keys(brief_period, brief_period_expected)
      or pg_catalog.jsonb_typeof(brief_period -> 'label') <> 'string'
      or brief_period ->> 'label' is distinct from pg_catalog.btrim(brief_period ->> 'label')
      or pg_catalog.char_length(coalesce(brief_period ->> 'label', '')) not between 1 and 120
      or (brief_period ? 'startDate' and (
        pg_catalog.jsonb_typeof(brief_period -> 'startDate') <> 'string'
        or coalesce(brief_period ->> 'startDate', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        or pg_catalog.to_char(
          pg_catalog.to_date(brief_period ->> 'startDate', 'YYYY-MM-DD'),
          'YYYY-MM-DD'
        ) is distinct from brief_period ->> 'startDate'
      ))
      or (brief_period ? 'endDate' and (
        pg_catalog.jsonb_typeof(brief_period -> 'endDate') <> 'string'
        or coalesce(brief_period ->> 'endDate', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        or pg_catalog.to_char(
          pg_catalog.to_date(brief_period ->> 'endDate', 'YYYY-MM-DD'),
          'YYYY-MM-DD'
        ) is distinct from brief_period ->> 'endDate'
      ))
      or (
        (brief_period ? 'startDate') and (brief_period ? 'endDate')
        and brief_period ->> 'startDate' > brief_period ->> 'endDate'
      ) then
      raise exception 'brief_revision_evidence_period_invalid' using errcode = '22023';
    end if;
  end loop;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(p_document -> 'evidencePeriods') period(value)
  ) <> (
    select pg_catalog.count(distinct pg_catalog.lower(pg_catalog.btrim(value ->> 'label')))
    from pg_catalog.jsonb_array_elements(p_document -> 'evidencePeriods') period(value)
  ) then
    raise exception 'brief_revision_periods_not_normalized' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.assert_brief_revision_document(jsonb)
  from public, anon, authenticated, service_role;

-- Report content validator ----------------------------------------------------
--
-- Mirrors marketMonitoringReportSchema key-for-key: exact report pins,
-- summary and local meaning, findings with citation slots, the competitor
-- comparison, an optional speculative-estimate block that is refused unless
-- it carries all three honesty parts (label, assumptions, reasoning) over a
-- well-formed low-to-high range, gaps, draft advice, sources with
-- case-insensitive unique references, and the plain-language flag. Finding
-- and draft keys stay case-sensitive, exactly like the Zod uniqueness
-- checks; only source references fold case.

create function private.assert_market_monitoring_report_content(
  p_content jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  report_expected_keys text[] := array[
    'reportId', 'reportVersionId', 'organizationId', 'projectId', 'locationId',
    'briefRevisionId', 'evidenceDigest', 'summary', 'localMeaning',
    'findings', 'competitorComparison', 'sources'
  ]::text[];
  report_finding jsonb;
  report_citation jsonb;
  report_competitor jsonb;
  report_estimate jsonb;
  report_range jsonb;
  report_gap jsonb;
  report_advice jsonb;
  report_source jsonb;
  report_assumption text;
  report_timestamp text;
begin
  if p_content is null then
    raise exception 'market_monitoring_report_invalid' using errcode = '22023';
  end if;
  if p_content ? 'speculativeEstimate' then
    report_expected_keys := report_expected_keys || 'speculativeEstimate'::text;
  end if;
  if p_content ? 'gaps' then
    report_expected_keys := report_expected_keys || 'gaps'::text;
  end if;
  if p_content ? 'draftAdvice' then
    report_expected_keys := report_expected_keys || 'draftAdvice'::text;
  end if;
  if p_content ? 'plainLanguageRequired' then
    report_expected_keys := report_expected_keys || 'plainLanguageRequired'::text;
  end if;

  if not private.jsonb_object_has_exact_keys(p_content, report_expected_keys)
    or pg_catalog.jsonb_typeof(p_content -> 'reportId') <> 'string'
    or coalesce(p_content ->> 'reportId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_content -> 'reportVersionId') <> 'string'
    or coalesce(p_content ->> 'reportVersionId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_content -> 'organizationId') <> 'string'
    or coalesce(p_content ->> 'organizationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_content -> 'projectId') <> 'string'
    or coalesce(p_content ->> 'projectId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_content -> 'locationId') <> 'string'
    or coalesce(p_content ->> 'locationId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_content -> 'briefRevisionId') <> 'string'
    or coalesce(p_content ->> 'briefRevisionId', '') !~ '^[0-9a-fA-F-]{36}$'
    or pg_catalog.jsonb_typeof(p_content -> 'evidenceDigest') <> 'string'
    or p_content ->> 'evidenceDigest'
      is distinct from pg_catalog.btrim(p_content ->> 'evidenceDigest')
    or pg_catalog.char_length(coalesce(p_content ->> 'evidenceDigest', ''))
      not between 1 and 512
    or pg_catalog.jsonb_typeof(p_content -> 'summary') <> 'string'
    or p_content ->> 'summary' is distinct from pg_catalog.btrim(p_content ->> 'summary')
    or pg_catalog.char_length(coalesce(p_content ->> 'summary', '')) not between 1 and 5000
    or pg_catalog.jsonb_typeof(p_content -> 'localMeaning') <> 'string'
    or p_content ->> 'localMeaning'
      is distinct from pg_catalog.btrim(p_content ->> 'localMeaning')
    or pg_catalog.char_length(coalesce(p_content ->> 'localMeaning', ''))
      not between 1 and 5000
    or (p_content ? 'plainLanguageRequired' and (
      pg_catalog.jsonb_typeof(p_content -> 'plainLanguageRequired') <> 'boolean'
    )) then
    raise exception 'market_monitoring_report_invalid' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_content -> 'findings') <> 'array'
    or pg_catalog.jsonb_array_length(p_content -> 'findings') not between 1 and 100 then
    raise exception 'report_finding_invalid' using errcode = '22023';
  end if;
  for report_finding in
    select value from pg_catalog.jsonb_array_elements(p_content -> 'findings')
  loop
    if not private.jsonb_object_has_exact_keys(
        report_finding, array['key', 'statement', 'citationSlots']::text[]
      )
      or pg_catalog.jsonb_typeof(report_finding -> 'key') <> 'string'
      or report_finding ->> 'key'
        is distinct from pg_catalog.btrim(report_finding ->> 'key')
      or pg_catalog.char_length(coalesce(report_finding ->> 'key', ''))
        not between 1 and 120
      or pg_catalog.jsonb_typeof(report_finding -> 'statement') <> 'string'
      or report_finding ->> 'statement'
        is distinct from pg_catalog.btrim(report_finding ->> 'statement')
      or pg_catalog.char_length(coalesce(report_finding ->> 'statement', ''))
        not between 1 and 2000
      or pg_catalog.jsonb_typeof(report_finding -> 'citationSlots') <> 'array'
      or pg_catalog.jsonb_array_length(report_finding -> 'citationSlots')
        not between 1 and 50 then
      raise exception 'report_finding_invalid' using errcode = '22023';
    end if;
    for report_citation in
      select value from pg_catalog.jsonb_array_elements(report_finding -> 'citationSlots')
    loop
      if not private.jsonb_object_has_exact_keys(
          report_citation,
          case when report_citation ? 'sourceRef'
            then array['claimId', 'sourceRef']::text[]
            else array['claimId']::text[] end
        )
        or pg_catalog.jsonb_typeof(report_citation -> 'claimId') <> 'string'
        or coalesce(report_citation ->> 'claimId', '') !~ '^[0-9a-fA-F-]{36}$'
        or (report_citation ? 'sourceRef' and (
          pg_catalog.jsonb_typeof(report_citation -> 'sourceRef') <> 'string'
          or report_citation ->> 'sourceRef'
            is distinct from pg_catalog.btrim(report_citation ->> 'sourceRef')
          or pg_catalog.char_length(coalesce(report_citation ->> 'sourceRef', ''))
            not between 1 and 240
        )) then
        raise exception 'report_finding_invalid' using errcode = '22023';
      end if;
    end loop;
  end loop;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(p_content -> 'findings') finding(value)
  ) <> (
    select pg_catalog.count(distinct value ->> 'key')
    from pg_catalog.jsonb_array_elements(p_content -> 'findings') finding(value)
  ) then
    raise exception 'report_findings_not_normalized' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_content -> 'competitorComparison') <> 'array'
    or pg_catalog.jsonb_array_length(p_content -> 'competitorComparison')
      not between 1 and 50 then
    raise exception 'report_competitor_invalid' using errcode = '22023';
  end if;
  for report_competitor in
    select value from pg_catalog.jsonb_array_elements(p_content -> 'competitorComparison')
  loop
    if not private.jsonb_object_has_exact_keys(
        report_competitor,
        case when report_competitor ? 'citationSlots'
          then array['competitorName', 'summary', 'citationSlots']::text[]
          else array['competitorName', 'summary']::text[] end
      )
      or pg_catalog.jsonb_typeof(report_competitor -> 'competitorName') <> 'string'
      or report_competitor ->> 'competitorName'
        is distinct from pg_catalog.btrim(report_competitor ->> 'competitorName')
      or pg_catalog.char_length(coalesce(report_competitor ->> 'competitorName', ''))
        not between 1 and 160
      or pg_catalog.jsonb_typeof(report_competitor -> 'summary') <> 'string'
      or report_competitor ->> 'summary'
        is distinct from pg_catalog.btrim(report_competitor ->> 'summary')
      or pg_catalog.char_length(coalesce(report_competitor ->> 'summary', ''))
        not between 1 and 2000 then
      raise exception 'report_competitor_invalid' using errcode = '22023';
    end if;
    if report_competitor ? 'citationSlots' then
      if pg_catalog.jsonb_typeof(report_competitor -> 'citationSlots') <> 'array'
        or pg_catalog.jsonb_array_length(report_competitor -> 'citationSlots') > 50 then
        raise exception 'report_competitor_invalid' using errcode = '22023';
      end if;
      for report_citation in
        select value
        from pg_catalog.jsonb_array_elements(report_competitor -> 'citationSlots')
      loop
        if not private.jsonb_object_has_exact_keys(
            report_citation,
            case when report_citation ? 'sourceRef'
              then array['claimId', 'sourceRef']::text[]
              else array['claimId']::text[] end
          )
          or pg_catalog.jsonb_typeof(report_citation -> 'claimId') <> 'string'
          or coalesce(report_citation ->> 'claimId', '') !~ '^[0-9a-fA-F-]{36}$'
          or (report_citation ? 'sourceRef' and (
            pg_catalog.jsonb_typeof(report_citation -> 'sourceRef') <> 'string'
            or report_citation ->> 'sourceRef'
              is distinct from pg_catalog.btrim(report_citation ->> 'sourceRef')
            or pg_catalog.char_length(coalesce(report_citation ->> 'sourceRef', ''))
              not between 1 and 240
          )) then
          raise exception 'report_competitor_invalid' using errcode = '22023';
        end if;
      end loop;
    end if;
  end loop;

  -- A speculative estimate is refused unless it carries all three honesty
  -- parts: the visible speculation label, its assumptions, and its reasoning.
  -- An absent block is fine; a partial block is not.
  if p_content ? 'speculativeEstimate' then
    report_estimate := p_content -> 'speculativeEstimate';
    if not private.jsonb_object_has_exact_keys(
        report_estimate, array['label', 'range', 'assumptions', 'reasoning']::text[]
      )
      or pg_catalog.jsonb_typeof(report_estimate -> 'label') <> 'string'
      or report_estimate ->> 'label'
        is distinct from pg_catalog.btrim(report_estimate ->> 'label')
      or pg_catalog.char_length(coalesce(report_estimate ->> 'label', ''))
        not between 1 and 240
      or pg_catalog.jsonb_typeof(report_estimate -> 'reasoning') <> 'string'
      or report_estimate ->> 'reasoning'
        is distinct from pg_catalog.btrim(report_estimate ->> 'reasoning')
      or pg_catalog.char_length(coalesce(report_estimate ->> 'reasoning', ''))
        not between 1 and 2000
      or pg_catalog.jsonb_typeof(report_estimate -> 'assumptions') <> 'array'
      or pg_catalog.jsonb_array_length(report_estimate -> 'assumptions')
        not between 1 and 20 then
      raise exception 'report_estimate_invalid' using errcode = '22023';
    end if;
    for report_assumption in
      select value
      from pg_catalog.jsonb_array_elements_text(report_estimate -> 'assumptions')
    loop
      if pg_catalog.char_length(report_assumption) not between 1 and 500
        or report_assumption <> pg_catalog.btrim(report_assumption) then
        raise exception 'report_estimate_invalid' using errcode = '22023';
      end if;
    end loop;
    report_range := report_estimate -> 'range';
    if not private.jsonb_object_has_exact_keys(
        report_range, array['lowMinorUnits', 'highMinorUnits', 'currency']::text[]
      )
      or pg_catalog.jsonb_typeof(report_range -> 'lowMinorUnits') <> 'number'
      or (report_range ->> 'lowMinorUnits')::numeric
        <> pg_catalog.trunc((report_range ->> 'lowMinorUnits')::numeric)
      or (report_range ->> 'lowMinorUnits')::numeric < 0
      or pg_catalog.jsonb_typeof(report_range -> 'highMinorUnits') <> 'number'
      or (report_range ->> 'highMinorUnits')::numeric
        <> pg_catalog.trunc((report_range ->> 'highMinorUnits')::numeric)
      or (report_range ->> 'highMinorUnits')::numeric < 0
      or (report_range ->> 'lowMinorUnits')::numeric
        > (report_range ->> 'highMinorUnits')::numeric
      or pg_catalog.jsonb_typeof(report_range -> 'currency') <> 'string'
      or coalesce(report_range ->> 'currency', '') !~ '^[A-Z]{3}$' then
      raise exception 'report_estimate_invalid' using errcode = '22023';
    end if;
  end if;

  if p_content ? 'gaps' then
    if pg_catalog.jsonb_typeof(p_content -> 'gaps') <> 'array'
      or pg_catalog.jsonb_array_length(p_content -> 'gaps') > 50 then
      raise exception 'market_monitoring_report_invalid' using errcode = '22023';
    end if;
    for report_gap in
      select value from pg_catalog.jsonb_array_elements(p_content -> 'gaps')
    loop
      if not private.jsonb_object_has_exact_keys(
          report_gap, array['key', 'description']::text[]
        )
        or pg_catalog.jsonb_typeof(report_gap -> 'key') <> 'string'
        or report_gap ->> 'key' is distinct from pg_catalog.btrim(report_gap ->> 'key')
        or pg_catalog.char_length(coalesce(report_gap ->> 'key', ''))
          not between 1 and 120
        or pg_catalog.jsonb_typeof(report_gap -> 'description') <> 'string'
        or report_gap ->> 'description'
          is distinct from pg_catalog.btrim(report_gap ->> 'description')
        or pg_catalog.char_length(coalesce(report_gap ->> 'description', ''))
          not between 1 and 1000 then
        raise exception 'market_monitoring_report_invalid' using errcode = '22023';
      end if;
    end loop;
  end if;

  if p_content ? 'draftAdvice' then
    if pg_catalog.jsonb_typeof(p_content -> 'draftAdvice') <> 'array'
      or pg_catalog.jsonb_array_length(p_content -> 'draftAdvice') > 100 then
      raise exception 'report_draft_advice_invalid' using errcode = '22023';
    end if;
    for report_advice in
      select value from pg_catalog.jsonb_array_elements(p_content -> 'draftAdvice')
    loop
      if not private.jsonb_object_has_exact_keys(
          report_advice, array['itemKey', 'kind', 'title', 'detail']::text[]
        )
        or pg_catalog.jsonb_typeof(report_advice -> 'itemKey') <> 'string'
        or report_advice ->> 'itemKey'
          is distinct from pg_catalog.btrim(report_advice ->> 'itemKey')
        or pg_catalog.char_length(coalesce(report_advice ->> 'itemKey', ''))
          not between 1 and 160
        or report_advice ->> 'kind' not in ('action', 'finding')
        or pg_catalog.jsonb_typeof(report_advice -> 'title') <> 'string'
        or report_advice ->> 'title'
          is distinct from pg_catalog.btrim(report_advice ->> 'title')
        or pg_catalog.char_length(coalesce(report_advice ->> 'title', ''))
          not between 1 and 240
        or pg_catalog.jsonb_typeof(report_advice -> 'detail') <> 'string'
        or report_advice ->> 'detail'
          is distinct from pg_catalog.btrim(report_advice ->> 'detail')
        or pg_catalog.char_length(coalesce(report_advice ->> 'detail', ''))
          not between 1 and 2000 then
        raise exception 'report_draft_advice_invalid' using errcode = '22023';
      end if;
    end loop;
    if (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(p_content -> 'draftAdvice') advice(value)
    ) <> (
      select pg_catalog.count(distinct value ->> 'itemKey')
      from pg_catalog.jsonb_array_elements(p_content -> 'draftAdvice') advice(value)
    ) then
      raise exception 'report_draft_advice_not_normalized' using errcode = '22023';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(p_content -> 'sources') <> 'array'
    or pg_catalog.jsonb_array_length(p_content -> 'sources') not between 1 and 200 then
    raise exception 'market_monitoring_report_invalid' using errcode = '22023';
  end if;
  for report_source in
    select value from pg_catalog.jsonb_array_elements(p_content -> 'sources')
  loop
    if not private.jsonb_object_has_exact_keys(
        report_source,
        case when report_source ? 'url' and report_source ? 'retrievedAtUtc'
          then array['sourceRef', 'url', 'retrievedAtUtc']::text[]
          when report_source ? 'url'
          then array['sourceRef', 'url']::text[]
          when report_source ? 'retrievedAtUtc'
          then array['sourceRef', 'retrievedAtUtc']::text[]
          else array['sourceRef']::text[] end
      )
      or pg_catalog.jsonb_typeof(report_source -> 'sourceRef') <> 'string'
      or report_source ->> 'sourceRef'
        is distinct from pg_catalog.btrim(report_source ->> 'sourceRef')
      or pg_catalog.char_length(coalesce(report_source ->> 'sourceRef', ''))
        not between 1 and 240
      or (report_source ? 'url' and (
        pg_catalog.jsonb_typeof(report_source -> 'url') <> 'string'
        or report_source ->> 'url'
          is distinct from pg_catalog.btrim(report_source ->> 'url')
        or pg_catalog.char_length(coalesce(report_source ->> 'url', ''))
          not between 1 and 2048
      )) then
      raise exception 'market_monitoring_report_invalid' using errcode = '22023';
    end if;
    if report_source ? 'retrievedAtUtc' then
      if pg_catalog.jsonb_typeof(report_source -> 'retrievedAtUtc') <> 'string' then
        raise exception 'market_monitoring_report_invalid' using errcode = '22023';
      end if;
      report_timestamp := report_source ->> 'retrievedAtUtc';
      begin
        perform report_timestamp::pg_catalog.timestamptz;
      exception when others then
        raise exception 'market_monitoring_report_invalid' using errcode = '22023';
      end;
      if report_timestamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:?[0-9]{2})$' then
        raise exception 'market_monitoring_report_invalid' using errcode = '22023';
      end if;
    end if;
  end loop;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_array_elements(p_content -> 'sources') source(value)
  ) <> (
    select pg_catalog.count(distinct pg_catalog.lower(value ->> 'sourceRef'))
    from pg_catalog.jsonb_array_elements(p_content -> 'sources') source(value)
  ) then
    raise exception 'report_sources_not_normalized' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.assert_market_monitoring_report_content(jsonb)
  from public, anon, authenticated, service_role;

-- Tables ----------------------------------------------------------------------

create table public.growth_intelligence_research_projects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  branch_id uuid not null,
  title text not null,
  question text not null,
  mode text not null check (mode in ('one-time', 'recurring')),
  schedule jsonb,
  lifecycle text not null default 'active' check (lifecycle in ('active', 'paused', 'archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  check (title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 200),
  check (question = pg_catalog.btrim(question) and pg_catalog.char_length(question) between 1 and 2000),
  -- One-time projects run on explicit starts only and carry no schedule;
  -- recurring projects always carry one.
  check ((mode = 'recurring') = (schedule is not null))
);

comment on table public.growth_intelligence_research_projects is
  'Independent Market Monitoring research lifecycles at one location. Starting, pausing or archiving one project never touches another.';

create table public.growth_intelligence_brief_revisions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  revision_number integer not null check (revision_number >= 1),
  document jsonb not null check (pg_catalog.jsonb_typeof(document) = 'object'),
  pinned_to_update_id uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, project_id, revision_number),
  foreign key (organization_id, project_id)
    references public.growth_intelligence_research_projects(organization_id, id)
    on delete restrict,
  -- A pinned revision keeps opening exactly for its update; re-pinning to
  -- another update is a conflict, so the pin rides the immutable row.
  check (pinned_to_update_id is null or pinned_to_update_id <> id)
);

comment on table public.growth_intelligence_brief_revisions is
  'Append-only brief revisions per research project. Later edits create new revisions for future runs only.';

create table public.growth_intelligence_reports (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  branch_id uuid not null,
  brief_revision_id uuid not null,
  report_version_id uuid not null unique,
  evidence_digest text not null,
  content jsonb not null check (pg_catalog.jsonb_typeof(content) = 'object'),
  review_state text not null default 'pending_review'
    check (review_state in ('pending_review', 'accepted')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, report_version_id),
  foreign key (organization_id, project_id)
    references public.growth_intelligence_research_projects(organization_id, id)
    on delete restrict,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete restrict,
  foreign key (organization_id, brief_revision_id)
    references public.growth_intelligence_brief_revisions(organization_id, id)
    on delete restrict,
  check (
    evidence_digest = pg_catalog.btrim(evidence_digest)
    and pg_catalog.char_length(evidence_digest) between 1 and 512
  )
);

comment on table public.growth_intelligence_reports is
  'Saved readable Market Monitoring answers per update, pinned to exact project, branch, brief revision and evidence identity.';

create table public.growth_intelligence_draft_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  report_version_id uuid not null,
  item_key text not null,
  kind text not null check (kind in ('action', 'finding')),
  title text not null,
  detail text not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, report_version_id, item_key),
  foreign key (organization_id, report_version_id)
    references public.growth_intelligence_reports(organization_id, report_version_id)
    on delete restrict,
  check (item_key = pg_catalog.btrim(item_key) and pg_catalog.char_length(item_key) between 1 and 160),
  check (title = pg_catalog.btrim(title) and pg_catalog.char_length(title) between 1 and 240),
  check (detail = pg_catalog.btrim(detail) and pg_catalog.char_length(detail) between 1 and 2000)
);

comment on table public.growth_intelligence_draft_items is
  'Reviewable advice units of one report version. Nothing enters Recommendations or Insights before explicit acceptance.';

create table public.growth_intelligence_acceptances (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  organization_id uuid not null,
  acceptance_key text not null,
  report_version_id uuid not null,
  item_key text not null,
  kind text not null check (kind in ('action', 'finding')),
  destination text not null check (destination in ('Recommendations', 'Insights')),
  grants_execution_approval boolean not null default false,
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, id),
  unique (organization_id, acceptance_key),
  foreign key (organization_id, report_version_id, item_key)
    references public.growth_intelligence_draft_items(organization_id, report_version_id, item_key)
    on delete restrict,
  -- The acceptance identity is exactly report version id plus item key.
  check (acceptance_key = report_version_id::text || ':' || item_key),
  -- The destination derives from the item type: action advice routes to
  -- Recommendations, informational findings route to Insights.
  check (
    (kind = 'action' and destination = 'Recommendations')
    or (kind = 'finding' and destination = 'Insights')
  ),
  -- Accepting research advice never authorizes campaign execution, spending
  -- or publication.
  check (grants_execution_approval = false)
);

comment on table public.growth_intelligence_acceptances is
  'Explicit draft-item acceptance. Idempotent per acceptance key; replaying a kept key returns the kept row.';

-- Mutation guards ---------------------------------------------------------------
--
-- Brief revisions, draft items and acceptances reuse the shared append-only
-- guard. Projects stay lifecycle-managed (title, question, schedule and
-- lifecycle writable; identity frozen; deletes forbidden). Reports keep
-- content and pins immutable; only the review state may advance from
-- pending_review to accepted.

create function private.enforce_research_project_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_research_project_delete_forbidden' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.branch_id is distinct from old.branch_id
      or new.mode is distinct from old.mode
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'growth_intelligence_research_project_identity_immutable' using errcode = '55000';
    end if;
  end if;
  if new.mode = 'recurring' then
    perform private.assert_research_project_schedule(new.schedule);
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_research_project_mutation()
  from public, anon, authenticated, service_role;

create function private.enforce_research_project_brief_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.assert_brief_revision_document(new.document);
  return new;
end;
$$;

revoke all on function private.enforce_research_project_brief_mutation()
  from public, anon, authenticated, service_role;

create function private.enforce_research_report_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'growth_intelligence_report_delete_forbidden' using errcode = '55000';
  end if;
  if tg_op = 'INSERT' then
    perform private.assert_market_monitoring_report_content(new.content);
    return new;
  end if;
  if new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.project_id is distinct from old.project_id
    or new.branch_id is distinct from old.branch_id
    or new.brief_revision_id is distinct from old.brief_revision_id
    or new.report_version_id is distinct from old.report_version_id
    or new.evidence_digest is distinct from old.evidence_digest
    or new.content is distinct from old.content
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'growth_intelligence_report_content_immutable' using errcode = '55000';
  end if;
  if old.review_state = new.review_state then
    return new;
  end if;
  if old.review_state = 'pending_review' and new.review_state = 'accepted' then
    return new;
  end if;
  raise exception 'growth_intelligence_report_transition_invalid' using errcode = '55000';
end;
$$;

revoke all on function private.enforce_research_report_mutation()
  from public, anon, authenticated, service_role;

create trigger growth_intelligence_research_projects_set_updated_at
before update on public.growth_intelligence_research_projects
for each row execute function public.set_updated_at();
create trigger growth_intelligence_research_projects_enforce_mutation
before insert or update or delete on public.growth_intelligence_research_projects
for each row execute function private.enforce_research_project_mutation();

create trigger growth_intelligence_brief_revisions_enforce_document
before insert on public.growth_intelligence_brief_revisions
for each row execute function private.enforce_research_project_brief_mutation();
create trigger growth_intelligence_brief_revisions_append_only
before update or delete on public.growth_intelligence_brief_revisions
for each row execute function private.reject_growth_intelligence_append_only_mutation();

create trigger growth_intelligence_reports_enforce_mutation
before insert or update or delete on public.growth_intelligence_reports
for each row execute function private.enforce_research_report_mutation();

create trigger growth_intelligence_draft_items_append_only
before update or delete on public.growth_intelligence_draft_items
for each row execute function private.reject_growth_intelligence_append_only_mutation();

create trigger growth_intelligence_acceptances_append_only
before update or delete on public.growth_intelligence_acceptances
for each row execute function private.reject_growth_intelligence_append_only_mutation();

-- Tenant-leading and bounded-read indexes ---------------------------------------
--
-- Partial indexes serve the two hot reads (the project list without archived
-- rows, and pending-review reports) while every tenant FK and feed-read path
-- carries its own index. History pagination orders by (created_at, id) with
-- caller-side limits; no unbounded list function exists.

create index growth_intelligence_research_projects_branch_idx
  on public.growth_intelligence_research_projects (organization_id, branch_id);

create index growth_intelligence_research_projects_active_list_idx
  on public.growth_intelligence_research_projects
  (organization_id, branch_id, created_at desc, id desc)
  where lifecycle in ('active', 'paused');

create index growth_intelligence_brief_revisions_project_history_idx
  on public.growth_intelligence_brief_revisions
  (organization_id, project_id, revision_number desc, id desc);

create index growth_intelligence_reports_project_history_idx
  on public.growth_intelligence_reports
  (organization_id, project_id, created_at desc, id desc);

create index growth_intelligence_reports_pending_review_idx
  on public.growth_intelligence_reports
  (organization_id, created_at desc, id desc)
  where review_state = 'pending_review';

create index growth_intelligence_reports_branch_idx
  on public.growth_intelligence_reports (organization_id, branch_id);

create index growth_intelligence_reports_brief_revision_idx
  on public.growth_intelligence_reports (organization_id, brief_revision_id);

create index growth_intelligence_draft_items_report_idx
  on public.growth_intelligence_draft_items (organization_id, report_version_id);

create index growth_intelligence_acceptances_report_idx
  on public.growth_intelligence_acceptances (organization_id, report_version_id);

-- RLS and least-privilege table access -------------------------------------------

alter table public.growth_intelligence_research_projects enable row level security;
alter table public.growth_intelligence_research_projects force row level security;
alter table public.growth_intelligence_brief_revisions enable row level security;
alter table public.growth_intelligence_brief_revisions force row level security;
alter table public.growth_intelligence_reports enable row level security;
alter table public.growth_intelligence_reports force row level security;
alter table public.growth_intelligence_draft_items enable row level security;
alter table public.growth_intelligence_draft_items force row level security;
alter table public.growth_intelligence_acceptances enable row level security;
alter table public.growth_intelligence_acceptances force row level security;

create policy "members with Growth Intelligence read research projects"
on public.growth_intelligence_research_projects
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read brief revisions"
on public.growth_intelligence_brief_revisions
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read monitoring reports"
on public.growth_intelligence_reports
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read draft items"
on public.growth_intelligence_draft_items
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

create policy "members with Growth Intelligence read acceptances"
on public.growth_intelligence_acceptances
for select to authenticated
using (private.has_organization_permission(organization_id, 'growth_intelligence.read'));

revoke all on table public.growth_intelligence_research_projects from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_brief_revisions from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_reports from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_draft_items from public, anon, authenticated, service_role;
revoke all on table public.growth_intelligence_acceptances from public, anon, authenticated, service_role;

grant select on table public.growth_intelligence_research_projects to authenticated;
grant select on table public.growth_intelligence_brief_revisions to authenticated;
grant select on table public.growth_intelligence_reports to authenticated;
grant select on table public.growth_intelligence_draft_items to authenticated;
grant select on table public.growth_intelligence_acceptances to authenticated;
grant select on table public.growth_intelligence_research_projects to service_role;
grant select on table public.growth_intelligence_brief_revisions to service_role;
grant select on table public.growth_intelligence_reports to service_role;
grant select on table public.growth_intelligence_draft_items to service_role;
grant select on table public.growth_intelligence_acceptances to service_role;

-- Fenced RPCs ---------------------------------------------------------------------

create function public.create_research_project(
  p_organization_id uuid,
  p_actor_id uuid,
  p_branch_id uuid,
  p_title text,
  p_question text,
  p_mode text,
  p_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.growth_intelligence_research_projects;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'research_project_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_branch_id is null
    or p_title is null
    or p_question is null
    or p_mode not in ('one-time', 'recurring')
    or (p_mode = 'recurring') <> (p_schedule is not null) then
    raise exception 'research_project_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.branches branch
    where branch.organization_id = p_organization_id
      and branch.id = p_branch_id
  ) then
    raise exception 'research_project_scope_not_found' using errcode = '42501';
  end if;

  if p_mode = 'recurring' then
    perform private.assert_research_project_schedule(p_schedule);
  end if;

  insert into public.growth_intelligence_research_projects (
    organization_id, branch_id, title, question, mode, schedule, created_by
  ) values (
    p_organization_id, p_branch_id, p_title, p_question, p_mode, p_schedule, p_actor_id
  ) returning * into created;

  return pg_catalog.jsonb_build_object(
    'projectId', created.id,
    'lifecycle', created.lifecycle,
    'replayed', false
  );
end;
$$;

revoke all on function public.create_research_project(uuid, uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_research_project(uuid, uuid, uuid, text, text, text, jsonb)
  to authenticated, service_role;

create function public.save_brief_revision(
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
    if existing.document = p_document then
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

revoke all on function public.save_brief_revision(uuid, uuid, uuid, integer, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.save_brief_revision(uuid, uuid, uuid, integer, jsonb, uuid)
  to authenticated, service_role;

create function public.persist_report_version(
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
      or existing.content is distinct from p_content then
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

revoke all on function public.persist_report_version(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.persist_report_version(uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb)
  to authenticated, service_role;

create function public.accept_draft_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_version_id uuid,
  p_item_key text,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_row public.growth_intelligence_draft_items;
  kept public.growth_intelligence_acceptances;
  inserted public.growth_intelligence_acceptances;
  acceptance_key text;
  destination text;
  remaining integer;
begin
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
    and (
      (select auth.uid()) is distinct from p_actor_id
      or not private.has_organization_permission(p_organization_id, 'growth_intelligence.manage')
    ) then
    raise exception 'draft_acceptance_forbidden' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_report_version_id is null
    or p_item_key is null
    or pg_catalog.char_length(p_item_key) not between 1 and 160
    or p_kind not in ('action', 'finding') then
    raise exception 'draft_acceptance_invalid' using errcode = '22023';
  end if;

  select item.* into draft_row
  from public.growth_intelligence_draft_items item
  where item.organization_id = p_organization_id
    and item.report_version_id = p_report_version_id
    and item.item_key = p_item_key;
  if not found then
    raise exception 'draft_item_not_found' using errcode = '42501';
  end if;
  -- The acceptance kind must match the draft item it accepts: a key presented
  -- for another type is a conflict, never a silent overwrite.
  if draft_row.kind is distinct from p_kind then
    raise exception 'draft_acceptance_kind_conflict' using errcode = '23505';
  end if;

  acceptance_key := p_report_version_id::text || ':' || p_item_key;
  destination := case when p_kind = 'action' then 'Recommendations' else 'Insights' end;

  -- One serialized acceptance per report, taken before the per-key lock so
  -- concurrent transactions always acquire the two locks in the same order.
  -- The flip counts remaining items across keys, so without this lock two
  -- concurrent accepts of the last two items could each see remaining = 1
  -- under READ COMMITTED and neither would flip the report to accepted.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'accept_draft_item',
      p_organization_id, p_report_version_id
    ),
    0
  ));

  -- One serialized acceptance per key: concurrent accepts converge on the
  -- single kept row instead of duplicating feed items.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.concat_ws(
      '|', 'growth_intelligence', 'accept_draft_item',
      p_organization_id, acceptance_key
    ),
    0
  ));

  insert into public.growth_intelligence_acceptances (
    organization_id, acceptance_key, report_version_id, item_key,
    kind, destination, accepted_by
  ) values (
    p_organization_id, acceptance_key, p_report_version_id, p_item_key,
    p_kind, destination, p_actor_id
  )
  on conflict (organization_id, acceptance_key) do nothing
  returning * into inserted;

  if found then
    -- The report leaves pending review once every draft item it carries has
    -- been accepted; the content itself never changes.
    select pg_catalog.count(*) into remaining
    from public.growth_intelligence_draft_items item
    where item.organization_id = p_organization_id
      and item.report_version_id = p_report_version_id
      and not exists (
        select 1 from public.growth_intelligence_acceptances acceptance
        where acceptance.organization_id = p_organization_id
          and acceptance.report_version_id = p_report_version_id
          and acceptance.item_key = item.item_key
      );
    if remaining = 0 then
      update public.growth_intelligence_reports report
      set review_state = 'accepted'
      where report.organization_id = p_organization_id
        and report.report_version_id = p_report_version_id
        and report.review_state = 'pending_review';
    end if;
    return pg_catalog.jsonb_build_object(
      'acceptanceKey', inserted.acceptance_key,
      'destination', inserted.destination,
      'grantsExecutionApproval', inserted.grants_execution_approval,
      'outcome', 'accepted'
    );
  end if;

  select acceptance.* into kept
  from public.growth_intelligence_acceptances acceptance
  where acceptance.organization_id = p_organization_id
    and acceptance.acceptance_key = acceptance_key;
  if kept.kind is distinct from p_kind then
    raise exception 'draft_acceptance_kind_conflict' using errcode = '23505';
  end if;
  -- A replayed acceptance retries the flip too: if an earlier concurrent
  -- accept lost the race and left the report pending with every item
  -- accepted, the next replay converges it to accepted. The update stays
  -- conditional on pending_review, so replays never move a decided report.
  select pg_catalog.count(*) into remaining
  from public.growth_intelligence_draft_items item
  where item.organization_id = p_organization_id
    and item.report_version_id = p_report_version_id
    and not exists (
      select 1 from public.growth_intelligence_acceptances acceptance
      where acceptance.organization_id = p_organization_id
        and acceptance.report_version_id = p_report_version_id
        and acceptance.item_key = item.item_key
    );
  if remaining = 0 then
    update public.growth_intelligence_reports report
    set review_state = 'accepted'
    where report.organization_id = p_organization_id
      and report.report_version_id = p_report_version_id
      and report.review_state = 'pending_review';
  end if;
  return pg_catalog.jsonb_build_object(
    'acceptanceKey', kept.acceptance_key,
    'destination', kept.destination,
    'grantsExecutionApproval', kept.grants_execution_approval,
    'outcome', 'already_accepted'
  );
end;
$$;

revoke all on function public.accept_draft_item(uuid, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_draft_item(uuid, uuid, uuid, text, text)
  to authenticated, service_role;
