begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(16);

-- Contract: per-provider qualification for the TinyFish restoration ----------

select extensions.has_function(
  'private', 'research_provider_blockers_for',
  array['text'],
  'blocker evaluation is parameterized by provider'
);
select extensions.has_function(
  'public', 'check_research_provider_qualification_for',
  array['text'],
  'provider qualification answers safely per provider without secrets'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.check_research_provider_qualification_for(text)',
    'execute'
  ),
  'signed-in members check per-provider qualification through the governed RPC'
);
select extensions.ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.check_research_provider_qualification_for(text)',
    'execute'
  ),
  'the worker checks per-provider qualification through the governed RPC'
);

-- Unknown and malformed providers fail closed, never raise --------------------

select extensions.is(
  (select (public.check_research_provider_qualification_for('other') ->> 'available')::boolean),
  false,
  'an unknown provider is never available'
);
select extensions.ok(
  (select public.check_research_provider_qualification_for('other') -> 'blockers'
    ? 'qualification_missing'),
  'an unknown provider reports qualification_missing'
);
select extensions.ok(
  (select public.check_research_provider_qualification_for('BRAVE') -> 'blockers'
    ? 'qualification_missing'),
  'a malformed provider id fails closed instead of matching brave'
);
select extensions.ok(
  (select public.check_research_provider_qualification_for('') -> 'blockers'
    ? 'qualification_missing'),
  'an empty provider id fails closed'
);
select extensions.ok(
  (select public.check_research_provider_qualification_for('tinyfish') -> 'blockers'
    ? 'qualification_missing'),
  'tinyfish with no staged row reports qualification_missing'
);

-- An incomplete TinyFish staging stays blocked --------------------------------

insert into private.growth_intelligence_provider_qualifications (
  provider, agreement_version, agreement_date, agreement_expires_at,
  permitted_uses, retention_policy, deletion_rules, pricing_version,
  search_rate_micros_usd, credential_ready, model_bounds, canary_result
) values (
  'tinyfish', 'TINYFISH-ORDER-2026-09-19', '2026-09-19', pg_catalog.now() + interval '90 days',
  array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse'],
  'retain permitted excerpts per agreement, then erase',
  'erase on termination within 30 days, including derived text on request',
  'tinyfish-search-2026-09', 1, false,
  '{"extraction": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "supportReview": {"maxInputTokens": 12000, "maxOutputTokens": 4000}, "synthesis": {"maxInputTokens": 24000, "maxOutputTokens": 6000}}'::jsonb,
  'pending'
);

select extensions.ok(
  (select public.check_research_provider_qualification_for('tinyfish') -> 'blockers'
    ? 'required_rights_missing'),
  'tinyfish without the six required uses stays blocked'
);
select extensions.is(
  (select (public.check_research_provider_qualification_for('tinyfish') ->> 'available')::boolean),
  false,
  'an incomplete tinyfish staging is never available'
);

-- A complete TinyFish staging unlocks only the TinyFish lane ------------------

-- One micro-dollar is the free-tier accounting floor: the rates check
-- requires a positive rate, and the enterprise rate replaces this staging
-- value when contracted. Actual TinyFish Search cost stays zero.
update private.growth_intelligence_provider_qualifications
set permitted_uses = array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse', 'agreed_retention'],
  pricing_version = 'tinyfish-search-2026-09',
  search_rate_micros_usd = 1,
  credential_ready = true,
  canary_result = 'passed'
where provider = 'tinyfish';

select extensions.is(
  (select (public.check_research_provider_qualification_for('tinyfish') ->> 'available')::boolean),
  true,
  'a complete tinyfish staging reports available'
);
select extensions.is(
  (select pg_catalog.jsonb_array_length(
    public.check_research_provider_qualification_for('tinyfish') -> 'blockers')),
  0,
  'a complete tinyfish staging reports no blockers'
);
select extensions.is(
  (select public.check_research_provider_qualification_for('tinyfish') ->> 'provider'),
  'tinyfish',
  'the availability answer echoes the requested provider'
);

-- The legacy Brave lane is untouched and isolated ------------------------------

select extensions.is(
  (select (public.check_research_provider_qualification() ->> 'available')::boolean),
  false,
  'staging tinyfish does not unlock the legacy brave lane'
);

-- Expiry blocks even a complete staging -----------------------------------------

update private.growth_intelligence_provider_qualifications
set agreement_expires_at = pg_catalog.now() - interval '1 day'
where provider = 'tinyfish';

select extensions.ok(
  (select public.check_research_provider_qualification_for('tinyfish') -> 'blockers'
    ? 'agreement_expired'),
  'an expired tinyfish agreement reports agreement_expired'
);

rollback;
