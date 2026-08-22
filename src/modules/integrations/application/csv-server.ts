import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

/** Server-only hashing and deterministic identifiers for legacy CSV writes. */
export function csvContentDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildOperationSubkey(idempotencyKey: string, suffix: string): string {
  return `${idempotencyKey.slice(0, 160)}:${createHash("sha256").update(suffix).digest("hex").slice(0, 16)}`;
}

/** Stable operation-scoped upload ID so a retried request addresses one object. */
export function buildDeterministicUploadId(organizationId: string, idempotencyKey: string): string {
  z.string().uuid().parse(organizationId);
  const digest = createHash("sha256")
    .update(`${organizationId}:${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  const variant = ["8", "9", "a", "b"][parseInt(digest[16], 16) % 4];
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20)}`;
}
