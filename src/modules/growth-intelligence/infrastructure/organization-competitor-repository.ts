import "server-only";

import { z } from "zod";

import { DomainError } from "@/lib/errors";
import {
  organizationCompetitorSchema,
  toNormalizedCompetitorName,
  type OrganizationCompetitor,
} from "@/modules/growth-intelligence/application/organization-competitors";

/**
 * Organisation competitor persistence (Track C1 P2).
 *
 * Every read and write pins both the session organisation and the row id, so
 * an unknown id or another organisation's row reads as not-found (404), never
 * as a permission leak. Writes go through the session role under RLS; no
 * service-role bypass exists on this path.
 */

const rowSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    name: z.string(),
    website: z.string().nullable(),
    location_hint: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

function toCompetitor(row: z.infer<typeof rowSchema>): OrganizationCompetitor {
  return organizationCompetitorSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    website: row.website,
    locationHint: row.location_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

type Persistence = {
  from: (table: string) => unknown;
};

function missingTable(error: unknown): boolean {
  const code =
    (error as { code?: unknown } | null)?.code ??
    (error as { error?: { code?: unknown } } | null)?.error?.code;
  return (
    code === "42P01" ||
    (typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string" &&
      ((error as { message: string }).message.includes("does not exist") ||
        (error as { message: string }).message.includes("Could not find the table")))
  );
}

export function createAuthenticatedOrganizationCompetitorRepository(supabase: Persistence) {
  const client = supabase as unknown as {
    from: (
      table: string,
    ) => {
      select: (columns: string) => unknown;
      insert: (values: unknown) => unknown;
      update: (values: unknown) => unknown;
      delete: () => unknown;
      upsert: (values: unknown, options?: unknown) => unknown;
    };
  };

  return {
    async listCompetitors(input: { organizationId: string }): Promise<OrganizationCompetitor[]> {
      const organizationId = z.string().uuid().parse(input.organizationId);
      const query = client
        .from("growth_intelligence_organization_competitors")
        .select("id,organization_id,name,website,location_hint,created_at,updated_at") as unknown as {
        eq: (column: string, value: string) => {
          order: (column: string, options: { ascending: boolean }) => Promise<{ data: unknown; error: unknown }>;
        };
      };
      const { data, error } = await query.eq("organization_id", organizationId).order("name", {
        ascending: true,
      });
      if (error) {
        if (missingTable(error)) return [];
        throw new DomainError("UNEXPECTED_ERROR", "Competitors could not be loaded.", error);
      }
      if (!Array.isArray(data)) return [];
      return data
        .map((row) => rowSchema.safeParse(row))
        .filter(
          (parsed): parsed is { success: true; data: z.infer<typeof rowSchema> } => parsed.success,
        )
        .map((parsed) => toCompetitor(parsed.data));
    },

    async createCompetitor(input: {
      organizationId: string;
      name: string;
      website?: string | null;
      locationHint?: string | null;
      actorId: string;
    }): Promise<OrganizationCompetitor> {
      const organizationId = z.string().uuid().parse(input.organizationId);
      const name = z.string().trim().min(1).max(160).parse(input.name);
      const website =
        input.website === undefined || input.website === null || input.website === ""
          ? null
          : z.string().trim().min(1).max(2_048).parse(input.website);
      const locationHint =
        input.locationHint === undefined || input.locationHint === null || input.locationHint === ""
          ? null
          : z.string().trim().min(1).max(240).parse(input.locationHint);
      void input.actorId;

      const normalized = toNormalizedCompetitorName(name);
      const insert = client.from("growth_intelligence_organization_competitors").insert({
        organization_id: organizationId,
        name,
        normalized_name: normalized,
        website,
        location_hint: locationHint,
      }) as unknown as {
        select: (columns: string) => {
          single: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
      const { data, error } = await insert
        .select("id,organization_id,name,website,location_hint,created_at,updated_at")
        .single();
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "23505") {
          throw new DomainError("VALIDATION_ERROR", "That competitor is already listed.");
        }
        throw new DomainError("UNEXPECTED_ERROR", "The competitor could not be saved.", error);
      }
      const parsed = rowSchema.safeParse(data);
      if (!parsed.success) {
        throw new DomainError("UNEXPECTED_ERROR", "The competitor could not be saved.");
      }
      return toCompetitor(parsed.data);
    },

    async updateCompetitor(input: {
      organizationId: string;
      competitorId: string;
      name?: string;
      website?: string | null;
      locationHint?: string | null;
    }): Promise<OrganizationCompetitor> {
      const organizationId = z.string().uuid().parse(input.organizationId);
      const competitorId = z.string().uuid().parse(input.competitorId);
      const patch: Record<string, string | null> = {};
      if (input.name !== undefined) {
        patch.name = z.string().trim().min(1).max(160).parse(input.name);
        patch.normalized_name = toNormalizedCompetitorName(patch.name as string);
      }
      if (input.website !== undefined) {
        patch.website =
          input.website === null || input.website === ""
            ? null
            : z.string().trim().min(1).max(2_048).parse(input.website);
      }
      if (input.locationHint !== undefined) {
        patch.location_hint =
          input.locationHint === null || input.locationHint === ""
            ? null
            : z.string().trim().min(1).max(240).parse(input.locationHint);
      }

      const query = client.from("growth_intelligence_organization_competitors").update(patch) as unknown as {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            select: (columns: string) => {
              single: () => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
      const { data, error } = await query
        .eq("organization_id", organizationId)
        .eq("id", competitorId)
        .select("id,organization_id,name,website,location_hint,created_at,updated_at")
        .single();
      if (error) {
        const code = (error as { code?: string }).code;
        if (code === "PGRST116") {
          throw new DomainError(
            "TENANT_SCOPE_ERROR",
            "This competitor was not found in your organization.",
          );
        }
        if (code === "23505") {
          throw new DomainError("VALIDATION_ERROR", "That competitor is already listed.");
        }
        throw new DomainError("UNEXPECTED_ERROR", "The competitor could not be saved.", error);
      }
      const parsed = rowSchema.safeParse(data);
      if (!parsed.success) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This competitor was not found in your organization.",
        );
      }
      return toCompetitor(parsed.data);
    },

    async deleteCompetitor(input: {
      organizationId: string;
      competitorId: string;
    }): Promise<void> {
      const organizationId = z.string().uuid().parse(input.organizationId);
      const competitorId = z.string().uuid().parse(input.competitorId);
      const query = client.from("growth_intelligence_organization_competitors").delete() as unknown as {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            select: (columns: string) => Promise<{ data: unknown; error: unknown }>;
          };
        };
      };
      const { data, error } = await query
        .eq("organization_id", organizationId)
        .eq("id", competitorId)
        .select("id");
      if (error) {
        throw new DomainError("UNEXPECTED_ERROR", "The competitor could not be deleted.", error);
      }
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This competitor was not found in your organization.",
        );
      }
    },

    /**
     * Fold dialog competitors into permanent organisation storage. Best-effort
     * by design: duplicates are ignored and a missing table (migration
     * dry-run only, not yet applied) never fails the research start.
     */
    async rememberCompetitors(input: {
      organizationId: string;
      competitors: readonly { name: string; website?: string; locationHint?: string }[];
      actorId: string;
    }): Promise<void> {
      const organizationId = z.string().uuid().parse(input.organizationId);
      const unique = new Map<string, { name: string; website: string | null; locationHint: string | null }>();
      for (const competitor of input.competitors) {
        const name = competitor.name?.trim();
        if (!name) continue;
        const key = toNormalizedCompetitorName(name);
        if (unique.has(key)) continue;
        unique.set(key, {
          name,
          website: competitor.website?.trim() ? competitor.website.trim() : null,
          locationHint: competitor.locationHint?.trim() ? competitor.locationHint.trim() : null,
        });
      }
      for (const entry of unique.values()) {
        try {
          const upsert = client.from("growth_intelligence_organization_competitors").upsert(
            {
              organization_id: organizationId,
              name: entry.name,
              normalized_name: toNormalizedCompetitorName(entry.name),
              website: entry.website,
              location_hint: entry.locationHint,
            },
            { onConflict: "organization_id,normalized_name", ignoreDuplicates: true },
          ) as unknown as Promise<{ error: unknown }>;
          const result = await upsert;
          if (result?.error && !missingTable(result.error)) {
            throw result.error;
          }
        } catch {
          return;
        }
      }
    },
  };
}

export type OrganizationCompetitorRepository = ReturnType<
  typeof createAuthenticatedOrganizationCompetitorRepository
>;
