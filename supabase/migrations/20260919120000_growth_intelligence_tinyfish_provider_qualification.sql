-- TinyFish provider qualification: per-provider fail-closed evaluation.
--
-- The Brave-era private.research_provider_blockers() hardcodes provider =
-- 'brave' and public.check_research_provider_qualification() answers for
-- Brave only. Both stay byte-identical for legacy provenance and the
-- ephemeral live preview. This migration only ADDS:
--
--   private.research_provider_blockers_for(p_provider)
--   public.check_research_provider_qualification_for(p_provider)
--
-- so TinyFish ('tinyfish') can be staged, checked, and gated exactly like
-- Brave. Unknown or malformed provider ids fail closed with
-- qualification_missing and never raise.

create function private.research_provider_blockers_for(p_provider text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  blocker_qualification private.growth_intelligence_provider_qualifications;
  blocker_codes text[] := '{}';
  blocker_phase text;
  blocker_bounds jsonb;
begin
  if p_provider is null
    or p_provider not in ('brave', 'tinyfish') then
    return array['qualification_missing'];
  end if;
  select qualification.* into blocker_qualification
  from private.growth_intelligence_provider_qualifications qualification
  where qualification.provider = p_provider;
  if not found then
    return array['qualification_missing'];
  end if;
  if pg_catalog.btrim(blocker_qualification.agreement_version) = '' then
    blocker_codes := array_append(blocker_codes, 'agreement_missing');
  end if;
  if blocker_qualification.agreement_expires_at <= pg_catalog.now() then
    blocker_codes := array_append(blocker_codes, 'agreement_expired');
  end if;
  if not (blocker_qualification.permitted_uses @> array[
    'snippet_storage', 'commercial_inference', 'organization_display',
    'derived_claims', 'synthesis_reuse', 'agreed_retention'
  ]) then
    blocker_codes := array_append(blocker_codes, 'required_rights_missing');
  end if;
  if pg_catalog.btrim(blocker_qualification.pricing_version) = ''
    or blocker_qualification.search_rate_micros_usd <= 0 then
    blocker_codes := array_append(blocker_codes, 'rates_missing');
  end if;
  if not blocker_qualification.credential_ready then
    blocker_codes := array_append(blocker_codes, 'credential_missing');
  end if;
  if pg_catalog.jsonb_typeof(blocker_qualification.model_bounds) <> 'object' then
    blocker_codes := array_append(blocker_codes, 'model_bounds_missing');
  else
    foreach blocker_phase in array array['extraction', 'supportReview', 'synthesis'] loop
      blocker_bounds := blocker_qualification.model_bounds -> blocker_phase;
      if pg_catalog.jsonb_typeof(blocker_bounds) <> 'object'
        or coalesce(blocker_bounds ->> 'maxInputTokens', '') !~ '^[1-9][0-9]{0,6}$'
        or coalesce(blocker_bounds ->> 'maxOutputTokens', '') !~ '^[1-9][0-9]{0,6}$' then
        blocker_codes := array_append(blocker_codes, 'model_bounds_missing');
        exit;
      end if;
    end loop;
  end if;
  if blocker_qualification.canary_result is distinct from 'passed' then
    blocker_codes := array_append(blocker_codes, 'controlled_canary_missing');
  end if;
  return blocker_codes;
end;
$$;

revoke all on function private.research_provider_blockers_for(text)
  from public, anon, authenticated, service_role;

-- Safe per-provider availability: blocker codes only, never secrets -----------
create function public.check_research_provider_qualification_for(p_provider text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cpq_blockers text[];
  cpq_provider text;
begin
  if p_provider in ('brave', 'tinyfish') then
    cpq_provider := p_provider;
  else
    cpq_provider := 'unknown';
  end if;
  if cpq_provider = 'unknown' then
    cpq_blockers := array['qualification_missing'];
  else
    cpq_blockers := private.research_provider_blockers_for(cpq_provider);
  end if;
  return pg_catalog.jsonb_build_object(
    'provider', cpq_provider,
    'available', pg_catalog.cardinality(cpq_blockers) = 0,
    'blockers', pg_catalog.to_jsonb(cpq_blockers)
  );
end;
$$;

revoke all on function public.check_research_provider_qualification_for(text)
  from public, anon, authenticated, service_role;
grant execute on function public.check_research_provider_qualification_for(text)
  to authenticated, service_role;
