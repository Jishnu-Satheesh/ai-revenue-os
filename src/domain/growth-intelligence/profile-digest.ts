import { createHash } from "node:crypto";

import {
  compareCanonicalText,
  marketProfileDocumentSchema,
} from "@/domain/growth-intelligence/schemas";
import type { MarketProfileDocument } from "@/domain/growth-intelligence/types";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareCanonicalText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Binds decisions and recurring research to one exact approved profile document.
 * The schema version routes each document to its frozen validator, so version-one
 * bytes keep their exact digest.
 */
export function createMarketProfileDigest(document: MarketProfileDocument): string {
  const normalized = marketProfileDocumentSchema.parse(document);
  return createHash("sha256").update(canonicalize(normalized), "utf8").digest("hex");
}
