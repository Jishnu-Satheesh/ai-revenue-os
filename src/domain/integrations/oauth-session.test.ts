import { describe, expect, it } from "vitest";

import {
  buildAuthorizationRequest,
  createOAuthState,
  digestOAuthState,
  oauthCallbackResultCodeSchema,
  oauthSessionRecordSchema,
  oauthStartRequestSchema,
  reconcileCallback,
} from "@/domain/integrations/oauth-session";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const otherUserId = "44444444-4444-4444-8444-444444444444";

const authorization = {
  authorizationEndpoint: "https://provider.example.com/oauth/authorize",
  clientId: "client-abc",
  requestedScopes: ["read_profile", "read_insights"] as const,
  callbackUrl: "https://app.example.com/api/integrations/oauth/fake/callback",
};

describe("oauth state secret", () => {
  it("produces a high-entropy state that never repeats across calls", () => {
    const states = new Set(Array.from({ length: 200 }, () => createOAuthState()));

    expect(states.size).toBe(200);
    for (const state of states) {
      // 32 bytes of randomness, base64url encoded, is 43 characters.
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it("stores only an irreversible digest, never the state itself", () => {
    const state = createOAuthState();
    const digest = digestOAuthState(state);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(state);
    expect(digestOAuthState(state)).toBe(digest);
    expect(digestOAuthState(createOAuthState())).not.toBe(digest);
  });
});

describe("oauth session record", () => {
  const base = {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId,
    userId,
    providerKey: "fake_provider",
    stateDigest: digestOAuthState(createOAuthState()),
    requestedScopes: ["read_profile"],
    callbackUrl: authorization.callbackUrl,
    expiresAt: "2026-08-12T12:00:00.000Z",
    consumedAt: null,
  };

  it("accepts a well-formed pending session", () => {
    expect(oauthSessionRecordSchema.parse(base)).toMatchObject({ providerKey: "fake_provider" });
  });

  it("rejects a record that carries the raw state, an authorization code, or a token", () => {
    for (const leak of ["state", "code", "accessToken", "refreshToken", "clientSecret"]) {
      expect(() => oauthSessionRecordSchema.parse({ ...base, [leak]: "leaked-value" })).toThrow();
    }
  });

  it("rejects a digest that is not a sha-256 hex digest", () => {
    expect(() => oauthSessionRecordSchema.parse({ ...base, stateDigest: "short" })).toThrow();
    expect(() =>
      oauthSessionRecordSchema.parse({ ...base, stateDigest: createOAuthState() }),
    ).toThrow();
  });

  it("requires at least one requested scope so a session cannot authorize nothing", () => {
    expect(() => oauthSessionRecordSchema.parse({ ...base, requestedScopes: [] })).toThrow();
  });
});

describe("authorization request", () => {
  it("binds state, scopes, and the fixed callback into the provider URL", () => {
    const state = createOAuthState();
    const request = buildAuthorizationRequest({ ...authorization, state });
    const url = new URL(request.authorizationUrl);

    expect(url.origin + url.pathname).toBe(authorization.authorizationEndpoint);
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("client_id")).toBe(authorization.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(authorization.callbackUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("read_profile read_insights");
  });

  it("refuses a non-https authorization endpoint or callback outside the configured origin", () => {
    const state = createOAuthState();

    expect(() =>
      buildAuthorizationRequest({
        ...authorization,
        state,
        authorizationEndpoint: "http://provider.example.com/oauth/authorize",
      }),
    ).toThrow(/https/i);

    expect(() =>
      buildAuthorizationRequest({
        ...authorization,
        state,
        callbackUrl: "https://attacker.example.com/callback",
        expectedCallbackOrigin: "https://app.example.com",
      }),
    ).toThrow(/callback/i);
  });

  it("never places the client secret in the authorization URL", () => {
    const request = buildAuthorizationRequest({ ...authorization, state: createOAuthState() });

    expect(request.authorizationUrl).not.toContain("secret");
    expect(request.authorizationUrl).not.toContain("client_secret");
  });
});

describe("callback reconciliation", () => {
  const state = createOAuthState();
  const session = {
    id: "55555555-5555-4555-8555-555555555555",
    organizationId,
    userId,
    providerKey: "fake_provider",
    stateDigest: digestOAuthState(state),
    requestedScopes: ["read_profile"],
    callbackUrl: authorization.callbackUrl,
    expiresAt: "2026-08-12T12:00:00.000Z",
    consumedAt: null,
  };
  const now = new Date("2026-08-12T11:59:00.000Z");

  it("accepts the exact state for the binding organization, user, and provider", () => {
    expect(
      reconcileCallback({
        session,
        presentedState: state,
        actor: { organizationId, userId, hasCurrentRole: true },
        providerKey: "fake_provider",
        now,
      }),
    ).toEqual({ outcome: "accepted" });
  });

  it("rejects a replayed session that was already consumed", () => {
    expect(
      reconcileCallback({
        session: { ...session, consumedAt: "2026-08-12T11:58:00.000Z" },
        presentedState: state,
        actor: { organizationId, userId, hasCurrentRole: true },
        providerKey: "fake_provider",
        now,
      }),
    ).toEqual({ outcome: "rejected", resultCode: "oauth_session_already_used" });
  });

  it("rejects an expired session", () => {
    expect(
      reconcileCallback({
        session,
        presentedState: state,
        actor: { organizationId, userId, hasCurrentRole: true },
        providerKey: "fake_provider",
        now: new Date("2026-08-12T12:00:01.000Z"),
      }),
    ).toEqual({ outcome: "rejected", resultCode: "oauth_session_expired" });
  });

  it("treats the exact expiry instant as expired, matching the consuming RPC", () => {
    // The database rejects on `expires_at <= now()`. If this layer accepted the
    // boundary, it would approve a handshake the database then refuses.
    expect(
      reconcileCallback({
        session,
        presentedState: state,
        actor: { organizationId, userId, hasCurrentRole: true },
        providerKey: "fake_provider",
        now: new Date(session.expiresAt),
      }),
    ).toEqual({ outcome: "rejected", resultCode: "oauth_session_expired" });

    expect(
      reconcileCallback({
        session,
        presentedState: state,
        actor: { organizationId, userId, hasCurrentRole: true },
        providerKey: "fake_provider",
        now: new Date(Date.parse(session.expiresAt) - 1),
      }),
    ).toEqual({ outcome: "accepted" });
  });

  it("rejects a mismatched state without revealing the expected value", () => {
    const result = reconcileCallback({
      session,
      presentedState: createOAuthState(),
      actor: { organizationId, userId, hasCurrentRole: true },
      providerKey: "fake_provider",
      now,
    });

    expect(result).toEqual({ outcome: "rejected", resultCode: "oauth_state_mismatch" });
    expect(JSON.stringify(result)).not.toContain(session.stateDigest);
  });

  it("rejects another tenant, another user, or a different provider", () => {
    const cases = [
      { actor: { organizationId: otherOrganizationId, userId, hasCurrentRole: true } },
      { actor: { organizationId, userId: otherUserId, hasCurrentRole: true } },
      { providerKey: "other_provider" },
    ];

    for (const override of cases) {
      expect(
        reconcileCallback({
          session,
          presentedState: state,
          actor: { organizationId, userId, hasCurrentRole: true },
          providerKey: "fake_provider",
          now,
          ...override,
        }),
      ).toEqual({ outcome: "rejected", resultCode: "oauth_session_not_authorized" });
    }
  });

  it("rejects an actor whose platform role was removed after the session started", () => {
    expect(
      reconcileCallback({
        session,
        presentedState: state,
        actor: { organizationId, userId, hasCurrentRole: false },
        providerKey: "fake_provider",
        now,
      }),
    ).toEqual({ outcome: "rejected", resultCode: "oauth_session_not_authorized" });
  });

  it("compares state in constant time rather than with a short-circuiting equality", () => {
    // A same-length near-miss must be rejected exactly like a wholly different
    // value, so timing cannot reveal how much of the state was correct.
    const nearMiss = `${state.slice(0, -1)}${state.endsWith("A") ? "B" : "A"}`;

    expect(
      reconcileCallback({
        session,
        presentedState: nearMiss,
        actor: { organizationId, userId, hasCurrentRole: true },
        providerKey: "fake_provider",
        now,
      }),
    ).toEqual({ outcome: "rejected", resultCode: "oauth_state_mismatch" });
  });
});

describe("start request and result codes", () => {
  it("requires a uuid organization and a known provider key shape", () => {
    expect(() =>
      oauthStartRequestSchema.parse({ organizationId: "not-a-uuid", providerKey: "fake_provider" }),
    ).toThrow();
    expect(() =>
      oauthStartRequestSchema.parse({ organizationId, providerKey: "Fake Provider!" }),
    ).toThrow();
    expect(oauthStartRequestSchema.parse({ organizationId, providerKey: "fake_provider" })).toEqual(
      {
        organizationId,
        providerKey: "fake_provider",
      },
    );
  });

  it("rejects unknown fields at the external boundary", () => {
    expect(() =>
      oauthStartRequestSchema.parse({
        organizationId,
        providerKey: "fake_provider",
        scopes: ["escalated_scope"],
      }),
    ).toThrow();
  });

  it("keeps every callback result code safe and opaque", () => {
    for (const code of oauthCallbackResultCodeSchema.options) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(code).not.toMatch(/token|secret|code_value|handle/);
    }
  });
});
