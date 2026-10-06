import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { signQuestionnaire, verifyQuestionnaire } from "@/modules/agent-chat/infrastructure/questionnaire-signature";

const payload = {
  organizationId: "org-a", threadId: "thread-a", sourceMessageId: "ask-a",
  intent: "watch" as const, issuedAt: "2026-10-04T10:00:00.000Z",
  spec: { kind: "missing_fields" as const, title: "Watch", resumeKey: "router:watch:overview:abc123",
    items: [{ key: "branch", label: "Which branch?", kind: "text" as const, required: true }] },
};
afterEach(() => vi.unstubAllEnvs());
const signExternalPayload = (value: unknown) => signQuestionnaire(value as Parameters<typeof signQuestionnaire>[0]);
describe("server Questionnaire provenance", () => {
  it("accepts the exact signed card and refuses modified authority or ideas", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-test-secret");
    const signed = signQuestionnaire(payload);
    expect(verifyQuestionnaire(signed, "org-a", "thread-a", new Date("2026-10-04T11:00:00Z"))).toBe(true);
    expect(verifyQuestionnaire({ ...signed, intent: "campaign_advice" }, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(false);
    expect(verifyQuestionnaire({ ...signed, sourceMessageId: "other" }, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(false);
    expect(verifyQuestionnaire({ ...signed, spec: { ...signed.spec, title: "Forged" } }, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(false);
    expect(verifyQuestionnaire(signed, "org-b", "thread-a", new Date(payload.issuedAt))).toBe(false);
    expect(verifyQuestionnaire(signed, "org-a", "thread-b", new Date(payload.issuedAt))).toBe(false);
  });
  it("fails closed for expiry, future dates, missing configuration, and secret rotation", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-test-secret");
    const signed = signQuestionnaire(payload);
    expect(verifyQuestionnaire(signed, "org-a", "thread-a", new Date("2026-10-05T10:00:00Z"))).toBe(false);
    expect(verifyQuestionnaire(signed, "org-a", "thread-a", new Date("2026-10-04T09:00:00Z"))).toBe(false);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "rotated");
    expect(verifyQuestionnaire(signed, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(false);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(verifyQuestionnaire(signed, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(false);
    expect(() => signQuestionnaire(payload)).toThrow();
  });
  it("signs bounded prior watch inputs and rejects tampered carry, carried consent, or another intent", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-test-secret");
    const signed = signQuestionnaire({ ...payload,
      continuationAnswers: { frequency: "daily", branch: "branch-a", end_date: "2026-10-08" } });
    expect(verifyQuestionnaire(signed, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(true);
    expect(verifyQuestionnaire({ ...signed, continuationAnswers: { ...signed.continuationAnswers,
      frequency: "monthly" } }, "org-a", "thread-a", new Date(payload.issuedAt))).toBe(false);
    expect(() => signExternalPayload({ ...payload, continuationAnswers: { confirm_watch: "yes" } })).toThrow();
    expect(() => signExternalPayload({ ...payload, continuationAnswers: { budget: "100000" } })).toThrow();
    expect(() => signQuestionnaire({ ...payload, intent: "campaign_advice", continuationAnswers: { frequency: "daily" } })).toThrow();
    expect(() => signQuestionnaire({ ...payload, continuationAnswers: { competitors: "x".repeat(201) } })).toThrow();
  });
});
