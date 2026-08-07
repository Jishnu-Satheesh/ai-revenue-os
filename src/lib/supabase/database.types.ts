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
          status: "draft_onboarding" | "active" | "archived";
          created_by: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["organizations"]["Row"], "id" | "created_at" | "updated_at" | "archived_at" | "status"> & { status?: Database["public"]["Tables"]["organizations"]["Row"]["status"] };
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
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
        Insert: Omit<Database["public"]["Tables"]["organization_memberships"]["Row"], "created_at" | "updated_at"> & { role?: Database["public"]["Tables"]["organization_memberships"]["Row"]["role"] };
        Update: Partial<Database["public"]["Tables"]["organization_memberships"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: { id: string; display_name: string | null; avatar_url: string | null; created_at: string; updated_at: string };
        Insert: { id: string; display_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization_with_owner: {
        Args: { input_name: string; input_slug: string; input_industry: string; input_country_code: string; input_base_currency: string; input_timezone: string };
        Returns: Database["public"]["Tables"]["organizations"]["Row"];
      };
    };
    Enums: { organization_status: "draft_onboarding" | "active" | "archived"; organization_role: "owner" | "admin" | "operator" | "viewer" };
    CompositeTypes: Record<string, never>;
  };
};
