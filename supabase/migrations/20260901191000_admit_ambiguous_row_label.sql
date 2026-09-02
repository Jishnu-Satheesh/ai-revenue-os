-- A label the statement uses twice, refused rather than resolved.
--
-- A profit and loss repeats a label freely. `Total for Cost of Goods Sold`
-- appears once covering food and packaging and again including the delivery
-- commission, with different figures under each. The header map keeps the first
-- match it finds, so binding one silently picks a total nobody chose -- and on
-- the client's own statement the two candidates differ by the entire commission
-- bill.
--
-- Like a bill with two lines both called `Total`: pick the wrong one and the
-- cost is understated while everything reports itself as fine.
--
-- The reader now reports which labels are ambiguous and refuses any field that
-- binds one. That refusal needs a name an operator can act on, and
-- `REQUIRED_SOURCE_HEADER_MISSING` is the wrong one -- the header is present,
-- twice, which sends them looking for a column that is right there.
--
-- Admitted in both places, for the reason registry versions are: the code list
-- lives in `private.assert_report_validation_codes` and again in the check
-- constraint on `integration_report_packages.safe_failure_code`. Changing only
-- one passes every unit test and then raises 22023 when a real run reports it.

create or replace function private.assert_report_validation_codes(p_codes jsonb)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_codes) <> 'array' or jsonb_array_length(p_codes) > 50
    or exists (
      select 1 from jsonb_array_elements_text(p_codes) code
      where code not in (
        'REQUIRED_SHEET_MISSING', 'OPTIONAL_SHEET_MISSING', 'UNDECLARED_SHEET_PRESENT',
        'REQUIRED_SOURCE_HEADER_MISSING', 'REQUIRED_FIELD_MISSING', 'OPTIONAL_FIELD_MISSING',
        'INVALID_INTEGER', 'INVALID_DECIMAL', 'INVALID_MONEY', 'INVALID_LOCAL_DATE', 'INVALID_TIMESTAMP',
        'INVALID_DURATION', 'INVALID_PERCENTAGE', 'INVALID_TEXT', 'INVALID_ENUM', 'FORMULA_REJECTED',
        'FORMULA_VALUE_UNSUPPORTED', 'MERGED_CELLS_REJECTED', 'CONTROL_MISMATCH',
        'AMBIGUOUS_ROW_LABEL',
        'OBJECT_IDENTITY_CHANGED', 'OBJECT_UNAVAILABLE', 'PACKAGE_EXPIRED',
        'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
        'VALIDATION_PROCESSING_FAILED', 'UNREADABLE_WORKBOOK'
      )
    ) then
    raise exception 'report validation codes are invalid' using errcode = '22023';
  end if;
end;
$function$;

alter table public.integration_report_packages
  drop constraint if exists integration_report_packages_safe_failure_code_check,
  add constraint integration_report_packages_safe_failure_code_check check (safe_failure_code is null or safe_failure_code in (
    'UPLOAD_EXPIRED', 'OBJECT_UNAVAILABLE', 'OBJECT_IDENTITY_CHANGED', 'INVALID_FILE_TYPE', 'FILE_TOO_LARGE',
    'TOO_MANY_SHEETS', 'TOO_MANY_ROWS', 'TOO_MANY_POPULATED_CELLS', 'EXPANDED_CONTENT_TOO_LARGE',
    'UNSAFE_WORKBOOK', 'UNREADABLE_WORKBOOK', 'PROFILE_FAILED', 'PACKAGE_EXPIRED',
    'CONTRACT_VERSION_NOT_APPROVED', 'CONTRACT_BINDING_INACTIVE', 'CONTRACT_CONTEXT_MISMATCH',
    'REQUIRED_SHEET_MISSING', 'REQUIRED_SOURCE_HEADER_MISSING', 'REQUIRED_FIELD_MISSING',
    'INVALID_INTEGER', 'INVALID_DECIMAL', 'INVALID_MONEY', 'INVALID_LOCAL_DATE', 'INVALID_TIMESTAMP',
    'INVALID_DURATION', 'INVALID_PERCENTAGE', 'INVALID_TEXT', 'INVALID_ENUM', 'FORMULA_REJECTED',
    'FORMULA_VALUE_UNSUPPORTED', 'MERGED_CELLS_REJECTED', 'CONTROL_MISMATCH',
    'AMBIGUOUS_ROW_LABEL',
    'UNDECLARED_SHEET_PRESENT', 'VALIDATION_PROCESSING_FAILED',
    'PROJECTION_VERSION_NOT_APPROVED', 'PROJECTION_BINDING_INACTIVE', 'PROJECTION_CONTEXT_MISMATCH',
    'PROJECTION_FIELD_VALUE_KIND_MISMATCH', 'REQUIRED_PROJECTED_VALUE_MISSING',
    'CONTROL_TOTAL_MISMATCH', 'PROJECTION_OUTPUT_KIND_UNSUPPORTED', 'TOTALS_ROW_NOT_RESOLVED',
    'PERIOD_OUT_OF_DECLARED_RANGE',
    'PROJECTION_PROCESSING_FAILED'
  ));
