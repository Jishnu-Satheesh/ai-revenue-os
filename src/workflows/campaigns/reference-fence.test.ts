import { describe, expect, it } from "vitest";

import { loadReferenceBytes } from "@/workflows/campaigns/generate-bundle";
import type {
  ReferenceCandidateFile,
  ReferenceObjectReader,
} from "@/workflows/campaigns/generate-bundle";
import type { ReferenceResolution } from "@/domain/campaigns/reference-resolution";

/**
 * The structural fence between rejected creative and the final image model.
 *
 * A rejected design is evidence for the Blueprint stage — "this was refused,
 * for these reasons, do not do it again" is a thing the planner must be able
 * to read. It is emphatically NOT a conditioning reference for the model that
 * draws the finished picture: handing those bytes to an image model is asking
 * it to look at the thing it must not produce.
 *
 * ADR 0049 and contract C06 separate the two evidence sets by type so the
 * mistake cannot be made by passing the wrong array. These tests hold the
 * seam where the bytes are actually loaded, because a type boundary that is
 * never asserted at runtime is a comment.
 */

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const APPROVED_ASSET = "22222222-2222-4222-8222-222222222222";
const APPROVED_VERSION = "33333333-3333-4333-8333-333333333333";
const REJECTED_ASSET = "44444444-4444-4444-8444-444444444444";
const REJECTED_VERSION = "55555555-5555-4555-8555-555555555555";

const APPROVED_PATH = `${ORGANIZATION}/approved/source.png`;
const REJECTED_PATH = `${ORGANIZATION}/rejected/source.png`;

/** Distinct, recognisable bytes so a leak is identifiable, not merely unequal. */
const APPROVED_BYTES = new Uint8Array([1, 1, 1, 1]);
const REJECTED_BYTES = new Uint8Array([9, 9, 9, 9]);

function resolution(): ReferenceResolution {
  return {
    resolverVersion: 1,
    outcome: "resolved",
    refusalCode: null,
    referenceSlots: [
      {
        role: "subject",
        ordinal: 0,
        brandAssetId: APPROVED_ASSET,
        brandAssetVersionId: APPROVED_VERSION,
        referenceMode: "guided",
        script: null,
      },
    ],
    avoidReferences: [
      {
        role: "avoid",
        brandAssetId: REJECTED_ASSET,
        brandAssetVersionId: REJECTED_VERSION,
        reasonCodes: ["wrong_subject"],
      },
    ],
    negativeRules: [],
  } as unknown as ReferenceResolution;
}

function candidates(): readonly ReferenceCandidateFile[] {
  return [
    {
      brandAssetId: APPROVED_ASSET,
      brandAssetVersionId: APPROVED_VERSION,
      storagePath: APPROVED_PATH,
      mimeType: "image/png",
    },
    {
      brandAssetId: REJECTED_ASSET,
      brandAssetVersionId: REJECTED_VERSION,
      storagePath: REJECTED_PATH,
      mimeType: "image/png",
    },
  ] as unknown as readonly ReferenceCandidateFile[];
}

function objects(): ReferenceObjectReader & { readPaths: string[] } {
  const readPaths: string[] = [];
  return {
    readPaths,
    async read(storagePath: string) {
      readPaths.push(storagePath);
      if (storagePath === APPROVED_PATH) return APPROVED_BYTES;
      if (storagePath === REJECTED_PATH) return REJECTED_BYTES;
      return null;
    },
  };
}

function bytesOf(references: readonly { bytes: Uint8Array }[]): string[] {
  return references.map((reference) => [...reference.bytes].join(","));
}

describe("the fence between rejected creative and the final image model", () => {
  it("keeps rejected bytes out of the final-image set", async () => {
    const loaded = await loadReferenceBytes(resolution(), candidates(), objects());
    expect(loaded).not.toBeNull();

    expect(bytesOf(loaded!.finalImage)).not.toContain([...REJECTED_BYTES].join(","));
    expect(bytesOf(loaded!.finalImage)).toEqual([[...APPROVED_BYTES].join(",")]);
  });

  it("carries no rejected identifier or role into the final-image set", async () => {
    const loaded = await loadReferenceBytes(resolution(), candidates(), objects());

    const serialized = JSON.stringify(
      loaded!.finalImage.map((reference) => ({ ...reference, bytes: [...reference.bytes] })),
    );
    expect(serialized).not.toContain(REJECTED_ASSET);
    expect(serialized).not.toContain(REJECTED_VERSION);
    expect(serialized).not.toContain(REJECTED_PATH);
    expect(serialized).not.toContain("rejected_creative");
    expect(serialized).not.toContain("avoid");
  });

  it("still gives the Blueprint stage the rejected evidence, with its reasons", async () => {
    const loaded = await loadReferenceBytes(resolution(), candidates(), objects());

    const rejected = loaded!.blueprintEvidence.filter(
      (reference) => reference.role === "rejected_creative",
    );
    expect(rejected).toHaveLength(1);
    expect([...rejected[0]!.bytes]).toEqual([...REJECTED_BYTES]);
    expect(rejected[0]).toMatchObject({ reasonCodes: ["wrong_subject"] });
  });

  it("gives the Blueprint stage the positive references too, so it sees both sides", async () => {
    const loaded = await loadReferenceBytes(resolution(), candidates(), objects());

    const roles = loaded!.blueprintEvidence.map((reference) => reference.role).sort();
    expect(roles).toEqual(["rejected_creative", "subject"]);
  });

  it("refuses the whole load when a rejected object is missing, rather than proceeding partly blind", async () => {
    const reader: ReferenceObjectReader = {
      async read(storagePath: string) {
        return storagePath === APPROVED_PATH ? APPROVED_BYTES : null;
      },
    };

    await expect(loadReferenceBytes(resolution(), candidates(), reader)).resolves.toBeNull();
  });

  it("keeps the rejected ordinals contiguous from zero, independent of the positive slots", async () => {
    const loaded = await loadReferenceBytes(resolution(), candidates(), objects());

    const rejected = loaded!.blueprintEvidence.filter(
      (reference) => reference.role === "rejected_creative",
    );
    expect(rejected.map((reference) => reference.ordinal)).toEqual([0]);
  });

  it("never reads bytes for a candidate the resolution did not pin", async () => {
    const reader = objects();
    await loadReferenceBytes(resolution(), candidates(), reader);

    expect(reader.readPaths.sort()).toEqual([APPROVED_PATH, REJECTED_PATH].sort());
  });
});
