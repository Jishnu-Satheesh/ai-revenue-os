import { describe, expect, it, vi } from "vitest";

import {
  readBrandIdentity,
  saveBrandGuidelines,
  saveBrandLogo,
  type BrandIdentityPorts,
} from "@/modules/brand/application/brand-identity-service";

const selection = {
  variant: "primary" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000001",
};

const emptyGuidelines = { palette: {}, rules: [], restrictedTerms: [] };

function ports(overrides: Partial<BrandIdentityPorts> = {}): BrandIdentityPorts {
  return {
    readGuidelines: vi.fn(async () => emptyGuidelines),
    writeGuidelines: vi.fn(async () => {}),
    readLogos: vi.fn(async () => []),
    setLogo: vi.fn(async () => {}),
    isVersionUsable: vi.fn(async () => true),
    ...overrides,
  };
}

describe("saveBrandLogo", () => {
  it("sets a logo that points at a usable image", async () => {
    const port = ports();

    await saveBrandLogo(selection, port);

    expect(port.setLogo).toHaveBeenCalledWith(selection);
  });

  it("refuses a logo pointing at an image that is not usable yet", async () => {
    // An unusable version is one whose bytes the server has not decoded,
    // re-encoded and hashed. Pointing the brand mark at it would put bytes
    // nobody validated in front of every viewer and into every generation.
    const port = ports({ isVersionUsable: vi.fn(async () => false) });

    await expect(saveBrandLogo(selection, port)).rejects.toThrow(/not available/i);
    expect(port.setLogo).not.toHaveBeenCalled();
  });

  it("checks usability before writing, not after", async () => {
    const order: string[] = [];
    const port = ports({
      isVersionUsable: vi.fn(async () => {
        order.push("check");
        return true;
      }),
      setLogo: vi.fn(async () => {
        order.push("write");
      }),
    });

    await saveBrandLogo(selection, port);

    expect(order).toEqual(["check", "write"]);
  });
});

describe("saveBrandGuidelines", () => {
  it("writes exactly what it was given", async () => {
    const port = ports();
    const guidelines = {
      palette: { primary: "#c8102e" },
      rules: [{ text: "Never imply a medical benefit", strength: "hard" as const }],
      restrictedTerms: ["best in dubai"],
    };

    await saveBrandGuidelines(guidelines, port);

    expect(port.writeGuidelines).toHaveBeenCalledWith(guidelines);
  });
});

describe("readBrandIdentity", () => {
  it("returns the guidelines and the logos together", async () => {
    const port = ports({ readLogos: vi.fn(async () => [selection]) });

    // One read, because the panel shows both and two round trips would let it
    // render a logo from one moment beside rules from another.
    expect(await readBrandIdentity(port)).toEqual({
      guidelines: emptyGuidelines,
      logos: [selection],
    });
  });
});
