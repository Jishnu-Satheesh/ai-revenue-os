-- Let the package actually move, now that re-projection admits it.
--
-- 20260831170000 taught `request_governed_report_package_projection` to accept a
-- package stuck in `reconciliation_required`, and it still could not move:
-- `private.prevent_report_package_mutation` keeps its own transition table, and
-- that table let `reconciliation_required` go only to `projected` or
-- `partially_projected`. The request was admitted and the update it makes was
-- refused, one line later, with `report_package_status_transition_is_invalid`.
--
-- The same shape as the analysis grain admitted in a check constraint but not in
-- the claim guard: a rule written down in two places, changed in one. Both are
-- now consistent, and the transition is exercised against staging rather than
-- assumed, because plpgsql resolves none of this until it runs.
--
-- This adds exactly one edge. `reconciliation_required -> awaiting_projection`
-- is a re-read of a file whose overlaps could not be settled; every other
-- transition out of that status is unchanged.

do $repair$
declare
  definition text;
  anchor constant text :=
    E'(or \\(old\\.status = ''reconciliation_required'' and new\\.status in \\(''reconciliation_required'', ''projected'', ''partially_projected''\\)\\))';
  hits integer;
begin
  select pg_catalog.pg_get_functiondef('private.prevent_report_package_mutation()'::regprocedure)
  into definition;

  select count(*)::integer into hits
  from pg_catalog.regexp_matches(definition, anchor, 'g');
  if hits <> 1 then
    raise exception 'package mutation guard is not the expected version (anchors found: %)', hits
      using errcode = '55000';
  end if;

  execute pg_catalog.regexp_replace(
    definition,
    anchor,
    E'or (old.status = ''reconciliation_required'' and new.status in (''reconciliation_required'', ''projected'', ''partially_projected'', ''awaiting_projection''))'
  );
end;
$repair$;
