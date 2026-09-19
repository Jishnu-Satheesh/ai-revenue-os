// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: {} }) }));

import { AcceptOrganizationInvitation } from "@/components/organizations/accept-organization-invitation";
import type { OrganizationInvitationPreview } from "@/domain/access/invitations";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const TOKEN = "B".repeat(43);

function preview(overrides: Partial<OrganizationInvitationPreview> = {}) {
  const base: OrganizationInvitationPreview = {
    state: "valid",
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationName: "Client Alpha",
    invitedEmail: "client@example.com",
    inviterName: "Owner O",
    role: "viewer",
    expiresAt: "2026-09-24T00:00:00.000Z",
    matchesCaller: true,
    signedInEmail: "client@example.com",
  };
  return { ...base, ...overrides };
}

describe("AcceptOrganizationInvitation", () => {
  it("joins automatically when the signed-in address is the invited one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<AcceptOrganizationInvitation token={TOKEN} preview={preview()} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/organization-invitations/${TOKEN}/accept`, {
        method: "POST",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("names the client and the granted role while joining", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AcceptOrganizationInvitation token={TOKEN} preview={preview()} />);

    expect(screen.getByRole("heading", { name: /joining client alpha/i })).toBeInTheDocument();
    expect(screen.getByText(/in client alpha: viewer/i)).toBeInTheDocument();
  });

  it("never accepts on behalf of a different signed-in address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AcceptOrganizationInvitation
        token={TOKEN}
        preview={preview({ matchesCaller: false, signedInEmail: "stranger@example.com" })}
      />,
    );

    expect(screen.getByRole("heading", { name: /for someone else/i })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("offers sign-in to the invited address when signed out", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<AcceptOrganizationInvitation token={TOKEN} preview={preview({ signedInEmail: null })} />);

    expect(screen.getByRole("heading", { name: /join client alpha/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /email me a sign-in link/i }),
    ).toBeInTheDocument();
  });
});
