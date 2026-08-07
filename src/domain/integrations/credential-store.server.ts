import "server-only";

import type { CredentialHandle } from "@/domain/integrations/types";

export type CreateCredentialInput = {
  organizationId: string;
  providerKey: string;
  secret: string;
};

export type ResolveCredentialInput = {
  organizationId: string;
  providerKey: string;
  handle: CredentialHandle;
};

export type ReplaceCredentialInput = CreateCredentialInput & { handle: CredentialHandle };
export type RevokeCredentialInput = ResolveCredentialInput;

export type SensitiveCredential = {
  readonly value: string;
  toJSON(): never;
};

export type CredentialStore = {
  create(input: CreateCredentialInput): Promise<CredentialHandle>;
  resolve(input: ResolveCredentialInput): Promise<SensitiveCredential>;
  replace(input: ReplaceCredentialInput): Promise<void>;
  revoke(input: RevokeCredentialInput): Promise<void>;
};
