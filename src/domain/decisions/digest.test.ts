import { describe, expect, it } from "vitest";

import { candidateFingerprint, parameterDigest, type SubjectRef } from "@/domain/decisions/digest";

const playbookVersionId = "11111111-1111-4111-8111-111111111111";
const otherVersionId = "22222222-2222-4222-8222-222222222222";
const subject: SubjectRef = { subjectKind: "branch", subjectId: "branch-1" };

describe("parameter digest", () => {
  it("is stable across key order, because object order is not meaning", () => {
    expect(parameterDigest({ a: 1, b: 2 })).toBe(parameterDigest({ b: 2, a: 1 }));
  });

  it("is stable across nesting order and inside arrays of objects", () => {
    expect(parameterDigest({ outer: { x: 1, y: [{ p: 1, q: 2 }] } })).toBe(
      parameterDigest({ outer: { y: [{ q: 2, p: 1 }], x: 1 } }),
    );
  });

  it("preserves array order, because sequence is meaning", () => {
    expect(parameterDigest({ steps: [1, 2] })).not.toBe(parameterDigest({ steps: [2, 1] }));
  });

  it("separates a missing key from an explicit null", () => {
    expect(parameterDigest({ a: 1 })).not.toBe(parameterDigest({ a: 1, b: null }));
  });

  it("does not confuse a number with its string form", () => {
    expect(parameterDigest({ a: 1 })).not.toBe(parameterDigest({ a: "1" }));
  });

  it("rejects a value that cannot be canonicalised rather than digesting a guess", () => {
    expect(() => parameterDigest({ when: new Date() } as never)).toThrow();
    expect(() => parameterDigest({ nan: Number.NaN })).toThrow();
  });
});

describe("candidate fingerprint", () => {
  it("is stable across cycles for the same version, subject, and parameters", () => {
    const first = candidateFingerprint({ playbookVersionId, subject, parameters: { budget: 10 } });
    const second = candidateFingerprint({ playbookVersionId, subject, parameters: { budget: 10 } });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the playbook version changes, because that is a new proposal", () => {
    expect(
      candidateFingerprint({ playbookVersionId, subject, parameters: { budget: 10 } }),
    ).not.toBe(
      candidateFingerprint({
        playbookVersionId: otherVersionId,
        subject,
        parameters: { budget: 10 },
      }),
    );
  });

  it("changes when the subject or its kind changes", () => {
    const base = candidateFingerprint({ playbookVersionId, subject, parameters: {} });

    expect(
      candidateFingerprint({
        playbookVersionId,
        subject: { subjectKind: "branch", subjectId: "branch-2" },
        parameters: {},
      }),
    ).not.toBe(base);

    // Same id under a different kind is a different subject, not the same one.
    expect(
      candidateFingerprint({
        playbookVersionId,
        subject: { subjectKind: "channel", subjectId: "branch-1" },
        parameters: {},
      }),
    ).not.toBe(base);
  });

  it("changes when parameters change, so a re-parameterised proposal is not a repeat", () => {
    expect(
      candidateFingerprint({ playbookVersionId, subject, parameters: { budget: 10 } }),
    ).not.toBe(candidateFingerprint({ playbookVersionId, subject, parameters: { budget: 20 } }));
  });

  it("cannot be collided by moving text across the three fields", () => {
    // Without delimiting, "ab"+"c" and "a"+"bc" would digest identically.
    expect(
      candidateFingerprint({
        playbookVersionId: "ab",
        subject: { subjectKind: "branch", subjectId: "c" },
        parameters: {},
      }),
    ).not.toBe(
      candidateFingerprint({
        playbookVersionId: "a",
        subject: { subjectKind: "branch", subjectId: "bc" },
        parameters: {},
      }),
    );
  });
});
