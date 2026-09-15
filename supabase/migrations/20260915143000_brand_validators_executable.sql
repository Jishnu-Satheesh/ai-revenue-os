-- Let the brand tables actually be written to.
--
-- `20260915120000_brand_identity.sql` guarded its validators with
-- `revoke all ... from public`, copying the Asset Library migration. That was
-- the wrong pattern to copy. The Asset Library's tables are written only
-- through `security definer` RPCs, which execute as the function owner, so its
-- validators never need to be callable by anybody else.
--
-- These tables are written directly by `authenticated` under RLS. A CHECK
-- constraint is evaluated as the calling user, so every insert died on
-- "permission denied for function brand_palette_valid". Nothing could ever
-- have been written — the table was locked against the only writes it exists
-- for, which is exactly the shape of the defect that the monitoring scope
-- fingerprint table hit the same week.
--
-- Two changes, both narrow:
--
-- The validators become executable by `authenticated`. They are pure
-- predicates over a value the caller already holds: they read no table, take
-- no tenant, and returning a boolean about the caller's own input discloses
-- nothing they did not already know.
--
-- `restricted_terms` stops borrowing `private.asset_library_text_array_valid`.
-- Granting execute on a function three other tables depend on would widen a
-- blast radius for no reason, so brand identity gets its own predicate with
-- the same bounds.

create function private.brand_restricted_terms_valid(input_terms text[])
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select input_terms is not null
    and pg_catalog.cardinality(input_terms) <= 200
    and not exists (
      select 1
      from pg_catalog.unnest(input_terms) as term(value)
      where term.value is null
        or pg_catalog.char_length(pg_catalog.btrim(term.value)) not between 1 and 80
    )
    -- Distinct, so the same term entered twice does not become two rules that
    -- later disagree when one of them is edited.
    and pg_catalog.cardinality(input_terms) = (
      select pg_catalog.count(distinct term.value)::integer
      from pg_catalog.unnest(input_terms) as term(value)
    );
$$;

alter table public.organization_brand_guidelines
  drop constraint organization_brand_guidelines_restricted_terms_check;

alter table public.organization_brand_guidelines
  add constraint organization_brand_guidelines_restricted_terms_check
  check (private.brand_restricted_terms_valid(restricted_terms));

-- Executable by a signed-in user, because that is who the CHECK runs as.
-- Still revoked from `public` and `anon`: an unauthenticated caller has no
-- reason to reach them.
revoke all on function private.brand_restricted_terms_valid(text[]) from public, anon;
grant execute on function private.brand_palette_valid(jsonb) to authenticated;
grant execute on function private.brand_rules_valid(jsonb) to authenticated;
grant execute on function private.brand_restricted_terms_valid(text[]) to authenticated;
