export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          industry: string;
          country_code: string;
          base_currency: string;
          default_timezone: string;
          industry_pack_slug: string;
          branchless_confirmed: boolean;
          status: "draft_onboarding" | "active" | "archived";
          /** The agency that owns this client. Immutable after creation. */
          account_id: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organizations"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "archived_at"
          | "status"
          | "industry_pack_slug"
          | "branchless_confirmed"
          | "account_id"
        > & {
          status?: Database["public"]["Tables"]["organizations"]["Row"]["status"];
          industry_pack_slug?: string;
          branchless_confirmed?: boolean;
          /** Set by create_organization_with_owner_v3, never by a client insert. */
          account_id?: string;
        };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
        Relationships: [];
      };
      branches: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          kind: "physical" | "virtual";
          timezone: string;
          currency: string;
          service_area: Record<string, unknown>;
          operating_hours: Record<string, unknown>;
          contact_details: Record<string, unknown>;
          capacity_metadata: Record<string, unknown>;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["branches"]["Row"],
          "id" | "created_at" | "updated_at" | "is_active"
        > & { is_active?: boolean };
        Update: Partial<Database["public"]["Tables"]["branches"]["Insert"]>;
        Relationships: [];
      };
      organization_market_profiles: {
        Row: {
          id: string;
          organization_id: string;
          current_version_id: string | null;
          enabled: boolean;
          next_daily_research_due_at: string | null;
          next_weekly_synthesis_due_at: string | null;
          last_research_succeeded_at: string | null;
          last_weekly_synthesis_succeeded_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      organization_market_profile_versions: {
        Row: {
          id: string;
          organization_id: string;
          market_profile_id: string;
          version: number;
          schema_version: number;
          profile_document: Record<string, unknown>;
          profile_digest: string;
          source_policy_digest: string;
          proposal_source: "operator" | "ai" | "system";
          model_provider: string | null;
          model_name: string | null;
          model_version: string | null;
          model_input_digest: string | null;
          created_by: string | null;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      organization_market_profile_decisions: {
        Row: {
          id: string;
          organization_id: string;
          market_profile_id: string;
          market_profile_version_id: string;
          decision: "confirmed" | "rejected" | "disabled" | "superseded";
          profile_digest: string;
          superseded_by_version_id: string | null;
          reason: string | null;
          decided_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      growth_intelligence_requests: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          channel_id: string | null;
          kind:
            | "profile_discovery"
            | "market_research"
            | "weekly_synthesis"
            | "business_evidence_changed"
            | "evidence_reassessment";
          trigger_reason:
            | "profile_confirmed"
            | "profile_revised"
            | "daily_due"
            | "weekly_due"
            | "business_evidence_current"
            | "source_policy_changed"
            | "evidence_expired"
            | "source_changed"
            | "manual_retry";
          request_fingerprint: string;
          business_evidence_digest: string | null;
          market_profile_version_id: string;
          source_policy_digest: string;
          research_rule_version: string;
          local_time_bucket: string;
          synthesis_version_tuple: string | null;
          playbook_version_tuple: string | null;
          status: "pending" | "claimed" | "succeeded" | "failed" | "cancelled";
          due_at: string;
          claim_token: string | null;
          lease_expires_at: string | null;
          attempt_count: number;
          max_attempts: number;
          dispatch_attempt_count: number;
          last_dispatch_attempt_at: string | null;
          safe_failure_code: string | null;
          failed_at: string | null;
          completed_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          requested_by: string | null;
          last_transition_actor_type: Database["public"]["Enums"]["audit_actor_type"];
          last_transition_actor_id: string | null;
          correlation_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      organization_channels: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          display_name: string;
          category: "marketplace" | "owned_digital" | "physical" | "reseller" | "other";
          template_key: string | null;
          status: "active" | "archived";
          created_by: string;
          archived_by: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organization_channels"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "template_key"
          | "status"
          | "archived_by"
          | "archived_at"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["organization_channels"]["Row"],
              "template_key" | "status" | "archived_by" | "archived_at"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["organization_channels"]["Insert"]>;
        Relationships: [];
      };
      organization_channel_branches: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          branch_id: string;
          status: "active" | "inactive";
          effective_from: string | null;
          effective_to: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organization_channel_branches"]["Row"],
          "id" | "created_at" | "updated_at" | "status" | "effective_from" | "effective_to"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["organization_channel_branches"]["Row"],
              "status" | "effective_from" | "effective_to"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["organization_channel_branches"]["Insert"]>;
        Relationships: [];
      };
      channel_source_aliases: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          alias: string;
          normalized_alias: string;
          source_scope:
            | "onboarding"
            | "normalized_metric"
            | "economics_entry"
            | "cost_rate"
            | "report_package"
            | "manual";
          source_record_reference: string | null;
          status: "active" | "retired";
          effective_from: string | null;
          effective_to: string | null;
          confirmed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["channel_source_aliases"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "source_record_reference"
          | "status"
          | "effective_from"
          | "effective_to"
          | "confirmed_at"
          | "created_by"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["channel_source_aliases"]["Row"],
              | "source_record_reference"
              | "status"
              | "effective_from"
              | "effective_to"
              | "confirmed_at"
              | "created_by"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["channel_source_aliases"]["Insert"]>;
        Relationships: [];
      };
      business_profiles: {
        Row: {
          organization_id: string;
          business_model: string | null;
          value_proposition: string | null;
          customer_segments: unknown[];
          brand_context: Record<string, unknown>;
          languages: string[];
          operating_model: Record<string, unknown>;
          source: string;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["business_profiles"]["Row"],
          "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["business_profiles"]["Insert"]>;
        Relationships: [];
      };
      business_facts: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          fact_key: string;
          value: unknown;
          source: string;
          source_reference: string | null;
          status: "verified" | "imported" | "inferred" | "stale";
          confidence: number | null;
          effective_from: string | null;
          effective_to: string | null;
          last_verified_at: string | null;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["business_facts"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["business_facts"]["Insert"]>;
        Relationships: [];
      };
      goals: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          metric: string;
          metric_key: string | null;
          baseline_status: "known" | "unknown" | "estimated";
          baseline_value: number | null;
          target_value: number;
          unit: string;
          currency: string | null;
          deadline: string | null;
          scope_kind: "organization" | "branch";
          scope_branch_id: string | null;
          owner_id: string | null;
          priority: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["goals"]["Row"],
          "id" | "created_at" | "updated_at" | "metric_key"
        > &
          Partial<Pick<Database["public"]["Tables"]["goals"]["Row"], "metric_key">>;
        Update: Partial<Database["public"]["Tables"]["goals"]["Insert"]>;
        Relationships: [];
      };
      subject_kinds: {
        Row: {
          key: string;
          label: string;
          owner_scope: "core" | "pack";
          pack_slug: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["subject_kinds"]["Row"], "created_at">;
        Update: Partial<Database["public"]["Tables"]["subject_kinds"]["Insert"]>;
        Relationships: [];
      };
      integration_data_sources: {
        Row: {
          id: string;
          organization_id: string;
          source_type: "manual" | "csv_import";
          name: string;
          branch_id: string | null;
          status: "pending" | "ready" | "processing" | "failed" | "archived";
          storage_path: string | null;
          original_filename: string | null;
          media_type: string | null;
          size_bytes: number | null;
          schema_version: number;
          column_mapping: Record<string, string>;
          last_successful_import_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["integration_data_sources"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["integration_data_sources"]["Insert"]>;
        Relationships: [];
      };
      /** Immutable governed report intake metadata. Original files stay in private Storage. */
      integration_report_packages: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          branch_id: string;
          report_type: string;
          declared_period_start: string;
          declared_period_end: string;
          declared_currency: string;
          period_timezone: string;
          file_kind: "csv" | "xlsx" | "pdf";
          original_filename: string;
          declared_content_type: string;
          declared_content_length: number;
          storage_bucket_id: string;
          storage_path: string;
          storage_object_id: string | null;
          storage_object_version: string | null;
          content_sha256: string | null;
          parser_version: number;
          fingerprint_version: number;
          schema_fingerprint: string | null;
          structure_version: number;
          structure_fingerprint: string | null;
          admitted_under_admission_id: string | null;
          status:
            | "awaiting_upload"
            | "uploaded"
            | "profiling"
            | "awaiting_contract"
            | "awaiting_approval"
            | "awaiting_validation"
            | "validating"
            | "validated"
            | "partially_validated"
            | "validation_failed"
            | "awaiting_projection"
            | "projecting"
            | "projected"
            | "partially_projected"
            | "reconciliation_required"
            | "projection_failed"
            | "failed";
          safe_failure_code: string | null;
          safe_failure_at: string | null;
          upload_expires_at: string;
          uploaded_at: string | null;
          profiled_at: string | null;
          retained_until: string;
          created_by: string;
          correlation_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Bounded structural evidence only: no raw sheet cells or rows. */
      integration_report_sheet_manifests: {
        Row: {
          id: string;
          organization_id: string;
          report_package_id: string;
          sheet_position: number;
          sheet_name: string;
          normalized_sheet_name: string;
          row_count: number;
          populated_cell_count: number;
          expanded_bytes: number;
          content_digest: string | null;
          /** SHA-256 structural-header evidence only; never workbook values. */
          header_candidate_digests: unknown;
          /** Deprecated legacy column. Database migration permanently redacts it. */
          header_candidates: unknown;
          has_formula: boolean;
          has_merged_cells: boolean;
          has_repeated_header: boolean;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Bounded deterministic evidence for one approved report contract validation. */
      integration_report_validation_runs: {
        Row: {
          id: string;
          organization_id: string;
          report_package_id: string;
          report_contract_version_id: string;
          report_contract_binding_id: string;
          validator_version: number;
          input_digest: string;
          result_digest: string | null;
          status: "running" | "validated" | "partially_validated" | "failed";
          quality_state: "complete" | "partial" | "failed" | null;
          completeness_state: "complete" | "partial" | "unavailable" | null;
          error_codes: unknown;
          warning_codes: unknown;
          correlation_id: string;
          started_at: string;
          completed_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Sheet-level counters and codes; no workbook values or cells. */
      integration_report_validation_sheet_results: {
        Row: {
          id: string;
          organization_id: string;
          validation_run_id: string;
          normalized_sheet_name: string;
          required: boolean;
          outcome: "validated" | "warning" | "failed";
          row_count: number;
          populated_cell_count: number;
          parsed_field_success_count: number;
          parsed_field_failure_count: number;
          error_codes: unknown;
          warning_codes: unknown;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Contract control counters only; no report values. */
      integration_report_validation_control_results: {
        Row: {
          id: string;
          organization_id: string;
          validation_run_id: string;
          control_key: string;
          control_kind: "row_count" | "populated_cell_count";
          normalized_sheet_name: string;
          expected_count: number;
          actual_count: number;
          tolerance: number;
          passed: boolean;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Stable identity for one organization/channel/report-family contract lineage. */
      report_contracts: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          report_type: string;
          outlet_grain: "branch";
          created_by: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Immutable, declarative and value-free report contract proposal. */
      report_contract_versions: {
        Row: {
          id: string;
          organization_id: string;
          report_contract_id: string;
          report_package_id: string;
          version: number;
          schema_fingerprint: string;
          parser_version: number;
          fingerprint_version: number;
          mapping_document: unknown;
          mapping_digest: string;
          declared_currency: string;
          financial_sign_semantics: unknown;
          controls: unknown;
          unmapped_field_disposition: "reviewed_ignore" | "requires_mapping";
          proposal_source: "human" | "library";
          provider_definition_key: string | null;
          created_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Append-only owner/admin decision on one exact report contract version. */
      report_contract_decisions: {
        Row: {
          id: string;
          organization_id: string;
          report_contract_version_id: string;
          decision: "approved" | "rejected";
          mapping_digest: string;
          reason: string | null;
          decided_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** One active exact fingerprint binding may be trusted after human approval. */
      report_contract_bindings: {
        Row: {
          id: string;
          organization_id: string;
          report_contract_id: string;
          report_contract_version_id: string;
          channel_id: string;
          report_type: string;
          schema_fingerprint: string;
          declared_currency: string;
          outlet_grain: "branch";
          active: boolean;
          bound_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      report_projection_versions: {
        Row: {
          id: string;
          organization_id: string;
          report_contract_version_id: string;
          version: number;
          projection_document: unknown;
          projection_digest: string;
          calculation_version: number;
          proposal_source: "human" | "library";
          provider_definition_key: string | null;
          created_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      report_projection_decisions: {
        Row: {
          id: string;
          organization_id: string;
          report_projection_version_id: string;
          decision: "approved" | "rejected";
          projection_digest: string;
          reason: string | null;
          decided_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      report_projection_bindings: {
        Row: {
          id: string;
          organization_id: string;
          report_contract_version_id: string;
          report_contract_binding_id: string;
          report_projection_version_id: string;
          schema_fingerprint: string;
          declared_currency: string;
          active: boolean;
          bound_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      integration_report_projection_runs: {
        Row: {
          id: string;
          organization_id: string;
          report_package_id: string;
          report_contract_version_id: string;
          report_contract_binding_id: string;
          report_projection_version_id: string;
          report_projection_binding_id: string;
          validation_run_id: string;
          calculation_version: number;
          input_digest: string;
          result_digest: string | null;
          status: "running" | "projected" | "partially_projected" | "failed";
          quality_state: "complete" | "partial" | "failed" | null;
          completeness_state: "complete" | "partial" | "unavailable" | null;
          output_count: number;
          absent_row_count: number | null;
          error_codes: unknown;
          warning_codes: unknown;
          /**
           * What the failure knew about itself, bounded to 300 characters:
           * the error's own name and message, never workbook content. Null on
           * a run that succeeded, and on every failure recorded before the
           * platform started keeping this.
           */
          failure_detail: string | null;
          correlation_id: string;
          started_at: string;
          completed_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      exact_range_metric_observations: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string;
          channel_id: string;
          metric_definition_id: string;
          projection_output_key: string;
          value_kind: "money" | "count";
          subject_kind: "organization";
          subject_ref: null;
          dimensions: unknown;
          period_start: string;
          period_end: string;
          period_timezone: string;
          value_numerator: number;
          value_denominator: null;
          currency: string | null;
          quality_state: "complete" | "partial";
          completeness_state: "complete" | "partial";
          revision: number;
          superseded_by_id: string | null;
          supersede_reason: string | null;
          reconciliation_state: "current" | "blocked_overlap" | "excluded" | "superseded";
          reconciliation_digest: string | null;
          report_package_id: string;
          validation_run_id: string;
          report_contract_version_id: string;
          report_projection_version_id: string;
          projection_run_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      report_projection_lineage: {
        Row: {
          id: string;
          organization_id: string;
          /** Exactly one of these two names the ledger this lineage resolves into. */
          exact_range_metric_observation_id: string | null;
          normalized_metric_id: string | null;
          report_package_id: string;
          validation_run_id: string;
          projection_run_id: string;
          report_contract_version_id: string;
          report_projection_version_id: string;
          normalized_sheet_name: string;
          canonical_field: string;
          source_column_ordinal: number;
          /** Null for a series: the projector computes no row range per period. */
          first_data_row: number | null;
          last_data_row: number | null;
          contributor_count: number;
          calculation_version: number;
          source_digest: string;
          quality_state: "complete" | "partial";
          completeness_state: "complete" | "partial";
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      report_projection_reconciliations: {
        Row: {
          id: string;
          organization_id: string;
          report_package_id: string;
          projection_run_id: string;
          projection_output_key: string;
          projection_target: "exact_range" | "period_grain";
          /** Inclusive local dates, set for a series and null for an exact range. */
          period_start: string | null;
          period_end: string | null;
          classification:
            | "exact_duplicate"
            | "non_overlapping"
            | "ambiguous_overlap"
            | "approved_correction";
          reconciliation_digest: string;
          prior_observation_id: string | null;
          prior_normalized_metric_id: string | null;
          result_observation_id: string | null;
          result_normalized_metric_id: string | null;
          candidate_count: number;
          quality_state: "complete" | "partial";
          completeness_state: "complete" | "partial";
          calculation_version: number;
          correlation_id: string;
          created_at: string;
          withdrawn_at: string | null;
          withdrawn_reason: "package_reprojection_requested" | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      report_projection_reconciliation_resolutions: {
        Row: {
          id: string;
          organization_id: string;
          reconciliation_id: string;
          resolution: "accept_correction" | "keep_existing";
          outcome_classification: "approved_correction" | "existing_retained" | null;
          reconciliation_digest: string;
          prior_observation_id: string | null;
          prior_normalized_metric_id: string | null;
          result_observation_id: string | null;
          result_normalized_metric_id: string | null;
          resolved_by: string;
          correlation_id: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** One durable, revocable grant admitting a report structure. See ADR 0046. */
      report_structure_admissions: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          structure_fingerprint: string;
          structure_version: number;
          declared_currency: string;
          outlet_grain: "branch";
          report_type: string;
          report_family_key: string | null;
          report_contract_version_id: string;
          report_projection_version_id: string;
          active: boolean;
          granted_by: string;
          granted_at: string;
          revoked_by: string | null;
          revoked_at: string | null;
          correlation_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_analysis_runs: {
        Row: {
          id: string;
          organization_id: string;
          /** Null for a run whose detectors compare channels against each other. */
          channel_id: string | null;
          branch_id: string | null;
          /** Inclusive local calendar dates in `window_timezone`. */
          window_start: string;
          window_end: string;
          period_grain: "day" | "week" | "month" | "span";
          window_timezone: string;
          registry_version: number;
          /** `[{ key, calculationVersion }]` -- what actually ran. */
          detector_versions: unknown;
          /** `[{ key, metricDefinitionId, valueKind }]`, resolved by the database. */
          metric_versions: unknown;
          input_digest: string;
          result_digest: string | null;
          status: "running" | "completed" | "failed";
          finding_count: number;
          observation_count: number;
          needs_data_count: number;
          safe_failure_code: string | null;
          correlation_id: string;
          started_at: string;
          completed_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_findings: {
        Row: {
          id: string;
          organization_id: string;
          analysis_run_id: string;
          channel_id: string | null;
          branch_id: string | null;
          detector_key: string;
          detector_version: number;
          kind: "observation" | "finding" | "needs_data";
          code: string;
          /** Set only when `kind` is `finding`. */
          severity: "critical" | "high" | "medium" | "low" | null;
          /** 1 is most urgent. Set only when `kind` is `finding`. */
          priority: number | null;
          metric_key: string | null;
          metric_definition_id: string | null;
          period_start: string | null;
          period_end: string | null;
          value_kind: "money" | "count" | "ratio" | null;
          value_numerator: number | null;
          value_denominator: number | null;
          currency: string | null;
          monetary_impact_minor_units: number | null;
          expected_period_count: number | null;
          observed_period_count: number | null;
          absent_period_count: number | null;
          quality_state: "complete" | "partial";
          needs_data_reason: string | null;
          limitations: unknown;
          calculation_digest: string;
          status: "open" | "superseded";
          superseded_by_run_id: string | null;
          superseded_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_finding_evidence: {
        Row: {
          id: string;
          organization_id: string;
          finding_id: string;
          evidence_kind:
            | "normalized_metric"
            | "exact_range_metric_observation"
            | "report_projection_reconciliation"
            | "projection_run";
          evidence_role:
            | "subject_period"
            | "prior_period"
            | "component"
            | "denominator"
            | "held_evidence"
            | "gap_count";
          /** Exactly one of these four names the record this citation resolves to. */
          normalized_metric_id: string | null;
          exact_range_metric_observation_id: string | null;
          reconciliation_id: string | null;
          projection_run_id: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_recommendations: {
        Row: {
          id: string;
          organization_id: string;
          channel_id: string;
          branch_id: string | null;
          analysis_run_id: string;
          /** Inclusive local calendar dates copied from the analysed run's window. */
          window_start: string;
          window_end: string;
          period_grain: "day" | "week" | "month" | "span";
          label: "observation" | "recommendation" | "needs_data";
          headline: string;
          detail: string;
          supported_actions: unknown;
          limitations: unknown;
          prompt_version: number;
          prompt_digest: string;
          output_digest: string;
          provider: string;
          model_id: string;
          result_digest: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_recommendation_citations: {
        Row: {
          recommendation_id: string;
          finding_id: string;
          organization_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_recommendation_decisions: {
        Row: {
          id: string;
          organization_id: string;
          recommendation_id: string;
          decision: "acknowledged" | "dismissed" | "planned";
          /** Required when the decision dismisses; null for every other answer. */
          dismissal_reason: string | null;
          actor_id: string;
          /**
           * Snapshot of the actor's display name, resolved definer-side at
           * answer time (20260824170000); 'Unknown' without a readable profile.
           */
          actor_display_name: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_recommendation_feedback: {
        Row: {
          organization_id: string;
          recommendation_id: string;
          actor_id: string;
          helpful: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      channel_recommendation_evaluations: {
        Row: {
          id: string;
          organization_id: string;
          recommendation_id: string;
          batch_id: string;
          citation_faithful: boolean;
          label_appropriate: boolean;
          invented_value_detected: boolean;
          uncertainty_honest: boolean;
          score: number;
          issues: unknown;
          notes: string;
          judge_provider: string;
          judge_model: string;
          judge_prompt_version: number;
          judge_prompt_digest: string;
          judge_output_digest: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      cost_component_definitions: {
        Row: {
          id: string;
          organization_id: string | null;
          key: string;
          label: string;
          owner_scope: "core" | "pack" | "organization";
          pack_slug: string | null;
          computation_kind: "fixed_amount" | "rate_of_revenue" | "per_unit" | "sourced";
          applies_to_channels: string[] | null;
          /** Set only for a `sourced` component: the metric supplying its amount. */
          source_metric_key: string | null;
          default_quality_tier: "measured" | "derived" | "estimated" | "assumed";
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["cost_component_definitions"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["cost_component_definitions"]["Insert"]>;
        Relationships: [];
      };
      cost_component_rates: {
        Row: {
          id: string;
          organization_id: string;
          definition_id: string;
          branch_id: string | null;
          channel: string | null;
          channel_id: string | null;
          channel_label_snapshot: string | null;
          amount_minor: number | null;
          rate_of_revenue: number | null;
          currency: string | null;
          quality_tier: "measured" | "derived" | "estimated" | "assumed";
          source_reference: string | null;
          effective_from: string;
          effective_to: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["cost_component_rates"]["Row"],
          "id" | "created_at" | "updated_at" | "channel_id" | "channel_label_snapshot"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["cost_component_rates"]["Row"],
              "channel_id" | "channel_label_snapshot"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["cost_component_rates"]["Insert"]>;
        Relationships: [];
      };
      channel_economics_entries: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          grain: "transaction" | "period";
          channel: string | null;
          channel_id: string | null;
          channel_label_snapshot: string | null;
          period_start: string;
          period_end: string;
          period_timezone: string;
          gross_revenue_minor: number;
          transaction_count: number;
          unit_count: number | null;
          currency: string;
          margin_source: "derived" | "reported";
          completeness_grade: "complete" | "partial" | "indicative";
          contribution_margin_minor: number | null;
          at_most_minor: number | null;
          reported_quality_tier: "measured" | "derived" | "estimated" | "assumed" | null;
          /** What the source reported, kept only where a derived figure took precedence. */
          reported_margin_minor: number | null;
          source_reference: string | null;
          computed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["channel_economics_entries"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "computed_at"
          | "channel_id"
          | "channel_label_snapshot"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["channel_economics_entries"]["Row"],
              "computed_at" | "channel_id" | "channel_label_snapshot"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["channel_economics_entries"]["Insert"]>;
        Relationships: [];
      };
      channel_economics_components: {
        Row: {
          id: string;
          organization_id: string;
          entry_id: string;
          definition_id: string;
          rate_id: string | null;
          amount_minor: number;
          quality_tier: "measured" | "derived" | "estimated" | "assumed" | "missing";
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["channel_economics_components"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["channel_economics_components"]["Insert"]>;
        // Declared so the operator view can embed components under their entry
        // and resolve each component's registered label in one round trip.
        // Without these, PostgREST embeds are untypable here.
        Relationships: [
          {
            foreignKeyName: "channel_economics_components_entry_id_fkey";
            columns: ["entry_id"];
            isOneToOne: false;
            referencedRelation: "channel_economics_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "channel_economics_components_definition_id_fkey";
            columns: ["definition_id"];
            isOneToOne: false;
            referencedRelation: "cost_component_definitions";
            referencedColumns: ["id"];
          },
        ];
      };
      metric_definitions: {
        Row: {
          id: string;
          organization_id: string | null;
          key: string;
          label: string;
          owner_scope: "core" | "pack" | "organization";
          pack_slug: string | null;
          value_kind: "count" | "money" | "ratio" | "duration" | "rating";
          unit: string | null;
          aggregation: "sum" | "ratio_of_sums" | "mean" | "weighted_mean" | "percentile" | "last";
          percentile_p: number | null;
          rating_min: number | null;
          rating_max: number | null;
          default_quality_tier: "measured" | "derived" | "estimated" | "assumed";
          /** Which channel economics input this metric supplies, if any. */
          economics_role:
            | "gross_revenue"
            | "transaction_count"
            | "unit_count"
            | "reported_margin"
            | null;
          replaced_by_key: string | null;
          effective_from: string;
          effective_to: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["metric_definitions"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["metric_definitions"]["Insert"]>;
        Relationships: [];
      };
      metric_dimension_definitions: {
        Row: {
          id: string;
          key: string;
          label: string;
          owner_scope: "core" | "pack";
          pack_slug: string | null;
          cardinality_max: number;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["metric_dimension_definitions"]["Row"],
          "id" | "created_at"
        >;
        Update: Partial<Database["public"]["Tables"]["metric_dimension_definitions"]["Insert"]>;
        Relationships: [];
      };
      normalized_metrics: {
        Row: {
          id: string;
          organization_id: string;
          branch_id: string | null;
          metric_definition_id: string;
          value_kind: "count" | "money" | "ratio" | "duration" | "rating";
          subject_kind: string;
          subject_ref: string | null;
          channel: string | null;
          channel_id: string | null;
          channel_label_snapshot: string | null;
          dimensions: Record<string, unknown>;
          period_grain: "hour" | "day" | "week" | "month";
          period_start: string;
          period_end: string;
          period_timezone: string;
          value_numerator: number;
          value_denominator: number | null;
          currency: string | null;
          quality_tier: "measured" | "derived" | "estimated" | "assumed";
          revision: number;
          superseded_by_id: string | null;
          supersede_reason: string | null;
          source_ingestion_run_id: string | null;
          reconciliation_state: "current" | "blocked_overlap" | "excluded";
          reconciliation_digest: string | null;
          observed_at: string;
          ingested_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["normalized_metrics"]["Row"],
          | "id"
          | "created_at"
          | "ingested_at"
          | "subject_kind"
          | "subject_ref"
          | "channel"
          | "channel_id"
          | "channel_label_snapshot"
          | "dimensions"
          | "revision"
          | "superseded_by_id"
          | "supersede_reason"
          | "source_ingestion_run_id"
          | "reconciliation_state"
          | "reconciliation_digest"
          | "branch_id"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["normalized_metrics"]["Row"],
              | "ingested_at"
              | "subject_kind"
              | "subject_ref"
              | "channel"
              | "channel_id"
              | "channel_label_snapshot"
              | "dimensions"
              | "revision"
              | "superseded_by_id"
              | "supersede_reason"
              | "source_ingestion_run_id"
              | "reconciliation_state"
              | "reconciliation_digest"
              | "branch_id"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["normalized_metrics"]["Insert"]>;
        Relationships: [];
      };
      constraints: {
        Row: {
          id: string;
          organization_id: string;
          constraint_key: string;
          name: string;
          constraint_type: string;
          value: unknown;
          severity: "soft" | "hard";
          source: string;
          scope_kind: string;
          scope_ref: string | null;
          version: number;
          effective_from: string;
          effective_to: string | null;
          superseded_by_id: string | null;
          is_active: boolean;
          created_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["constraints"]["Row"],
          | "id"
          | "created_at"
          | "updated_at"
          | "scope_kind"
          | "scope_ref"
          | "version"
          | "effective_from"
          | "effective_to"
          | "superseded_by_id"
          | "is_active"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["constraints"]["Row"],
              | "scope_kind"
              | "scope_ref"
              | "version"
              | "effective_from"
              | "effective_to"
              | "superseded_by_id"
              | "is_active"
            >
          >;
        Update: Partial<Database["public"]["Tables"]["constraints"]["Insert"]>;
        Relationships: [];
      };
      policies: {
        Row: {
          id: string;
          organization_id: string;
          policy_type: string;
          name: string;
          mode:
            | "recommendation_only"
            | "approval_required"
            | "bounded_auto_execution"
            | "fully_autonomous";
          configuration: Record<string, unknown>;
          monthly_budget_minor: number | null;
          budget_currency: string | null;
          version: number;
          is_active: boolean;
          created_by: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["policies"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["policies"]["Insert"]>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: string;
          /** Null for agency-level events, which belong to no single client. */
          organization_id: string | null;
          account_id: string | null;
          event_name: string;
          actor_type: "user" | "system" | "ai";
          actor_id: string | null;
          entity_type: string;
          entity_id: string | null;
          correlation_id: string;
          payload: Record<string, unknown>;
          occurred_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["audit_events"]["Row"],
          "id" | "correlation_id" | "occurred_at"
        > & { correlation_id?: string; occurred_at?: string };
        Update: never;
        Relationships: [];
      };
      onboarding_sessions: {
        Row: {
          id: string;
          organization_id: string;
          owner_id: string;
          status: "in_progress" | "completed" | "archived";
          current_section_key: string;
          started_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_sessions"]["Row"],
          | "id"
          | "status"
          | "current_section_key"
          | "started_at"
          | "completed_at"
          | "created_at"
          | "updated_at"
        > & {
          status?: Database["public"]["Tables"]["onboarding_sessions"]["Row"]["status"];
          current_section_key?: string;
          completed_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["onboarding_sessions"]["Insert"]>;
        Relationships: [];
      };
      onboarding_section_states: {
        Row: {
          id: string;
          organization_id: string;
          session_id: string;
          section_key: string;
          status: "not_started" | "in_progress" | "complete" | "needs_attention" | "blocked";
          payload: Record<string, unknown>;
          source_metadata: unknown[];
          updated_by: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_section_states"]["Row"],
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["onboarding_section_states"]["Insert"]>;
        Relationships: [];
      };
      onboarding_requests: {
        Row: {
          id: string;
          organization_id: string;
          session_id: string;
          section_key: string;
          title: string;
          description: string;
          assignee_user_id: string | null;
          client_contact: string | null;
          status: "open" | "in_progress" | "fulfilled" | "cancelled";
          due_date: string | null;
          created_by: string;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_requests"]["Row"],
          "id" | "created_at" | "updated_at"
        > & { status?: Database["public"]["Tables"]["onboarding_requests"]["Row"]["status"] };
        Update: Partial<Database["public"]["Tables"]["onboarding_requests"]["Insert"]>;
        Relationships: [];
      };
      onboarding_uploads: {
        Row: {
          id: string;
          organization_id: string;
          session_id: string;
          section_key: string;
          storage_path: string;
          original_filename: string;
          media_type: string;
          byte_size: number;
          checksum: string;
          status: "pending" | "uploaded" | "extracting" | "succeeded" | "failed";
          error_summary: string | null;
          source_metadata: Record<string, unknown>;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_uploads"]["Row"],
          "id" | "created_at" | "updated_at"
        > & { status?: Database["public"]["Tables"]["onboarding_uploads"]["Row"]["status"] };
        Update: Partial<Database["public"]["Tables"]["onboarding_uploads"]["Insert"]>;
        Relationships: [];
      };
      onboarding_extractions: {
        Row: {
          id: string;
          organization_id: string;
          upload_id: string;
          status: "pending" | "running" | "succeeded" | "failed";
          provider: string | null;
          model: string | null;
          retry_count: number;
          error_summary: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_extractions"]["Row"],
          "id" | "created_at" | "updated_at"
        > & { status?: Database["public"]["Tables"]["onboarding_extractions"]["Row"]["status"] };
        Update: Partial<Database["public"]["Tables"]["onboarding_extractions"]["Insert"]>;
        Relationships: [];
      };
      onboarding_extraction_candidates: {
        Row: {
          id: string;
          organization_id: string;
          extraction_id: string;
          section_key: string;
          candidate_type: "fact" | "metric" | "catalog_row" | "clarification";
          fact_key: string | null;
          candidate_payload: Record<string, unknown>;
          confidence: number | null;
          evidence: unknown[];
          contradiction_references: unknown[];
          status: "pending" | "confirmed" | "edited" | "rejected" | "unknown";
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_extraction_candidates"]["Row"],
          "id" | "created_at" | "updated_at"
        > & {
          status?: Database["public"]["Tables"]["onboarding_extraction_candidates"]["Row"]["status"];
        };
        Update: Partial<Database["public"]["Tables"]["onboarding_extraction_candidates"]["Insert"]>;
        Relationships: [];
      };
      ai_readiness_assessments: {
        Row: {
          id: string;
          organization_id: string;
          session_id: string;
          rubric_version: string;
          overall_score: number;
          capability_scores: Record<string, unknown>;
          blockers: unknown[];
          next_actions: unknown[];
          created_by: string | null;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["ai_readiness_assessments"]["Row"],
          "id" | "created_at"
        >;
        Update: never;
        Relationships: [];
      };
      onboarding_idempotency_records: {
        Row: {
          id: string;
          organization_id: string;
          operation: string;
          idempotency_key: string;
          request_hash: string;
          response_payload: Record<string, unknown>;
          created_by: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["onboarding_idempotency_records"]["Row"],
          "id" | "created_at"
        >;
        Update: never;
        Relationships: [];
      };
      organization_memberships: {
        Row: {
          organization_id: string;
          user_id: string;
          role: "owner" | "admin" | "operator" | "viewer";
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organization_memberships"]["Row"],
          "created_at" | "updated_at"
        > & { role?: Database["public"]["Tables"]["organization_memberships"]["Row"]["role"] };
        Update: Partial<Database["public"]["Tables"]["organization_memberships"]["Insert"]>;
        Relationships: [];
      };
      /** Per-user interface state, not tenant data: each row belongs to one user. */
      organization_last_access: {
        Row: {
          user_id: string;
          organization_id: string;
          last_accessed_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["organization_last_access"]["Row"],
          "last_accessed_at"
        > & { last_accessed_at?: string };
        Update: Partial<Database["public"]["Tables"]["organization_last_access"]["Insert"]>;
        Relationships: [];
      };
      /** Platform and Industry Pack vocabulary for human creative verdicts. */
      creative_review_reasons: {
        Row: {
          key: string;
          description: string;
          owner_scope: "core" | "pack";
          pack_slug: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Append-only human verdicts; writes are confined to the governed RPC. */
      creative_asset_reviews: {
        Row: {
          id: string;
          organization_id: string;
          subject_kind: "brand_asset_version" | "campaign_asset";
          subject_id: string;
          verdict: "approved" | "rejected";
          reason_codes: string[];
          note: string | null;
          reviewed_by: string;
          reviewed_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Confirmed descriptions are the declared-subject fallback when no photo exists. */
      organization_subject_profiles: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          slug: string;
          description: string | null;
          tags: string[];
          names_by_script: Record<string, string>;
          must_not_appear: string[];
          illustrated_style: boolean;
          state: "draft" | "confirmed";
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Versioned, platform-owned poster layouts. A template version is immutable. */
      campaign_poster_templates: {
        Row: {
          id: string;
          key: string;
          version: number;
          placement: "feed_image" | "image_story";
          canvas_width_px: number;
          canvas_height_px: number;
          layout: Record<string, unknown>;
          owner_scope: "core" | "pack" | "organization";
          pack_slug: string | null;
          organization_id: string | null;
          state: "active" | "retired";
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * One row per render attempt, refusals included -- a refusal that was never
       * written down cannot be counted, and the refusal rate per script is what
       * says whether font coverage is wrong rather than the operator.
       *
       * Carries no `truth_class`. That describes the plate and is read through
       * `plate_asset_id`; `synthetic_composite` means "drawn from the client's
       * photograph", not "layers composited", and conflating the two mislabels a
       * truth claim shown to a client.
       */
      campaign_poster_renders: {
        Row: {
          id: string;
          organization_id: string;
          campaign_id: string;
          bundle_version_id: string;
          plate_asset_id: string;
          /** Null for a client photograph and for an edited plate: neither has a run. */
          plate_generation_run_id: string | null;
          template_key: string;
          template_version: number;
          script: "Latn" | "Mlym" | "Arab";
          text_values: Record<string, string>;
          font_manifest: Record<string, unknown>;
          /** Over the render inputs. Present even when the render was refused. */
          render_digest: string;
          state: "rendered" | "refused";
          refusal_code: string | null;
          refusal_detail: Record<string, unknown> | null;
          output_storage_path: string | null;
          /** Over the produced bytes. One render_digest must always yield one of these. */
          output_content_hash: string | null;
          output_mime_type: "image/png" | "image/jpeg" | "image/webp" | null;
          output_width_px: number | null;
          output_height_px: number | null;
          verification: Record<string, unknown>;
          rendered_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Append-only masked-edit lineage and the edit's own receipt. No blueprint
       * columns: an edit does not run the art-direction stage, because direction
       * for a whole image would fight the mask it is supposed to respect.
       */
      campaign_plate_edits: {
        Row: {
          id: string;
          organization_id: string;
          campaign_id: string;
          parent_plate_asset_id: string;
          child_plate_asset_id: string;
          mask_storage_path: string;
          mask_content_hash: string;
          union_coverage_ratio: number;
          annotations: Array<{
            ordinal: number;
            bounds: Record<string, number>;
            instruction: string;
          }>;
          negative_rules: string[];
          model_id: string;
          /** Null means not measured. Zero would claim the edit was free. */
          cost_minor: number | null;
          idempotency_key: string;
          edited_by: string;
          edited_at: string;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * The permission vocabulary and its role mapping. Seeded by migration and
       * read-only to every application role, so Insert and Update are `never`.
       */
      permissions: {
        Row: {
          key: string;
          description: string;
          scope: "account" | "organization";
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      account_role_permissions: {
        Row: {
          account_role: "owner" | "admin" | "member";
          permission_key: string;
          permission_scope: "account" | "organization";
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      organization_role_permissions: {
        Row: {
          organization_role: "owner" | "admin" | "operator" | "viewer";
          permission_key: string;
          permission_scope: "account" | "organization";
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /**
       * Holds only a hash of each token. The raw token exists once, in the
       * response that minted it, and there is no route that reads it back.
       */
      account_invitations: {
        Row: {
          id: string;
          account_id: string;
          email: string;
          account_role: "owner" | "admin" | "member";
          default_organization_role: "owner" | "admin" | "operator" | "viewer" | null;
          token_hash: string;
          status: "pending" | "accepted" | "revoked" | "expired";
          invited_by: string;
          expires_at: string;
          accepted_by: string | null;
          accepted_at: string | null;
          revoked_by: string | null;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      /** Tenant root: the agency. Organizations are the clients it runs. */
      accounts: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["accounts"]["Row"],
          "id" | "created_at" | "updated_at"
        > & { id?: string };
        Update: Partial<Database["public"]["Tables"]["accounts"]["Insert"]>;
        Relationships: [];
      };
      /**
       * Agency-level tenancy. `default_organization_role` is the role this member
       * holds in every client of the account without an explicit override, which
       * is why organization access never has to be written per client.
       */
      account_memberships: {
        Row: {
          account_id: string;
          user_id: string;
          account_role: "owner" | "admin" | "member";
          default_organization_role: "owner" | "admin" | "operator" | "viewer" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["account_memberships"]["Row"],
          "created_at" | "updated_at" | "account_role" | "default_organization_role"
        > & {
          account_role?: Database["public"]["Tables"]["account_memberships"]["Row"]["account_role"];
          default_organization_role?: Database["public"]["Tables"]["account_memberships"]["Row"]["default_organization_role"];
        };
        Update: Partial<Database["public"]["Tables"]["account_memberships"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      enqueue_growth_intelligence_request: {
        Args: {
          p_organization_id: string;
          p_request: unknown;
        };
        Returns: Record<string, unknown>;
      };
      propose_market_profile_version: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_profile_document: unknown;
          p_profile_digest: string;
          p_proposal_context: unknown;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown>;
      };
      find_market_profile_proposal_replay: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_proposal_context: unknown;
          p_idempotency_key: string;
        };
        Returns: Record<string, unknown> | null;
      };
      decide_market_profile_version: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_market_profile_version_id: string;
          p_profile_digest: string;
          p_decision: "confirmed" | "rejected" | "disabled";
          p_reason: string | null;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown>;
      };
      retry_growth_intelligence_request: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_request_id: string;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown>;
      };
      cancel_growth_intelligence_request: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_request_id: string;
          p_reason: string;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown>;
      };
      claim_growth_intelligence_request: {
        Args: {
          p_organization_id: string;
          p_request_id: string;
          p_claim_token: string;
          p_lease_seconds: number;
        };
        Returns: Record<string, unknown>;
      };
      complete_growth_intelligence_request: {
        Args: {
          p_organization_id: string;
          p_request_id: string;
          p_claim_token: string;
        };
        Returns: Record<string, unknown>;
      };
      fail_growth_intelligence_request: {
        Args: {
          p_organization_id: string;
          p_request_id: string;
          p_claim_token: string;
          p_safe_failure_code: string;
        };
        Returns: Record<string, unknown>;
      };
      claim_due_growth_intelligence_requests: {
        Args: {
          p_limit: number;
          p_dispatch_cooldown_seconds: number;
        };
        Returns: {
          organizationId: string;
          requestId: string;
          kind: string;
          correlationId: string;
        }[];
      };
      start_governed_report_package_upload: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_channel_id: string;
          p_branch_id: string;
          p_report_type: string;
          p_period_start: string;
          p_period_end: string;
          p_currency: string;
          p_file_kind: "csv" | "xlsx" | "pdf";
          p_original_filename: string;
          p_content_type: string;
          p_content_length: number;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"];
      };
      complete_governed_report_package_upload: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_package_id: string;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"];
      };
      retry_governed_report_package_profiling: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_package_id: string;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"];
      };
      claim_governed_report_package_profiling: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_idempotency_key: string;
          p_claim_token: string;
        };
        Returns: Record<string, unknown> | null;
      };
      complete_governed_report_package_profiling: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_claim_token: string;
          p_content_sha256: string;
          p_schema_fingerprint: string;
          p_structure_fingerprint: string;
          p_sheets: unknown;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      propose_governed_report_contract: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_package_id: string;
          p_mapping_document: unknown;
          p_idempotency_key: string;
          p_correlation_id: string;
          p_proposal_source?: "human" | "library";
          p_provider_definition_key?: string | null;
        };
        Returns: Database["public"]["Tables"]["report_contract_versions"]["Row"];
      };
      decide_governed_report_contract: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_contract_version_id: string;
          p_decision: "approved" | "rejected";
          p_reason: string | null;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Database["public"]["Tables"]["report_contract_decisions"]["Row"];
      };
      fail_governed_report_package_profiling: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_claim_token: string;
          p_failure_code: string;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      claim_governed_report_package_validation: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_report_contract_version_id: string;
          p_validation_run_id: string;
          p_idempotency_key: string;
          p_claim_token: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown> | null;
      };
      complete_governed_report_package_validation: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_validation_run_id: string;
          p_claim_token: string;
          p_result_digest: string;
          p_result: unknown;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      fail_governed_report_package_validation: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_validation_run_id: string;
          p_claim_token: string;
          p_failure_code: string;
          p_result_digest: string;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      retry_governed_report_package_validation: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_package_id: string;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"];
      };
      propose_governed_report_projection: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_contract_version_id: string;
          p_projection_document: unknown;
          p_idempotency_key: string;
          p_correlation_id: string;
          p_proposal_source?: "human" | "library";
          p_provider_definition_key?: string | null;
        };
        Returns: Database["public"]["Tables"]["report_projection_versions"]["Row"];
      };
      decide_governed_report_projection: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_projection_version_id: string;
          p_decision: "approved" | "rejected";
          p_reason: string | null;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Database["public"]["Tables"]["report_projection_decisions"]["Row"];
      };
      request_governed_report_package_projection: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_report_package_id: string;
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown> | null;
      };
      claim_governed_report_package_projection: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_report_contract_version_id: string;
          p_report_projection_version_id: string;
          p_projection_run_id: string;
          p_idempotency_key: string;
          p_claim_token: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown> | null;
      };
      complete_governed_report_package_projection: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_projection_run_id: string;
          p_claim_token: string;
          p_result_digest: string;
          p_result: unknown;
          p_outputs: unknown;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      complete_governed_report_package_period_grain_projection: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_projection_run_id: string;
          p_claim_token: string;
          p_result_digest: string;
          p_result: unknown;
          p_observations: unknown;
          p_absent_row_count: number;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      fail_governed_report_package_projection: {
        Args: {
          p_organization_id: string;
          p_report_package_id: string;
          p_projection_run_id: string;
          p_claim_token: string;
          p_failure_code: string;
          p_result_digest: string;
          /** The error's own name and message, truncated by the function. */
          p_failure_detail?: string | null;
        };
        Returns: Database["public"]["Tables"]["integration_report_packages"]["Row"] | null;
      };
      claim_channel_analysis: {
        Args: {
          p_organization_id: string;
          p_channel_id: string | null;
          p_branch_id: string | null;
          p_window_start: string;
          p_window_end: string;
          p_period_grain: "day" | "week" | "month" | "span";
          p_analysis_run_id: string;
          p_registry_version: number;
          p_detectors: unknown;
          p_metric_keys: unknown;
          p_idempotency_key: string;
          p_claim_token: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown> | null;
      };
      complete_channel_analysis: {
        Args: {
          p_organization_id: string;
          p_analysis_run_id: string;
          p_claim_token: string;
          p_result_digest: string;
          p_findings: unknown;
        };
        Returns: Database["public"]["Tables"]["channel_analysis_runs"]["Row"] | null;
      };
      fail_channel_analysis: {
        Args: {
          p_organization_id: string;
          p_analysis_run_id: string;
          p_claim_token: string;
          p_failure_code: string;
          p_result_digest: string;
        };
        Returns: Database["public"]["Tables"]["channel_analysis_runs"]["Row"] | null;
      };
      claim_channel_recommendations: {
        Args: {
          p_organization_id: string;
          p_analysis_run_id: string;
          p_correlation_id: string;
          p_claim_token: string;
        };
        Returns: Record<string, unknown> | null;
      };
      complete_channel_recommendations: {
        Args: {
          p_organization_id: string;
          p_analysis_run_id: string;
          p_claim_token: string;
          p_provider: string;
          p_model_id: string;
          p_prompt_version: number;
          p_prompt_digest: string;
          p_output_digest: string;
          p_result_digest: string;
          p_recommendations: unknown;
        };
        Returns: Record<string, unknown> | null;
      };
      fail_channel_recommendations: {
        Args: {
          p_organization_id: string;
          p_analysis_run_id: string;
          p_claim_token: string;
          p_failure_code: string;
          p_result_digest: string;
        };
        Returns: Record<string, unknown> | null;
      };
      triage_channel_recommendation: {
        Args: {
          p_organization_id: string;
          p_recommendation_id: string;
          p_decision: "acknowledged" | "dismissed" | "planned";
          p_dismissal_reason: string | null;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      record_channel_recommendation_feedback: {
        Args: {
          p_organization_id: string;
          p_recommendation_id: string;
          p_helpful: boolean;
          p_actor_id: string;
        };
        Returns: undefined;
      };
      admit_channel_recommendation_evaluations: {
        Args: {
          p_organization_id: string;
          p_batch_id: string;
          p_judge_provider: string;
          p_judge_model: string;
          p_judge_prompt_version: number;
          p_judge_prompt_digest: string;
          p_judge_output_digest: string;
          p_evaluations: unknown;
        };
        Returns: unknown;
      };
      resolve_governed_report_projection_overlap: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_reconciliation_id: string;
          p_resolution: "accept_correction" | "keep_existing";
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown> | null;
      };
      list_governed_report_projection_reconciliation_groups: {
        Args: {
          p_organization_id: string;
        };
        Returns: Array<{
          representative_reconciliation_id: string;
          organization_id: string;
          report_package_id: string;
          projection_run_id: string;
          projection_output_key: string;
          projection_target: "exact_range" | "period_grain";
          metric_key: string | null;
          normalized_sheet_name: string | null;
          canonical_field: string | null;
          source_header: string | null;
          affected_record_count: number;
          matching_record_count: number;
          affected_dates: string[];
          affected_dates_truncated: boolean;
          first_period: string | null;
          last_period: string | null;
          prior_upload_count: number;
          prior_report_type: string | null;
          prior_period_start: string | null;
          prior_period_end: string | null;
        }>;
      };
      resolve_governed_report_projection_overlap_group: {
        Args: {
          p_organization_id: string;
          p_actor_id: string;
          p_reconciliation_id: string;
          p_resolution: "accept_correction" | "keep_existing";
          p_idempotency_key: string;
          p_correlation_id: string;
        };
        Returns: Record<string, unknown> | null;
      };
      create_organization_with_owner: {
        Args: {
          input_name: string;
          input_slug: string;
          input_industry: string;
          input_country_code: string;
          input_base_currency: string;
          input_timezone: string;
        };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      create_organization_with_owner_v2: {
        Args: {
          input_name: string;
          input_slug: string;
          input_industry: string;
          input_country_code: string;
          input_base_currency: string;
          input_timezone: string;
          input_industry_pack_slug: string;
          input_first_branch_name?: string | null;
          input_first_branch_slug?: string | null;
          input_first_branch_kind?: "physical" | "virtual";
        };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      create_organization_with_owner_v3: {
        Args: {
          input_name: string;
          input_slug: string;
          input_industry: string;
          input_country_code: string;
          input_base_currency: string;
          input_timezone: string;
          input_industry_pack_slug: string;
          input_first_branch_name?: string | null;
          input_first_branch_slug?: string | null;
          input_first_branch_kind?: "physical" | "virtual";
          /** Omitted means the caller's only account; required if they have several. */
          input_account_id?: string | null;
        };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      create_account_invitation: {
        Args: {
          p_account_id: string;
          p_email: string;
          p_account_role: "owner" | "admin" | "member";
          p_default_organization_role: "owner" | "admin" | "operator" | "viewer" | null;
          p_token_hash: string;
          p_expires_at: string;
        };
        Returns: Database["public"]["Tables"]["account_invitations"]["Row"];
      };
      reissue_account_invitation: {
        Args: { p_invitation_id: string; p_token_hash: string; p_expires_at: string };
        Returns: Database["public"]["Tables"]["account_invitations"]["Row"];
      };
      revoke_account_invitation: {
        Args: { p_invitation_id: string };
        Returns: Database["public"]["Tables"]["account_invitations"]["Row"];
      };
      preview_account_invitation: {
        Args: { p_token_hash: string };
        /** Every field is null unless the invitation is live, so an unknown token reveals nothing. */
        Returns: {
          state: "valid" | "invalid" | "already_accepted";
          account_name: string | null;
          invited_email: string | null;
          inviter_name: string | null;
          account_role: "owner" | "admin" | "member" | null;
          default_organization_role: "owner" | "admin" | "operator" | "viewer" | null;
          expires_at: string | null;
          matches_caller: boolean | null;
        }[];
      };
      accept_account_invitation: {
        Args: { p_token_hash: string };
        Returns: Database["public"]["Tables"]["accounts"]["Row"];
      };
      current_organization_role: {
        Args: { target_organization_id: string };
        /** Null when the caller has no access, which is indistinguishable from no such organization. */
        Returns: "owner" | "admin" | "operator" | "viewer" | null;
      };
      activate_organization: {
        Args: { target_organization_id: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      archive_draft_organization: {
        Args: { target_organization_id: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      resolve_landing_organization: {
        Args: Record<string, never>;
        /** Null when the caller has no organization that is not archived. */
        Returns: string | null;
      };
      touch_organization_access: {
        Args: { target_organization_id: string };
        Returns: undefined;
      };
      save_policy_version: {
        Args: {
          target_organization_id: string;
          input_policy_type: string;
          input_name: string;
          input_mode:
            | "recommendation_only"
            | "approval_required"
            | "bounded_auto_execution"
            | "fully_autonomous";
          input_configuration: Record<string, unknown>;
          input_monthly_budget_minor: number | null;
          input_budget_currency: string | null;
        };
        Returns: Database["public"]["Tables"]["policies"]["Row"];
      };
      save_constraint_version: {
        Args: {
          target_organization_id: string;
          input_constraint_key: string;
          input_name: string;
          input_constraint_type: string;
          input_value: unknown;
          input_severity: "soft" | "hard";
          input_source: string;
          input_scope_kind: string;
          input_scope_ref: string | null;
          input_effective_from: string | null;
        };
        Returns: Database["public"]["Tables"]["constraints"]["Row"];
      };
      get_cost_component_coverage: {
        Args: { target_organization_id: string };
        /** Coverage and tier only; never what a component costs. */
        Returns: {
          key: string;
          label: string;
          computation_kind: string;
          has_rate: boolean;
          weakest_tier: string | null;
        }[];
      };
      record_cost_component_rates: {
        Args: {
          target_organization_id: string;
          /** Effective-dated rates, shaped by the onboarding promotion path. */
          input_rates: unknown;
        };
        Returns: number;
      };
      record_channel_economics_entries: {
        Args: {
          target_organization_id: string;
          /** Entries with their components nested, shaped by the ledger repository. */
          input_entries: unknown;
        };
        Returns: number;
      };
    };
    Enums: {
      organization_status: "draft_onboarding" | "active" | "archived";
      organization_role: "owner" | "admin" | "operator" | "viewer";
      branch_kind: "physical" | "virtual";
      digital_twin_fact_status: "verified" | "imported" | "inferred" | "stale";
      goal_baseline_status: "known" | "unknown" | "estimated";
      policy_mode:
        | "recommendation_only"
        | "approval_required"
        | "bounded_auto_execution"
        | "fully_autonomous";
      audit_actor_type: "user" | "system" | "ai";
    };
    CompositeTypes: Record<string, never>;
  };
};
