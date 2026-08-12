import { createHash } from "node:crypto";

import { DecisionError } from "@/domain/decisions/errors";

/**
 * Subject kinds are registered vocabulary, never free text. The core registers
 * these three; Industry Packs register their own through `public.subject_kinds`
 * and the core never learns them. See `specs/005` section 5.2.
 */
export type CoreSubjectKind = "organization" | "branch" | "channel";

export type SubjectRef = {
  subjectKind: CoreSubjectKind | (string & {});
  subjectId: string;
};

export type CandidateParameters = Readonly<Record<string, unknown>>;

/**
 * Canonical JSON in the RFC 8785 spirit: object keys sorted, arrays left alone
 * because their order carries meaning, and anything that cannot be represented
 * exactly rejected rather than coerced.
 *
 * A digest that silently accepted a Date or a NaN would be stable only by
 * accident, and candidate identity is the key for suppression, deduplication,
 * and outcome joins.
 */
function canonicalise(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new DecisionError(
          "DECISION_PARAMETER_NOT_CANONICAL",
          `Parameter at ${path} is not a finite number.`,
        );
      }
      return JSON.stringify(value);
    }
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((entry, index) => canonicalise(entry, `${path}[${index}]`)).join(",")}]`;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new DecisionError(
          "DECISION_PARAMETER_NOT_CANONICAL",
          `Parameter at ${path} is not a plain value.`,
        );
      }
      const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      return `{${entries
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalise(entry, `${path}.${key}`)}`)
        .join(",")}}`;
    }
    default:
      throw new DecisionError(
        "DECISION_PARAMETER_NOT_CANONICAL",
        `Parameter at ${path} has an unsupported type.`,
      );
  }
}

export function parameterDigest(parameters: CandidateParameters): string {
  return createHash("sha256").update(canonicalise(parameters, "$"), "utf8").digest("hex");
}

export type CandidateIdentity = {
  playbookVersionId: string;
  subject: SubjectRef;
  parameters: CandidateParameters;
};

/**
 * `digest(playbook_version_id, subject_ref, parameter_digest)`.
 *
 * Fields are length-prefixed rather than concatenated, so no arrangement of
 * text can make two different candidates share a fingerprint.
 */
export function candidateFingerprint(identity: CandidateIdentity): string {
  const parts = [
    identity.playbookVersionId,
    identity.subject.subjectKind,
    identity.subject.subjectId,
    parameterDigest(identity.parameters),
  ];

  return createHash("sha256")
    .update(parts.map((part) => `${part.length}:${part}`).join("|"), "utf8")
    .digest("hex");
}
