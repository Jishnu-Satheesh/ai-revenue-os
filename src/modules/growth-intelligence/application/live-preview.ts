import "server-only";

import { z } from "zod";

import { parse as parseDomain } from "tldts";

import { DomainError } from "@/lib/errors";

const LIVE_PREVIEW_MAX_TOPICS = 3;
const LIVE_PREVIEW_MAX_COMPETITORS = 2;
const LIVE_PREVIEW_MAX_QUERIES = 3;
const LIVE_PREVIEW_MAX_RESULTS_PER_QUERY = 5;
const LIVE_PREVIEW_MAX_ITEMS = 15;

const INVALID_INPUT_MESSAGE = "The live preview request could not be understood.";
const INVALID_RESPONSE_MESSAGE = "The live preview response could not be understood.";

export const livePreviewInputSchema = z
  .object({
    branchId: z.string().uuid(),
    topics: z.array(z.string().trim().min(1).max(160)).max(3).optional().default([]),
    competitors: z.array(z.string().trim().min(1).max(160)).max(2).optional().default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.topics.length + input.competitors.length < 1) {
      context.addIssue({
        code: "custom",
        path: ["topics"],
        message: "Provide at least one topic or competitor.",
      });
    }
  });

export type LivePreviewInput = z.infer<typeof livePreviewInputSchema>;

export const livePreviewQuerySchema = z
  .object({
    slotKey: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(160),
    maxResults: z.number().int().min(1).max(5),
  })
  .strict();

export type LivePreviewQuery = z.infer<typeof livePreviewQuerySchema>;

export const livePreviewResultItemSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    url: z
      .string()
      .trim()
      .min(1)
      .max(2_048)
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            (url.protocol === "http:" || url.protocol === "https:") &&
            !url.username &&
            !url.password
          );
        } catch {
          return false;
        }
      }, "A preview URL must be a public HTTP URL without credentials."),
    publisher: z.string().trim().min(1).max(200),
    snippet: z.string().trim().min(1).max(1_000),
    retrievedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type LivePreviewResultItem = z.infer<typeof livePreviewResultItemSchema>;

const QUERY_OPERATOR = /\b(?:site|inurl|filetype|cache|related|link)\s*:/gi;
const PROMPT_INJECTION =
  /\b(?:ignore|disregard|forget|override)\b[\s\S]{0,80}\b(?:instruction|instructions|previous|system)\b/gi;

function safePhrase(value: string): string {
  const clean = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(PROMPT_INJECTION, " ")
    .replace(QUERY_OPERATOR, " ")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return clean.slice(0, 160);
}

