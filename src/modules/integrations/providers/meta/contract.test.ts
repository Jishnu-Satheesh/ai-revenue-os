import { describe, expect, it } from "vitest";

import {
  metaCampaignProviderContract,
  parseVerifiedProviderContract,
} from "@/modules/integrations/providers/meta/contract";

const NOW = new Date("2026-08-11T12:00:00.000Z");

const verifiedFixture = {
  schemaVersion: 1,
  providerKey: "fixture_provider",
  contractVersion: "fixture-v1",
  apiVersion: "v1",
  verifiedAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-09-10T00:00:00.000Z",
  officialSourceUrls: ["https://developers.facebook.com/docs/graph-api/guides/versioning/"],
  accountPrerequisites: ["A controlled test account must pass a live eligibility check."],
  exactScopes: ["fixture_publish"],
  placements: [
    {
      key: "fixture.feed_image",
      verificationStatus: "verified" as const,
      limits: {
        maxPayloadBytes: 1_000_000,
        maxCopyCharacters: 1_000,
        maxHashtags: 10,
      },
    },
  ],
  actions: [
    {
      key: "fixture.publish_image",
      verificationStatus: "verified" as const,
      effect: "public_write" as const,
      placementKey: "fixture.feed_image",
      requiredScopes: ["fixture_publish"],
      idempotency: {
        mode: "platform_ledger" as const,
        providerKeyField: null,
      },
      reconciliationLookup: {
        method: "GET" as const,
        pathTemplate: "/objects/{provider_reference}",
        externalReferenceField: "provider_reference",
      },
    },
  ],
  webhook: {
    events: [
      {
        key: "fixture.object_changed",
        sourceUrl: "https://developers.facebook.com/docs/graph-api/guides/versioning/",
      },
    ],
    signature: {
      mechanism: "fixture_hmac",
      headerName: "x-fixture-signature",
    },
    replay: {
      deduplicationKey: "event_id",
      retentionSeconds: 86_400,
    },
  },
  retryableStatuses: [429, 500, 502, 503, 504],
  knownRestrictions: [],
};

describe("verified provider contract boundary", () => {
  it("accepts the checked-in Meta contract while its controlled-account actions remain blocked", () => {
    const parsed = parseVerifiedProviderContract(metaCampaignProviderContract, NOW);

    expect(parsed.providerKey).toBe("meta_campaign");
    expect(parsed.apiVersion).toBe("v26.0");
    expect(parsed.actions).toEqual([]);
    expect(parsed.knownRestrictions.map(({ code }) => code)).toContain(
      "meta.controlled_account_eligibility_unverified",
    );
  });

  it("rejects a contract whose verification has expired", () => {
    expect(() =>
      parseVerifiedProviderContract(
        { ...verifiedFixture, expiresAt: "2026-08-11T11:59:59.000Z" },
        NOW,
      ),
    ).toThrow(/expired/i);
  });

  it("rejects an action that is not verified", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          actions: [{ ...verifiedFixture.actions[0], verificationStatus: "unverified" }],
        },
        NOW,
      ),
    ).toThrow();
  });

  it("rejects an action whose required scope is absent from the exact scope set", () => {
    expect(() =>
      parseVerifiedProviderContract({ ...verifiedFixture, exactScopes: [] }, NOW),
    ).toThrow(/scope/i);
  });

  it("rejects a webhook event without an official source in the contract", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          webhook: {
            ...verifiedFixture.webhook,
            events: [
              {
                key: "fixture.undocumented_event",
                sourceUrl: "https://developers.facebook.com/docs/undocumented-event/",
              },
            ],
          },
        },
        NOW,
      ),
    ).toThrow(/webhook/i);
  });

  it("rejects a write action without an unknown-outcome reconciliation lookup", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          actions: [{ ...verifiedFixture.actions[0], reconciliationLookup: null }],
        },
        NOW,
      ),
    ).toThrow(/reconciliation/i);
  });

  it("rejects unknown fields at the provider boundary", () => {
    expect(() =>
      parseVerifiedProviderContract({ ...verifiedFixture, guessedPermission: true }, NOW),
    ).toThrow();
  });
});
