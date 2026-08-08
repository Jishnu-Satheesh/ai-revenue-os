import "server-only";

import { z } from "zod";

import type {
  CreateCredentialInput,
  CredentialStore,
  ReplaceCredentialInput,
  ResolveCredentialInput,
  RevokeCredentialInput,
} from "@/modules/integrations/infrastructure/credential-store";
import { IntegrationError } from "@/domain/integrations/errors";
import type { CredentialHandle } from "@/domain/integrations/types";

const credentialContextSchema = z.object({
  organizationId: z.string().trim().min(1).max(200),
  providerKey: z.string().trim().min(1).max(120),
});

export type FixtureCredentialHandle = CredentialHandle & {
  toJSON(): never;
};

function validateContext(input: { organizationId: string; providerKey: string }): void {
  if (!credentialContextSchema.safeParse(input).success) {
    throw new IntegrationError("VALIDATION_ERROR", "Credential context is invalid.", false);
  }
}

function assertFixtureHandle(handle: CredentialHandle): void {
  if (!handle.reference.startsWith("fixture:")) {
    throw new IntegrationError("VALIDATION_ERROR", "Credential handle is invalid.", false);
  }
}

function unavailable(): never {
  throw new IntegrationError(
    "FEATURE_NOT_AVAILABLE",
    "Fixture mode does not support real credential operations.",
    false,
  );
}

export function createFixtureCredentialStore(): CredentialStore {
  return {
    async create(input: CreateCredentialInput): Promise<FixtureCredentialHandle> {
      validateContext(input);
      // Deliberately do not read, retain, log, or serialize input.secret.
      const handle: FixtureCredentialHandle = Object.freeze({
        reference: `fixture:${crypto.randomUUID()}`,
        toJSON(): never {
          throw new Error("Fixture credential handles must not be serialized.");
        },
      });
      return handle;
    },
    async resolve(input: ResolveCredentialInput) {
      validateContext(input);
      assertFixtureHandle(input.handle);
      return unavailable();
    },
    async replace(input: ReplaceCredentialInput): Promise<void> {
      validateContext(input);
      assertFixtureHandle(input.handle);
      return unavailable();
    },
    async revoke(input: RevokeCredentialInput): Promise<void> {
      validateContext(input);
      assertFixtureHandle(input.handle);
      return unavailable();
    },
  };
}
