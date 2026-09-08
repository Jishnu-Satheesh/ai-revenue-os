import "server-only";

import { Redis } from "@upstash/redis";

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
 * Nothing sensitive is logged -- the key names an organization and a run, and
 * only `error.name` travels.
 */
function client(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = client();
  if (redis === null) return null;
  try {
    return ((await redis.get(key)) as T | null) ?? null;
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
