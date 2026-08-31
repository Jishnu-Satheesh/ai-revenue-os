-- The rest of what a marketplace charges, and registry 7 to read it.
--
-- `cost.commission` arrived with Keeta's order export and closed the money
-- chapter's oldest gap. It also created a subtler one: commission is the
-- largest line a marketplace charges, so it reads like the whole bill.
--
-- Keeta's own statement of account settles the question. Reconciling a client's
-- two-month statement against what this platform records, commission and
-- merchant-borne promotion subsidies -- both already projected -- came to about
-- three quarters of what the marketplace actually invoiced. The rest was bank
-- charges and POS machine fees, and nothing here records either. An operator
-- reading a commission rate would reasonably conclude that is what the channel
-- costs; it was closer to twice that.
--
-- Both figures are already in the billing report this platform ingests. The
-- bank fee column is bound today and simply never projected; the POS column was
-- not bound at all. Neither needs new machinery -- only vocabulary to land in.
--
-- Pack-scoped like `cost.commission`, and for the same reason: a chain did not
-- invent payment processing fees, and registering them per tenant would collide
-- the moment a second client uploaded the same provider's export.
--
-- `cost.payment_processing` is the provider's own words -- Keeta's glossary
-- calls its bank charge "a transaction fee charged by the platform to cover
-- payment processor and bank fees". It is a cost of being paid, not a cost of
-- selling, and keeping it apart from commission is what lets a reader see that
-- the two are charged on different bases.
--
-- `cost.equipment_fee` is a device usage charge, not a purchase and not a
-- deduction from an order. It arrives in weekly lumps rather than daily, so a
-- day's sum is a fact about that day and most days carry a plain zero.
-- Spreading a month's charge across its days would invent daily figures the
-- provider never stated.

insert into public.metric_definitions (
  key, label, owner_scope, pack_slug, value_kind, unit, aggregation,
  percentile_p, rating_min, rating_max
)
values
  ('cost.payment_processing', 'Payment processing charged', 'pack', 'restaurant', 'money', null, 'sum', null, null, null),
  ('cost.equipment_fee', 'Provider equipment fee', 'pack', 'restaurant', 'money', null, 'sum', null, null, null)
on conflict do nothing;

-- Registry 7: `economics.channel_cost_load`, which adds the cost lines together
-- against the revenue they were charged on.
--
-- Admitted in both places. The version lives in a check constraint on
-- `channel_analysis_runs` and again in the guard inside `claim_channel_analysis`.
-- Changing only the constraint passes every unit test and then raises 22023 at
-- claim time -- that is what happened with registry 3 on 2026-08-28, and again
-- with the span grain on 2026-08-31.

alter table public.channel_analysis_runs
  drop constraint channel_analysis_runs_registry_version_check;
alter table public.channel_analysis_runs
  add constraint channel_analysis_runs_registry_version_check
  check (registry_version in (1, 2, 3, 4, 5, 6, 7));

do $repair$
declare
  claim_definition text;
  registry_pattern constant text := E'or p_registry_version not in \\(1, 2, 3, 4, 5, 6\\)';
  registry_hits integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_channel_analysis(uuid,uuid,uuid,date,date,text,uuid,integer,jsonb,jsonb,text,uuid,uuid)'::regprocedure
  ) into claim_definition;

  select count(*)::integer into registry_hits
  from pg_catalog.regexp_matches(claim_definition, registry_pattern, 'g');

  if registry_hits <> 1 then
    raise exception
      'claim_channel_analysis is not the expected version (registry allow-lists found: %)',
      registry_hits
      using errcode = '55000';
  end if;

  execute pg_catalog.regexp_replace(
    claim_definition,
    registry_pattern,
    E'or p_registry_version not in (1, 2, 3, 4, 5, 6, 7)'
  );
end;
$repair$;
