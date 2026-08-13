-- Cover the two nullable result foreign keys used when referenced Decision
-- rows are checked for deletion. Partial indexes keep the private ledger small
-- while operations are merely claimed, cancelled, or failed.

create index decision_cycle_operations_result_record_idx
  on private.decision_cycle_operations(
    organization_id,
    result_decision_record_id
  )
  where result_decision_record_id is not null;

create index decision_cycle_operations_result_opportunity_idx
  on private.decision_cycle_operations(
    organization_id,
    result_opportunity_id
  )
  where result_opportunity_id is not null;
