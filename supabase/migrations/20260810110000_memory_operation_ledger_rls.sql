-- These ledgers are private implementation state for authenticated,
-- security-definer Memory RPCs. FORCE RLS also constrains the table-owning
-- definer, but the tables intentionally have no policies, so every governed
-- write fails before its idempotency record can be locked. Keep RLS enabled
-- and every browser role revoked; remove only FORCE so the existing definer
-- authorization checks can operate on their private ledger rows.
alter table public.memory_write_operations no force row level security;
alter table public.memory_promotion_operations no force row level security;
alter table public.memory_proposal_rejection_operations no force row level security;

revoke all on table public.memory_write_operations from public, anon, authenticated;
revoke all on table public.memory_promotion_operations from public, anon, authenticated;
revoke all on table public.memory_proposal_rejection_operations from public, anon, authenticated;
