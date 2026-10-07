import { z } from "zod";

import { logger } from "@/lib/logger";

/**
 * One parser for every `*_ORGANIZATION_IDS` rollout allowlist.
 *
 * Like a label printer for breaker switches: each gate used to hand-write
 * its own guest-list check, and a typo such as `*` escaped as a raw
 * `ZodError` that production masks into "Something went wrong". Now every
 * gate shares this parser, the thrown error names the exact environment
 * variable and the offending entry, and the request-path resolvers below
 * fail closed — the feature reads as disabled — with one error-level log
 * line instead of a page crash.
 *
 * The log line stays inside the logger's closed fence on purpose: the
 * context carries the variable name plus a bounded reason word, never the
 * raw entry. The entry itself travels on the thrown error, which only
 * surfaces in server logs and test output, never in a client response.
 */

const organizationIdSchema = z.string().uuid();

const MAX_ENTRY_LOG_LENGTH = 60;

export type RolloutAllowlistReason =
  | "empty_entry"
  | "invalid_entry"
  | "duplicate_entry"
  | "over_cap"
  | "unexpected";

export class RolloutAllowlistError extends Error {
  readonly variableName: string;
  readonly reason: RolloutAllowlistReason;

  constructor(variableName: string, reason: RolloutAllowlistReason, message: string) {
    super(message);
    this.name = "RolloutAllowlistError";
    this.variableName = variableName;
    this.reason = reason;
  }
}

export type ParseOrganizationAllowlistOptions = {
  /** The environment variable the value came from, named in every error. */
  variableName: string;
  /** Human label for the list, e.g. "Campaign rollout organization IDs". */
  label: string;
  /** Optional cap on entries; the overview growth list uses 100. */
  maxEntries?: number;
};

function truncateEntry(entry: string): string {
  return entry.length > MAX_ENTRY_LOG_LENGTH ? `${entry.slice(0, MAX_ENTRY_LOG_LENGTH)}…` : entry;
}

/**
 * Strict parse: blank means disabled, anything malformed throws a
 * `RolloutAllowlistError` naming the variable and the entry. Direct
 * callers (and their tests) keep this strict contract; request paths use
 * `resolveOrganizationAllowlist` below so a typo degrades instead of
 * crashing the page.
 */
export function parseOrganizationAllowlist(
  value: string | undefined,
  options: ParseOrganizationAllowlistOptions,
): Set<string> {
  const { variableName, label, maxEntries } = options;
  if (value === undefined || value.trim() === "") return new Set();

  const entries = value.split(",").map((entry) => entry.trim());

  if (entries.some((entry) => entry.length === 0)) {
    throw new RolloutAllowlistError(
      variableName,
      "empty_entry",
      `${label} must not contain empty values. Check ${variableName}.`,
    );
  }

  const enabled = new Set<string>();
  for (const entry of entries) {
    if (!organizationIdSchema.safeParse(entry).success) {
      throw new RolloutAllowlistError(
        variableName,
        "invalid_entry",
        `${label} has an invalid entry in ${variableName}: "${truncateEntry(entry)}" is not an organization ID. Use comma-separated UUIDs, or unset ${variableName} to disable.`,
      );
    }
    enabled.add(entry.toLowerCase());
  }

  if (enabled.size !== entries.length) {
    throw new RolloutAllowlistError(
      variableName,
      "duplicate_entry",
      `${label} must not contain duplicates. Check ${variableName}.`,
    );
  }

  if (maxEntries !== undefined && enabled.size > maxEntries) {
    throw new RolloutAllowlistError(
      variableName,
      "over_cap",
      `${label} must not exceed ${maxEntries} entries. Check ${variableName}.`,
    );
  }

  return enabled;
}

/**
 * Fail-closed resolver for request paths: a misconfigured list logs one
 * error line naming the variable and reads as an empty set, so every
 * organization sees the feature as disabled instead of a 500. Blank stays
 * silent — unset means off by design, not a misconfiguration.
 */
export function resolveOrganizationAllowlist(
  value: string | undefined,
  options: ParseOrganizationAllowlistOptions,
): Set<string> {
  try {
    return parseOrganizationAllowlist(value, options);
  } catch (error) {
    const reason = error instanceof RolloutAllowlistError ? error.reason : ("unexpected" as const);
    logger.error("rollout_allowlist.invalid_config", {
      errorCode: `${options.variableName}:${reason}`,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return new Set<string>();
  }
}
