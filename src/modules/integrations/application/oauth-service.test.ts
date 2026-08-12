import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { digestOAuthState } from "@/domain/integrations/oauth-session";
import { createOAuthService } from "@/modules/integrations/application/oauth-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "33333333-3333-4333-8333-333333333333";
const correlationId = "99999999-9999-4999-8999-999999999999";
const sessionId = "55555555-5555-4555-8555-555555555555";
const reference = "77777777-7777-4777-8777-777777777777";

/**
 * A fake provider stands in for a real one throughout. No Meta endpoint is
 * exercised anywhere in this suite, because no verified Meta contract exists.
 */
function makeFakeApplication() {
  return {
    providerKey: "fake_provider",
    authorizationEndpoint: "https://provider.example.com/oauth/authorize",
    clientId: "client-abc",
    requestedScopes: ["read_profile"] as const,
    // Fresh per test: a shared mock would carry call counts between cases and
    // make "never exchanged" assertions meaningless.
    exchangeCode: vi.fn(async () => ({ secret: "provider-access-token" })),
  };
}

type FakeApplication = ReturnType<typeof makeFakeApplication>;

function build(
  overrides: {
    applications?: Record<string, FakeApplication>;
    consumeResult?: unknown;
    exchange?: FakeApplication["exchangeCode"];
  } = {},
) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const supabase = {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "start_integration_oauth_session") {
        return Promise.resolve({ data: sessionId, error: null });
      }
      if (name === "consume_integration_oauth_session") {
        return Promise.resolve({
          data:
            overrides.consumeResult === undefined
              ? [
                  {
                    session_id: sessionId,
                    organization_id: organizationId,
                    user_id: actorId,
                    requested_scopes: ["read_profile"],
                    callback_url: "https://app.example.com/api/integrations/oauth/fake/callback",
                  },
                ]
              : overrides.consumeResult,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  };

  const credentialStore = {
    create: vi.fn(async () => ({ reference })),
    resolve: vi.fn(),
    replace: vi.fn(),
    revoke: vi.fn(),
  };

  const application = makeFakeApplication();
  if (overrides.exchange) application.exchangeCode = overrides.exchange;

  const service = createOAuthService({
    supabase: supabase as never,
    credentialStore: credentialStore as never,
    applications: overrides.applications ?? { fake_provider: application },
    appOrigin: "https://app.example.com",
  });

  return { service, supabase, credentialStore, rpcCalls, application };
}

describe("oauth service — start", () => {
  it("fails before creating a session when the provider has no configured application", async () => {
    const { service, supabase } = build({ applications: {} });

    await expect(
      service.start({ organizationId, providerKey: "meta", actorId, correlationId }),
    ).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("persists only the state digest, never the state itself", async () => {
    const { service, rpcCalls } = build();

    const started = await service.start({
      organizationId,
      providerKey: "fake_provider",
      actorId,
      correlationId,
    });

    const state = new URL(started.authorizationUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const call = rpcCalls.find((entry) => entry.name === "start_integration_oauth_session");
    expect(call?.args.p_state_digest).toBe(digestOAuthState(state as string));
    expect(JSON.stringify(call?.args)).not.toContain(state as string);
  });

  it("binds the authorization URL to the configured callback origin", async () => {
    const { service } = build();

    const started = await service.start({
      organizationId,
      providerKey: "fake_provider",
      actorId,
      correlationId,
    });
    const url = new URL(started.authorizationUrl);

    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/integrations/oauth/fake_provider/callback",
    );
    expect(started.authorizationUrl).not.toContain("client_secret");
  });
});

describe("oauth service — callback", () => {
  it("consumes the session, exchanges the code, and stores the credential", async () => {
    const { service, credentialStore, application } = build();

    const result = await service.completeCallback({
      providerKey: "fake_provider",
      state: "presented-state",
      code: "provider-code",
      correlationId,
    });

    expect(result).toEqual({ resultCode: "oauth_connected", organizationId });
    expect(application.exchangeCode).toHaveBeenCalledOnce();
    expect(credentialStore.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, providerKey: "fake_provider", correlationId }),
    );
  });

  it("never exchanges a code when no session was consumed", async () => {
    const { service, credentialStore, application } = build({ consumeResult: [] });

    const result = await service.completeCallback({
      providerKey: "fake_provider",
      state: "forged-state",
      code: "provider-code",
      correlationId,
    });

    expect(result.resultCode).toBe("oauth_session_not_authorized");
    expect(application.exchangeCode).not.toHaveBeenCalled();
    expect(credentialStore.create).not.toHaveBeenCalled();
  });

  it("looks the session up by digest, never by the presented state", async () => {
    const { service, rpcCalls } = build();

    await service.completeCallback({
      providerKey: "fake_provider",
      state: "presented-state",
      code: "provider-code",
      correlationId,
    });

    const call = rpcCalls.find((entry) => entry.name === "consume_integration_oauth_session");
    expect(call?.args.p_state_digest).toBe(digestOAuthState("presented-state"));
    expect(JSON.stringify(call?.args)).not.toContain("presented-state");
  });

  it("reports a provider rejection without storing a credential or leaking the code", async () => {
    const exchange = vi.fn(async () => {
      throw new Error("provider said no for code provider-code");
    });
    const { service, credentialStore } = build({ exchange });

    const result = await service.completeCallback({
      providerKey: "fake_provider",
      state: "presented-state",
      code: "provider-code",
      correlationId,
    });

    expect(result.resultCode).toBe("oauth_provider_rejected");
    expect(credentialStore.create).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("provider-code");
  });

  it("rejects an unconfigured provider at the callback without touching the database", async () => {
    const { service, supabase } = build({ applications: {} });

    const result = await service.completeCallback({
      providerKey: "meta",
      state: "presented-state",
      code: "provider-code",
      correlationId,
    });

    expect(result.resultCode).toBe("oauth_not_configured");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns nothing that could be replayed", async () => {
    const { service } = build();

    const result = await service.completeCallback({
      providerKey: "fake_provider",
      state: "presented-state",
      code: "provider-code",
      correlationId,
    });

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("provider-code");
    expect(serialised).not.toContain("provider-access-token");
    expect(serialised).not.toContain(reference);
  });
});
