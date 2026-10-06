import { describe, expect, it } from "vitest";

import { detectScriptMismatch, scriptsPresentIn } from "@/domain/campaigns/script-detection";

describe("which scripts a string uses", () => {
  it("names Malayalam in Malayalam copy", () => {
    expect([...scriptsPresentIn("ഞങ്ങളുടെ നെയ്മീൻ കറി")]).toEqual(["Mlym"]);
  });

  it("names Arabic in Arabic copy", () => {
    expect([...scriptsPresentIn("تذوق النكهات الغنية")]).toEqual(["Arab"]);
  });

  it("names Latin in English copy", () => {
    expect([...scriptsPresentIn("Feed the whole family")]).toEqual(["Latn"]);
  });

  it("reports both when a string genuinely mixes them", () => {
    const found = scriptsPresentIn("Order the ഞങ്ങളുടെ special");
    expect(found.has("Latn")).toBe(true);
    expect(found.has("Mlym")).toBe(true);
  });
});

describe("characters that belong to no script are not guessed at", () => {
  it("does not call digits, spaces or punctuation Latin", () => {
    // "Open until 11pm" would be Latin; "11 — 23:00" claims nothing at all.
    expect([...scriptsPresentIn("11 — 23:00 · 5")]).toEqual([]);
  });

  it("ignores the joiners that hold Malayalam and Arabic together", () => {
    // A zero-width joiner forms a chillu. Counting it as an unknown script
    // would make correct Malayalam look mixed.
    expect([...scriptsPresentIn("ന‍")]).toEqual(["Mlym"]);
  });
});

describe("the mismatch warning", () => {
  it("fires when Malayalam copy would be drawn with the Latin face", () => {
    const mismatch = detectScriptMismatch("ഞങ്ങളുടെ നെയ്മീൻ കറി", "Latn");

    expect(mismatch).not.toBeNull();
    expect(mismatch!.selected).toBe("Latn");
    expect(mismatch!.unexpected).toEqual(["Mlym"]);
  });

  it("stays silent when the face matches the text", () => {
    expect(detectScriptMismatch("ഞങ്ങളുടെ നെയ്മീൻ", "Mlym")).toBeNull();
    expect(detectScriptMismatch("Feed the whole family", "Latn")).toBeNull();
  });

  it("stays silent on text it knows nothing about, rather than claiming a pass", () => {
    // Null means "no mismatch found", never "this will render". Coverage is a
    // cmap question and is answered by glyph-coverage.ts with a real font.
    expect(detectScriptMismatch("12:00", "Latn")).toBeNull();
    expect(detectScriptMismatch("漢字", "Latn")).toBeNull();
  });
});
