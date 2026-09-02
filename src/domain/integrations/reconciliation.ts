/**
 * Turning a contract's reconciliation lookup into an actual request.
 *
 * A write whose outcome nobody knows is the most dangerous state this platform
 * has: retrying publishes twice, and giving up loses a real post. The only way
 * out is to ask the provider what happened, and the only legitimate description
 * of how to ask is the checked-in contract — so this builds the request from
 * that description and refuses when the description does not fit the evidence.
 *
 * Nothing here decides the finding. It only produces the question.
 */

export type ReconciliationLookupDefinition = {
  method: "GET" | "POST";
  /** e.g. `objects/by-idempotency/{idempotency_key}` */
  pathTemplate: string;
  lookupInputs: readonly {
    key: string;
    source: "request" | "preflight";
    valueReference: string;
  }[];
  resultIdentityField: string;
};

/** Everything captured when the ambiguous request was made. */
export type ReconciliationEvidence = Readonly<Record<string, string>>;

export type BuiltLookup =
  | { outcome: "ready"; method: "GET" | "POST"; path: readonly string[] }
  | { outcome: "impossible"; reason: "missing_evidence"; missing: readonly string[] };

/**
 * Builds the lookup, or says why it cannot be built.
 *
 * Missing evidence is `impossible`, never a best-effort request with a hole in
 * the path. A lookup built from partial evidence could match the wrong object,
 * and a wrong match here either invents a receipt or releases a retry for
 * something that already published.
 */
export function buildReconciliationLookup(
  definition: ReconciliationLookupDefinition,
  evidence: ReconciliationEvidence,
): BuiltLookup {
  const missing = definition.lookupInputs
    .filter((lookupInput) => {
      const value = evidence[lookupInput.valueReference];
      return typeof value !== "string" || value.length === 0;
    })
    .map((lookupInput) => lookupInput.valueReference);

  if (missing.length > 0) {
    return { outcome: "impossible", reason: "missing_evidence", missing };
  }

  let path = definition.pathTemplate;
  for (const lookupInput of definition.lookupInputs) {
    const value = evidence[lookupInput.valueReference] as string;
    // Encoded per segment. An identifier carrying a slash would otherwise
    // silently change which resource is being asked about.
    path = path.split(`{${lookupInput.key}}`).join(encodeURIComponent(value));
  }

  // Any placeholder left over means the template names something the contract
  // did not declare as an input, which is a contract fault rather than a
  // request to send anyway.
  if (/\{[^}]+\}/.test(path)) {
    return {
      outcome: "impossible",
      reason: "missing_evidence",
      missing: [...(path.match(/\{[^}]+\}/g) ?? [])],
    };
  }

  return {
    outcome: "ready",
    method: definition.method,
    path: path.split("/").filter((segment) => segment.length > 0),
  };
}