function slotKeySegment(value: string): string {
  const segment = safePhrase(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return segment.length > 0 ? segment : "input";
}

const braveLivePreviewEnvelopeSchema = z
  .object({
    web: z
      .object({
        results: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

const braveLivePreviewResultSchema = z
  .object({
    url: z.string(),
    title: z.string().nullish(),
    description: z.string().nullish(),
  })
  .passthrough();

const retrievedAtSchema = z.string().datetime({ offset: true });

/**
 * Local citation-URL check mirroring the safe-public-http rules (public
 * HTTP(S) without credentials, default port only, registrable non-IP host).
 * Kept inline because application services depend on ports, not adapters:
 * importing the infrastructure helper would invert the layer direction.
 * Returns the canonical form (lowercase host, default port dropped,
 * fragment stripped) or null when unsafe.
 */
function tryNormalizePreviewCitationUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return null;
  }
  if (
    url.port &&
    !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))
  ) {
    return null;
  }
  const host = parseDomain(url.hostname, { allowPrivateDomains: false, detectIp: true });
  if (host.isIp || host.domain === null) return null;
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  url.hash = "";
  return url.toString();
}

/**
 * Deterministic live-preview query plan: topics in input order, then
 * competitors in input order, sanitized with the shared safePhrase rules,
 * deduped case-insensitively, fail-closed past the 3-query ceiling.
 */
export function buildLivePreviewQueries(input: LivePreviewInput): LivePreviewQuery[] {
  const parsed = livePreviewInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", INVALID_INPUT_MESSAGE);
  }
  if (
    parsed.data.topics.length > LIVE_PREVIEW_MAX_TOPICS ||
    parsed.data.competitors.length > LIVE_PREVIEW_MAX_COMPETITORS
  ) {
    throw new DomainError("VALIDATION_ERROR", INVALID_INPUT_MESSAGE);
  }

  const ordered: Array<{ kind: "topic" | "competitor"; raw: string }> = [
    ...parsed.data.topics.map((raw) => ({ kind: "topic" as const, raw })),
    ...parsed.data.competitors.map((raw) => ({ kind: "competitor" as const, raw })),
  ];

  const seenPhrases = new Set<string>();
  const deduped: Array<{ kind: "topic" | "competitor"; text: string }> = [];
  for (const entry of ordered) {
    const text = safePhrase(entry.raw);
    if (text.length === 0) {
      throw new DomainError("VALIDATION_ERROR", INVALID_INPUT_MESSAGE);
    }
    const folded = text.toLowerCase();
    if (seenPhrases.has(folded)) continue;
    seenPhrases.add(folded);
    deduped.push({ kind: entry.kind, text });
  }

  if (deduped.length === 0) {
    throw new DomainError("VALIDATION_ERROR", INVALID_INPUT_MESSAGE);
  }
  if (deduped.length > LIVE_PREVIEW_MAX_QUERIES) {
    throw new DomainError("VALIDATION_ERROR", INVALID_INPUT_MESSAGE);
  }

  const seenSlotKeys = new Set<string>();
  return deduped.map((entry) => {
    const base = `${entry.kind}:${slotKeySegment(entry.text)}`;
    let slotKey = base;
    let suffix = 2;
    while (seenSlotKeys.has(slotKey)) {
      slotKey = `${base}-${suffix}`;
      suffix += 1;
    }
    seenSlotKeys.add(slotKey);
    return {
      slotKey,
      text: entry.text,
      maxResults: LIVE_PREVIEW_MAX_RESULTS_PER_QUERY,
    };
  });
}

/**
 * Parses one Brave web/results envelope into bounded preview items.
 * Unsafe citation URLs are dropped, output caps at 15 items, and failures
 * use a fixed safe message so raw provider text never surfaces.
 */
export function parseLivePreviewResponse(
  json: unknown,
  retrievedAt: string,
): LivePreviewResultItem[] {
  if (!retrievedAtSchema.safeParse(retrievedAt).success) {
    throw new DomainError("VALIDATION_ERROR", INVALID_RESPONSE_MESSAGE);
  }
  const envelope = braveLivePreviewEnvelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new DomainError("VALIDATION_ERROR", INVALID_RESPONSE_MESSAGE);
  }

  const items: LivePreviewResultItem[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of envelope.data.web.results) {
    if (items.length >= LIVE_PREVIEW_MAX_ITEMS) break;
    const result = braveLivePreviewResultSchema.safeParse(candidate);
    if (!result.success) continue;

    const rawTitle = (result.data.title ?? "").trim();
    if (rawTitle.length === 0) continue;
    const title = rawTitle.slice(0, 200).trim();
    if (title.length === 0) continue;

    const rawSnippet = (result.data.description ?? "").trim();
    if (rawSnippet.length === 0) continue;
    const snippet = rawSnippet.slice(0, 1_000).trim();
    if (snippet.length === 0) continue;

    const normalized = tryNormalizePreviewCitationUrl(result.data.url);
    if (!normalized) continue;
    if (seenUrls.has(normalized)) continue;

    let publisher: string;
    try {
      publisher = new URL(normalized).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (publisher.length < 1 || publisher.length > 200) continue;

    const item = livePreviewResultItemSchema.safeParse({
      title,
      url: normalized,
      publisher,
      snippet,
      retrievedAt,
    });
    if (!item.success) continue;
    seenUrls.add(normalized);
    items.push(item.data);
  }

  return items;
}
