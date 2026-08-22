-- The stable contract identity is append-only alongside its versions,
-- decisions, and bindings. Corrections are new versions, never relabels.

create trigger report_contracts_prevent_update
before update or delete on public.report_contracts
for each row execute function private.prevent_report_contract_mutation();
