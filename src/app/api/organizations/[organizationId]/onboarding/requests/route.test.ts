import { beforeEach, describe, expect, it, vi } from "vitest";

const createRequest = vi.fn();

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
  createOnboardingService: () => ({ createRequest }),
}));
vi.mock("@/modules/onboarding/infrastructure/repository", () => ({
  createOnboardingRepository: () => ({}),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));

import { POST } from "@/app/api/organizations/[organizationId]/onboarding/requests/route";

describe("POST onboarding request", () => {
  beforeEach(() => createRequest.mockReset());

  it("creates a validated request assigned to a client contact", async () => {
    createRequest.mockResolvedValue({ id: "request-1", status: "open" });
    const response = await POST(
      new Request(
        "http://localhost/api/organizations/11111111-1111-4111-8111-111111111111/onboarding/requests",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: "session-1",
            sectionKey: "customers_consent",
            title: "Confirm consent source",
            description: "Please confirm the source and retention period.",
            clientContact: "owner@example.com",
          }),
        },
      ),
      { params: Promise.resolve({ organizationId: "11111111-1111-4111-8111-111111111111" }) },
    );

    expect(response.status).toBe(201);
    expect(createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
      }),
    );
  });
});
