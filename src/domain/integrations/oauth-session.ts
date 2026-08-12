import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * An OAuth handshake is only as strong as the secret that ties the redirect
 * back to the request that started it. The state is generated here, handed to
 * the provider, and never persisted in readable form: the database stores a
 * digest, so a leaked row cannot be replayed against the provider.
 */
const STATE_BYTES = 32;

export function createOAuthState(): string {
  return randomBytes(STATE_BYTES).toString("base64url");
}

export function digestOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

const sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be a sha-256 hex digest of the oauth state");

const providerKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "must be a lower snake_case provider key");

const isoTimestampSchema = z.string().datetime();

/**
 * `strictObject` is deliberate. If a caller ever tries to persist the raw
 * state, an authorization code, or a token alongside the session, the parse
 * fails instead of silently writing a secret into a tenant table.
 */
export const oauthSessionRecordSchema = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  providerKey: providerKeySchema,
  stateDigest: sha256HexSchema,
  requestedScopes: z.array(z.string().min(1)).min(1),
  callbackUrl: z.string().url(),
  expiresAt: isoTimestampSchema,
  consumedAt: isoTimestampSchema.nullable(),
});

export type OAuthSessionRecord = z.infer<typeof oauthSessionRecordSchema>;

export const oauthStartRequestSchema = z.strictObject({
  organizationId: z.string().uuid(),
  providerKey: providerKeySchema,
});

export type OAuthStartRequest = z.infer<typeof oauthStartRequestSchema>;

/**
 * Result codes are the only thing a redirect carries back to the browser. They
 * stay opaque and uniform so a probe cannot distinguish "wrong tenant" from
 * "no such session" and map out another organization's connections.
 */
export const oauthCallbackResultCodeSchema = z.enum([
  "oauth_connected",
  "oauth_session_expired",
  "oauth_session_already_used",
  "oauth_state_mismatch",
  "oauth_session_not_authorized",
  "oauth_provider_rejected",
  "oauth_provider_unavailable",
  "oauth_not_configured",
]);

export type OAuthCallbackResultCode = z.infer<typeof oauthCallbackResultCodeSchema>;

export type BuildAuthorizationRequestInput = {
  authorizationEndpoint: string;
  clientId: string;
  requestedScopes: readonly string[];
  callbackUrl: string;
  state: string;
  expectedCallbackOrigin?: string;
};

export type AuthorizationRequest = {
  authorizationUrl: string;
};

export function buildAuthorizationRequest(
  input: BuildAuthorizationRequestInput,
): AuthorizationRequest {
  const endpoint = new URL(input.authorizationEndpoint);
  if (endpoint.protocol !== "https:") {
    throw new Error("The provider authorization endpoint must use https.");
  }

  const callback = new URL(input.callbackUrl);
  if (callback.protocol !== "https:" && callback.hostname !== "localhost") {
    throw new Error("The oauth callback must use https outside local development.");
  }
  if (input.expectedCallbackOrigin && callback.origin !== input.expectedCallbackOrigin) {
    throw new Error("The oauth callback origin does not match the configured application origin.");
  }
  if (input.requestedScopes.length === 0) {
    throw new Error("An authorization request must ask for at least one scope.");
  }

  // Only the public client identifier belongs in a URL the browser follows.
  // The client secret is used server-side during token exchange and never here.
  endpoint.searchParams.set("client_id", input.clientId);
  endpoint.searchParams.set("redirect_uri", input.callbackUrl);
  endpoint.searchParams.set("response_type", "code");
  endpoint.searchParams.set("scope", input.requestedScopes.join(" "));
  endpoint.searchParams.set("state", input.state);

  return { authorizationUrl: endpoint.toString() };
}

export type OAuthCallbackActor = {
  organizationId: string;
  userId: string;
  hasCurrentRole: boolean;
};

export type ReconcileCallbackInput = {
  session: OAuthSessionRecord;
  presentedState: string;
  actor: OAuthCallbackActor;
  providerKey: string;
  now: Date;
};

export type ReconcileCallbackResult =
  | { outcome: "accepted" }
  | { outcome: "rejected"; resultCode: OAuthCallbackResultCode };

function statesMatch(presented: string, expectedDigest: string): boolean {
  const presentedDigest = Buffer.from(digestOAuthState(presented), "hex");
  const expected = Buffer.from(expectedDigest, "hex");

  if (presentedDigest.length !== expected.length) return false;
  return timingSafeEqual(presentedDigest, expected);
}

/**
 * Ordering matters. Authorization and freshness are checked before the state
 * comparison so a caller who is not entitled to the session learns nothing
 * about whether their guessed state was close.
 */
export function reconcileCallback(input: ReconcileCallbackInput): ReconcileCallbackResult {
  const { session, actor, now } = input;

  const authorized =
    actor.hasCurrentRole &&
    actor.organizationId === session.organizationId &&
    actor.userId === session.userId &&
    input.providerKey === session.providerKey;

  if (!authorized) {
    return { outcome: "rejected", resultCode: "oauth_session_not_authorized" };
  }

  if (session.consumedAt !== null) {
    return { outcome: "rejected", resultCode: "oauth_session_already_used" };
  }

  if (now.getTime() > Date.parse(session.expiresAt)) {
    return { outcome: "rejected", resultCode: "oauth_session_expired" };
  }

  if (!statesMatch(input.presentedState, session.stateDigest)) {
    return { outcome: "rejected", resultCode: "oauth_state_mismatch" };
  }

  return { outcome: "accepted" };
}
