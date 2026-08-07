import { beforeEach, describe, expect, it, vi } from "vitest";

const generateReadiness = vi.fn();

vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  getOrganizationContext: vi.fn(async () => ({
    organizationId: "11111111-1111-4111-8111-111111111111",
    user: { id: "user-1" },
    supabase: {},
  })),
}));
vi.mock("@/modules/onboarding/application/service", () => ({
  createOnboardingService: () => ({ generateReadiness }),
}));
vi.mock("@/modules/onboarding/infrastructure/repository", () => ({
  createOnboardingRepository: () => ({}),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));

import { POST } from "@/app/api/organizations/[organizationId]/onboarding/readiness/route";

describe("POST onboarding readiness", () => {
  beforeEach(() => generateReadiness.mockReset());

  it("generates readiness for the authorized session", async () => {
    generateReadiness.mockResolvedValue({ id: "assessment-1", overall_score: 42 });
    const response = await POST(
      new Request(
        "http://localhost/api/organizations/11111111-1111-4111-8111-111111111111/onboarding/readiness",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-1" }),
        },
      ),
      { params: Promise.resolve({ organizationId: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(200);
    expect(generateReadiness).toHaveBeenCalledWith({
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      sessionId: "session-1",
    });
  });
});
