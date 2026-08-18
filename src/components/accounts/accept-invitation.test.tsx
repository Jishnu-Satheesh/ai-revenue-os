// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => ({ auth: {} }) }));

import { AcceptInvitation } from "@/components/accounts/accept-invitation";
import type { InvitationPreview } from "@/domain/access/invitations";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const TOKEN = "A".repeat(43);

function preview(overrides: Partial<InvitationPreview> = {}): InvitationPreview {
  return {
    state: "valid",
    accountName: "Super-admin agency",
    invitedEmail: "sarah@example.com",
    inviterName: "Jishnu",
    accountRole: "member",
    defaultOrganizationRole: "operator",
    expiresAt: "2026-08-24T00:00:00.000Z",
    matchesCaller: true,
    signedInEmail: "sarah@example.com",
    ...overrides,
  };
}

describe("AcceptInvitation", () => {
  /**
   * Proving control of the invited address is the whole of the check, so a
   * person who has just read their email is not asked to confirm it again.
   */
  it("joins automatically when the signed-in address is the invited one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    render(<AcceptInvitation token={TOKEN} preview={preview()} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/invitations/${TOKEN}/accept`, {
        method: "POST",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("asks for nothing while it is joining", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AcceptInvitation token={TOKEN} preview={preview()} />);

    expect(
      screen.getByRole("heading", { name: /joining super-admin agency/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^join/i })).not.toBeInTheDocument();
  });

  it("attempts acceptance only once, however often it re-renders", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(<AcceptInvitation token={TOKEN} preview={preview()} />);
    rerender(<AcceptInvitation token={TOKEN} preview={preview()} />);
    rerender(<AcceptInvitation token={TOKEN} preview={preview()} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("offers a retry rather than stranding the person when joining fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<AcceptInvitation token={TOKEN} preview={preview()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });

  it("never joins on its own for an address that is not the invited one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AcceptInvitation
        token={TOKEN}
        preview={preview({ matchesCaller: false, signedInEmail: "someone-else@example.com" })}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what the invitation actually grants, not just that it exists", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AcceptInvitation token={TOKEN} preview={preview()} />);
    expect(screen.getByText(/operator in every client/i)).toBeInTheDocument();
  });

  it("says plainly when no client access comes with the seat", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<AcceptInvitation token={TOKEN} preview={preview({ defaultOrganizationRole: null })} />);
    expect(screen.getByText(/no access to clients until someone grants it/i)).toBeInTheDocument();
  });

  /**
   * The state that matters most. A link forwarded to the wrong person must never
   * offer to admit them, and must name both addresses so the mismatch is
   * obvious rather than mysterious.
   */
  it("refuses to offer joining when signed in as a different address", () => {
    render(
      <AcceptInvitation
        token={TOKEN}
        preview={preview({ matchesCaller: false, signedInEmail: "someone-else@example.com" })}
      />,
    );

    expect(screen.queryByRole("button", { name: /^join/i })).not.toBeInTheDocument();
    expect(screen.getByText(/this invitation is for someone else/i)).toBeInTheDocument();
    expect(screen.getByText("sarah@example.com")).toBeInTheDocument();
    expect(screen.getByText("someone-else@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
  });

  it("offers sign-in, not joining, when nobody is signed in", () => {
    render(
      <AcceptInvitation
        token={TOKEN}
        preview={preview({ signedInEmail: null, matchesCaller: false })}
      />,
    );
    expect(screen.getByRole("button", { name: /email me a sign-in link/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^join/i })).not.toBeInTheDocument();
  });

  it("gives an invalid link a recovery action rather than a dead end", () => {
    render(
      <AcceptInvitation
        token={TOKEN}
        preview={preview({ state: "invalid", accountName: null, invitedEmail: null })}
      />,
    );
    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
    expect(screen.getByText(/ask the person who invited you/i)).toBeInTheDocument();
  });

  it("never reveals an account name for an invalid link", () => {
    render(
      <AcceptInvitation
        token={TOKEN}
        preview={preview({
          state: "invalid",
          accountName: null,
          invitedEmail: null,
          inviterName: null,
        })}
      />,
    );
    expect(screen.queryByText(/super-admin agency/i)).not.toBeInTheDocument();
  });

  it("sends someone who already joined onward rather than showing an error", () => {
    render(<AcceptInvitation token={TOKEN} preview={preview({ state: "already_accepted" })} />);
    expect(screen.getByText(/already joined/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /go to your workspace/i })).toBeInTheDocument();
  });
});
