import { describe, expect, it } from "vitest";

import {
  admitStudioEdit,
  checkProviderCaps,
  studioProviderProfileSchema,
  studioProviderRequestSchema,
} from "@/domain/creative-studio/provider";

const PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const QUALIFICATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    provider: "candidate-a",
    exactModelId: "candidate-a-poster-2026-09",
    apiFamily: "responses",
    adapterVersion: "studio-adapter-1",
    supportedRatios: ["4:5", "1:1", "9:16"],
    maxInputBytes: 10_000_000,
    maxImages: 6,
    partialFrameContract: {
      mechanism: "server-sent partial frames",
      provenByQualificationId: QUALIFICATION,
    },
    continuationContract: {
      mechanism: "opaque server continuation",
      provenByQualificationId: QUALIFICATION,
    },
    retentionDisclosure: "Provider retains prompts 30 days for abuse monitoring.",
    measuredQualificationId: QUALIFICATION,
    enabled: true,
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    documentId: PROFILE,
    runId: QUALIFICATION,
    operation: "generate",
    promptDigest: "c".repeat(64),
    inputDigest: "d".repeat(64),
    profileId: PROFILE,
    parentVersionId: null,
    markerCount: 0,
    aspectRatio: "4:5",
    ...overrides,
  };
}

describe("provider profile", () => {
  it("accepts a fully described, qualified, enabled profile", () => {
    expect(studioProviderProfileSchema.safeParse(profile()).success).toBe(true);
  });

  it("pins the exact model id: no silent fallback mid-session", () => {
    expect(
      studioProviderProfileSchema.safeParse(profile({ exactModelId: "latest" })).success,
    ).toBe(true);
    expect(studioProviderProfileSchema.safeParse(profile({ exactModelId: "" })).success).toBe(
      false,
    );
  });

  it("refuses a profile with no measured qualification", () => {
    expect(
      studioProviderProfileSchema.safeParse(profile({ measuredQualificationId: "not-a-uuid" }))
        .success,
    ).toBe(false);
  });

  it("refuses browser-authored provider state on the request path", () => {
    // The provider request manifest must never carry an opaque handle or token
    // the browser invented; continuation travels server-side only.
    expect(
      studioProviderProfileSchema.safeParse({ ...profile(), providerHandle: "opaque" }).success,
    ).toBe(false);
    expect(
      studioProviderRequestSchema.safeParse({
        ...request(),
        continuationToken: "browser-invented",
      }).success,
    ).toBe(false);
  });
});

describe("provider caps", () => {
  it("admits a request inside the qualified envelope", () => {
    expect(
      checkProviderCaps({
        profile: profile(),
        ratio: "4:5",
        totalImages: 4,
        estimatedInputBytes: 5_000_000,
      }),
    ).toEqual({ admitted: true });
  });

  it("refuses a disabled profile before spending anything", () => {
    expect(
      checkProviderCaps({
        profile: profile({ enabled: false }),
        ratio: "4:5",
        totalImages: 1,
        estimatedInputBytes: 100,
      }),
    ).toMatchObject({ admitted: false, code: "profile_disabled" });
  });

  it("keeps unsupported ratios visibly unavailable with a reason", () => {
    expect(
      checkProviderCaps({
        profile: profile(),
        ratio: "3:4",
        totalImages: 1,
        estimatedInputBytes: 100,
      }),
    ).toMatchObject({ admitted: false, code: "ratio_unsupported" });
  });

  it("enforces the qualified image and byte ceilings", () => {
    expect(
      checkProviderCaps({
        profile: profile(),
        ratio: "4:5",
        totalImages: 7,
        estimatedInputBytes: 100,
      }),
    ).toMatchObject({ admitted: false, code: "too_many_images" });
    expect(
      checkProviderCaps({
        profile: profile(),
        ratio: "4:5",
        totalImages: 1,
        estimatedInputBytes: 10_000_001,
      }),
    ).toMatchObject({ admitted: false, code: "payload_too_large" });
  });
});

describe("immutable profile binding", () => {
  it("admits an edit that reuses the pinned profile and a usable continuation", () => {
    expect(
      admitStudioEdit({
        pinnedProfileId: PROFILE,
        requestProfileId: PROFILE,
        continuationState: "usable",
        sameDocument: true,
      }),
    ).toEqual({ admitted: true });
  });

  it("sends a profile change to a new branch instead of silently switching models", () => {
    expect(
      admitStudioEdit({
        pinnedProfileId: PROFILE,
        requestProfileId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        continuationState: "usable",
        sameDocument: true,
      }),
    ).toMatchObject({ admitted: false, code: "profile_changed", startBranch: true });
  });

  it("offers an explicitly labelled new branch when the editing context expired", () => {
    expect(
      admitStudioEdit({
        pinnedProfileId: PROFILE,
        requestProfileId: PROFILE,
        continuationState: "expired",
        sameDocument: true,
      }),
    ).toMatchObject({ admitted: false, code: "continuation_expired", startBranch: true });
  });

  it("refuses a parent from another document outright: no branch can fix that", () => {
    expect(
      admitStudioEdit({
        pinnedProfileId: PROFILE,
        requestProfileId: PROFILE,
        continuationState: "usable",
        sameDocument: false,
      }),
    ).toMatchObject({ admitted: false, code: "foreign_parent", startBranch: false });
  });
});
