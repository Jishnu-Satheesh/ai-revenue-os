import { createHash } from "node:crypto";

import { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";
import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Binds decisions and recurring research to one exact approved profile document. */
export function createMarketProfileDigest(document: MarketProfileDocumentV1): string {
  const normalized = marketProfileDocumentV1Schema.parse(document);
  return createHash("sha256").update(canonicalize(normalized), "utf8").digest("hex");
}
