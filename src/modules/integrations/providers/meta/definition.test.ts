import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createProviderRegistry } from "@/domain/integrations/provider-registry";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import { createGoogleBusinessProfileFixtureAdapter } from "@/modules/integrations/providers/google-business-profile/fixture-adapter";
import {
  META_BLOCKED_CAPABILITY_KEYS,
  metaDefinition,
} from "@/modules/integrations/providers/meta/definition";

/**
 * Meta is present in the catalog so an operator can see what is intended and
 * why it is unavailable. It must be structurally impossible to grant: it
 * declares no grantable capability and ships no adapter.
 */
describe("meta provider definition", () => {
  it("declares no grantable capability, so no organization grant can be derived", () => {
    expect(metaDefinition.capabilities).toEqual([]);
    expect(metaDefinition.rolloutState).toBe("disabled");
  });

  it("names each blocked capability the release train intends to prove", () => {
    expect([...META_BLOCKED_CAPABILITY_KEYS].sort()).toEqual([
      "advertise_meta_ads",
      "publish_facebook",
      "publish_instagram",
      "read_meta_metrics",
      "webhook_meta",
    ]);
  });

  it("carries only restriction codes that the checked-in contract records", () => {
    const contractCodes = new Set([
      "meta.instagram_feed_image_blocked",
      "meta.instagram_image_story_blocked",
      "meta.facebook_feed_image_blocked",
      "meta.facebook_image_story_unproven",
      "meta.ads_feed_image_blocked",
      "meta.ads_image_story_blocked",
      "meta.unknown_outcome_reconciliation_unverified",
      "meta.webhook_contract_unverified",
      "meta.controlled_account_evidence_missing",
    ]);

    for (const declaration of metaDefinition.declaredBlockedCapabilities ?? []) {
      expect(declaration.restrictionCodes.length).toBeGreaterThan(0);
      for (const code of declaration.restrictionCodes) {
        expect(contractCodes.has(code)).toBe(true);
      }
    }
  });

  it("requests no scope it cannot justify from the documented scope set", () => {
    const documentedScopes = new Set([
      "instagram_basic",
      "instagram_content_publish",
      "pages_manage_engagement",
      "pages_manage_posts",
      "pages_read_engagement",
      "pages_read_user_engagement",
      "ads_management",
      "ads_read",
    ]);

    for (const declaration of metaDefinition.declaredBlockedCapabilities ?? []) {
      for (const scope of declaration.requiredScopes) {
        expect(documentedScopes.has(scope)).toBe(true);
      }
    }
  });

  it("registers without any Meta adapter, because a blocked declaration needs none", () => {
    const registry = createProviderRegistry({
      definitions: [googleBusinessProfileDefinition, metaDefinition],
      adapters: { read: [createGoogleBusinessProfileFixtureAdapter()] },
    });

    expect(registry.getDefinition("meta").displayName).toBe("Meta");
  });

  it("refuses a definition whose blocked declaration shadows a grantable capability", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [
          {
            ...googleBusinessProfileDefinition,
            declaredBlockedCapabilities: [
              {
                key: "read_reviews",
                character: "data_source",
                effect: "read",
                adapterKind: "read",
                requiredScopes: [],
                restrictionCodes: ["meta.controlled_account_evidence_missing"],
                summary: "shadows a real capability",
              },
            ],
          },
          metaDefinition,
        ],
        adapters: { read: [createGoogleBusinessProfileFixtureAdapter()] },
      }),
    ).toThrow(/blocked/i);
  });

  it("refuses a blocked declaration with no restriction code, which would read as merely absent", () => {
    expect(() =>
      createProviderRegistry({
        definitions: [
          {
            ...metaDefinition,
            declaredBlockedCapabilities: [
              {
                key: "publish_instagram",
                character: "publishing_destination",
                effect: "public_write",
                adapterKind: "publish",
                requiredScopes: [],
                restrictionCodes: [],
                summary: "no reason given",
              },
            ],
          },
        ],
        adapters: {},
      }),
    ).toThrow(/restriction/i);
  });
});
