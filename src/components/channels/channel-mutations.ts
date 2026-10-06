"use client";

import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import {
  channelAliasInputSchema,
  channelBranchMappingInputSchema,
  channelCreateInputSchema,
  channelUpdateInputSchema,
  type ChannelAliasInput,
  type ChannelBranchMappingInput,
  type ChannelCreateInput,
  type ChannelUpdateInput,
} from "@/domain/channels/types";
import type {
  ChannelSourceAliasRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

/**
 * Task 6 — browser-safe TanStack wrappers around the four existing channel
 * endpoints (plan §5). No new endpoint, no service-role client, no auto-retry:
 * every hook sets `retry:false` because a second POST could double-create an
 * alias or mapping after an ambiguous network failure.
 *
 * Hooks resolve the validated resource and never navigate; the calling dialog
 * decides whether to close, stay open, or refresh. Input shapes are reused
 * from `src/domain/channels/types.ts` — never redefined here — and the
 * server-only `application/api.ts` stays out of this client graph.
 */

export const CHANNEL_IDENTITY_ERROR = "The channel could not be saved. Please try again.";
export const CHANNEL_MAPPING_ERROR = "The location mapping could not be saved. Please try again.";
export const CHANNEL_LABEL_ERROR = "The report label could not be saved. Please try again.";
export const CHANNEL_STATUS_ERROR = "The channel status could not be changed. Please try again.";

const JSON_HEADERS = { "content-type": "application/json" };

function channelsUrl(organizationId: string, channelId?: string): string {
  const base = `/api/organizations/${organizationId}/channels`;
  return channelId ? `${base}/${channelId}` : base;
}

/** Only the established `{error:{code,message}}` envelope may surface publicly. */
function publicEnvelopeMessage(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const nested = (body as { error?: unknown }).error;
    if (nested && typeof nested === "object" && "message" in nested) {
      const message = (nested as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  }
  return null;
}

/**
 * Same-origin JSON round trip. A rejected fetch, a non-2xx envelope, a
 * malformed/non-JSON body, or a 2xx missing the expected object all become a
 * safe Error carrying either the public envelope message or the mandatory
 * section fallback — never a raw payload, provider error, or stack trace.
 */
async function requestJsonEnvelope(
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(fallback);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(publicEnvelopeMessage(body) ?? fallback);
  if (!body || typeof body !== "object") throw new Error(fallback);
  return body;
}

function envelopeResource(body: unknown, key: "channel" | "mapping" | "alias"): unknown {
  if (body && typeof body === "object" && key in body) {
    return (body as Record<string, unknown>)[key];
  }
  return undefined;
}

// Response identity checks (plan §5): `id` must be a UUID, the record must
// belong to this tenant (and this channel for mappings/aliases), and a status
// write must echo the requested status. Unknown extra fields pass through.
const channelResourceSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string(),
    status: z.string(),
  })
  .passthrough();

const mappingResourceSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string(),
    channel_id: z.string(),
  })
  .passthrough();

const aliasResourceSchema = z
  .object({
    id: z.string().uuid(),
    organization_id: z.string(),
    channel_id: z.string(),
  })
  .passthrough();

function validatedChannel(
  body: unknown,
  organizationId: string,
  fallback: string,
  expectedStatus?: "active" | "archived",
): OrganizationChannelRow {
  const parsed = channelResourceSchema.safeParse(envelopeResource(body, "channel"));
  if (!parsed.success) throw new Error(fallback);
  if (parsed.data.organization_id !== organizationId) throw new Error(fallback);
  if (expectedStatus !== undefined && parsed.data.status !== expectedStatus) {
    throw new Error(fallback);
  }
  return parsed.data as unknown as OrganizationChannelRow;
}

function validatedMapping(
  body: unknown,
  organizationId: string,
  channelId: string,
): OrganizationChannelBranchRow {
  const parsed = mappingResourceSchema.safeParse(envelopeResource(body, "mapping"));
  if (!parsed.success) throw new Error(CHANNEL_MAPPING_ERROR);
  if (parsed.data.organization_id !== organizationId) throw new Error(CHANNEL_MAPPING_ERROR);
  if (parsed.data.channel_id !== channelId) throw new Error(CHANNEL_MAPPING_ERROR);
  return parsed.data as unknown as OrganizationChannelBranchRow;
}

function validatedAlias(
  body: unknown,
  organizationId: string,
  channelId: string,
): ChannelSourceAliasRow {
  const parsed = aliasResourceSchema.safeParse(envelopeResource(body, "alias"));
  if (!parsed.success) throw new Error(CHANNEL_LABEL_ERROR);
  if (parsed.data.organization_id !== organizationId) throw new Error(CHANNEL_LABEL_ERROR);
  if (parsed.data.channel_id !== channelId) throw new Error(CHANNEL_LABEL_ERROR);
  return parsed.data as unknown as ChannelSourceAliasRow;
}

