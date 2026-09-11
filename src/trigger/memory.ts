import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, queue, schedules, schemaTask, task, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import type { Database } from "@/lib/supabase/database.types";
import { createMemoryWorkerServiceClient } from "@/lib/supabase/service";
import { createEmbeddingProvider } from "@/modules/memory/infrastructure/embedding-provider";
import { createCaptureRepository } from "@/modules/memory/infrastructure/capture-repository";
import { createSupabaseMemoryWorkerRepository } from "@/modules/memory/infrastructure/worker-repository";
import {
  parseMemoryTaskPayload,
  type MemoryWorkerDependencies,
} from "@/workflows/memory/contracts";
import {
  runCaptureDispatch,
  runCaptureReconcile,
  toEnqueuedCount,
  type CaptureReconcilePage,
} from "@/workflows/memory/capture-dispatch";
import { runEmbedItems } from "@/workflows/memory/embed-items";
import { runExpireItems } from "@/workflows/memory/expire-items";
import { runReembedItem } from "@/workflows/memory/reembed-item";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/** Only Trigger registration creates service-role dependencies, after parsing. */
function createWorkerDependencies(signal: AbortSignal): MemoryWorkerDependencies {
  const supabase = createMemoryWorkerServiceClient();
  return {
    repository: createSupabaseMemoryWorkerRepository(supabase),
    embeddings: createEmbeddingProvider(),
    events: createEventPublisher(),
    signal,
  };
}

const cancellationParsers = {
  "memory.embed-items": (payload: unknown) => parseMemoryTaskPayload("memory.embed-items", payload),
  "memory.reembed-item": (payload: unknown) =>
    parseMemoryTaskPayload("memory.reembed-item", payload),
  "memory.expire-items": (payload: unknown) =>
    parseMemoryTaskPayload("memory.expire-items", payload),
} as const;

/**
 * Parsing cancellation payloads fails closed. These workers keep no separate
 * execution row, so their runners expose a cancelled terminal outcome when an
 * execution-aware cancellation dependency is supplied by the runtime.
 */
tasks.onCancel(async ({ task: taskId, payload }) => {
  const parsePayload = cancellationParsers[taskId as keyof typeof cancellationParsers];
  if (!parsePayload) return;
  parsePayload(payload);
});

export const memoryEmbedItemsTask = task({
  id: "memory.embed-items",
  retry,
  maxDuration: 300,
  run: async (payload: unknown, { signal }) => {
    parseMemoryTaskPayload("memory.embed-items", payload);
    return runEmbedItems(payload, createWorkerDependencies(signal));
  },
});

export const memoryReembedItemTask = task({
  id: "memory.reembed-item",
  retry,
  maxDuration: 120,
  run: async (payload: unknown, { signal }) => {
    parseMemoryTaskPayload("memory.reembed-item", payload);
    return runReembedItem(payload, createWorkerDependencies(signal));
  },
});

export const memoryExpireItemsTask = task({
  id: "memory.expire-items",
  retry,
  maxDuration: 120,
  run: async (payload: unknown, { signal }) => {
    parseMemoryTaskPayload("memory.expire-items", payload);
    return runExpireItems(payload, createWorkerDependencies(signal));
  },
});

/**
 * Capture pump (Spec 023 §5). The queue, leased claim/complete/fail RPCs, and
 * the Channel adapters are live; these schedules move deliveries through
 * them. Only identifiers, counts, and safe codes are ever logged.
 *
 * Bounds are global per pass, never per-tenant multiplied.
 */

/** At most two organizations project concurrently; the minute schedule fans
 * out onto this shared queue so a burst of due tenants queues instead of
 * stampeding Postgres. */
export const memoryCaptureQueue = queue({
  name: "memory-capture",
  concurrencyLimit: 2,
});

/**
 * Four organizations per minute-pass: each claims at most 25 events, so one
 * pass moves at most 100 events — the spec's global per-pass bound — while
 * the due-org scan's oldest-first order rotates fairly past a large tenant.
 */
