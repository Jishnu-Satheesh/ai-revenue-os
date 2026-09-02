-- Registry 9: the first detector that reads the client's own books.
--
-- Every detector before this one reads a marketplace's export, and no
-- marketplace has ever told this platform what the food cost. The money chapter
-- has said so since it was written: what remains after a marketplace's
-- deductions is not profit, because food, packaging, labour and rent are not in
-- any approved report.
--
-- The company's profit and loss states the first two, monthly, and the platform
-- can read it now. `economics.company_cost_structure` reads food, packaging and
-- the marketplace commission the books recorded against the revenue the books
-- state, and reports each line separately as well as together -- a reader
-- deciding what to do needs to know whether the cost sits in the kitchen or in
-- the commission, and one combined ratio hides exactly that.
--
-- It divides by `revenue.company_gross`, never `revenue.gross`. A statement that
-- books marketplace commission as a cost has, under accrual, already counted
-- those marketplaces' sales as income, so dividing a company cost by one
-- channel's revenue would compare a whole against a part. Nothing here is ever
-- attributed to a channel: a set of books does not say which marketplace an
-- order's ingredients were bought for.
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
  check (registry_version in (1, 2, 3, 4, 5, 6, 7, 8, 9));

do $repair$
declare
  claim_definition text;
  registry_pattern constant text := E'or p_registry_version not in \\(1, 2, 3, 4, 5, 6, 7, 8\\)';
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
    E'or p_registry_version not in (1, 2, 3, 4, 5, 6, 7, 8, 9)'
  );
end;
$repair$;
