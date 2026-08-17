-- The generic audit trigger records identifiers, operation, and bounded status;
-- it deliberately never copies evidence bundles, feedback diffs, or PII.
create trigger audit_decision_cycle
  after insert or update on public.decision_cycles
  for each row execute function private.audit_organization_change();
create trigger audit_decision_record
  after insert on public.decision_records
  for each row execute function private.audit_organization_change();
create trigger audit_opportunity
  after insert or update on public.opportunities
  for each row execute function private.audit_organization_change();
create trigger audit_decision_feedback
  after insert on public.decision_feedback
  for each row execute function private.audit_organization_change();
