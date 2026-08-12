"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ConnectionDetail,
  type ConnectionAction,
} from "@/components/integrations/connection-detail";
import { ConnectionList } from "@/components/integrations/connection-list";
import { HealthSummary } from "@/components/integrations/health-summary";
import type { MappingFormValue } from "@/components/integrations/mapping-form";
import {
  integrationQueryKeys,
  integrationRequest,
  integrationsBasePath,
} from "@/components/integrations/query-options";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { hasIntegrationPermission } from "@/domain/integrations/permissions";
import {
  applyCapabilityRuntimeGuards,
  type IntegrationHubSnapshot,
} from "@/modules/integrations/application/read-model";

type QueuedOperation = { runId: string; status: string };

export function ConnectionsTab({
  organizationId,
  snapshot,
  catalog,
  role,
  timeZone,
}: Readonly<{
  organizationId: string;
  snapshot: IntegrationHubSnapshot;
  catalog: readonly ProviderDefinition[];
  role: OrganizationRole;
  timeZone: string;
}>) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const canOperate = hasIntegrationPermission(role, "integration.test");
  const definitionsByKey = useMemo(
    () => Object.fromEntries(catalog.map((definition) => [definition.key, definition])),
    [catalog],
  );
  const providerNames = useMemo(
    () => Object.fromEntries(catalog.map((definition) => [definition.key, definition.displayName])),
    [catalog],
  );
  const selectedSource =
    snapshot.connections.find((connection) => connection.id === selectedId) ??
    snapshot.connections[0] ??
    null;
  const selected = selectedSource
    ? {
        ...selectedSource,
        capabilities: selectedSource.capabilities.map((grant) =>
          applyCapabilityRuntimeGuards(grant, {
            connectionStatus: selectedSource.status,
            rolloutState: definitionsByKey[selectedSource.provider_key]?.rolloutState,
          }),
        ),
      }
    : null;

  /**
   * Only the scopes a mutation actually touches are invalidated, and nothing is
   * written into the cache optimistically: the server remains the only source
   * of connection health, run state, and capability availability.
   */
  function invalidateConnectionScope(connectionId: string) {
    void queryClient.invalidateQueries({ queryKey: integrationQueryKeys.snapshot(organizationId) });
    void queryClient.invalidateQueries({
      queryKey: integrationQueryKeys.connection(organizationId, connectionId),
    });
    void queryClient.invalidateQueries({ queryKey: integrationQueryKeys.activity(organizationId) });
  }

  function acknowledgeQueued(prefix: string, result: QueuedOperation, connectionId: string) {
    setFailure(null);
    setAcknowledgement(`${prefix} ${result.status} · run ${result.runId}`);
    toast.info(`${prefix} ${result.status}`);
    invalidateConnectionScope(connectionId);
  }

  function reportFailure(error: unknown) {
    const message =
      error instanceof Error ? error.message : "The request could not be completed. Try again.";
    setAcknowledgement(null);
    setFailure(message);
    toast.error(message);
  }

  const testConnection = useMutation({
    mutationFn: async (connectionId: string) =>
      integrationRequest<QueuedOperation>(
        `${integrationsBasePath(organizationId)}/connections/${connectionId}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        },
      ),
    onSuccess: (result, connectionId) => acknowledgeQueued("Test", result, connectionId),
    onError: reportFailure,
  });

  const syncConnection = useMutation({
    mutationFn: async (connectionId: string) =>
      integrationRequest<QueuedOperation>(
        `${integrationsBasePath(organizationId)}/connections/${connectionId}/sync`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        },
      ),
    onSuccess: (result, connectionId) => acknowledgeQueued("Sync", result, connectionId),
    onError: reportFailure,
  });

  const replaceMappings = useMutation({
    mutationFn: async (input: { connectionId: string; mappings: MappingFormValue[] }) =>
      integrationRequest<{ mappings: unknown[] }>(
        `${integrationsBasePath(organizationId)}/connections/${input.connectionId}/mappings`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            mappings: input.mappings,
          }),
        },
      ),
    onSuccess: (_result, input) => {
      setFailure(null);
      setAcknowledgement("Branch mappings saved.");
      toast.success("Branch mappings saved.");
      invalidateConnectionScope(input.connectionId);
    },
    onError: reportFailure,
  });

  const disconnectConnection = useMutation({
    mutationFn: async (input: { connectionId: string; confirmation: string }) =>
      integrationRequest<QueuedOperation>(
        `${integrationsBasePath(organizationId)}/connections/${input.connectionId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            confirmation: input.confirmation,
          }),
        },
      ),
    onSuccess: (result, input) => {
      setFailure(null);
      setAcknowledgement(
        `Capabilities are disabled. Credential cleanup ${result.status} · run ${result.runId}`,
      );
      toast.info("Capabilities disabled; credential cleanup queued.");
      invalidateConnectionScope(input.connectionId);
    },
    onError: reportFailure,
  });

  const pendingAction: ConnectionAction | null = testConnection.isPending
    ? "test"
    : syncConnection.isPending
      ? "sync"
      : disconnectConnection.isPending
        ? "disconnect"
        : null;

  const detail = selected ? (
    <ConnectionDetail
      connection={selected}
      definition={definitionsByKey[selected.provider_key]}
      branches={snapshot.branches}
      activity={snapshot.recentActivity}
      canOperate={canOperate}
      pendingAction={pendingAction}
      lastAcknowledgement={acknowledgement}
      failureMessage={failure}
      timeZone={timeZone}
      onTest={() => testConnection.mutate(selected.id)}
      onSync={() => syncConnection.mutate(selected.id)}
      onReplaceMappings={async (mappings) => {
        await replaceMappings.mutateAsync({ connectionId: selected.id, mappings });
      }}
      onDisconnect={(confirmation) =>
        disconnectConnection.mutate({ connectionId: selected.id, confirmation })
      }
    />
  ) : null;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <HealthSummary
        connections={snapshot.connections}
        summary={snapshot.summary}
        timeZone={timeZone}
      />

      <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <ConnectionList
          connections={snapshot.connections}
          selectedConnectionId={selected?.id ?? null}
          providerNames={providerNames}
          timeZone={timeZone}
          onSelect={(connectionId) => {
            setSelectedId(connectionId);
            setAcknowledgement(null);
            setFailure(null);
            if (isMobile) setDetailOpen(true);
          }}
        />
        {/* Narrow screens open the same detail inside a Sheet instead of
            stacking a second full-width column below the list. */}
        {isMobile ? null : detail}
      </div>

      {isMobile ? (
        <Sheet open={detailOpen && selected !== null} onOpenChange={setDetailOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{selected?.external_account_label ?? "Connection"}</SheetTitle>
              <SheetDescription>Health, capabilities, mappings, and actions</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">{detail}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
