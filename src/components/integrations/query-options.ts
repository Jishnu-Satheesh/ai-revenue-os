import type { ProviderDefinition } from "@/domain/integrations/types";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

/**
 * Every Integration Hub cache entry hangs off the organization it was read
 * for, so switching tenants can never surface another organization's data and
 * a mutation can invalidate exactly the scope it touched.
 */
export const integrationQueryKeys = {
  root: (organizationId: string) => ["organizations", organizationId, "integrations"] as const,
  snapshot: (organizationId: string) =>
    [...integrationQueryKeys.root(organizationId), "snapshot"] as const,
  catalog: (organizationId: string) =>
    [...integrationQueryKeys.root(organizationId), "catalog"] as const,
  connections: (organizationId: string) =>
    [...integrationQueryKeys.root(organizationId), "connections"] as const,
  connection: (organizationId: string, connectionId: string) =>
    [...integrationQueryKeys.connections(organizationId), connectionId] as const,
  connectionHealth: (organizationId: string, connectionId: string) =>
    [...integrationQueryKeys.connection(organizationId, connectionId), "health"] as const,
  dataSources: (organizationId: string) =>
    [...integrationQueryKeys.root(organizationId), "data-sources"] as const,
  activity: (organizationId: string) =>
    [...integrationQueryKeys.root(organizationId), "activity"] as const,
};

export function integrationsBasePath(organizationId: string): string {
  return `/api/organizations/${organizationId}/integrations`;
}

export type PublicApiError = { code: string; message: string; retryable?: boolean };

export class IntegrationRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "IntegrationRequestError";
  }
}

/**
 * Reads the safe public error envelope the API guarantees. The browser never
 * receives an internal cause, so nothing else is worth surfacing here.
 */
export async function integrationRequest<TResponse>(
  input: string,
  init?: RequestInit,
): Promise<TResponse> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => null)) as
    | ({ error?: PublicApiError } & Record<string, unknown>)
    | null;
  if (!response.ok) {
    const error = body?.error;
    throw new IntegrationRequestError(
      error?.code ?? "UNEXPECTED_ERROR",
      error?.message ?? "The integration request could not be completed.",
      response.status,
      error?.retryable ?? false,
    );
  }
  return body as TResponse;
}

export function integrationSnapshotQueryOptions(input: {
  organizationId: string;
  initialData?: IntegrationHubSnapshot;
  initialDataUpdatedAt?: number;
}) {
  return {
    queryKey: integrationQueryKeys.snapshot(input.organizationId),
    queryFn: async () =>
      (
        await integrationRequest<{ snapshot: IntegrationHubSnapshot }>(
          integrationsBasePath(input.organizationId),
        )
      ).snapshot,
    initialData: input.initialData,
    initialDataUpdatedAt: input.initialDataUpdatedAt,
    // Health is only meaningful when it is recent, so the snapshot is treated
    // as stale quickly while never blanking the data already on screen.
    staleTime: 15_000,
  };
}

export function integrationCatalogQueryOptions(input: {
  organizationId: string;
  initialData?: readonly ProviderDefinition[];
  initialDataUpdatedAt?: number;
}) {
  return {
    queryKey: integrationQueryKeys.catalog(input.organizationId),
    queryFn: async () =>
      (
        await integrationRequest<{ catalog: ProviderDefinition[] }>(
          `${integrationsBasePath(input.organizationId)}/catalog`,
        )
      ).catalog,
    initialData: input.initialData as ProviderDefinition[] | undefined,
    initialDataUpdatedAt: input.initialDataUpdatedAt,
    // The catalog is a versioned server constant, not tenant state.
    staleTime: 5 * 60_000,
  };
}
