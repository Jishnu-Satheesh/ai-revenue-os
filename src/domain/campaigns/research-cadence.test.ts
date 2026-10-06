import { describe, expect, it } from "vitest";

import {
  isQualifyingChange,
  isScheduleDue,
  researchScheduleInputSchema,
  scheduledEvidenceFingerprint,
  scheduledIdempotencyKey,
  scheduleWindowStart,
  type ResearchSchedule,
} from "@/domain/campaigns/research-cadence";

function schedule(overrides: Partial<ResearchSchedule> = {}): ResearchSchedule {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    enabled: true,
    intervalDays: 7,
    qualifyingChangeKinds: ["memory_revision"],
    lastEvaluatedAt: null,
    ...overrides,
  };
}

describe("the research schedule an organization configures", () => {
  it("refuses an enabled schedule that names nothing as warranting research", () => {
    const parsed = researchScheduleInputSchema.safeParse({
      enabled: true,
      intervalDays: 7,
      qualifyingChangeKinds: [],
    });

    // Switching research on without saying what warrants it would admit runs
    // nobody asked for. The kinds are the ask.
    expect(parsed.success).toBe(false);
  });

  it("refuses a duplicated qualifying kind and an interval outside 1..30 days", () => {
    expect(
      researchScheduleInputSchema.safeParse({
        enabled: true,
        intervalDays: 7,
        qualifyingChangeKinds: ["memory_revision", "memory_revision"],
      }).success,
    ).toBe(false);
    expect(
      researchScheduleInputSchema.safeParse({
        enabled: true,
        intervalDays: 0,
        qualifyingChangeKinds: ["scheduled_cadence"],
      }).success,
    ).toBe(false);
    expect(
      researchScheduleInputSchema.safeParse({
        enabled: false,
        intervalDays: 31,
        qualifyingChangeKinds: ["scheduled_cadence"],
      }).success,
    ).toBe(false);
  });

  it("accepts a disabled schedule that still names its kinds", () => {
    // Pausing keeps the configuration so resuming restores it; the kinds stay
    // so the pause cannot silently become a different schedule on resume.
    const parsed = researchScheduleInputSchema.safeParse({
      enabled: false,
      intervalDays: 7,
      qualifyingChangeKinds: ["memory_revision"],
    });

    expect(parsed.success).toBe(true);
  });
});

describe("whether the scheduler should evaluate now", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");

  it("finds no work without a schedule, a disabled schedule, or a disabled policy", () => {
    expect(isScheduleDue({ schedule: null, policyEnabled: true, now })).toBe(false);
    expect(
      isScheduleDue({ schedule: schedule({ enabled: false }), policyEnabled: true, now }),
    ).toBe(false);
    // Org A on, org B off: B's tick finds no work even with a schedule row.
    expect(isScheduleDue({ schedule: schedule(), policyEnabled: false, now })).toBe(false);
  });

  it("is due when never evaluated, and again once the interval has passed", () => {
    expect(isScheduleDue({ schedule: schedule(), policyEnabled: true, now })).toBe(true);
    expect(
      isScheduleDue({
        schedule: schedule({ lastEvaluatedAt: "2026-09-10T12:00:00.000Z" }),
        policyEnabled: true,
        now,
      }),
    ).toBe(true);
  });

  it("is not due inside the interval, even by a second", () => {
    expect(
      isScheduleDue({
        schedule: schedule({ lastEvaluatedAt: "2026-09-10T12:00:01.000Z" }),
        policyEnabled: true,
        now,
      }),
    ).toBe(false);
  });
});

