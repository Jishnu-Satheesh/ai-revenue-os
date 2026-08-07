import { beforeEach, describe, expect, it, vi } from "vitest";

const saveSection = vi.fn();

vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  getOrganizationContext: vi.fn(async () => ({
    organizationId: "org-1",
    user: { id: "user-1" },
    supabase: {},
  })),
}));
vi.mock("@/modules/onboarding/application/service", () => ({
  createOnboardingService: () => ({ saveSection }),
}));
vi.mock("@/modules/onboarding/infrastructure/repository", () => ({
  createOnboardingRepository: () => ({}),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));

import { PATCH } from "@/app/api/organizations/[organizationId]/onboarding/sections/[sectionKey]/route";

describe("PATCH onboarding section", () => {
  beforeEach(() => saveSection.mockReset());

  it("rejects malformed section payloads", async () => {
    const response = await PATCH(
      new Request(
        "http://localhost/api/organizations/org-1/onboarding/sections/business_identity",
        {
          method: "PATCH",
          body: JSON.stringify({ status: "complete" }),
        },
      ),
      {
        params: Promise.resolve({
          organizationId: "11111111-1111-4111-8111-111111111111",
          sectionKey: "business_identity",
        }),
      },
    );

    expect(response.status).toBe(400);
    expect(saveSection).not.toHaveBeenCalled();
  });

  it("saves a validated section through the tenant context", async () => {
    saveSection.mockResolvedValue({ id: "state-1", status: "in_progress" });
    const response = await PATCH(
      new Request(
        "http://localhost/api/organizations/11111111-1111-4111-8111-111111111111/onboarding/sections/business_identity",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "session-1",
            status: "in_progress",
            payload: { name: "Al Noor Kitchen" },
            idempotencyKey: "section-save-key-0001",
          }),
        },
      ),
      {
        params: Promise.resolve({
          organizationId: "11111111-1111-4111-8111-111111111111",
          sectionKey: "business_identity",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(saveSection).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "user-1",
        sessionId: "session-1",
        sectionKey: "business_identity",
      }),
    );
  });
});
