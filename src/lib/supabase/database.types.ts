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
          "id" | "created_at" | "updated_at"
        >;
        Update: Partial<Database["public"]["Tables"]["goals"]["Insert"]>;
        Relationships: [];
      };
      constraints: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          constraint_type: string;
          value: unknown;
          severity: "soft" | "hard";
          source: string;
          is_active: boolean;
          created_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<
          Database["public"]["Tables"]["constraints"]["Row"],
          "id" | "created_at" | "updated_at"
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
