import { createHash } from "node:crypto";

import type { RenderableScript } from "@/domain/campaigns/poster-template";

/**
 * The value that says two renders are the same render.
 *
 * A render is a pure function of its inputs -- plate bytes, template version,
 * text values, script, font versions -- so the digest is taken over exactly
 * those and nothing else. Everything absent from this list is absent on
 * purpose: storage paths, timestamps, run ids and who asked all vary between
 * two renders that must be considered identical.
 *
 * Two things follow, and both are load-bearing.
 *
 * It is computable **before** anything is drawn, which is what lets a refused
 * render still carry one and still be idempotent. And because
 * `fontManifestDigest` is an input, a font upgrade produces a different digest
 * and therefore a new version -- the honest outcome, rather than a silent
 * substitution under an approval that was given for something else.
 *
 * The output bytes are hashed separately. Determinism is then an observation
 * anyone can check: one render digest must always yield one output hash.
 */

export type RenderInputs = {
  /** SHA-256 of the plate image the layers are composited over. */
  readonly plateContentHash: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly script: RenderableScript;
  /** Exactly the strings that will be drawn, by slot. */
  readonly textValues: Readonly<Record<string, string>>;
  /** `fontManifestDigest()` from the vendored font manifest. */
  readonly fontManifestDigest: string;
};

export function renderDigest(inputs: RenderInputs): string {
  // Key order is an accident of construction, never an operator's decision, so
  // it is sorted away. An absent slot and an empty one stay distinct: the first
  // draws nothing, the second draws an empty string, and a template may treat
  // them differently.
  const textValues = Object.entries(inputs.textValues)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([slot, value]) => [slot, value] as const);

  const canonical = JSON.stringify([
    "campaign-poster-render-v1",
    inputs.plateContentHash,
    inputs.templateKey,
    inputs.templateVersion,
    inputs.script,
    textValues,
    inputs.fontManifestDigest,
  ]);

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
