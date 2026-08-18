import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Invitation tokens.
 *
 * The raw token is a bearer credential for joining an agency. It exists in
 * exactly two places and no others: the response that created it, and the link
 * the inviter shares. **It is never persisted, never logged, and never placed in
 * an event payload.** The database stores only `tokenDigest`.
 *
 * 32 bytes of CSPRNG entropy is 256 bits -- far beyond guessing, which matters
 * because a valid token is the whole of the secret. The lookup is by digest, so
 * a stolen database backup yields nothing redeemable.
 */

const TOKEN_BYTES = 32;

export function createInvitationToken(): { token: string; tokenDigest: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenDigest: tokenDigest(token) };
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time digest comparison. The database lookup is an indexed equality on
 * the digest and is the real path, so this exists for anywhere a digest is
 * compared in application code -- where a short-circuiting `===` would leak
 * position information through timing.
 */
export function digestsMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
