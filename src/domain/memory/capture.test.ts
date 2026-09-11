import { describe, expect, it } from "vitest";

import {
  CAPTURE_CLAIM_BATCH_LIMIT,
  CAPTURE_DUE_SCAN_LIMIT,
  CAPTURE_LEASE_SECONDS,
  CAPTURE_MAX_ATTEMPTS,
  captureRetryDelayMs,
} from "@/domain/memory/capture";

describe("capture bounds", () => {
  it("pins the Spec 023 §5 runtime bounds", () => {
    expect(CAPTURE_LEASE_SECONDS).toBe(120);
    expect(CAPTURE_CLAIM_BATCH_LIMIT).toBe(25);
    expect(CAPTURE_DUE_SCAN_LIMIT).toBe(100);
    expect(CAPTURE_MAX_ATTEMPTS).toBe(5);
  });
});

describe("captureRetryDelayMs", () => {
  it("follows 30s, 2m, 10m, 30m then terminal", () => {
    expect(captureRetryDelayMs(1)).toBe(30_000);
    expect(captureRetryDelayMs(2)).toBe(120_000);
    expect(captureRetryDelayMs(3)).toBe(600_000);
    expect(captureRetryDelayMs(4)).toBe(1_800_000);
    expect(captureRetryDelayMs(5)).toBeNull();
    expect(captureRetryDelayMs(0)).toBeNull();
  });
});
