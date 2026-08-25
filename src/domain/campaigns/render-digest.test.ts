import { describe, expect, it } from "vitest";

import { renderDigest, type RenderInputs } from "@/domain/campaigns/render-digest";

function inputs(overrides: Partial<RenderInputs> = {}): RenderInputs {
  return {
    plateContentHash: "a".repeat(64),
    templateKey: "kerala_feed",
    templateVersion: 1,
    script: "Mlym",
    textValues: { caption: "കേരള മീൻ കറി", footer: "വിളിക്കൂ" },
    fontManifestDigest: "f".repeat(64),
    ...overrides,
  };
}

describe("renderDigest", () => {
  it("is a sha-256 hex string", () => {
    expect(renderDigest(inputs())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls, which is what reproducibility rests on", () => {
    expect(renderDigest(inputs())).toBe(renderDigest(inputs()));
  });

  /**
   * Key order is an accident of how an object was built, never a decision an
   * operator made. If it changed the digest, the same poster would look like a
   * different one and re-rendering would stop being idempotent.
   */
  it("ignores the order keys were written in", () => {
    const forwards = renderDigest(inputs({ textValues: { caption: "A", footer: "B" } }));
    const backwards = renderDigest(inputs({ textValues: { footer: "B", caption: "A" } }));

    expect(forwards).toBe(backwards);
  });

  it.each([
    ["a different plate", { plateContentHash: "b".repeat(64) }],
    ["a different template", { templateKey: "kerala_story" }],
    ["a new template version", { templateVersion: 2 }],
    ["a different script", { script: "Latn" as const }],
    ["different words", { textValues: { caption: "Something else" } }],
    ["an upgraded font", { fontManifestDigest: "e".repeat(64) }],
  ])("changes when %s is used", (_name, override) => {
    expect(renderDigest(inputs(override))).not.toBe(renderDigest(inputs()));
  });

  /**
   * A font upgrade changes what publishes, so it must produce a new version
   * rather than a silent substitution under an approval given for something
   * else. This is the assertion that makes the font a pinned input rather than
   * an ambient fact about the machine.
   */
  it("treats a font upgrade as a change to what publishes", () => {
    const before = renderDigest(inputs());
    const after = renderDigest(inputs({ fontManifestDigest: "1".repeat(64) }));

    expect(after).not.toBe(before);
  });

  it("distinguishes an absent slot from an empty one", () => {
    const absent = renderDigest(inputs({ textValues: { caption: "A" } }));
    const empty = renderDigest(inputs({ textValues: { caption: "A", footer: "" } }));

    expect(absent).not.toBe(empty);
  });

  /**
   * Malayalam can be written as precomposed characters or as a base plus a
   * combining sign. They look identical and are not the same bytes, so a digest
   * that ignored the difference would call two different renders the same one.
   */
  it("distinguishes text that differs only in its codepoints", () => {
    const precomposed = renderDigest(inputs({ textValues: { caption: "ൊ" } }));
    const decomposed = renderDigest(inputs({ textValues: { caption: "ൊ" } }));

    expect(precomposed).not.toBe(decomposed);
  });
});
