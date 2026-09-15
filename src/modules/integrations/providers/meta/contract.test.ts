import { describe, expect, it } from "vitest";
import { FacebookAdsApi } from "facebook-nodejs-business-sdk";

import {
  getMetaCampaignProviderContract,
  parseVerifiedProviderContract,
} from "@/modules/integrations/providers/meta/contract";
import * as metaContractModule from "@/modules/integrations/providers/meta/contract";

const NOW = new Date("2026-08-11T12:00:00.000Z");

/**
 * Inside the checked-in contract's own review window, which moves whenever the
 * contract is re-verified. Kept separate from `NOW` so the synthetic fixtures
 * below keep testing the schema rather than today's date.
 */
const CONTRACT_NOW = new Date("2026-09-15T12:00:00.000Z");

const verifiedFixture = {
  schemaVersion: 1,
  providerKey: "fixture_provider",
  contractVersion: "fixture-v1",
  apiVersion: "v1",
  verifiedAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-09-10T00:00:00.000Z",
  officialSourceUrls: ["https://developers.facebook.com/docs/graph-api/guides/versioning/"],
  evidence: [
    {
      id: "fixture.official.publish_contract",
      kind: "official_source" as const,
      sourceUrl: "https://developers.facebook.com/docs/graph-api/guides/versioning/",
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official source documents the fixture action contract.",
    },
    {
      id: "fixture.controlled.account_check",
      kind: "controlled_account_check" as const,
      sourceUrl: "https://developers.facebook.com/docs/graph-api/guides/versioning/",
      checkedAt: "2026-08-10T01:00:00.000Z",
      detail: "The controlled fixture account passed its live eligibility check.",
      artifactReference: "docs/verification/fixture/account-check.json",
      artifactSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  ],
  accountPrerequisites: [
    {
      key: "fixture.controlled_account",
      detail: "A controlled test account must pass a live eligibility check.",
      verificationStatus: "verified" as const,
      evidenceIds: ["fixture.controlled.account_check"],
    },
  ],
  exactScopes: ["fixture_publish"],
  placements: [
    {
      key: "fixture.feed_image",
      verificationStatus: "verified" as const,
      evidenceIds: ["fixture.official.publish_contract"],
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
      sourceEvidenceIds: ["fixture.official.publish_contract"],
      controlledAccountEvidenceIds: ["fixture.controlled.account_check"],
      requiredPrerequisiteKeys: ["fixture.controlled_account"],
      idempotency: {
        mode: "platform_ledger" as const,
        providerKeyField: null,
      },
      reconciliationLookup: {
        method: "GET" as const,
        pathTemplate: "/objects/by-idempotency/{idempotency_key}",
        lookupInputs: [
          {
            key: "idempotency_key",
            source: "request" as const,
            valueReference: "request.idempotency_key",
          },
        ],
        resultIdentityField: "id",
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
    const parsed = getMetaCampaignProviderContract(CONTRACT_NOW);

    expect(parsed.providerKey).toBe("meta_campaign");
    // Must equal what the SDK actually calls. FacebookAdsApi.VERSION is a
    // static getter with no setter, so a contract naming any other version
    // would describe requests this platform never makes.
    expect(parsed.apiVersion).toBe("v24.0");
    expect(FacebookAdsApi.VERSION).toBe(parsed.apiVersion);
    expect(parsed.actions).toEqual([]);
    expect(parsed.knownRestrictions.map(({ code }) => code)).toContain(
      "meta.controlled_account_eligibility_unverified",
    );
  });

  it("exposes the checked-in Meta contract only through current temporal validation", () => {
    expect("metaCampaignProviderContract" in metaContractModule).toBe(false);
    expect(() => getMetaCampaignProviderContract(new Date("2026-10-15T00:00:00.000Z"))).toThrow(
      /expired/i,
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

  it("rejects a contract verified in the future", () => {
    expect(() =>
      parseVerifiedProviderContract(
        { ...verifiedFixture, verifiedAt: "2026-08-11T12:00:01.000Z" },
        NOW,
      ),
    ).toThrow(/future/i);
  });

  it("rejects a verified action without official-source and controlled-account evidence", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          actions: [
            {
              ...verifiedFixture.actions[0],
              sourceEvidenceIds: [],
              controlledAccountEvidenceIds: [],
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/evidence/i);
  });

  it("rejects an action whose required controlled-account prerequisite is blocked", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          accountPrerequisites: [
            {
              ...verifiedFixture.accountPrerequisites[0],
              verificationStatus: "blocked",
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/prerequisite/i);
  });

  it("rejects controlled-account evidence without an independent artifact digest", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          evidence: [
            verifiedFixture.evidence[0],
            {
              id: "fixture.controlled.account_check",
              kind: "controlled_account_check",
              sourceUrl: "https://developers.facebook.com/docs/graph-api/guides/versioning/",
              checkedAt: "2026-08-10T01:00:00.000Z",
              detail: "The controlled fixture account passed its live eligibility check.",
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/artifact/i);
  });

  it("rejects a verified placement whose required limits are unknown", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          placements: [
            {
              ...verifiedFixture.placements[0],
              limits: { ...verifiedFixture.placements[0].limits, maxHashtags: null },
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/limit/i);
  });

  it("rejects reconciliation that depends only on a create-response reference", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          actions: [
            {
              ...verifiedFixture.actions[0],
              reconciliationLookup: {
                ...verifiedFixture.actions[0].reconciliationLookup,
                lookupInputs: [
                  {
                    key: "provider_reference",
                    source: "create_response",
                    valueReference: "create_response.id",
                  },
                ],
              },
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/request|preflight/i);
  });

  it("rejects response-derived reconciliation references disguised as request inputs", () => {
    expect(() =>
      parseVerifiedProviderContract(
        {
          ...verifiedFixture,
          actions: [
            {
              ...verifiedFixture.actions[0],
              reconciliationLookup: {
                ...verifiedFixture.actions[0].reconciliationLookup,
                lookupInputs: [
                  {
                    key: "idempotency_key",
                    source: "request",
                    valueReference: "create_response.id",
                  },
                ],
              },
            },
          ],
        },
        NOW,
      ),
    ).toThrow(/request/i);
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

describe("what the 2026-09-15 re-verification actually proved", () => {
  it("proves the Instagram feed image limits from the official media reference", () => {
    const parsed = getMetaCampaignProviderContract(CONTRACT_NOW);
    const feed = parsed.placements.find(({ key }) => key === "instagram.feed_image");

    // These are the numbers the POST /{ig-user-id}/media reference states, and
    // they are what a draft is checked against before anyone tries to publish
    // it. A plausible-looking guess here would fail at Meta instead.
    expect(feed?.verificationStatus).toBe("verified");
    expect(feed?.limits).toEqual({
      maxPayloadBytes: 8_000_000,
      maxCopyCharacters: 2200,
      maxHashtags: 30,
    });
  });

  it("leaves every placement the re-verification did not cover blocked", () => {
    const parsed = getMetaCampaignProviderContract(CONTRACT_NOW);
    const blocked = parsed.placements
      .filter(({ verificationStatus }) => verificationStatus !== "verified")
      .map(({ key }) => key);

    // Stories limits are not documented on the pages consulted, and Facebook
    // and ads were not part of this pass. Reading the contract must not suggest
    // otherwise.
    expect(blocked.sort()).toEqual([
      "facebook.feed_image",
      "facebook.image_story",
      "instagram.image_story",
      "meta_ads.feed_image",
      "meta_ads.image_story",
    ]);
  });

  it("keeps the controlled account unproven, so nothing may actually publish", () => {
    const parsed = getMetaCampaignProviderContract(CONTRACT_NOW);

    // Reading a public document proves what the API allows. It cannot prove
    // that this organization's account is eligible to do it, and no amount of
    // documentation ever will.
    expect(
      parsed.accountPrerequisites.every(
        ({ verificationStatus }) => verificationStatus === "blocked",
      ),
    ).toBe(true);
    expect(parsed.actions).toEqual([]);
  });

  it("records that organic impressions cannot be collected, rather than substituting a metric", () => {
    const parsed = getMetaCampaignProviderContract(CONTRACT_NOW);

    // Meta deprecated impressions for media created after 2024-07-02. Mapping
    // reach or views onto the registry's impressions would put a different
    // measurement behind a name people already trust.
    expect(parsed.knownRestrictions.map(({ code }) => code)).toContain(
      "meta.instagram_organic_impressions_unavailable",
    );
  });
});

describe("the checked-in contract against the real clock", () => {
  /**
   * Deliberately time-dependent, and the only test here that is.
   *
   * This contract lapsed on 2026-09-10 and nothing said so. It was found five
   * days later only because a feature that needed it stopped working, having
   * looked fine in every test — every other test in this file pins its own
   * date, so all of them kept passing over an expired record.
   *
   * A failure here means the review is due, not that the code is broken. Fix
   * it by re-checking the official sources and updating `verifiedAt`,
   * `expiresAt` and every evidence `checkedAt` to what was actually read.
   * Never by moving the dates alone.
   */
  it("is inside its own review window today", () => {
    expect(() => getMetaCampaignProviderContract(new Date())).not.toThrow();
  });
});
