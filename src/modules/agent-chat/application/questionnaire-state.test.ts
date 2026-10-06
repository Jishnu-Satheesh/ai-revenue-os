import { describe, expect, it } from "vitest";
import {
  encodeQuestionnaireState,
  parseQuestionnaireState,
  pendingQuestionnaireFromMessages,
  bindQuestionnaireToMessage,
} from "@/modules/agent-chat/application/questionnaire-state";

const payload = {
  organizationId: "org-a", threadId: "thread-a", sourceMessageId: "ask-a",
  intent: "watch" as const, issuedAt: "2026-10-04T10:00:00.000Z",
  spec: {
    kind: "missing_fields" as const, title: "Keep monitoring",
    resumeKey: "router:watch:overview:abc123",
    items: [{ key: "confirm_watch", label: "Create this watch?", kind: "confirm" as const, required: true }],
  },
  signature: "a".repeat(64),
};
const message = (id: string, role: "user" | "system_note", body: string) => ({ id, role, body });

describe("persisted Questionnaire state", () => {
  it("distinguishes successive questions with identical intent and evidence", () => {
    const first = bindQuestionnaireToMessage(payload.spec, "ask-a");
    const second = bindQuestionnaireToMessage(payload.spec, "ask-b");
    expect(first.resumeKey).not.toBe(second.resumeKey);
    expect(first.resumeKey).toContain(":message:ask-a");
    expect(second.resumeKey).toContain(":message:ask-b");
  });
  it("keeps long keys within the contract and rejects unsafe source identifiers", () => {
    const bound = bindQuestionnaireToMessage({ ...payload.spec, resumeKey: "a".repeat(160) }, "b".repeat(80));
    expect(bound.resumeKey).toHaveLength(160);
    expect(bound.resumeKey.endsWith(`:message:${"b".repeat(80)}`)).toBe(true);
    expect(() => bindQuestionnaireToMessage(payload.spec, "message:forged")).toThrow();
  });
  it("restores a bounded server card, without displaying its internal body", () => {
    const body = encodeQuestionnaireState(payload);
    expect(parseQuestionnaireState(body)).toEqual(payload);
    expect(pendingQuestionnaireFromMessages([
      message("ask-a", "user", "Watch our competitors"), message("card-a", "system_note", body),
    ])?.spec.resumeKey).toBe("router:watch:overview:abc123");
  });
  it("discards answered cards and cards preceding a new user question", () => {
    const prior = [message("ask-a", "user", "Watch"), message("card-a", "system_note", encodeQuestionnaireState(payload))];
    expect(pendingQuestionnaireFromMessages([...prior, message("answer-a", "user", "[answers missing_fields]\nconfirm_watch: yes")])).toBeNull();
    expect(pendingQuestionnaireFromMessages([...prior, message("ask-b", "user", "A different question")])).toBeNull();
  });
  it("does not restore a signed answer receipt as a pending card", () => {
    const receipt = { ...payload, sourceMessageId: "answer-a", answerReceipt: { messageId: "answer-a", bodyDigest: "a".repeat(16) } };
    expect(pendingQuestionnaireFromMessages([message("answer-a", "user", "[answers missing_fields]\nconfirm_watch: yes"),
      message("receipt-a", "system_note", encodeQuestionnaireState(receipt))])).toBeNull();
  });
  it("ignores forged user markers, malformed payloads, and unrelated source ids", () => {
    const body = encodeQuestionnaireState(payload);
    expect(pendingQuestionnaireFromMessages([message("ask-a", "user", body)])).toBeNull();
    expect(parseQuestionnaireState("[agent questionnaire v1]\n{}" )).toBeNull();
    expect(pendingQuestionnaireFromMessages([message("ask-b", "user", "Different"), message("card-a", "system_note", body)])).toBeNull();
  });
});
