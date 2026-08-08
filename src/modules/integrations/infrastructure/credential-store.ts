import "server-only";

/**
 * Production credential boundary. A real implementation is deliberately not
 * provided until the Vault/OAuth security review has been approved.
 */
export type {
  CreateCredentialInput,
  CredentialStore,
  ReplaceCredentialInput,
  ResolveCredentialInput,
  RevokeCredentialInput,
  SensitiveCredential,
} from "@/domain/integrations/credential-store.server";
