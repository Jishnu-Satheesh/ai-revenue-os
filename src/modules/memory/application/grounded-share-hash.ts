import "server-only";

import { createHash } from "node:crypto";

import {
  canonicalGroundedShareConsentText,
  GROUNDED_SHARE_CONSENT_VERSION,
} from "@/domain/memory/grounded-share";

/**
 * Server-only consent wording hash.
 *
 * Lives outside the pure domain module on purpose: a node:crypto import
 * inside a module a client component reaches fails the browser build, so
 * the wording constant stays pure and only this file hashes it.
 * See src/lib/client-module-boundary.test.ts.
 */
export function groundedShareWordingHash(): { version: string; hash: string } {
  const hash = createHash("sha256").update(canonicalGroundedShareConsentText(), "utf8").digest("hex");
  return { version: GROUNDED_SHARE_CONSENT_VERSION, hash };
}
