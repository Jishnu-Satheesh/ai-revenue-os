"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CircleSlash, Info, PlugZap, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  integrationQueryKeys,
  integrationRequest,
  integrationsBasePath,
} from "@/components/integrations/query-options";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { hasIntegrationPermission } from "@/domain/integrations/permissions";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

type Connection = IntegrationHubSnapshot["connections"][number];

const rolloutPresentation = {
  fixture: {
    label: "Fixture",
    description: "Deterministic sample data. No provider request is made.",
    variant: "secondary" as const,
  },
  available: {
    label: "Available",
    description: "Generally available for this organization.",
    variant: "default" as const,
  },
  disabled: {
    label: "Not available",
    description: "Provider access has not been approved for V1.",
    variant: "outline" as const,
  },
};

/**
 * The fixture connection is deterministic, so its external identity is a
 * constant of the provider definition rather than something an operator types.
 */
const fixtureAccount = {
  externalAccountId: "locations/fixture-central",
  externalAccountLabel: "Fixture Bakery — Central",
};

export function CatalogTab({
  organizationId,
  catalog,
  connections,
  role,
}: Readonly<{
  organizationId: string;
  catalog: readonly ProviderDefinition[];
  connections: readonly Connection[];
  role: OrganizationRole;
}>) {
  const queryClient = useQueryClient();
  const [pendingProviderKey, setPendingProviderKey] = useState<string | null>(null);
  const canConnect = hasIntegrationPermission(role, "integration.connect");

  const connectFixture = useMutation({
    mutationFn: async (definition: ProviderDefinition) =>
      integrationRequest<{ connection: { id: string } }>(
        `${integrationsBasePath(organizationId)}/connections/fixture`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            providerKey: definition.key,
            ...fixtureAccount,
            grantedScopes: [...definition.requiredScopes],
            idempotencyKey: `fixture:${definition.key}:${fixtureAccount.externalAccountId}`,
          }),
        },
      ),
    onSuccess: () => {
      toast.info("Fixture connection created. The initial test is queued.");
      void queryClient.invalidateQueries({
        queryKey: integrationQueryKeys.snapshot(organizationId),
      });
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : "The fixture connection could not be created.",
      ),
  });

  const pendingDefinition = catalog.find((definition) => definition.key === pendingProviderKey);

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <ShieldCheck />
        <AlertTitle>V1 reads only</AlertTitle>
        <AlertDescription>
          No provider in this catalog can write back or receive webhooks. Real Google OAuth stays
          disabled until Google approves API access and the credential security review passes.
        </AlertDescription>
      </Alert>

      <ul aria-label="Provider catalog" className="grid gap-4 md:grid-cols-2">
        {catalog.map((definition) => {
          const presentation = rolloutPresentation[definition.rolloutState];
          const connected = connections.some(
            (connection) => connection.provider_key === definition.key,
          );
          return (
            <li key={definition.key} className="flex">
              <Card className="flex w-full flex-col">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {definition.displayName}
                    <Badge variant={presentation.variant}>
                      {definition.rolloutState === "disabled" ? (
                        <CircleSlash aria-hidden="true" />
                      ) : (
                        <PlugZap aria-hidden="true" />
                      )}
                      {presentation.label}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{presentation.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3 text-sm">
                  {definition.operatorCopy ? (
                    <Alert>
                      <Info />
                      <AlertTitle>Provider access</AlertTitle>
                      <AlertDescription>{definition.operatorCopy}</AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase">Capabilities</span>
                    <div className="flex flex-wrap gap-2">
                      {definition.supportedCapabilities.map((capability) => (
                        <Badge key={capability} variant="outline">
                          {capability}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground uppercase">Required access</span>
                    <span className="text-muted-foreground">
                      {definition.requiredScopes.length > 0
                        ? definition.requiredScopes.join(", ")
                        : "No provider scopes are requested in fixture mode."}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Read-only · no provider writes or webhooks · syncs every{" "}
                    {definition.syncIntervalMinutes} minutes · stale after{" "}
                    {definition.staleAfterMinutes} minutes
                  </p>
                </CardContent>
                <CardFooter>
                  {definition.rolloutState === "fixture" && canConnect ? (
                    <Button
                      onClick={() => setPendingProviderKey(definition.key)}
                      disabled={connectFixture.isPending}
                    >
                      {connectFixture.isPending ? <Spinner /> : null}
                      {connected ? "Reconnect fixture" : "Connect fixture"}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {definition.rolloutState === "disabled"
                        ? "This provider is blocked by the V1 rollout policy."
                        : "Connecting requires an operator role."}
                    </p>
                  )}
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={pendingDefinition !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingProviderKey(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create the {pendingDefinition?.displayName} fixture connection?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-left">
                <p>
                  This creates a deterministic fixture connection. No Google credential is stored
                  and no Google API request is made.
                </p>
                <p>{pendingDefinition?.operatorCopy}</p>
                <p>An initial connection test is queued once the connection exists.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (pendingDefinition) connectFixture.mutate(pendingDefinition);
                setPendingProviderKey(null);
              }}
            >
              Create fixture connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