const MEMORY_CAPTURE_DUE_ORG_SCAN_LIMIT = 4;

/** Organizations processed per fifteen-minute reconcile pass; rotation slices
 * this many with wrap-around (see the reconcile task). */
const MEMORY_CAPTURE_RECONCILE_ORG_LIMIT = 10;

/** Source identities reconciled per organization per pass (spec bound). */
const MEMORY_CAPTURE_RECONCILE_IDENTITY_LIMIT = 100;

/** Channel only until later slices register growth and campaign adapters. */
const RECONCILE_ADAPTERS = ["channel"] as const;

const captureDispatchOrgPayloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

type StructuralRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

function structuralRpcClient(supabase: SupabaseClient<Database>): StructuralRpcClient {
  return supabase as unknown as StructuralRpcClient;
}

type CaptureScanResult = {
  data: Array<Record<string, unknown>> | null;
  error: { code?: string; message?: string } | null;
};

/**
 * Structural read over tables the application deliberately leaves untyped
 * (RPC-only surfaces): the capture settings row for reconcile cursors and
 * organization discovery. Every filter is organization-scoped explicitly even
 * though the worker is service_role.
 */
type UntypedCaptureSelect = PromiseLike<CaptureScanResult> & {
  eq(column: string, value: string | boolean): UntypedCaptureSelect;
  gte(column: string, value: string): UntypedCaptureSelect;
  order(column: string, options?: { ascending?: boolean }): UntypedCaptureSelect;
  limit(count: number): UntypedCaptureSelect;
  maybeSingle(): PromiseLike<{
    data: Record<string, unknown> | null;
    error: { code?: string; message?: string } | null;
  }>;
};

function untypedCaptureTables(supabase: SupabaseClient<Database>): {
  from(table: string): { select(columns: string): UntypedCaptureSelect };
} {
  return supabase as unknown as {
    from(table: string): { select(columns: string): UntypedCaptureSelect };
  };
}

