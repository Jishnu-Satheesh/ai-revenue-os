import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { IntegrationError } from "@/domain/integrations/errors";
import type { Database } from "@/lib/supabase/database.types";
import { createVaultCredentialStore } from "@/modules/integrations/infrastructure/vault-credential-store";

const organizationId = "11111111-1111-4111-8111-111111111111";
const providerKey = "fake_provider";
const correlationId = "99999999-9999-4999-8999-999999999999";
const reference = "77777777-7777-4777-8777-777777777777";

type RpcResult = { data: unknown; error: { message: string; code?: string } | null };

function stubClient(handler: (name: string, args: Record<string, unknown>) => RpcResult) {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) =>
    Promise.resolve(handler(name, args)),
  );
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("vault credential store", () => {
  it("creates a credential and returns only an opaque handle", async () => {
    const { client, rpc } = stubClient(() => ({ data: reference, error: null }));
    const store = createVaultCredentialStore(client);

    const handle = await store.create({
      organizationId,
      providerKey,
      secret: "super-secret-token",
      correlationId,
      idempotencyKey: "connect-1",
    });

    expect(handle).toEqual({ reference });
    expect(Object.keys(handle)).toEqual(["reference"]);

    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("create_integration_credential");
    expect(args).toMatchObject({
      p_organization_id: organizationId,
      p_provider_key: providerKey,
      p_correlation_id: correlationId,
      p_idempotency_key: "connect-1",
    });
  });

  it("binds every operation to an organization and provider", async () => {
    const { client, rpc } = stubClient((name) =>
      name === "resolve_integration_credential"
        ? { data: "super-secret-token", error: null }
        : { data: null, error: null },
    );
    const store = createVaultCredentialStore(client);

    await store.resolve({ organizationId, providerKey, handle: { reference }, correlationId });
    await store.replace({
      organizationId,
      providerKey,
      handle: { reference },
      secret: "rotated",
      correlationId,
      idempotencyKey: "rotate-1",
    });
    await store.revoke({ organizationId, providerKey, handle: { reference }, correlationId });

    for (const [, args] of rpc.mock.calls) {
      expect(args).toMatchObject({
        p_organization_id: organizationId,
        p_provider_key: providerKey,
      });
    }
  });

  it("returns a secret that refuses to serialise itself", async () => {
    const { client } = stubClient(() => ({ data: "super-secret-token", error: null }));
    const store = createVaultCredentialStore(client);

    const credential = await store.resolve({
      organizationId,
      providerKey,
      handle: { reference },
      correlationId,
    });

    expect(credential.value).toBe("super-secret-token");
    expect(() => credential.toJSON()).toThrow();
    expect(() => JSON.stringify(credential)).toThrow();
    expect(String(credential)).not.toContain("super-secret-token");
    expect(`${credential}`).not.toContain("super-secret-token");
  });

  it("keeps the secret out of enumerable properties and inspection output", async () => {
    const { client } = stubClient(() => ({ data: "super-secret-token", error: null }));
    const store = createVaultCredentialStore(client);

    const credential = await store.resolve({
      organizationId,
      providerKey,
      handle: { reference },
      correlationId,
    });

    expect(Object.keys(credential)).not.toContain("value");
    expect(JSON.stringify({ credential: { ...credential } })).not.toContain("super-secret-token");
  });

  it("treats a repeated revoke as success rather than an error", async () => {
    const { client, rpc } = stubClient(() => ({ data: null, error: null }));
    const store = createVaultCredentialStore(client);
    const input = { organizationId, providerKey, handle: { reference }, correlationId };

    await expect(store.revoke(input)).resolves.toBeUndefined();
    await expect(store.revoke(input)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("reports a missing or foreign credential as a safe not-found, not a leak", async () => {
    const { client } = stubClient(() => ({
      data: null,
      error: {
        message: 'credential 7777 for organization 1111 not found in vault "vault.secrets"',
      },
    }));
    const store = createVaultCredentialStore(client);

    const failure = await store
      .resolve({ organizationId, providerKey, handle: { reference }, correlationId })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IntegrationError);
    const error = failure as IntegrationError;
    expect(error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(error.toJSON())).not.toContain("vault.secrets");
    expect(JSON.stringify(error.toJSON())).not.toContain(reference);
  });

  it("never places the secret or the handle in an error raised by a failed write", async () => {
    const { client } = stubClient(() => ({
      data: null,
      error: { message: "insert failed for value super-secret-token" },
    }));
    const store = createVaultCredentialStore(client);

    const failure = await store
      .create({
        organizationId,
        providerKey,
        secret: "super-secret-token",
        correlationId,
        idempotencyKey: "connect-1",
      })
      .catch((error: unknown) => error);

    const serialised = JSON.stringify((failure as IntegrationError).toJSON());
    expect(serialised).not.toContain("super-secret-token");
    expect(serialised).not.toContain(reference);
  });

  it("rejects a malformed handle before calling the database", async () => {
    const { client, rpc } = stubClient(() => ({ data: null, error: null }));
    const store = createVaultCredentialStore(client);

    await expect(
      store.resolve({
        organizationId,
        providerKey,
        handle: { reference: "not-a-uuid" },
        correlationId,
      }),
    ).rejects.toBeInstanceOf(IntegrationError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a blank secret before calling the database", async () => {
    const { client, rpc } = stubClient(() => ({ data: null, error: null }));
    const store = createVaultCredentialStore(client);

    await expect(
      store.create({
        organizationId,
        providerKey,
        secret: "   ",
        correlationId,
        idempotencyKey: "connect-1",
      }),
    ).rejects.toBeInstanceOf(IntegrationError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a create response that is not an opaque reference", async () => {
    const { client } = stubClient(() => ({ data: { secret: "super-secret-token" }, error: null }));
    const store = createVaultCredentialStore(client);

    await expect(
      store.create({
        organizationId,
        providerKey,
        secret: "super-secret-token",
        correlationId,
        idempotencyKey: "connect-1",
      }),
    ).rejects.toBeInstanceOf(IntegrationError);
  });
});