describe("the schedule window a tick falls in", () => {
  it("buckets by calendar day in the organization's timezone", () => {
    // 2026-09-17T01:30Z is still Sep 16 in New York and already Sep 17 in
    // Dubai. The same instant lands in different local days, so with a daily
    // interval the windows differ — the schedule follows the organization's
    // midnight, not UTC's.
    const instant = new Date("2026-09-17T01:30:00.000Z");
    const newYork = scheduleWindowStart({
      now: instant,
      timezone: "America/New_York",
      intervalDays: 1,
    });
    const dubai = scheduleWindowStart({ now: instant, timezone: "Asia/Dubai", intervalDays: 1 });

    expect(newYork).toBe("2026-09-16T00:00:00.000Z");
    expect(dubai).toBe("2026-09-17T00:00:00.000Z");
  });

  it("holds one window across the spring-forward DST boundary", () => {
    // America/New_York springs forward on 2026-03-08: the day is 23 hours
    // long. A daily schedule must still produce one window for that date, not
    // zero and not two — the bucket is the calendar day, never a 24h period.
    const before = scheduleWindowStart({
      now: new Date("2026-03-08T06:30:00.000Z"),
      timezone: "America/New_York",
      intervalDays: 1,
    });
    const after = scheduleWindowStart({
      now: new Date("2026-03-08T08:30:00.000Z"),
      timezone: "America/New_York",
      intervalDays: 1,
    });

    expect(before).toBe("2026-03-08T00:00:00.000Z");
    expect(after).toBe("2026-03-08T00:00:00.000Z");
  });

  it("holds one window across the fall-back DST boundary", () => {
    // 2026-11-01 is 25 hours long in New York. Same rule: the calendar day is
    // the bucket, so the repeated hour cannot open a second window.
    const first = scheduleWindowStart({
      now: new Date("2026-11-01T04:30:00.000Z"),
      timezone: "America/New_York",
      intervalDays: 1,
    });
    const second = scheduleWindowStart({
      now: new Date("2026-11-01T06:30:00.000Z"),
      timezone: "America/New_York",
      intervalDays: 1,
    });

    expect(first).toBe("2026-11-01T00:00:00.000Z");
    expect(second).toBe("2026-11-01T00:00:00.000Z");
  });

  it("advances one window per interval, so a missed sweep never floods catch-up", () => {
    // Three missed daily ticks later the current instant is in exactly one
    // window. The scheduler claims the current window only — the missed ones
    // stay missed rather than admitting three runs at once.
    const missed = new Date("2026-09-14T12:00:00.000Z");
    const now = new Date("2026-09-17T12:00:00.000Z");
    const missedWindow = scheduleWindowStart({
      now: missed,
      timezone: "Asia/Dubai",
      intervalDays: 1,
    });
    const currentWindow = scheduleWindowStart({
      now,
      timezone: "Asia/Dubai",
      intervalDays: 1,
    });

    expect(missedWindow).toBe("2026-09-14T00:00:00.000Z");
    expect(currentWindow).toBe("2026-09-17T00:00:00.000Z");
    expect(missedWindow).not.toBe(currentWindow);
  });
});

describe("what a scheduled evaluation is judged by", () => {
  it("fingerprints memory by digest, and the absence of memory stably", () => {
    expect(scheduledEvidenceFingerprint({ manifestDigest: "a".repeat(64) })).toBe(
      `memory:${"a".repeat(64)}`,
    );
    // Stable across ticks: the second no-memory evaluation recognizes the
    // signal as seen rather than treating "still nothing" as news.
    expect(scheduledEvidenceFingerprint({ manifestDigest: null })).toBe("no-memory");
  });

  it("admits on cadence when named, and only on moved memory otherwise", () => {
    expect(
      isQualifyingChange({ kinds: ["scheduled_cadence"], memoryChanged: false }),
    ).toBe(true);
    expect(isQualifyingChange({ kinds: ["memory_revision"], memoryChanged: true })).toBe(true);
    // A repeated capture of the same root revision leaves the digest where it
    // was: no change, no run, but the evaluation is still recorded.
    expect(isQualifyingChange({ kinds: ["memory_revision"], memoryChanged: false })).toBe(false);
  });

  it("keys idempotency by evidence, not by window", () => {
    const org = "11111111-1111-4111-8111-111111111111";
    const first = scheduledIdempotencyKey({
      organizationId: org,
      evidenceFingerprint: "memory:abc",
      candidateRevision: "rev-1",
    });
    const retry = scheduledIdempotencyKey({
      organizationId: org,
      evidenceFingerprint: "memory:abc",
      candidateRevision: "rev-1",
    });
    const newRevision = scheduledIdempotencyKey({
      organizationId: org,
      evidenceFingerprint: "memory:def",
      candidateRevision: "rev-2",
    });

    // A retry, a lease recovery and a repeated delivery all name the same key,
    // so each replays the admitted run. A material new revision is a new key,
    // so it may admit exactly one run of its own.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(retry).toBe(first);
    expect(newRevision).not.toBe(first);
  });
});
