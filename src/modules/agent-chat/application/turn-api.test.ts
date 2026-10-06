import { describe, expect, it, vi } from "vitest";

import { classifyGovernedTurn, turnStartBodySchema } from "./turn-api";

const input = {
  question: "How can we improve in a month?",
  page: "/agent",
  contextDigest: "digest",
  role: "viewer" as const,
};
const model = (intent = "business_advice", confidence = "high") => ({
  modelProvider: "test",
  modelName: "test",
  modelVersion: "test",
  propose: vi.fn(async () => ({ intent, confidence, missing: [] })),
});

describe("governed turn admission", () => {
  it("admits a clear performance question for a known tenant channel during router outages", async () => {
    const down = model();
    down.propose.mockRejectedValue(new Error("provider unavailable"));
    expect(
      await classifyGovernedTurn(
        {
          ...input,
          question: "How was Talabat doing during 2026-08-01 to 2026-08-31?",
          knownChannelLabels: ["talabat"],
        },
        down as never,
      ),
    ).toBe("channel_assessment");
    expect(down.propose).not.toHaveBeenCalled();
    expect(
      await classifyGovernedTurn(
        {
          ...input,
          question: "How was a different business doing?",
          knownChannelLabels: ["talabat"],
        },
        down as never,
      ),
    ).toBeNull();
  });
  it("rejects a browser supplied objective", () => {
    expect(
      turnStartBodySchema.safeParse({
        messageId: "11111111-1111-4111-8111-111111111111",
        idempotencyKey: "1234567890123456",
        objective: "report_intake",
      }).success,
    ).toBe(false);
  });
  it("allows viewer business advice from the stored question", async () => {
    const classifier = model();
    expect(await classifyGovernedTurn(input, classifier as never)).toBe("business_advice");
    expect(classifier.propose).toHaveBeenCalledWith(
      expect.objectContaining({ text: input.question }),
    );
  });
  it("allows a viewer to assess existing channel evidence", async () => {
    expect(await classifyGovernedTurn(input, model("channel_assessment") as never)).toBe(
      "channel_assessment",
    );
  });
  it("refuses attachment intake before classification for a viewer", async () => {
    const classifier = model();
    await expect(
      classifyGovernedTurn({ ...input, hasAttachment: true }, classifier as never),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(classifier.propose).not.toHaveBeenCalled();
  });
  it("takes an authorized attachment into report intake without interpreting file contents", async () => {
    const classifier = model();
    expect(
      await classifyGovernedTurn(
        { ...input, role: "operator", hasAttachment: true },
        classifier as never,
      ),
    ).toBe("report_intake");
    expect(classifier.propose).not.toHaveBeenCalled();
  });
  it("leaves research and ambiguous proposals on the established path", async () => {
    expect(await classifyGovernedTurn(input, model("research_once") as never)).toBe(null);
    expect(await classifyGovernedTurn(input, model("business_advice", "low") as never)).toBe(null);
    const down = model();
    down.propose.mockRejectedValue(new Error("provider unavailable"));
    expect(await classifyGovernedTurn(input, down as never)).toBe(null);
  });
  it("admits the reported one-month advice question while the provider is unavailable", async () => {
    const down = model();
    down.propose.mockRejectedValue(new Error("provider unavailable"));
    expect(
      await classifyGovernedTurn(
        { ...input, question: "How to improve the business within 1 month?" },
        down as never,
      ),
    ).toBe("business_advice");
    expect(down.propose).not.toHaveBeenCalled();
  });
});
