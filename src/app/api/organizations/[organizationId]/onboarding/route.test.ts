import { beforeEach, describe, expect, it, vi } from "vitest";

const startOrResumeSession = vi.fn();
const getSnapshot = vi.fn();

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
  createOnboardingService: () => ({ startOrResumeSession, getSnapshot }),
}));
vi.mock("@/modules/onboarding/infrastructure/repository", () => ({
  createOnboardingRepository: () => ({}),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));

import { GET } from "@/app/api/organizations/[organizationId]/onboarding/route";

describe("GET onboarding workspace", () => {
  beforeEach(() => {
    startOrResumeSession.mockReset();
    getSnapshot.mockReset();
  });

  it("starts or resumes the tenant session and returns its snapshot", async () => {
    startOrResumeSession.mockResolvedValue({ id: "session-1" });
    getSnapshot.mockResolvedValue({ session: { id: "session-1" }, sections: [] });

    const response = await GET(new Request("http://localhost/api/onboarding"), {
      params: Promise.resolve({ organizationId: "11111111-1111-4111-8111-111111111111" }),
    });

    expect(response.status).toBe(200);
    expect(startOrResumeSession).toHaveBeenCalledWith({
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
    });
    expect(getSnapshot).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });
});
