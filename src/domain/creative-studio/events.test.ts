import { describe, expect, it } from "vitest";

import {
  STUDIO_PERSISTED_RUN_STATES,
  StudioRunTransitionError,
  isTerminalRunState,
  toSafeFailure,
  transitionRunState,
  type StudioRunEvent,
  type StudioRunState,
} from "@/domain/creative-studio/events";

function transitionReason(from: StudioRunState, event: StudioRunEvent): string | null {
  try {
    transitionRunState(from, event);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioRunTransitionError);
    return (error as StudioRunTransitionError).from;
  }
  return null;
}

describe("run stage transitions", () => {
  it("walks the happy path from admission to a saved final", () => {
    expect(transitionRunState(null, "studio.run.accepted")).toBe("queued");
    expect(transitionRunState("queued", "studio.run.references_prepared")).toBe("preparing");
    expect(transitionRunState("preparing", "studio.run.generation_started")).toBe("generating");
    expect(transitionRunState("generating", "studio.run.preview_available")).toBe("previewing");
    expect(transitionRunState("previewing", "studio.run.preview_available")).toBe("previewing");
    expect(transitionRunState("previewing", "studio.run.output_validated")).toBe("validating");
    expect(transitionRunState("validating", "studio.run.completed")).toBe("ready");
  });

  it("saves a valid final even when no partial preview ever arrived", () => {
    expect(transitionRunState("generating", "studio.run.output_validated")).toBe("validating");
  });

  it("completes the no-preview run end to end: generating straight through to ready", () => {
    // No missing-preview record exists at this layer (worker/DB concern per
    // contract §5); the run simply completes honestly without ever previewing.
    expect(transitionRunState("generating", "studio.run.output_validated")).toBe("validating");
    expect(transitionRunState("validating", "studio.run.completed")).toBe("ready");
  });

  it("requests cancellation without pretending the outcome is settled", () => {
    expect(transitionRunState("generating", "studio.run.cancel_requested")).toBe(
      "cancel_requested",
    );
    expect(transitionRunState("cancel_requested", "studio.run.cancelled")).toBe("cancelled");
  });

  it("lets the worker confirm the real outcome after a cancel request", () => {
    expect(transitionRunState("cancel_requested", "studio.run.completed")).toBe("ready");
    expect(transitionRunState("cancel_requested", "studio.run.failed")).toBe("failed");
  });

  it("parks an uncertain paid outcome instead of retrying blindly", () => {
    expect(transitionRunState("generating", "studio.run.outcome_unknown")).toBe("outcome_unknown");
  });

  it("lands a retrieved provider result through recovery completion", () => {
    expect(transitionRunState("outcome_unknown", "studio.run.completed")).toBe("ready");
  });

  it("refuses to resurrect a terminal run", () => {
    for (const terminal of ["ready", "failed", "cancelled", "outcome_unknown"] as const) {
      expect(transitionReason(terminal, "studio.run.generation_started")).toBe(terminal);
    }
  });

  it("refuses to skip stages: no preparing straight to ready", () => {
    expect(() => transitionRunState("preparing", "studio.run.completed")).toThrow();
  });

  it("keeps campaign link events on a ready run without moving its state", () => {
    expect(transitionRunState("ready", "studio.campaign_link_created")).toBe("ready");
    expect(transitionRunState("ready", "studio.campaign_link_blocked")).toBe("ready");
    expect(transitionRunState("ready", "studio.campaign_link_resolved")).toBe("ready");
  });

  it("knows its terminal states", () => {
    expect(STUDIO_PERSISTED_RUN_STATES).toContain("ready");
    expect(isTerminalRunState("ready")).toBe(true);
    expect(isTerminalRunState("failed")).toBe(true);
    expect(isTerminalRunState("cancelled")).toBe(true);
    expect(isTerminalRunState("outcome_unknown")).toBe(true);
    expect(isTerminalRunState("generating")).toBe(false);
    expect(isTerminalRunState("cancel_requested")).toBe(false);
  });
});

describe("safe failures", () => {
  it("exposes only a code and a static message: never prompt, bytes or URLs", () => {
    const failure = toSafeFailure("provider_refused");

    expect(Object.keys(failure).sort()).toEqual(["code", "message"]);
    expect(failure.code).toBe("provider_refused");
    expect(typeof failure.message).toBe("string");
  });

  it("covers the visible failure surface the contract requires", () => {
    for (const code of [
      "policy_refused",
      "reference_revoked",
      "unsupported_ratio",
      "context_expired",
      "cancelled",
    ] as const) {
      expect(toSafeFailure(code).code).toBe(code);
    }
  });
});
