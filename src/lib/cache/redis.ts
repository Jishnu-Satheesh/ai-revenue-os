import "server-only";

import { Redis } from "@upstash/redis";
import type { ZodType } from "zod";

import { logger } from "@/lib/logger";

/**
 * A cache that cannot break the page.
 *
 * Every read reports a failure as a miss and every write swallows one, so a
 * caller never has to decide what an outage means: it means the database
 * answers instead, which is what it did before this module existed. That
 * property belongs here rather than at each call site, because a single caller
 * forgetting it turns a cache outage into an outage.
 *
 * A hit is validated against the caller's schema before it is trusted, because
 * the installed Upstash client swallows its own `JSON.parse` failures and
 * hands back the raw stored value instead of throwing -- a corrupt entry, or
 * one written by a deploy whose payload shape has since changed, would
 * otherwise reach the caller looking like an ordinary hit. Validating turns
 * that into a miss too, which the database can still answer.
 *
 * Nothing sensitive is logged -- neither the key nor any cached payload is
 * ever written to the log, only a bounded `errorCode`.
 */
function client(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function cacheGet<T>(key: string, schema: ZodType<T>): Promise<T | null> {
  const redis = client();
  if (redis === null) return null;
  try {
    const raw = await redis.get(key);
    if (raw === null || raw === undefined) return null;
    // A hit is not the same as a usable hit. The Upstash client returns the raw
    // value when its own JSON.parse fails, so a corrupt entry -- or one written
    // by a deploy whose payload shape has since changed -- arrives here looking
    // like a normal hit. Validating turns that into a miss, and a miss is a
    // question the database can still answer.
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("analysis_cache.payload_rejected", {
        errorCode: "SCHEMA_MISMATCH",
      });
      return null;
    }
    return parsed.data;
  } catch (error) {
    logger.warn("analysis_cache.read_failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = client();
  if (redis === null) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    logger.warn("analysis_cache.write_failed", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
  }
}
