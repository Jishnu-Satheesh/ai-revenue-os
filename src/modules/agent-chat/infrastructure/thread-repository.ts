import { z } from "zod";

import { IdempotencyConflictError } from "@/domain/agent-chat/errors";
import { DomainError } from "@/lib/errors";

/**
 * Agent thread repository (spec section 7).
 *
 * Member writes go only through the Task 1 fenced RPCs
 * (`create_agent_thread_keyed`, `append_agent_message`) on the caller's
 * session client, so RLS plus the in-function role recheck own tenant
 * isolation. Reads pin `organization_id` on the same session client.
 * No service role anywhere in this module.
 *
 * Validation mirrors the Task 1 contract exactly: title trims to at most
 * 200 chars, message bodies trim to 1-20000 chars, idempotency keys trim
 * to 1-200 chars. Identifiers are deliberately opaque non-empty strings
 * here: the route layer already guarantees UUIDs via
 * `getOrganizationContext`, and this layer must not invent a second
 * source of scope truth.
 */

export const threadModeSchema = z.enum(["quick", "deepthink"]);
export type ThreadMode = z.infer<typeof threadModeSchema>;

export const threadStatusSchema = z.enum(["open", "awaiting_user", "running", "completed", "cancelled"]);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const threadMessageRoleSchema = z.enum(["user", "assistant", "system_note"]);
export type ThreadMessageRole = z.infer<typeof threadMessageRoleSchema>;

export type ThreadRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Minimal thenable select chain. Shaped so the real session client fits
 * with a cast at the call site (sibling precedent) and tests can hand in
 * a small fake.
 */
export type ThreadQueryBuilder = PromiseLike<{ data: unknown; error: unknown }> & {
  select(columns: string): ThreadQueryBuilder;
  eq(column: string, value: unknown): ThreadQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): ThreadQueryBuilder;
  limit(count: number): ThreadQueryBuilder;
  lt(column: string, value: string): ThreadQueryBuilder;
  gt(column: string, value: string): ThreadQueryBuilder;
  or(filters: string): ThreadQueryBuilder;
};

export type ThreadPersistence = {
  rpc: ThreadRpc;
  from?: (table: string) => ThreadQueryBuilder;
};

const idSchema = z.string().min(1).max(200);
const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200);

const createThreadInputSchema = z
  .object({
    organizationId: idSchema,
    actorId: idSchema,
    idempotencyKey: idempotencyKeySchema,
    title: z.string().max(200).optional(),
    mode: threadModeSchema,
  })
  .strict();

