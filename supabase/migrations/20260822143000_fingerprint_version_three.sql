-- Fingerprint version 3: several candidate header rows, not just the first.
--
-- Real exports do not put their headers on row one. Noon states a field row, an
-- English description row, and an Arabic description row before its single line
-- of values; Keeta's billing summary stacks a category row and a subcategory row
-- above its field names. Profiling recorded only the first candidate, so a
-- contract had no way to say which row the headers were really on.
--
-- The candidates feed the schema fingerprint, so recording more of them changes
-- the fingerprint a given file produces. That is a versioned change rather than
-- a silent one: previously profiled packages keep their version-2 fingerprint
-- and their bindings stay valid and readable, and anything reprofiled produces
-- a version-3 fingerprint that reads as drifted and asks for an approval, which
-- is exactly the behaviour section 8.4 already defines for a drifted schema.
--
-- Forward-only. No data is rewritten and no binding is invalidated.

alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_fingerprint_version_check,
  add constraint integration_report_packages_fingerprint_version_check
    check (fingerprint_version in (1, 2, 3)),
  alter column fingerprint_version set default 3;

alter table public.report_contract_versions
  drop constraint if exists report_contract_versions_fingerprint_version_check,
  add constraint report_contract_versions_fingerprint_version_check
    check (fingerprint_version in (1, 2, 3));
