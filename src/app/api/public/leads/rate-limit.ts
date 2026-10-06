import "server-only";

import { createHmac } from "node:crypto";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { logger } from "@/lib/logger";

/**
 * What one signup may cost the public endpoint: five submissions per email
 * address per hour, twenty per IP per hour. A genuine visitor never notices;
 * a script listing addresses does. Both buckets fail closed — an anonymous
 * form with no limiter is a free bulk-insert API, and a 503 during a Redis
 * outage is honest where silent ingestion is not. Do not reuse the fail-open
 * analysis limiter here.
 */
const EMAIL_SUBMISSIONS_PER_HOUR = 5;
const IP_SUBMISSIONS_PER_HOUR = 20;

export type LeadAllowance =
  | { allowed: true }
  | { allowed: false; reason: "limited" | "unavailable" };

/** The HMAC is the only form an email address takes inside Redis. */
export function hashLeadEmail(email: string, key: string): string {
  return createHmac("sha256", key).update(email).digest("hex");
}

export async function consumeLeadAllowances(input: {
  ip: string;
  email: string;
}): Promise<LeadAllowance> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const hashKey = process.env.LEADS_EMAIL_HASH_KEY;
  if (!url || !token || !hashKey) return { allowed: false, reason: "unavailable" };

  try {
    const redis = new Redis({ url, token });
    const byEmail = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(EMAIL_SUBMISSIONS_PER_HOUR, "1 h"),
      prefix: "leads:email:v1",
    });
    const byIp = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(IP_SUBMISSIONS_PER_HOUR, "1 h"),
      prefix: "leads:ip:v1",
    });

    const [emailResult, ipResult] = await Promise.all([
      byEmail.limit(hashLeadEmail(input.email, hashKey)),
      byIp.limit(input.ip),
    ]);

    if (!emailResult.success || !ipResult.success) {
      logger.info("public_leads.rate_limited");
      return { allowed: false, reason: "limited" };
    }

    return { allowed: true };
  } catch (error) {
    logger.warn("public_leads.rate_limit_unavailable", {
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return { allowed: false, reason: "unavailable" };
  }
}
