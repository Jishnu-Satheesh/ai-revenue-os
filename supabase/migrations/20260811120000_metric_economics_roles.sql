-- Which registered metric plays which part in the channel economics ledger.
--
-- The ledger needs to read "gross revenue" and "the margin the operator's own
-- export stated". The second one is `margin.contribution`, which is Restaurant
-- Pack vocabulary, and per ADR 0006 core code must never name it. The
-- alternative -- a map from industry pack to metric keys held in code -- would
-- mean editing core for every new vertical and would leave an organization
-- whose export names margin differently with no way to say so.
--
-- So the binding is data, declared by whoever owns the vocabulary, and the
-- ledger asks the registry rather than a lookup table in TypeScript.
--
-- See specs/015 section 5 and specs/012 section 6.

alter table public.metric_definitions
  add column economics_role text check (
    economics_role in ('gross_revenue', 'transaction_count', 'unit_count', 'reported_margin')
  );

comment on column public.metric_definitions.economics_role is
  'Which channel economics input this metric supplies, or null if it supplies none. Most metrics supply none.';

-- One metric per role, resolved most-specific-wins exactly as keys are: shared
-- vocabulary is keyed by role alone, an organization override by role and
-- organization. Two candidates for one role would make the ledger''s choice of
-- input arbitrary, and a margin computed from an arbitrary input is worse than
-- no margin.
create unique index metric_definitions_global_economics_role_idx
  on public.metric_definitions (economics_role)
  where organization_id is null and economics_role is not null;

create unique index metric_definitions_organization_economics_role_idx
  on public.metric_definitions (organization_id, economics_role)
  where organization_id is not null and economics_role is not null;

-- Core vocabulary. Revenue and transaction counts are industry-neutral: every
-- business has both, whatever it calls the unit it sells.
update public.metric_definitions
set economics_role = 'gross_revenue'
where organization_id is null and key = 'revenue.gross';

update public.metric_definitions
set economics_role = 'transaction_count'
where organization_id is null and key = 'transactions.count';

-- Restaurant Pack vocabulary. A marketplace export states contribution margin
-- per day without ever saying what makes it up, which is precisely the
-- `reported` margin source in specs/012 section 4.4.1.
update public.metric_definitions
set economics_role = 'reported_margin'
where organization_id is null and key = 'margin.contribution';

-- `unit_count` is deliberately left unbound. No registered metric counts items
-- sold yet, so packaging -- which is charged per item, not per order -- stays
-- unpriced and its margin stays indicative. That is the honest state, and
-- binding the role to the transaction count to make the number appear would
-- understate packaging on every multi-item basket.
