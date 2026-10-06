import "server-only";

import type { CredentialStore } from "@/domain/integrations/credential-store.server";
import type { CredentialHandle } from "@/domain/integrations/types";
import type { PlannedPublish } from "@/modules/campaigns/infrastructure/dispatch-planner";
import { createMetaOrganicAdapter } from "@/modules/integrations/providers/meta/organic-adapter";
import type { MetaGraphClient } from "@/modules/integrations/providers/meta/client";
import type { VerifiedProviderContract } from "@/modules/integrations/providers/meta/contract";
import type {
  ToolAdapter,
  ToolKey,
} from "@/modules/tool-gateway/application/ports";
import type { ToolAdapterResolver } from "@/modules/tool-gateway/application/service";

/**
 * Which Meta adapter serves which organization (Task 13, C04/C07).
 *
 * The dispatch sweep spans every tenant, while a Meta access token belongs to
 * exactly one. A single shared adapter would hold one organization's token and
 * publish everybody's work to that account, so the gateway asks this resolver
 * per action instead.
 *
 * Only the organic tool keys are offered. Paid dispatch stays unresolved on
 * purpose: an ads call needs a qualified connection and a confirmed pause path
 * that do not exist yet, and a tool key nobody resolves keeps refusing by name
 * rather than quietly doing nothing.
 *
 * Two different absences are kept apart, because they mean different things to
 * whoever reads the sweep:
 *
 * - The provider contract is out of review. That is about the deployment: no
 *   one has confirmed recently that these endpoints behave as recorded, so no
 *   tool key is supported and no credential is ever read.
 * - The organization has no granted connection, or its secret will not resolve.
 *   That is about one tenant, and the sweep records it against that action and
 *   carries on to the next.
 */

/** The narrowest view of a connection this needs: who to call as. */
export type MetaPublishConnection = {
  connectionId: string;
  credentialHandle: CredentialHandle;
};

export type MetaPublishConnectionReader = {
  /**
   * The organization's live Meta connection with this capability granted and
   * available, or null. The capability is checked, not just the provider: a
   * connection granted only for reading must not publish.
   */
  read(input: {
    organizationId: string;
    capabilityKey: string;
  }): Promise<MetaPublishConnection | null>;
};

export type MetaOrganicResolverDependencies = {
  /** Throws when the contract is expired or not yet verified. */
  readContract: () => VerifiedProviderContract;
  connections: MetaPublishConnectionReader;
  credentials: Pick<CredentialStore, "resolve">;
  /** Filled by the planner, keyed by action-run id. */
  requests: ReadonlyMap<string, PlannedPublish>;
  correlationId: string;
  createClient: (input: {
    contract: VerifiedProviderContract;
    credential: { readonly value: string; toJSON(): never };
  }) => MetaGraphClient;
};

export type MetaOrganicResolverResult = {
  resolver: ToolAdapterResolver;
  status: "ready" | "contract_unusable";
  /** Why nothing is supported, when that is the case. Safe to log. */
  reason?: string;
};

const ORGANIC_TOOL_KEYS = ["meta.publish_image", "meta.publish_story"] as const;

type OrganicToolKey = (typeof ORGANIC_TOOL_KEYS)[number];

function isOrganicToolKey(toolKey: ToolKey): toolKey is OrganicToolKey {
  return (ORGANIC_TOOL_KEYS as readonly string[]).includes(toolKey);
}

export function createMetaOrganicResolver(
  dependencies: MetaOrganicResolverDependencies,
): MetaOrganicResolverResult {
  // Read once, at construction. The contract is a deployment-wide review gate,
  // so re-reading it per action would only multiply the same answer.
  let contract: VerifiedProviderContract | null = null;
  let reason: string | undefined;
  try {
    contract = dependencies.readContract();
  } catch (error) {
    reason = error instanceof Error ? error.message : "The Meta provider contract is unusable.";
  }

  if (contract === null) {
    return {
      status: "contract_unusable",
      reason,
      resolver: {
        supportedToolKeys: () => [],
        resolve: async () => null,
      },
    };
  }

  const verified = contract;

  return {
    status: "ready",
    resolver: {
      supportedToolKeys: () => [...ORGANIC_TOOL_KEYS],

      async resolve({ organizationId, toolKey }): Promise<ToolAdapter | null> {
        if (!isOrganicToolKey(toolKey)) return null;

        // Instagram is the only organic surface this release publishes to, and
        // the capability key is the one the planner emitted, not a guess.
        const connection = await dependencies.connections.read({
          organizationId,
          capabilityKey: "meta.instagram.publish",
        });
        if (!connection) return null;

        let credential;
        try {
          credential = await dependencies.credentials.resolve({
            organizationId,
            providerKey: "meta",
            handle: connection.credentialHandle,
            correlationId: dependencies.correlationId,
          });
        } catch {
          // A revoked, rotated or missing secret is a disconnected
          // organization. Throwing here would abandon every remaining tenant
          // in the sweep over one tenant's credential.
          return null;
        }

        const client = dependencies.createClient({ contract: verified, credential });

        return createMetaOrganicAdapter(toolKey, {
          client,
          loadRequest: async ({ actionRunId }) => {
            const request = dependencies.requests.get(actionRunId);
            if (!request) {
              // The planner builds the request beside the plan. Missing here
              // means this action was never turned into something reviewable,
              // and publishing it would send what nobody approved.
              throw new Error(
                `No planned request is available for action run ${actionRunId}.`,
              );
            }
            return request;
          },
        });
      },
    },
  };
}
