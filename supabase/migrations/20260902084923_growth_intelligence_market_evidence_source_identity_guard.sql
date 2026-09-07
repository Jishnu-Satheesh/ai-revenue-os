-- The policy checks a canonical source domain. Bind it to the persisted public
-- URL so an adapter cannot relabel a source to bypass an excluded domain.
alter table public.market_evidence_sources
  add constraint market_evidence_sources_public_identity_check
  check (
    source_url ~ '^https?://[^/?#:@]+(?:/[^?#]*)?$'
    and source_domain = pg_catalog.lower(
      pg_catalog.regexp_replace(
        source_url,
        '^https?://([^/?#:]+)(?:/.*)?$',
        '\1'
      )
    )
  );
