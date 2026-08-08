import { describe, expect, it } from "vitest";

import { buildIntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

describe("Integration repository read-model boundary", () => {
  it("keeps cross-organization rows out of a snapshot even when a persistence adapter returns them", () => {
    const snapshot = buildIntegrationHubSnapshot({
      organizationId: "7e4402e6-283f-45a6-97e2-bde93fdf1bc9",
      now: new Date("2026-08-08T12:00:00.000Z"),
      connections: [
        {
          id: "12d32f7e-283f-45a6-97e2-bde93fdf1bc9",
          organization_id: "7e4402e6-283f-45a6-97e2-bde93fdf1bc9",
          provider_key: "google_business_profile",
          adapter_version: "v1",
          connection_mode: "fixture",
          status: "active",
          external_account_id: "account-a",
          external_account_label: "Restaurant A",
          credential_reference: "never-public",
          granted_scopes: [],
          token_expires_at: null,
          last_tested_at: null,
          last_successful_sync_at: null,
          next_scheduled_sync_at: null,
          created_by: "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f",
          created_at: "2026-08-08T10:00:00.000Z",
          updated_at: "2026-08-08T10:00:00.000Z",
        },
        {
          id: "22d32f7e-283f-45a6-97e2-bde93fdf1bc9",
          organization_id: "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f",
          provider_key: "google_business_profile",
          adapter_version: "v1",
          connection_mode: "fixture",
          status: "active",
          external_account_id: "account-b",
          external_account_label: "Restaurant B",
          credential_reference: "other-tenant-secret",
          granted_scopes: [],
          token_expires_at: null,
          last_tested_at: null,
          last_successful_sync_at: null,
          next_scheduled_sync_at: null,
          created_by: "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f",
          created_at: "2026-08-08T10:00:00.000Z",
          updated_at: "2026-08-08T11:00:00.000Z",
        },
      ],
      dataSources: [],
      healthChecks: [],
      runs: [],
      auditEvents: [],
    });

    expect(snapshot.connections).toEqual([
      expect.objectContaining({ id: "12d32f7e-283f-45a6-97e2-bde93fdf1bc9" }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("credential_reference");
    expect(JSON.stringify(snapshot)).not.toContain("never-public");
    expect(JSON.stringify(snapshot)).not.toContain("other-tenant-secret");
  });
});
