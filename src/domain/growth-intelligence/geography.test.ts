import { describe, expect, it } from "vitest";

import { evaluateGeographicCompatibility } from "@/domain/growth-intelligence/geography";

const tradeArea = {
  layer: "trade_area" as const,
  locationRef: "ae:du:dubai-marina",
  parentLocationRefs: ["ae:du", "ae"],
};
const city = {
  layer: "city" as const,
  locationRef: "ae:du",
  parentLocationRefs: ["ae"],
};
const country = {
  layer: "country" as const,
  locationRef: "ae",
  parentLocationRefs: [],
};

describe("evaluateGeographicCompatibility", () => {
  it("accepts evidence from the exact confirmed geography", () => {
    expect(
      evaluateGeographicCompatibility({ businessGeography: city, evidenceGeography: city }),
    ).toEqual({ compatible: true, relation: "exact", limitationCode: null });
  });

  it("accepts city evidence for a trade area only with a broader-market limitation", () => {
    expect(
      evaluateGeographicCompatibility({ businessGeography: tradeArea, evidenceGeography: city }),
    ).toEqual({
      compatible: true,
      relation: "broader_with_limitation",
      limitationCode: "BROADER_MARKET_INFERENCE",
    });
  });

  it("accepts country evidence for a trade area only with a broader-market limitation", () => {
    expect(
      evaluateGeographicCompatibility({ businessGeography: tradeArea, evidenceGeography: country }),
    ).toEqual({
      compatible: true,
      relation: "broader_with_limitation",
      limitationCode: "BROADER_MARKET_INFERENCE",
    });
  });

  it("refuses narrower evidence as proof of a broader business geography", () => {
    expect(
      evaluateGeographicCompatibility({ businessGeography: city, evidenceGeography: tradeArea }),
    ).toEqual({
      compatible: false,
      relation: "narrower_not_generalizable",
      limitationCode: "NARROWER_EVIDENCE_CANNOT_PROVE_BROADER_SCOPE",
    });
  });

  it("refuses a different city even when both cities share a country", () => {
    const abuDhabi = {
      layer: "city" as const,
      locationRef: "ae:az",
      parentLocationRefs: ["ae"],
    };

    expect(
      evaluateGeographicCompatibility({ businessGeography: city, evidenceGeography: abuDhabi }),
    ).toEqual({
      compatible: false,
      relation: "unrelated",
      limitationCode: "GEOGRAPHY_NOT_RELEVANT",
    });
  });

  it("refuses one trade area as evidence for a sibling trade area", () => {
    const siblingTradeArea = {
      layer: "trade_area" as const,
      locationRef: "ae:du:jumeirah",
      parentLocationRefs: ["ae:du", "ae"],
    };

    expect(
      evaluateGeographicCompatibility({
        businessGeography: tradeArea,
        evidenceGeography: siblingTradeArea,
      }).relation,
    ).toBe("unrelated");
  });

  it("rejects a geography that lists itself as a parent", () => {
    expect(() =>
      evaluateGeographicCompatibility({
        businessGeography: { ...city, parentLocationRefs: ["ae:du", "ae"] },
        evidenceGeography: country,
      }),
    ).toThrow(/parent/i);
  });
});
