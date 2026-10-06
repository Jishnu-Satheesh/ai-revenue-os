import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  publishProjectionInputSchema,
  type GrowthProjectionWritePort,
  type PublishGrowthProjectionInput,
  type PublishGrowthProjectionResult,
} from "@/modules/organizations/application/growth-progress-ports";
import type { GrowthScheduleSnapshot } from "@/modules/organizations/application/growth-projection-publisher";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Worker-only projection publication adapter (data contract D04/D07).
 *
 * Like a guarded deposit slot: the worker hands over a sealed envelope with
 * its own key, and the slot either files the original or hands back the
 * already-filed one. It never rewrites, never falls back to a live
 * recalculation, and never recalculates per viewer — a denial is reported
 * with a typed code after exactly one attempt.
 *
 * Server-only: the service client comes from the composition root, and this
 * module must never be imported by browser code (`import "server-only"`
 * enforces that at build time).
 */

type ServiceClient = SupabaseClient<Database>;

export type GrowthProjectionPublishErrorCode =
  | "INVALID_INPUT"
  | "TENANT_MISMATCH"
  | "INVALID_DOCUMENT"
  | "SCHEDULE_MISMATCH"
  | "PERIOD_ALREADY_STARTED"
  | "INVALID_CURVE"
  | "IMMUTABLE_ROW"
  | "PERMISSION_DENIED"
  | "PUBLISH_FAILED";

/** Typed publication failure; carries a stable code for the worker's diagnostics. */
export class GrowthProjectionPublishError extends Error {
  readonly code: GrowthProjectionPublishErrorCode;

  constructor(code: GrowthProjectionPublishErrorCode, message: string) {
    super(message);
    this.name = "GrowthProjectionPublishError";
    this.code = code;
  }
}

const rpcRowSchema = z.strictObject({
  projection_id: z.string().uuid(),
  digest: z.string().regex(/^[0-9a-f]{64}$/, { message: "Digests read as 64 hex characters." }),
  published: z.boolean(),
});

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortDeep(entry)]),
    );
  }
  return value;
}

/**
 * Stable digest over a candidate document: same content, same digest, any key
 * order. Server-side digests stay authoritative; this helper is for worker
 * diagnostics (replay comparison, log correlation), never for asserting what
 * the database stored.
 */
export function sha256HexCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(sortDeep(value)))
    .digest("hex");
}

function mapRpcError(error: { code?: string; message?: string }): GrowthProjectionPublishError {
  switch (error.code) {
    case "PGR01":
      return new GrowthProjectionPublishError(
        "INVALID_DOCUMENT",
        "The publication envelope was not usable.",
      );
    case "PGR02":
      return new GrowthProjectionPublishError(
        "TENANT_MISMATCH",
        "The publication names a tenant its sources do not belong to.",
      );
    case "PGR03":
      return new GrowthProjectionPublishError(
        "PERIOD_ALREADY_STARTED",
        "The period already started; a missed period stays unavailable.",
      );
    case "PGR04":
      return new GrowthProjectionPublishError(
        "SCHEDULE_MISMATCH",
        "The period sits off its fixed schedule grid.",
      );
    case "PGR05":
      return new GrowthProjectionPublishError(
        "INVALID_CURVE",
        "The projection curve was not usable.",
      );
    case "PGR06":
      return new GrowthProjectionPublishError(
        "IMMUTABLE_ROW",
        "A stored projection cannot be changed.",
      );
    case "42501":
      return new GrowthProjectionPublishError(
        "PERMISSION_DENIED",
        "Publication refused: the worker-only RPC denied this caller.",
      );
    default:
      return new GrowthProjectionPublishError("PUBLISH_FAILED", "Storing the projection failed.");
  }
}

/**
 * Binds the worker-only publication RPC to the service client. Revalidates
 * the request (envelope shape plus document/organization agreement) and the
 * returned identity (exactly one row, uuid identity, 64-hex digest) so a
 * malformed answer can never pose as a stored original.
 */
export function createGrowthProjectionRepository(
  serviceClient: ServiceClient,
): GrowthProjectionWritePort {
  return {
    async publish(input: PublishGrowthProjectionInput): Promise<PublishGrowthProjectionResult> {
      const parsed = publishProjectionInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new GrowthProjectionPublishError(
          "INVALID_INPUT",
          "The publication inputs were not usable.",
        );
      }
      const { organizationId, document, correlationId } = parsed.data;
      if (document.organizationId !== organizationId) {
        throw new GrowthProjectionPublishError(
          "TENANT_MISMATCH",
          "The document names a different organization than the request.",
        );
      }
      const { data, error } = await serviceClient.rpc("publish_organization_growth_projection", {
        p_organization_id: organizationId,
        p_document: document as unknown as Record<string, unknown>,
        p_correlation_id: correlationId,
      });
      if (error) {
        throw mapRpcError({
          code: typeof error.code === "string" ? error.code : undefined,
          message: typeof error.message === "string" ? error.message : undefined,
        });
      }
      const rows = z.array(rpcRowSchema).safeParse(data);
      if (!rows.success || rows.data.length !== 1 || !rows.data[0]) {
        throw new GrowthProjectionPublishError(
          "PUBLISH_FAILED",
          "The publication answer was not usable.",
        );
      }
      const row = rows.data[0];
      return { projectionId: row.projection_id, digest: row.digest, published: row.published };
    },
  };
}

const scheduleRowSchema = z.strictObject({
  schedule_origin_date: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, { message: "Origins read YYYY-MM-DD." }),
});

const scheduleInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  asOfDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, {
    message: "Schedule dates read YYYY-MM-DD.",
  }),
});

/**
 * Binds the worker-only schedule-read RPC to the service client (Task-5
 * decision b). The worker runs as service_role with direct projection-table
 * SELECT revoked, so schedule discovery goes through this narrow RPC —
 * origins only, never amounts — rather than a widened grant. A malformed
 * answer throws; the publisher maps the throw to a fail-closed skip.
 */
export function createGrowthScheduleRepository(serviceClient: ServiceClient): {
  readSchedule: (input: z.input<typeof scheduleInputSchema>) => Promise<GrowthScheduleSnapshot>;
} {
  return {
    async readSchedule(rawInput: z.input<typeof scheduleInputSchema>) {
      const parsed = scheduleInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        throw new GrowthProjectionPublishError(
          "INVALID_INPUT",
          "The schedule read inputs were not usable.",
        );
      }
      const { data, error } = await serviceClient.rpc("read_organization_growth_schedule", {
        p_organization_id: parsed.data.organizationId,
        p_as_of_date: parsed.data.asOfDate,
      });
      if (error) {
        throw new GrowthProjectionPublishError(
          "PUBLISH_FAILED",
          "Reading the projection schedule failed.",
        );
      }
      const rows = z.array(scheduleRowSchema).safeParse(data);
      if (!rows.success) {
        throw new GrowthProjectionPublishError(
          "PUBLISH_FAILED",
          "The schedule answer was not usable.",
        );
      }
      const origins = [...new Set(rows.data.map((row) => row.schedule_origin_date))].sort();
      if (origins.length === 0) return { status: "missing" };
      return { status: "ready", origins };
    },
  };
}
