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
        > & {
          status?: Database["public"]["Tables"]["organizations"]["Row"]["status"];
          industry_pack_slug?: string;
          branchless_confirmed?: boolean;
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
          "id" | "created_at" | "updated_at"
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
          source_reference: string | null;
          computed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["channel_economics_entries"]["Row"],
          "id" | "created_at" | "updated_at" | "computed_at"
        > &
          Partial<
            Pick<Database["public"]["Tables"]["channel_economics_entries"]["Row"], "computed_at">
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
          | "dimensions"
          | "revision"
          | "superseded_by_id"
          | "supersede_reason"
          | "source_ingestion_run_id"
          | "branch_id"
        > &
          Partial<
            Pick<
              Database["public"]["Tables"]["normalized_metrics"]["Row"],
              | "ingested_at"
              | "subject_kind"
              | "subject_ref"
              | "channel"
              | "dimensions"
              | "revision"
              | "superseded_by_id"
              | "supersede_reason"
              | "source_ingestion_run_id"
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
          organization_id: string;
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
      activate_organization: {
        Args: { target_organization_id: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
      archive_draft_organization: {
        Args: { target_organization_id: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
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
