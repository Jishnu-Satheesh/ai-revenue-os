import "server-only";

import type { CredentialHandle } from "@/domain/integrations/types";

/**
 * Every credential operation carries a correlation identifier so an audit trail
 * can be reconstructed without ever recording the secret itself. Writes also
 * carry an idempotency key, because a retried connect or rotation must not
 * leave a second live secret behind for the same authorization.
 */
type CredentialOperationContext = {
  correlationId: string;
};

type CredentialWriteContext = CredentialOperationContext & {
  idempotencyKey: string;
};

export type CreateCredentialInput = CredentialWriteContext & {
  organizationId: string;
  providerKey: string;
  secret: string;
};

export type ResolveCredentialInput = CredentialOperationContext & {
  organizationId: string;
  providerKey: string;
  handle: CredentialHandle;
};

export type ReplaceCredentialInput = CredentialWriteContext & {
  organizationId: string;
  providerKey: string;
  secret: string;
  handle: CredentialHandle;
};

export type RevokeCredentialInput = ResolveCredentialInput;

/**
 * `value` is intentionally non-enumerable in implementations and `toJSON`
 * always throws, so a secret cannot reach a log line, an error payload, or a
 * response body by being spread, stringified, or serialised by accident.
 */
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
