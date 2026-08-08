import { deriveConnectionHealth } from "@/domain/integrations/health";
import type {
  IntegrationAuditEvent,
  IntegrationConnectionRow,
  IntegrationDataSourceRow,
  IntegrationHealthCheckRow,
  IntegrationIngestionRunRow,
} from "@/modules/integrations/application/ports";

type SafeConnection = Omit<IntegrationConnectionRow, "credential_reference"> & {
  latestHealth: IntegrationHealthCheckRow | null;
  health: ReturnType<typeof deriveConnectionHealth>;
};

export type IntegrationActivity =
  | {
      kind: "audit";
      id: string;
      occurredAt: string;
      correlationId: string;
      eventName: string;
      entityId: string | null;
    }
  | {
      kind: "ingestion_run";
      id: string;
      occurredAt: string;
      correlationId: string;
      status: IntegrationIngestionRunRow["status"];
      sourceId: string;
    }
  | {
      kind: "health_check";
      id: string;
      occurredAt: string;
      correlationId: string;
      outcome: IntegrationHealthCheckRow["outcome"];
      connectionId: string;
    };

export type IntegrationHubSnapshot = {
  summary: {
    totalConnections: number;
    healthyConnections: number;
    actionRequiredConnections: number;
    dataSources: number;
  };
  connections: SafeConnection[];
  dataSources: IntegrationDataSourceRow[];
  recentActivity: IntegrationActivity[];
  serverTime: string;
};

export function buildIntegrationHubSnapshot(input: {
  organizationId: string;
  now: Date;
  connections: readonly IntegrationConnectionRow[];
  dataSources: readonly IntegrationDataSourceRow[];
  healthChecks: readonly IntegrationHealthCheckRow[];
  runs: readonly IntegrationIngestionRunRow[];
  auditEvents: readonly IntegrationAuditEvent[];
}): IntegrationHubSnapshot {
  const sameOrganization = <T extends { organization_id: string }>(rows: readonly T[]) =>
    rows.filter((row) => row.organization_id === input.organizationId);
  const healthChecks = sameOrganization(input.healthChecks);
  const latestHealthByConnection = new Map<string, IntegrationHealthCheckRow>();
  for (const check of [...healthChecks].sort((left, right) =>
    right.checked_at.localeCompare(left.checked_at),
  )) {
    if (!latestHealthByConnection.has(check.connection_id))
      latestHealthByConnection.set(check.connection_id, check);
  }
  const connections = sameOrganization(input.connections)
    .map((connectionRow) => {
      const safeConnection = { ...connectionRow };
      delete safeConnection.credential_reference;
      const connection: Omit<IntegrationConnectionRow, "credential_reference"> = safeConnection;
      const latestHealth = latestHealthByConnection.get(connection.id) ?? null;
      return {
        ...connection,
        latestHealth,
        health: deriveConnectionHealth({
          status: connection.status,
          staleAfterMinutes: 65,
          lastTestedAt: connection.last_tested_at ?? undefined,
          lastSuccessfulSyncAt: connection.last_successful_sync_at ?? undefined,
          nextScheduledSyncAt: connection.next_scheduled_sync_at ?? undefined,
          latestOutcome: latestHealth?.outcome,
          now: input.now,
        }),
      };
    })
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  const recentActivity: IntegrationActivity[] = [
    ...sameOrganization(input.auditEvents).map((event) => ({
      kind: "audit" as const,
      id: event.id,
      occurredAt: event.occurred_at,
      correlationId: event.correlation_id,
      eventName: event.event_name,
      entityId: event.entity_id,
    })),
    ...sameOrganization(input.runs).map((ingestionRun) => ({
      kind: "ingestion_run" as const,
      id: ingestionRun.id,
      occurredAt: ingestionRun.completed_at ?? ingestionRun.started_at ?? ingestionRun.created_at,
      correlationId: ingestionRun.correlation_id,
      status: ingestionRun.status,
      sourceId: ingestionRun.connection_id ?? ingestionRun.data_source_id ?? "unknown",
    })),
    ...healthChecks.map((check) => ({
      kind: "health_check" as const,
      id: check.id,
      occurredAt: check.checked_at,
      correlationId: check.correlation_id,
      outcome: check.outcome,
      connectionId: check.connection_id,
    })),
  ]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 50);
  const healthyConnections = connections.filter(
    (connection) => connection.health.state === "healthy",
  ).length;
  return {
    summary: {
      totalConnections: connections.length,
      healthyConnections,
      actionRequiredConnections: connections.filter(
        (connection) =>
          connection.health.state === "degraded" ||
          connection.health.state === "stale" ||
          connection.health.state === "revoked",
      ).length,
      dataSources: sameOrganization(input.dataSources).length,
    },
    connections,
    dataSources: sameOrganization(input.dataSources).sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at),
    ),
    recentActivity,
    serverTime: input.now.toISOString(),
  };
}
