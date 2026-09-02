import { describe, expect, it } from "vitest";

import { buildReconciliationLookup } from "@/domain/integrations/reconciliation";

const DEFINITION = {
  method: "GET" as const,
  pathTemplate: "objects/by-idempotency/{idempotency_key}",
  lookupInputs: [
    {
      key: "idempotency_key",
      source: "request" as const,
      valueReference: "request.idempotency_key",
    },
  ],
  resultIdentityField: "id",
};

describe("the lookup is built from the contract, not from guesswork", () => {
  it("substitutes captured evidence into the template", () => {
    expect(buildReconciliationLookup(DEFINITION, { "request.idempotency_key": "abc-123" })).toEqual(
      { outcome: "ready", method: "GET", path: ["objects", "by-idempotency", "abc-123"] },
    );
  });

  it("encodes a value so it cannot change which resource is asked about", () => {
    const built = buildReconciliationLookup(DEFINITION, {
      "request.idempotency_key": "a/../../b",
    });

    if (built.outcome !== "ready") throw new Error("expected a ready lookup");
    expect(built.path).toEqual(["objects", "by-idempotency", "a%2F..%2F..%2Fb"]);
  });

  it("fills every occurrence of a repeated placeholder", () => {
    const built = buildReconciliationLookup(
      { ...DEFINITION, pathTemplate: "{idempotency_key}/related/{idempotency_key}" },
      { "request.idempotency_key": "k1" },
    );

    expect(built).toMatchObject({ path: ["k1", "related", "k1"] });
  });
});

describe("a lookup that cannot be built is not sent anyway", () => {
  it("refuses when the captured evidence is missing", () => {
    // A partial path could match the wrong object, and a wrong match either
    // invents a receipt or releases a retry for something already published.
    expect(buildReconciliationLookup(DEFINITION, {})).toEqual({
      outcome: "impossible",
      reason: "missing_evidence",
      missing: ["request.idempotency_key"],
    });
  });

  it("treats an empty value as missing rather than substituting nothing", () => {
    expect(buildReconciliationLookup(DEFINITION, { "request.idempotency_key": "" })).toMatchObject({
      outcome: "impossible",
    });
  });

  it("names every missing input at once", () => {
    const built = buildReconciliationLookup(
      {
        ...DEFINITION,
        pathTemplate: "{a}/{b}",
        lookupInputs: [
          { key: "a", source: "request", valueReference: "request.a" },
          { key: "b", source: "preflight", valueReference: "preflight.b" },
        ],
      },
      {},
    );

    expect(built).toMatchObject({ missing: ["request.a", "preflight.b"] });
  });

  it("refuses a template naming a placeholder the contract never declared", () => {
    // A contract fault, not a request to send with a hole in it.
    const built = buildReconciliationLookup(
      { ...DEFINITION, pathTemplate: "objects/{idempotency_key}/{undeclared}" },
      { "request.idempotency_key": "abc" },
    );

    expect(built).toMatchObject({ outcome: "impossible", missing: ["{undeclared}"] });
  });
});
