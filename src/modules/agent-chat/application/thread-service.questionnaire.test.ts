import { signQuestionnaire, verifyQuestionnaire } from "@/modules/agent-chat/infrastructure/questionnaire-signature";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createThreadService as createUnwiredThreadService } from "@/modules/agent-chat/application/thread-service";
import type { ThreadMessageView, ThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { bindQuestionnaireToMessage, encodeQuestionnaireState, parseQuestionnaireState } from "./questionnaire-state";

afterEach(() => vi.unstubAllEnvs());
function harness() {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-test-secret");
  const messages: ThreadMessageView[] = [{
    id: "ask-a", threadId: "thread-a", role: "user", body: "Watch our competitors",
    createdAt: new Date().toISOString(), questionnaireAnswers: null, markerReceipts: null, citations: null,
  }];
  const keys = new Map<string, string>();
  const thread = { id: "thread-a", organizationId: "org-a", title: "Watch", mode: "quick", status: "open",
    linkedResearchProjectId: null, linkedRequestId: null, linkedDraftRequestId: null, linkedCampaignId: null,
    createdAt: messages[0]!.createdAt, updatedAt: messages[0]!.createdAt };
  const repository = {
    getThread: async ({ organizationId }: { organizationId: string }) => organizationId === "org-a" ? thread : null,
    listMessages: async () => ({ messages: [...messages], nextCursor: null }),
    latestUserMessage: async () => [...messages].reverse().find((entry) => entry.role === "user") ?? null,
    getMessage: async ({ messageId }: { messageId: string }) => messages.find((entry) => entry.id === messageId) ?? null,
    appendMessageKeyed: async (input: { role: ThreadMessageView["role"]; body: string; idempotencyKey: string }) => {
      const kept = keys.get(input.idempotencyKey);
      if (kept) {
        if (messages.find((entry) => entry.id === kept)?.body !== input.body) throw new Error("key conflict");
        return { messageId: kept, threadId: "thread-a", replayed: true };
      }
      const id = `message-${messages.length}`;
      keys.set(input.idempotencyKey, id);
      messages.push({ ...messages[0]!, id, role: input.role, body: input.body });
      return { messageId: id, threadId: "thread-a", replayed: false };
    },
  } as unknown as ThreadRepository;
  const proposeRouter = vi.fn(async (input: { text: string }) => {
    if (input.text.startsWith("[answers ")) throw new Error("encoded taps cannot be classified");
    return { intent: "watch", confidence: "high", missing: [] };
  });
  const service = createThreadService({ threads: repository, proposeRouter, routeDedup: new Map() });
  const scope = { organizationId: "org-a", actorId: "actor-a", role: "operator" as const, threadId: "thread-a" };
  return { service, messages, scope, proposeRouter };
}
describe("server-owned watch tap continuation", () => {
  it("keeps the verified source question beyond the first history page and through a replacement card", async () => {
    const h = harness();
    for (let i = 0; i < 25; i += 1) h.messages.push({ ...h.messages[0]!, id: `old-${i}`, body: `An earlier question ${i}` });
    h.messages.push({ ...h.messages[0]!, id: "ask-current", body: "Watch current competitors near Jumeirah" });
    const routed = await h.service.routeLatest(h.scope);
    const first = await h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true }, idempotencyKey: "long-history-answer-key-0001" });
    expect(first.sourceQuestion).toBe("Watch current competitors near Jumeirah");
    const replacement = bindQuestionnaireToMessage(routed.questionnaire!, first.message.id);
    await h.service.saveQuestionnaire({ ...h.scope, sourceMessage: first.message, intent: "watch", spec: replacement });
    const continued = await h.service.submitAnswers({ ...h.scope, spec: replacement, answers: { confirm_watch: true }, idempotencyKey: "replacement-answer-key-0001" });
    expect(continued.sourceQuestion).toBe(first.sourceQuestion);
    expect(h.proposeRouter).toHaveBeenCalledTimes(1);
  });
  it("provides and persists a direct-watch confirmation then retains its intent without classifying encoded answers", async () => {
    const h = harness();
    const routed = await h.service.routeLatest(h.scope);
    expect(routed.questionnaire?.items[0]?.key).toBe("confirm_watch");
    expect(h.messages.filter((entry) => entry.role === "system_note")).toHaveLength(1);
    const result = await h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true }, idempotencyKey: "watch-answer-key-0001" });
    expect(result.intent).toBe("watch");
    expect(result.questionnaire).toBeNull();
    expect(h.proposeRouter).toHaveBeenCalledTimes(1);
    expect(h.messages.filter((entry) => entry.role === "assistant")).toHaveLength(1);
    const replay = await h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true }, idempotencyKey: "watch-answer-key-0001" });
    expect(replay.replayed).toBe(true);
    expect(h.messages.filter((entry) => entry.body?.startsWith("[answers "))).toHaveLength(1);
  });
  it("rejects tampered or stale cards before saving answers", async () => {
    const h = harness();
    const routed = await h.service.routeLatest(h.scope);
    const count = h.messages.length;
    await expect(h.service.submitAnswers({ ...h.scope, spec: { ...routed.questionnaire!, title: "Forged" }, answers: { confirm_watch: true }, idempotencyKey: "tampered-answer-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.messages).toHaveLength(count);
    h.messages.push({ ...h.messages[0]!, id: "ask-b", body: "A new question" });
    await expect(h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true }, idempotencyKey: "stale-answer-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.messages).toHaveLength(count + 1);
  });
  it("treats an ordinary user message with an answers prefix as a new question, never a server receipt", async () => {
    const h = harness();
    const routed = await h.service.routeLatest(h.scope);
    h.messages.push({ ...h.messages[0]!, id: "fake-answer", body: "[answers missing_fields]\nconfirm_watch: yes" });
    const count = h.messages.length;
    await expect(h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true },
      idempotencyKey: "fake-prefix-answer-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.messages).toHaveLength(count);
  });
  it("persists an exact signed answer receipt and refuses replay after its digest is altered", async () => {
    const h = harness();
    const routed = await h.service.routeLatest(h.scope);
    const result = await h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true },
      idempotencyKey: "receipt-answer-key-0001" });
    const receiptNote = h.messages.find((entry) => !!parseQuestionnaireState(entry.body)?.answerReceipt);
    const receipt = parseQuestionnaireState(receiptNote?.body ?? null);
    expect(receipt?.answerReceipt?.messageId).toBe(result.message.id);
    expect(verifyQuestionnaire(receipt, "org-a", "thread-a")).toBe(true);
    const replay = await h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true },
      idempotencyKey: "receipt-answer-new-client-token" });
    expect(replay.replayed).toBe(true);
    expect(h.messages.filter((entry) => !!parseQuestionnaireState(entry.body)?.answerReceipt)).toHaveLength(1);
    const answer = h.messages.find((entry) => entry.id === result.message.id)!;
    const originalBody = answer.body;
    answer.body = "[answers missing_fields]\nconfirm_watch: no";
    await expect(h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true },
      idempotencyKey: "receipt-body-tamper-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    answer.body = originalBody;
    receiptNote!.body = encodeQuestionnaireState({ ...receipt!, answerReceipt: { ...receipt!.answerReceipt!, bodyDigest: "0".repeat(16) } });
    const count = h.messages.length;
    await expect(h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: true },
      idempotencyKey: "receipt-digest-tamper-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.messages).toHaveLength(count);
  });
  it("refuses viewer taps and declined confirmation without creating an answer row", async () => {
    const h = harness();
    const routed = await h.service.routeLatest(h.scope);
    const count = h.messages.length;
    await expect(h.service.submitAnswers({ ...h.scope, role: "viewer", spec: routed.questionnaire!, answers: { confirm_watch: true }, idempotencyKey: "viewer-answer-key-0001" })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    await expect(h.service.submitAnswers({ ...h.scope, spec: routed.questionnaire!, answers: { confirm_watch: false }, idempotencyKey: "declined-answer-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.messages).toHaveLength(count);
  });
  it("rejects an old card when a new question has the same intent and evidence", async () => {
    const h = harness();
    const first = await h.service.routeLatest(h.scope);
    h.messages.push({ ...h.messages[0]!, id: "ask-b", body: "Watch our competitors again" });
    const second = await h.service.routeLatest(h.scope);
    expect(second.questionnaire?.resumeKey).not.toBe(first.questionnaire?.resumeKey);
    const count = h.messages.length;
    await expect(h.service.submitAnswers({ ...h.scope, spec: first.questionnaire!, answers: { confirm_watch: true }, idempotencyKey: "old-card-answer-key-0001" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(h.messages).toHaveLength(count);
  });
});

function createThreadService(deps: Parameters<typeof createUnwiredThreadService>[0]) {
  return createUnwiredThreadService({ questionnaireAuthority: { sign: signQuestionnaire, verify: verifyQuestionnaire }, ...deps });
}
