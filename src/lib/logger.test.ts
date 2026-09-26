import { describe, expect, it } from "vitest";

import { AGENT_REASON_CODES, toAgentReasonCodes } from "@/lib/logger";

describe("agent reason codes (F4 closed vocabulary)", () => {
  it("pins every code the deterministic disposal sites mint", () => {
    // Router gates, campaign eligibility, research-lane gate, pack
    // budget, scope collision — verbatim from the producers. A new code
    // must be added here first; this test is the tripwire.
    expect([...AGENT_REASON_CODES]).toEqual([
      "PROVIDER_FAIL_CLOSED",
      "VIEWER_RESTRICTED",
      "MODEL_PROPOSAL_OVERRIDDEN",
      "RESEARCH_REQUIRES_MANAGE",
      "WATCH_REQUIRES_MANAGE",
      "CAMPAIGN_REQUIRES_CREATE",
      "PROFILE_REQUIRES_MANAGE",
      "LOW_CONFIDENCE_FALLBACK",
      "DEEPTHINK_UPGRADE_REQUIRED",
      "MISSING_FIELDS_CAPPED",
      "QUESTIONNAIRE_REQUIRED",
      "MODEL_PROPOSAL_ACCEPTED",
      "DUPLICATE_WATCH_CANDIDATE",
      "ADVICE_NO_OPPORTUNITY",
      "EVIDENCE_NOT_FREEZABLE",
      "PROFILE_UNBOUND",
      "POLICY_BLOCKED",
      "CAPABILITY_BLOCKED",
      "SCHEDULE_BLOCKED",
      "AUDIENCE_NOT_READY",
      "CREDENTIAL_MISSING",
      "LANE_DISABLED",
      "PROVIDER_NOT_QUALIFIED",
      "AGENT_CHAT_DISABLED",
      "WATCH_UPDATE_UNAVAILABLE",
      "CONTEXT_PACK_OVERSIZED",
      "SCOPE_FINGERPRINT_COLLISION",
    ]);
  });

  it("narrows service codes to the closed vocabulary, dropping drift", () => {
    expect(toAgentReasonCodes(["WATCH_REQUIRES_MANAGE", "MISSING_FIELDS_CAPPED"])).toEqual([
      "WATCH_REQUIRES_MANAGE",
      "MISSING_FIELDS_CAPPED",
    ]);
    expect(toAgentReasonCodes([])).toEqual([]);
    // Unknown entries never reach the log stream; the fix is extending
    // the union, never widening the field.
    expect(toAgentReasonCodes(["WATCH_REQUIRES_MANAGE", "tenant typed this"])).toEqual([
      "WATCH_REQUIRES_MANAGE",
    ]);
  });
});