/**
 * Identity create/update keyed by `channelId` presence. Create POSTs the full
 * identity (stable key required); update PATCHes display name, category and
 * provider hint only — `key` is never submitted on edit and `status` stays
 * with the status hook below.
 */
export function useChannelIdentityMutation({
  organizationId,
  channelId,
}: {
  organizationId: string;
  channelId: string | null;
}) {
  return useMutation({
    mutationKey: ["channels", organizationId, channelId ?? "new", "identity"],
    retry: false,
    mutationFn: async (
      input: ChannelCreateInput | ChannelUpdateInput,
    ): Promise<OrganizationChannelRow> => {
      if (channelId === null) {
        const parsed = channelCreateInputSchema.parse(input);
        const body = await requestJsonEnvelope(
          channelsUrl(organizationId),
          {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({
              key: parsed.key,
              displayName: parsed.displayName,
              category: parsed.category,
              templateKey: parsed.templateKey ?? null,
            }),
          },
          CHANNEL_IDENTITY_ERROR,
        );
        return validatedChannel(body, organizationId, CHANNEL_IDENTITY_ERROR);
      }
      const parsed = channelUpdateInputSchema.parse(input);
      const patch: Record<string, unknown> = {};
      if (parsed.displayName !== undefined) patch.displayName = parsed.displayName;
      if (parsed.category !== undefined) patch.category = parsed.category;
      if (parsed.templateKey !== undefined) patch.templateKey = parsed.templateKey;
      const body = await requestJsonEnvelope(
        channelsUrl(organizationId, channelId),
        { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) },
        CHANNEL_IDENTITY_ERROR,
      );
      return validatedChannel(body, organizationId, CHANNEL_IDENTITY_ERROR);
    },
  });
}

/** Archive/restore: PATCH `{status}` behind the D06 confirmation, never DELETE. */
export function useChannelStatusMutation({
  organizationId,
  channelId,
}: {
  organizationId: string;
  channelId: string;
}) {
  return useMutation({
    mutationKey: ["channels", organizationId, channelId, "status"],
    retry: false,
    mutationFn: async (input: { status: "active" | "archived" }) => {
      const status = z.enum(["active", "archived"]).parse(input.status);
      const body = await requestJsonEnvelope(
        channelsUrl(organizationId, channelId),
        {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ status }),
        },
        CHANNEL_STATUS_ERROR,
      );
      return validatedChannel(body, organizationId, CHANNEL_STATUS_ERROR, status);
    },
  });
}

/** One location mapping per PUT; Task 7 owns the D07 form around this hook. */
export function useChannelLocationMutation({
  organizationId,
  channelId,
}: {
  organizationId: string;
  channelId: string;
}) {
  return useMutation({
    mutationKey: ["channels", organizationId, channelId, "location"],
    retry: false,
    mutationFn: async (input: ChannelBranchMappingInput) => {
      const parsed = channelBranchMappingInputSchema.parse(input);
      const body = await requestJsonEnvelope(
        `${channelsUrl(organizationId, channelId)}/branches`,
        {
          method: "PUT",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            branchId: parsed.branchId,
            applicability: parsed.applicability,
            effectiveFrom: parsed.effectiveFrom ?? null,
            effectiveTo: parsed.effectiveTo ?? null,
          }),
        },
        CHANNEL_MAPPING_ERROR,
      );
      return validatedMapping(body, organizationId, channelId);
    },
  });
}

/** One exact report label per POST; Task 7 owns the D08 form around this hook. */
export function useChannelReportLabelMutation({
  organizationId,
  channelId,
}: {
  organizationId: string;
  channelId: string;
}) {
  return useMutation({
    mutationKey: ["channels", organizationId, channelId, "report-label"],
    retry: false,
    mutationFn: async (input: ChannelAliasInput) => {
      const parsed = channelAliasInputSchema.parse(input);
      const body = await requestJsonEnvelope(
        `${channelsUrl(organizationId, channelId)}/aliases`,
        {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({
            alias: parsed.alias,
            sourceScope: parsed.sourceScope,
            effectiveFrom: parsed.effectiveFrom ?? null,
            effectiveTo: parsed.effectiveTo ?? null,
          }),
        },
        CHANNEL_LABEL_ERROR,
      );
      return validatedAlias(body, organizationId, channelId);
    },
  });
}