function describeDatabaseError(error: { code?: string }): string {
  return error.code ?? "unknown";
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && z.string().uuid().safeParse(value).success;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

const CHANNEL_RECONCILE_EPOCH = "1970-01-01T00:00:00.000Z";

type ChannelReconcileSubkind = "f" | "r" | "d";

function parseChannelCursor(cursor: string | null): {
  subkind: ChannelReconcileSubkind;
  since: string;
} {
  if (cursor) {
    const [subkind, since] = cursor.split("|");
    if ((subkind === "f" || subkind === "r" || subkind === "d") && validTimestamp(since)) {
      return { subkind, since: since as string };
    }
  }
  return { subkind: "f", since: CHANNEL_RECONCILE_EPOCH };
}

function channelCursorFor(subkind: ChannelReconcileSubkind, since: string): string {
  return `${subkind}|${since}`;
}

function nextChannelSubkind(subkind: ChannelReconcileSubkind): ChannelReconcileSubkind {
  if (subkind === "f") return "r";
  if (subkind === "r") return "d";
  return "f";
}

/**
 * One reconcile page over Channel sources. Findings and recommendations both
 * enumerate completed analysis runs (their enqueue helpers take the run and
 * are idempotent no-ops for runs with nothing new); decisions enumerate
 * triage appends, which exist only as committed records. Only completed runs
 * are ever paged: the enqueue helpers gate on settings and existence but not
 * on run status, so an unfiltered scan could capture partially written
 * candidate rows. Rows share one timestamp cursor per subkind, oldest first;
 * a fully processed page rotates to the next subkind.
 */
async function listChannelIdentities(
  supabase: SupabaseClient<Database>,
  input: { organizationId: string; adapter: string; cursor: string | null; limit: number },
): Promise<CaptureReconcilePage> {
  if (input.adapter !== "channel") {
    throw new Error("Memory capture reconcile adapter is not registered yet.");
  }
  const { subkind, since } = parseChannelCursor(input.cursor);

  if (subkind === "d") {
    const { data, error } = await supabase
      .from("channel_recommendation_decisions")
      .select("id,created_at")
      .eq("organization_id", input.organizationId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(input.limit);
    if (error) {
      throw new Error(
        `Memory capture reconcile decision scan failed: ${describeDatabaseError(error)}.`,
      );
    }
    const rows = (data ?? []).filter(
      (row): row is { id: string; created_at: string } =>
        validUuid(row.id) && validTimestamp(row.created_at),
    );
    const last = rows[rows.length - 1];
    return {
      identities: rows.map((row) => ({ kind: "channel_decision", id: row.id })),
      completeCursor:
        rows.length < input.limit || !last
          ? channelCursorFor("f", CHANNEL_RECONCILE_EPOCH)
          : channelCursorFor("d", last.created_at),
    };
  }

  const { data, error } = await supabase
    .from("channel_analysis_runs")
    .select("id,completed_at")
    .eq("organization_id", input.organizationId)
    .eq("status", "completed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(input.limit);
  if (error) {
    throw new Error(`Memory capture reconcile run scan failed: ${describeDatabaseError(error)}.`);
  }
  const rows = (data ?? []).filter(
    (row): row is { id: string; completed_at: string } =>
      validUuid(row.id) && validTimestamp(row.completed_at),
  );
  const kind = subkind === "f" ? "channel_findings" : "channel_recommendations";
  const last = rows[rows.length - 1];
  return {
    identities: rows.map((row) => ({ kind, id: row.id })),
    completeCursor:
      rows.length < input.limit || !last
        ? channelCursorFor(nextChannelSubkind(subkind), CHANNEL_RECONCILE_EPOCH)
        : channelCursorFor(subkind, last.completed_at),
  };
}

/**
 * Reuses the exact enqueue helpers the source transactions run, through the
 * thin public service-only wrapper RPCs from the cursor migration (the
 * established fenced-RPC pattern: security definer, empty search_path,
 * per-function service_role-only grants). Nothing calls through
 * schema('private'): private-schema PostgREST calls are dead because schema
 * exposure is platform config no migration controls. Returns the events
 * inserted (0 when the helper found nothing new or capture is disabled for
 * the organization).
 */
async function enqueueMissingChannel(
  supabase: SupabaseClient<Database>,
  input: { organizationId: string; identity: { kind: string; id: string } },
): Promise<number> {
  const rpc = structuralRpcClient(supabase);
  const args = { p_organization_id: input.organizationId };

  if (
    input.identity.kind === "channel_findings" ||
    input.identity.kind === "channel_recommendations"
  ) {
    const rpcName =
      input.identity.kind === "channel_findings"
        ? "reconcile_memory_channel_findings"
        : "reconcile_memory_channel_recommendations";
    const { data, error } = await rpc.rpc(rpcName, {
      ...args,
      p_analysis_run_id: input.identity.id,
    });
    if (error) {
      throw new Error(
        `Memory capture reconcile enqueue failed: ${describeDatabaseError(error)}.`,
      );
    }
    return toEnqueuedCount(input.identity.kind, data);
  }

  if (input.identity.kind === "channel_decision") {
    const { data, error } = await rpc.rpc("reconcile_memory_channel_decision", {
      ...args,
      p_decision_id: input.identity.id,
    });
    if (error) {
      throw new Error(
        `Memory capture reconcile enqueue failed: ${describeDatabaseError(error)}.`,
      );
    }
    return toEnqueuedCount(input.identity.kind, data);
  }

  throw new Error("Memory capture reconcile identity kind is unknown.");
}

function captureCursorColumn(adapter: string): string {
  if (adapter === "channel") return "channel_cursor";
  throw new Error("Memory capture reconcile adapter is not registered yet.");
}

async function readCaptureCursor(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  adapter: string,
): Promise<string | null> {
  const { data, error } = await untypedCaptureTables(supabase)
    .from("memory_integration_settings")
    .select(captureCursorColumn(adapter))
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    throw new Error(`Memory capture cursor read failed: ${describeDatabaseError(error)}.`);
  }
  const cursor = data?.[captureCursorColumn(adapter)];
  // A corrupt cursor restarts the sweep from the epoch rather than freezing
  // the organization: enqueue is idempotent, so the cost is bounded rework.
  if (typeof cursor !== "string" || cursor.length < 1 || cursor.length > 200) return null;
  return cursor;
}

async function persistCaptureCursor(
  supabase: SupabaseClient<Database>,
  input: { organizationId: string; adapter: string; cursor: string },
): Promise<void> {
  const { data, error } = await structuralRpcClient(supabase).rpc(
    "update_memory_capture_cursor",
    {
      p_organization_id: input.organizationId,
      p_adapter: input.adapter,
      p_cursor: input.cursor,
      p_correlation_id: randomUUID(),
    },
  );
  if (error) {
    throw new Error(`Memory capture cursor write failed: ${describeDatabaseError(error)}.`);
  }
  const answer = data as { cursor?: unknown } | null;
  if (typeof answer !== "object" || answer === null || answer.cursor !== input.cursor) {
    throw new Error("Memory capture cursor write answer is invalid.");
  }
}

async function persistReconcileOrgCursor(
  supabase: SupabaseClient<Database>,
  input: { organizationId: string },
): Promise<void> {
  const { data, error } = await structuralRpcClient(supabase).rpc(
    "update_memory_reconcile_org_cursor",
    {
      p_organization_id: input.organizationId,
      p_correlation_id: randomUUID(),
    },
  );
  if (error) {
    throw new Error(
      `Memory capture reconcile organization cursor write failed: ${describeDatabaseError(error)}.`,
    );
  }
  const answer = data as { organizationId?: unknown; reconcileOrgCursor?: unknown } | null;
  if (
    typeof answer !== "object" ||
    answer === null ||
    answer.organizationId !== input.organizationId ||
    answer.reconcileOrgCursor !== input.organizationId
  ) {
    throw new Error("Memory capture reconcile organization cursor write answer is invalid.");
  }
}

export const memoryCaptureDispatchOrgTask = schemaTask({
  id: "memory-capture.dispatch-org",
  schema: captureDispatchOrgPayloadSchema,
  queue: memoryCaptureQueue,
  retry,
  maxDuration: 300,
  run: async (payload) => {
    const parsed = captureDispatchOrgPayloadSchema.parse(payload);
    const supabase = createMemoryWorkerServiceClient();
    const result = await runCaptureDispatch(parsed, {
      repository: createCaptureRepository(structuralRpcClient(supabase)),
    });
    logger.info("memory.capture_dispatch_org_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      claimed: result.counts.claimed,
      completed: result.counts.completed,
      replayed: result.counts.replayed,
      obsolete: result.counts.obsolete,
      quarantined: result.counts.quarantined,
      retryScheduled: result.counts.retryScheduled,
      terminal: result.counts.terminal,
      leaseLost: result.counts.leaseLost,
      unsettled: result.counts.unsettled,
    });
    return { counts: result.counts, finishedAt: result.finishedAt };
  },
});

/**
 * Every minute: fan out the oldest due organizations onto the shared queue.
 * `schedules.task` rather than `schemaTask`: the cron payload is fixed by
 * Trigger.dev, so there is no caller-supplied payload to validate.
 */
export const memoryCaptureDispatchTask = schedules.task({
  id: "memory-capture.dispatch",
  cron: "* * * * *",
  retry,
  maxDuration: 300,
  run: async () => {
    const supabase = createMemoryWorkerServiceClient();
    const organizationIds = await createCaptureRepository(
      structuralRpcClient(supabase),
    ).listDueOrganizations(MEMORY_CAPTURE_DUE_ORG_SCAN_LIMIT);
    for (const organizationId of organizationIds) {
      await tasks.trigger<typeof memoryCaptureDispatchOrgTask>("memory-capture.dispatch-org", {
        organizationId,
        correlationId: randomUUID(),
      });
    }
    logger.info("memory.capture_dispatch_scheduled", {
      organizations: organizationIds.length,
    });
    return { organizations: organizationIds.length };
  },
});

/**
 * Every fifteen minutes: repair missed integrations per capture-enabled
 * organization, one adapter page each, persisting the returned cursor only
 * when the page fully reconciled and the cursor actually moved (so a failed
 * page retries the same work and a quiet pass writes nothing). Organizations
 * rotate fairly: the scan resumes after the freshest reconcile_org_cursor
 * with wrap-around, and each fully-reconciled org persists itself as the new
 * resume point — a fixed top-N rescan would starve org N+1 forever.
 */
export const memoryCaptureReconcileTask = schedules.task({
  id: "memory-capture.reconcile",
  cron: "*/15 * * * *",
  retry,
  maxDuration: 300,
  run: async () => {
    const supabase = createMemoryWorkerServiceClient();
    // One cheap indexed read of uuid-sized rows: every capture-enabled org
    // plus its rotation marker. The limit bounds processing per pass, not
    // this listing — wrap-around needs the full order to resume correctly.
    const scan = await untypedCaptureTables(supabase)
      .from("memory_integration_settings")
      .select("organization_id,reconcile_org_cursor,updated_at")
      .eq("capture_enabled", true)
      .order("organization_id", { ascending: true });
    if (scan.error) {
      throw new Error(
        `Memory capture reconcile organization scan failed: ${describeDatabaseError(scan.error)}.`,
      );
    }
    const orderedIds = [
      ...new Set(
        (scan.data ?? [])
          .map((row) => row.organization_id)
          .filter((id): id is string => validUuid(id)),
      ),
    ];
    // Resume after the freshest rotation marker (the last fully-reconciled
    // org). A missing, corrupt, disabled, or removed marker restarts from
    // the beginning: re-scanning is bounded and idempotent, starving is not.
    let resumedAfter: string | null = null;
    let resumeTouchedAt = "";
    for (const row of scan.data ?? []) {
      const marker = row.reconcile_org_cursor;
      const touchedAt = row.updated_at;
      if (
        validUuid(marker) &&
        typeof touchedAt === "string" &&
        touchedAt >= resumeTouchedAt &&
        orderedIds.includes(marker)
      ) {
        resumedAfter = marker;
        resumeTouchedAt = touchedAt;
      }
    }
    const start = resumedAfter ? orderedIds.indexOf(resumedAfter) + 1 : 0;
    const organizationIds = [...orderedIds.slice(start), ...orderedIds.slice(0, start)].slice(
      0,
      MEMORY_CAPTURE_RECONCILE_ORG_LIMIT,
    );

    let scanned = 0;
    let enqueued = 0;
    for (const organizationId of organizationIds) {
      let orgAdvanced = true;
      for (const adapter of RECONCILE_ADAPTERS) {
        const cursor = await readCaptureCursor(supabase, organizationId, adapter);
        const result = await runCaptureReconcile(
          {
            organizationId,
            adapter,
            cursor,
            limit: MEMORY_CAPTURE_RECONCILE_IDENTITY_LIMIT,
          },
          {
            listIdentities: (page) => listChannelIdentities(supabase, page),
            enqueueMissing: (job) => enqueueMissingChannel(supabase, job),
          },
        );
        if (result.advanced && result.nextCursor !== null && result.nextCursor !== cursor) {
          await persistCaptureCursor(supabase, {
            organizationId,
            adapter,
            cursor: result.nextCursor,
          });
        }
        logger.info("memory.capture_reconcile_finished", {
          organizationId,
          adapter,
          scanned: result.scanned,
          enqueued: result.enqueued,
          advanced: result.advanced,
        });
        orgAdvanced = orgAdvanced && result.advanced;
        scanned += result.scanned;
        enqueued += result.enqueued;
      }
      // Only a fully-reconciled org becomes the resume point: a frozen page
      // keeps its turn next pass. Adapter cursors already persisted stay
      // saved, so the retry resumes mid-org rather than redoing it.
      if (orgAdvanced) {
        await persistReconcileOrgCursor(supabase, { organizationId });
      }
    }
    return { organizations: organizationIds.length, scanned, enqueued, resumedAfter };
  },
});
