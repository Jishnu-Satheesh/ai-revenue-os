-- TinyFish canary qualification staging (agreement AGR-2026-0915-0042).
--
-- Stages the provider row for the 'tinyfish' durable-research lane from the
-- cleared licensing agreement (version v1.3.0, dated 2026-09-15, expires
-- 2040-09-19, training-data opt-out confirmed TDO-2026-0915-0042). Only
-- version references, readiness flags and safe policy summaries live here:
-- no credential and no signed contract text.
--
-- The lane stays fail-closed after this migration: canary_result is
-- 'pending', so the gate keeps reporting controlled_canary_missing until a
-- controlled canary passes and a follow-up migration flips it to 'passed'.
--
-- Value mappings (explicit, not silent):
-- - The agreement grants "Organisation display"; the gate literal is
--   'organization_display'. Same right, code spelling stored.
-- - The agreement rate is $0.00 (free tier). The rates check requires a
--   positive rate, so the free-tier accounting floor of 1 micro-dollar is
--   staged per the documented convention in the TinyFish qualification
--   suite. Actual TinyFish Search cost stays zero; the enterprise rate
--   replaces this staging value when contracted.
-- - Retention summaries encode the agreed 10,000-day schedule; the worker
--   excerpt horizon (RESEARCH_EXCERPT_RETENTION_DAYS) must match.

insert into private.growth_intelligence_provider_qualifications (
  provider, agreement_version, agreement_date, agreement_expires_at,
  permitted_uses, retention_policy, deletion_rules, pricing_version,
  search_rate_micros_usd, credential_ready, model_bounds, canary_result
) values (
  'tinyfish',
  'v1.3.0',
  '2026-09-15',
  '2040-09-19T00:00:00Z',
  array['snippet_storage', 'commercial_inference', 'organization_display', 'derived_claims', 'synthesis_reuse', 'agreed_retention'],
  'AGR-2026-0915-0042: snippets, derived claims and syntheses retained up to 10,000 days from ingestion while the licence is valid; organisation-scoped with access controls',
  'AGR-2026-0915-0042: logical delete then permanent removal within 10,000 days of expiry or valid revocation; backups expire within 10,000 days of primary deletion; content-free audit record retained',
  'pricing-v2.1.0',
  1,
  true,
  '{"extraction": {"maxInputTokens": "32768", "maxOutputTokens": "4096"}, "supportReview": {"maxInputTokens": "65536", "maxOutputTokens": "8192"}, "synthesis": {"maxInputTokens": "131072", "maxOutputTokens": "16384"}}'::jsonb,
  'pending'
)
on conflict (provider) do update set
  agreement_version = excluded.agreement_version,
  agreement_date = excluded.agreement_date,
  agreement_expires_at = excluded.agreement_expires_at,
  permitted_uses = excluded.permitted_uses,
  retention_policy = excluded.retention_policy,
  deletion_rules = excluded.deletion_rules,
  pricing_version = excluded.pricing_version,
  search_rate_micros_usd = excluded.search_rate_micros_usd,
  credential_ready = excluded.credential_ready,
  model_bounds = excluded.model_bounds,
  canary_result = excluded.canary_result,
  updated_at = pg_catalog.now();
