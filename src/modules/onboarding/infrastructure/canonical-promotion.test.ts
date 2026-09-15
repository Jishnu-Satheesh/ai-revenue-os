import { describe, expect, it } from "vitest";

import { createOnboardingRepository } from "@/modules/onboarding/infrastructure/repository";

/**
 * Promotion writes, against a stub that records what reached the database.
 *
 * These are the assertions that catch the two defects this work exists for: a
 * completed brand assets section that never reached `business_profiles`, and a
 * business identity save that erased what other sections had already promoted.
 * Both are about the shape of the write, which is exactly what a stub can see.
 */

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

type ProfileRow = Record<string, unknown> | null;

function stubClient(existingProfile: ProfileRow, guidelinesError: { code?: string } | null = null) {
  const upserts: Record<string, unknown>[] = [];
  const guidelineUpserts: Record<string, unknown>[] = [];
  const organizationUpdates: Record<string, unknown>[] = [];

  const client = {
    from(table: string) {
      if (table === "organizations") {
        return {
          update(patch: Record<string, unknown>) {
            organizationUpdates.push(patch);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "business_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: existingProfile, error: null }),
            }),
          }),
          upsert: async (row: Record<string, unknown>) => {
            upserts.push(row);
            return { error: null };
          },
        };
      }
      if (table === "organization_brand_guidelines") {
        return {
          upsert: async (row: Record<string, unknown>) => {
            if (guidelinesError) return { error: guidelinesError };
            guidelineUpserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, upserts, guidelineUpserts, organizationUpdates };
}

function repositoryFor(existingProfile: ProfileRow, guidelinesError: { code?: string } | null = null) {
  const stub = stubClient(existingProfile, guidelinesError);
  return {
    ...stub,
    repository: createOnboardingRepository(
      stub.client as unknown as Parameters<typeof createOnboardingRepository>[0],
    ),
  };
}

describe("persistCanonicalSection", () => {
  it("puts a completed brand voice into force", async () => {
    const { repository, upserts } = repositoryFor(null);

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "brand_assets",
      payload: { brandVoice: ["warm", "direct"], languages: ["en"] },
    });

    // The exact key campaign generation reads. Before this, the section was
    // stored against the onboarding session and went no further, so a
    // carefully filled brand voice still produced `brand_voice` missing.
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.brand_context).toEqual({ voice: "Warm, Direct" });
  });

  it("writes nothing when the section names no voice", async () => {
    const { repository, upserts } = repositoryFor(null);

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "brand_assets",
      payload: { languages: ["en"] },
    });

    expect(upserts).toHaveLength(0);
  });

  it("keeps the promoted voice when business identity is saved afterwards", async () => {
    const { repository, upserts } = repositoryFor({
      organization_id: organizationId,
      brand_context: { voice: "Warm, Direct" },
      value_proposition: "Home-style Kerala cooking",
      customer_segments: [{ name: "Families" }],
      languages: ["en", "ml"],
      operating_model: { delivery: true },
      business_model: "restaurant",
    });

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "business_identity",
      payload: { legalIdentity: "Al Noor Kitchen LLC" },
    });

    // The regression: this write used to replace brand_context outright and
    // reset every list column to empty, so completing sections in the wrong
    // order silently discarded the earlier ones.
    const [row] = upserts;
    expect(row?.brand_context).toEqual({
      voice: "Warm, Direct",
      legalIdentity: "Al Noor Kitchen LLC",
    });
    expect(row?.languages).toEqual(["en", "ml"]);
    expect(row?.customer_segments).toEqual([{ name: "Families" }]);
    expect(row?.operating_model).toEqual({ delivery: true });
    expect(row?.business_model).toBe("restaurant");
    // Absent from the payload means "leave it alone", not "set it to null".
    expect(row?.value_proposition).toBe("Home-style Kerala cooking");
  });

  it("still promotes the organization's own name and industry", async () => {
    const { repository, organizationUpdates } = repositoryFor(null);

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "business_identity",
      payload: { name: "Al Noor Kitchen", industry: "restaurant" },
    });

    expect(organizationUpdates).toEqual([{ name: "Al Noor Kitchen", industry: "restaurant" }]);
  });

  it("leaves sections with no canonical home alone", async () => {
    const { repository, upserts, organizationUpdates } = repositoryFor(null);

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "governance",
      payload: { goals: ["Grow delivery"] },
    });

    expect(upserts).toHaveLength(0);
    expect(organizationUpdates).toHaveLength(0);
  });
});

describe("persistCanonicalSection, brand guidelines", () => {
  it("puts the colours and rules into force alongside the voice", async () => {
    const { repository, upserts, guidelineUpserts } = repositoryFor(null);

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "brand_assets",
      payload: {
        brandVoice: ["warm"],
        palette: { primary: "#c8102e" },
        brandRules: [
          { text: "Never imply a medical benefit", strength: "hard" },
          { text: "We usually lead with the food", strength: "soft" },
        ],
        restrictedTerms: ["best in dubai"],
      },
    });

    // Voice and rules land in different places on purpose: voice describes how
    // a brand sounds, rules constrain what may be published in its name, and
    // only the constraining half carries an audit trail.
    expect(upserts[0]?.brand_context).toEqual({ voice: "Warm" });
    expect(guidelineUpserts).toEqual([
      {
        organization_id: organizationId,
        palette: { primary: "#c8102e" },
        rules: [
          { text: "Never imply a medical benefit", strength: "hard" },
          { text: "We usually lead with the food", strength: "soft" },
        ],
        restricted_terms: ["best in dubai"],
        updated_by: userId,
      },
    ]);
  });

  it("writes no guidelines row when the section supplied none", async () => {
    const { repository, guidelineUpserts } = repositoryFor(null);

    await repository.persistCanonicalSection?.({
      organizationId,
      userId,
      sectionKey: "brand_assets",
      payload: { brandVoice: ["warm"] },
    });

    // An upsert of empty lists would replace rules set in the Asset Library
    // with nothing, lifting constraints nobody asked to lift.
    expect(guidelineUpserts).toEqual([]);
  });

  it("says who can put the rules in force when the writer may not", async () => {
    // `onboarding.manage` is an operator permission; `brand.manage` is not. An
    // operator can therefore fill this section and not be allowed to store its
    // rules. Reporting success would leave somebody believing generation was
    // constrained when it was not.
    const { repository } = repositoryFor(null, { code: "42501" });

    await expect(
      repository.persistCanonicalSection?.({
        organizationId,
        userId,
        sectionKey: "brand_assets",
        payload: { brandRules: [{ text: "Never show alcohol", strength: "hard" }] },
      }),
    ).rejects.toThrow(/admin or owner/i);
  });
});