const appendMessageInputSchema = z
  .object({
    organizationId: idSchema,
    actorId: idSchema,
    threadId: idSchema,
    role: threadMessageRoleSchema,
    body: z.string(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const setThreadLinksInputSchema = z
  .object({
    organizationId: idSchema,
    actorId: idSchema,
    threadId: idSchema,
    projectId: z.string().uuid().nullable().optional(),
    requestId: z.string().uuid().nullable().optional(),
    draftRequestId: z.string().uuid().nullable().optional(),
    campaignId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type SetThreadLinksInput = z.infer<typeof setThreadLinksInputSchema>;

export type ThreadLinkIds = {
  threadId: string;
  projectId: string | null;
  requestId: string | null;
  draftRequestId: string | null;
  campaignId: string | null;
};

const listInputSchema = z
  .object({
    organizationId: idSchema,
    limit: z.number().int().min(1).max(50).optional(),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict();

const threadCursorSchema = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
    id: z.string().min(1),
  })
  .strict();

const messageCursorSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().min(1),
  })
  .strict();

const THREAD_COLUMNS =
  "id,organization_id,title,mode,status,linked_research_project_id,linked_request_id,linked_draft_request_id,linked_campaign_id,created_by,created_at,updated_at";
const MESSAGE_COLUMNS =
  "id,organization_id,thread_id,role,body,questionnaire_answers,marker_receipts,citations,created_by,created_at";

const threadRowSchema = z
  .object({
    id: z.string().min(1),
    organization_id: z.string().min(1),
    title: z.string(),
    mode: threadModeSchema,
    status: threadStatusSchema,
    linked_research_project_id: z.string().nullable(),
    linked_request_id: z.string().nullable(),
    linked_draft_request_id: z.string().nullable(),
    linked_campaign_id: z.string().nullable(),
    created_by: z.string().min(1),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

const messageRowSchema = z
  .object({
    id: z.string().min(1),
    organization_id: z.string().min(1),
    thread_id: z.string().min(1),
    role: threadMessageRoleSchema,
    body: z.string().nullable(),
    questionnaire_answers: z.unknown().nullable(),
    marker_receipts: z.unknown().nullable(),
    citations: z.unknown().nullable(),
    created_by: z.string().min(1),
    created_at: z.string().datetime({ offset: true }),
  })
  .passthrough();

export type ThreadSummary = {
  id: string;
  organizationId: string;
  title: string;
  mode: ThreadMode;
  status: ThreadStatus;
  linkedResearchProjectId: string | null;
  linkedRequestId: string | null;
  linkedDraftRequestId: string | null;
  linkedCampaignId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ThreadMessageView = {
  id: string;
  threadId: string;
  role: ThreadMessageRole;
  body: string | null;
  questionnaireAnswers: unknown;
  markerReceipts: unknown;
  citations: unknown;
  createdAt: string;
};

function mapThreadRow(row: z.infer<typeof threadRowSchema>): ThreadSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    mode: row.mode,
    status: row.status,
    linkedResearchProjectId: row.linked_research_project_id,
    linkedRequestId: row.linked_request_id,
    linkedDraftRequestId: row.linked_draft_request_id,
    linkedCampaignId: row.linked_campaign_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessageRow(row: z.infer<typeof messageRowSchema>): ThreadMessageView {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    body: row.body,
    questionnaireAnswers: row.questionnaire_answers ?? null,
    markerReceipts: row.marker_receipts ?? null,
    citations: row.citations ?? null,
    createdAt: row.created_at,
  };
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") return String((error as { message: unknown }).message);
  return "";
}

/**
 * Safe RPC refusal mapping. Every branch names the operator's next step
 * without exposing foreign-thread existence or storage internals.
 */
function mapRpcError(error: unknown, scope: string): DomainError {
  const message = errorMessage(error);
  if (message.includes("forbidden")) {
    return new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to change this chat.",
    );
  }
  if (message.includes("key_conflict") || message.includes("conflict")) {
    return new IdempotencyConflictError(
      `This ${scope} was already saved with different details. Use a fresh idempotency key for new content.`,
    );
  }
  if (message.includes("not_found")) {
    return new DomainError(
      "TENANT_SCOPE_ERROR",
      "This chat was not found in your organization.",
    );
  }
  if (message.includes("invalid")) {
    return new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }
  return new DomainError("DOMAIN_ERROR", `This ${scope} could not be saved.`);
}

async function callKeyedRpc(
  persistence: ThreadPersistence,
  name: string,
  args: Record<string, unknown>,
  scope: string,
): Promise<Record<string, unknown>> {
  let result: { data: unknown; error: unknown };
  try {
    result = await persistence.rpc(name, args);
  } catch {
    throw new DomainError("DOMAIN_ERROR", `This ${scope} could not be saved.`);
  }
  if (result.error) throw mapRpcError(result.error, scope);
  const parsed = z.record(z.string(), z.unknown()).safeParse(result.data);
  if (!parsed.success) throw new DomainError("DOMAIN_ERROR", `This ${scope} could not be saved.`);
  return parsed.data as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, keys: string[], scope: string): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new DomainError("DOMAIN_ERROR", `This ${scope} could not be saved.`);
}

function booleanField(row: Record<string, unknown>, key: string, scope: string): boolean {
  const value = row[key];
  if (typeof value !== "boolean") {
    throw new DomainError("DOMAIN_ERROR", `This ${scope} could not be saved.`);
  }
  return value;
}

function nullableIdField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new DomainError("DOMAIN_ERROR", "These chat links could not be saved.");
  }
  return value;
}

function requireReads(persistence: ThreadPersistence): NonNullable<ThreadPersistence["from"]> {
  if (!persistence.from) {
    throw new DomainError("DOMAIN_ERROR", "This chat could not be loaded.");
  }
  return persistence.from;
}

/** base64url without node:Buffer, so this module stays client-importable. */
function encodeCursor(payload: Record<string, string>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeThreadCursor(cursor: string | undefined): z.infer<typeof threadCursorSchema> | null {
  if (!cursor) return null;
  try {
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = threadCursorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function decodeMessageCursor(
  cursor: string | undefined,
): z.infer<typeof messageCursorSchema> | null {
  if (!cursor) return null;
  try {
    const binary = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = messageCursorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readFailure(): never {
  throw new DomainError("DOMAIN_ERROR", "This chat could not be loaded.");
}

function readRows(result: { data: unknown; error: unknown }): unknown[] {
  if (result.error) throw new DomainError("DOMAIN_ERROR", "This chat could not be loaded.");
  if (!Array.isArray(result.data)) readFailure();
  return result.data as unknown[];
}

export function createThreadRepository(persistence: ThreadPersistence) {
  return {
    /**
     * Idempotent thread creation. Same key plus same body replays the kept
     * thread; same key with another body raises IdempotencyConflictError.
     * An empty title travels as null so the function applies its
     * 'New chat' default; over-200 titles refuse here, matching the check.
     */
    async createThreadKeyed(input: {
      organizationId: string;
      actorId: string;
      idempotencyKey: string;
      title?: string;
      mode: ThreadMode;
    }): Promise<{ threadId: string; status: string; replayed: boolean }> {
      const parsed = createThreadInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const cleanTitle = parsed.data.title?.trim() ?? "";
      if (cleanTitle.length > 200) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const row = await callKeyedRpc(
        persistence,
        "create_agent_thread_keyed",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_idempotency_key: parsed.data.idempotencyKey,
          p_title: cleanTitle.length > 0 ? cleanTitle : null,
          p_mode: parsed.data.mode,
        },
        "chat",
      );
      // The fenced function returns `threadId`; `id` is accepted as well so
      // keyed replays stay convergeable whatever key the caller stored.
      const threadId = stringField(row, ["threadId", "id"], "chat");
      const statusValue = row["status"];
      return {
        threadId,
        status: typeof statusValue === "string" && statusValue.length > 0 ? statusValue : "open",
        replayed: booleanField(row, "replayed", "chat"),
      };
    },

    /**
     * Idempotent message append. The parent thread clock refreshes inside
     * the function, so history ordering never needs a second write.
     */
    async appendMessageKeyed(input: {
      organizationId: string;
      actorId: string;
      threadId: string;
      role: ThreadMessageRole;
      body: string;
      idempotencyKey: string;
    }): Promise<{ messageId: string; threadId: string; replayed: boolean }> {
      const parsed = appendMessageInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const cleanBody = parsed.data.body.trim();
      if (cleanBody.length < 1 || cleanBody.length > 20000) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const row = await callKeyedRpc(
        persistence,
        "append_agent_message",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_thread_id: parsed.data.threadId,
          p_role: parsed.data.role,
          p_body: cleanBody,
          p_idempotency_key: parsed.data.idempotencyKey,
        },
        "message",
      );
      return {
        messageId: stringField(row, ["messageId", "id"], "message"),
        threadId: stringField(row, ["threadId", "thread_id"], "message"),
        replayed: booleanField(row, "replayed", "message"),
      };
    },

    /**
     * Governed thread link update through the Task 1 fenced
     * `set_thread_links` RPC (operator role or above; the function
     * rechecks inside, fenced to the calling organization). Link targets
     * stay safe ids verified by readers at use time; passing all four as
     * null clears them.
     */
    async setThreadLinks(input: SetThreadLinksInput): Promise<ThreadLinkIds> {
      const parsed = setThreadLinksInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const row = await callKeyedRpc(
        persistence,
        "set_thread_links",
        {
          p_organization_id: parsed.data.organizationId,
          p_actor_id: parsed.data.actorId,
          p_thread_id: parsed.data.threadId,
          p_project_id: parsed.data.projectId ?? null,
          p_request_id: parsed.data.requestId ?? null,
          p_draft_request_id: parsed.data.draftRequestId ?? null,
          p_campaign_id: parsed.data.campaignId ?? null,
        },
        "chat links",
      );
      return {
        threadId: stringField(row, ["threadId"], "chat links"),
        projectId: nullableIdField(row, "projectId"),
        requestId: nullableIdField(row, "requestId"),
        draftRequestId: nullableIdField(row, "draftRequestId"),
        campaignId: nullableIdField(row, "campaignId"),
      };
    },

    /** Newest-first thread history for the caller's own organization. */
    async listThreads(input: {
      organizationId: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ threads: ThreadSummary[]; nextCursor: string | null }> {
      const parsed = listInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const from = requireReads(persistence);
      const limit = parsed.data.limit ?? 20;
      const cursor = decodeThreadCursor(parsed.data.cursor);
      let query = from("agent_threads")
        .select(THREAD_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false });
      if (cursor) {
        query = query.or(
          `updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
        );
      }
      const rows = readRows(await query.limit(limit + 1));
      const kept = rows.slice(0, limit);
      const threads: ThreadSummary[] = [];
      for (const row of kept) {
        const validated = threadRowSchema.safeParse(row);
        if (!validated.success) readFailure();
        threads.push(mapThreadRow(validated.data as z.infer<typeof threadRowSchema>));
      }
      const hasMore = rows.length > limit;
      const last = threads.at(-1);
      return {
        threads,
        nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null,
      };
    },

    /** One thread by id, pinned to the caller's organization. Null when foreign. */
    async getThread(input: {
      organizationId: string;
      threadId: string;
    }): Promise<ThreadSummary | null> {
      const parsed = z
        .object({ organizationId: idSchema, threadId: idSchema })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const from = requireReads(persistence);
      const rows = readRows(
        await from("agent_threads")
          .select(THREAD_COLUMNS)
          .eq("organization_id", parsed.data.organizationId)
          .eq("id", parsed.data.threadId)
          .limit(1),
      );
      const validated = threadRowSchema.safeParse(rows[0]);
      if (!validated.success) return null;
      return mapThreadRow(validated.data);
    },

    /** Oldest-first messages for reopen: bodies plus saved answers and receipts. */
    async listMessages(input: {
      organizationId: string;
      threadId: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ messages: ThreadMessageView[]; nextCursor: string | null }> {
      const parsed = listInputSchema
        .extend({ threadId: idSchema })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const from = requireReads(persistence);
      const limit = parsed.data.limit ?? 20;
      const cursor = decodeMessageCursor(parsed.data.cursor);
      let query = from("agent_messages")
        .select(MESSAGE_COLUMNS)
        .eq("organization_id", parsed.data.organizationId)
        .eq("thread_id", parsed.data.threadId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (cursor) {
        query = query.or(
          `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id})`,
        );
      }
      const rows = readRows(await query.limit(limit + 1));
      const kept = rows.slice(0, limit);
      const messages: ThreadMessageView[] = [];
      for (const row of kept) {
        const validated = messageRowSchema.safeParse(row);
        if (!validated.success) readFailure();
        messages.push(mapMessageRow(validated.data as z.infer<typeof messageRowSchema>));
      }
      const hasMore = rows.length > limit;
      const last = messages.at(-1);
      return {
        messages,
        nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    /** One message by id, pinned to the caller's organization. Null when foreign. */
    async getMessage(input: {
      organizationId: string;
      messageId: string;
    }): Promise<ThreadMessageView | null> {
      const parsed = z
        .object({ organizationId: idSchema, messageId: idSchema })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const from = requireReads(persistence);
      const rows = readRows(
        await from("agent_messages")
          .select(MESSAGE_COLUMNS)
          .eq("organization_id", parsed.data.organizationId)
          .eq("id", parsed.data.messageId)
          .limit(1),
      );
      const validated = messageRowSchema.safeParse(rows[0]);
      if (!validated.success) return null;
      return mapMessageRow(validated.data);
    },

    /** Newest user message in a thread: what the route endpoint classifies. */
    async latestUserMessage(input: {
      organizationId: string;
      threadId: string;
    }): Promise<ThreadMessageView | null> {
      const parsed = z
        .object({ organizationId: idSchema, threadId: idSchema })
        .strict()
        .safeParse(input);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const from = requireReads(persistence);
      const rows = readRows(
        await from("agent_messages")
          .select(MESSAGE_COLUMNS)
          .eq("organization_id", parsed.data.organizationId)
          .eq("thread_id", parsed.data.threadId)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1),
      );
      const validated = messageRowSchema.safeParse(rows[0]);
      if (!validated.success) return null;
      return mapMessageRow(validated.data);
    },
  };
}

export type ThreadRepository = ReturnType<typeof createThreadRepository>;
