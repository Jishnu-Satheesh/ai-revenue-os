import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { logger } from "@/lib/logger";

/**
 * How many analyses one organization may start for windows that are not
 * already computed.
 *
 * Starting a run costs a detector pass and an AI narration, and the Channel
 * Audit no longer gates that on a role -- anyone who can see the channel can
 * ask. This is the control that replaces the role gate. Cached windows do not
 * count against it, so reading is always free and unlimited.
 */
const RUNS_PER_HOUR = 30;

function limiter(): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(RUNS_PER_HOUR, "1 h"),
    prefix: "analysis:runs:v1",
  });
}

/** True when the run may start. Fails open. */
export async function consumeAnalysisRunAllowance(organizationId: string): Promise<boolean> {
  const rate = limiter();
  if (rate === null) return true;
  try {
    const { success } = await rate.limit(organizationId);
    if (!success) logger.info("channel_analysis.rate_limited", { organizationId });
    return success;
  } catch (error) {
    // An outage in the cost control must not become an outage in the product.
    logger.warn("channel_analysis.rate_limit_unavailable", {
      organizationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return true;
  }
}
