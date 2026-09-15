// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { BrandGuidelinesPanel } from "@/components/assets/brand-guidelines-panel";
import type { LibraryReference } from "@/components/assets/asset-library-grid";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const organizationId = "11111111-1111-4111-8111-111111111111";
const usableVersionId = "aaaaaaaa-0000-4000-8000-000000000001";

function logoReference(overrides: Partial<LibraryReference> = {}): LibraryReference {
  return {
    brandAssetId: "bbbbbbbb-0000-4000-8000-000000000001",
    brandAssetVersionId: usableVersionId,
    label: "Al Noor wordmark",
    assetRole: "logo",
    conditioningRoles: ["brand_mark"],
    tags: [],
    scripts: [],
    ownership: "owned",
    archivedAt: null,
    version: 3,
    previewUrl: "https://signed.example/logo.png",
    currentVerdict: null,
    currentReasonCodes: [],
    currentReviewedAt: null,
    ...overrides,
  };
}

function mockIdentity(identity: {
  guidelines?: { palette: Record<string, string>; rules: unknown[]; restrictedTerms: string[] };
  logos?: { variant: string; brandAssetVersionId: string }[];
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          guidelines: identity.guidelines ?? { palette: {}, rules: [], restrictedTerms: [] },
          logos: identity.logos ?? [],
        }),
        { status: 200 },
      ),
  );
}

function renderPanel(
  props: { canManage: boolean; references?: readonly LibraryReference[] },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BrandGuidelinesPanel
        organizationId={organizationId}
        canManage={props.canManage}
        references={props.references ?? [logoReference()]}
      />
    </QueryClientProvider>,
  );
}

describe("BrandGuidelinesPanel", () => {
  it("offers no edit control to somebody who cannot manage the brand", async () => {
    mockIdentity({});
    renderPanel({ canManage: false });

    // A control that exists and then fails teaches people the product is
    // broken. The API refuses this role, so the interface never offers it.
    await waitFor(() => expect(screen.getByText(/no brand rules/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("never describes a generated logo as exact", async () => {
    mockIdentity({ logos: [{ variant: "primary", brandAssetVersionId: usableVersionId }] });
    renderPanel({ canManage: true });

    // Acceptance criterion 10. The model is conditioned on the mark; it is
    // not guaranteed to reproduce it, and saying otherwise sets up a client
    // to approve artwork they believe was checked.
    await waitFor(() => expect(screen.getByAltText(/al noor wordmark/i)).toBeInTheDocument());
    expect(
      screen.queryByText(/\b(exact|verified|guaranteed)\b(?!\s*to reproduce)/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/not guaranteed to reproduce it/i)).toBeInTheDocument();
  });

  it("reports a logo whose image was rejected instead of showing it", async () => {
    mockIdentity({ logos: [{ variant: "primary", brandAssetVersionId: usableVersionId }] });
    renderPanel({
      canManage: true,
      references: [
        logoReference({
          currentVerdict: "rejected",
          currentReasonCodes: ["brand_mark_distorted"],
          currentReviewedAt: "2026-09-14T10:00:00.000Z",
        }),
      ],
    });

    // Acceptance criterion 3. A mark somebody rejected must stop appearing,
    // and the operator must be told why rather than finding a blank space.
    await waitFor(() =>
      expect(screen.getByText(/no longer used as your logo/i)).toBeInTheDocument(),
    );
    expect(screen.queryByAltText(/al noor wordmark/i)).not.toBeInTheDocument();
  });

  it("does not quietly show the dark variant when the primary is broken", async () => {
    const darkVersionId = "aaaaaaaa-0000-4000-8000-000000000002";
    mockIdentity({
      logos: [
        // The primary points at an image the library no longer lists, which
        // means the server never validated it or it was archived.
        { variant: "primary", brandAssetVersionId: "aaaaaaaa-0000-4000-8000-00000000000f" },
        { variant: "dark", brandAssetVersionId: darkVersionId },
      ],
    });
    renderPanel({
      canManage: true,
      references: [logoReference({ brandAssetVersionId: darkVersionId, label: "Dark wordmark" })],
    });

    await waitFor(() =>
      expect(screen.getByText(/image is not available/i)).toBeInTheDocument(),
    );
    // Falling back would put a mark in front of everyone under a label saying
    // it is the primary, which is the one thing the broken state exists to
    // prevent.
    expect(screen.queryByAltText(/dark wordmark/i)).toBeInTheDocument();
    expect(screen.getAllByAltText(/wordmark/i)).toHaveLength(1);
  });

  it("separates absolute rules from preferred ones", async () => {
    mockIdentity({
      guidelines: {
        palette: { primary: "#c8102e" },
        rules: [
          { text: "Never imply a medical benefit", strength: "hard" },
          { text: "We usually lead with the food", strength: "soft" },
        ],
        restrictedTerms: ["best in dubai"],
      },
    });
    renderPanel({ canManage: true });

    await waitFor(() =>
      expect(screen.getByText("Never imply a medical benefit")).toBeInTheDocument(),
    );
    // Restricted terms belong with the absolute rules: they are matched
    // literally and refused, not weighed. Spec §18.4.
    const absolute = screen.getByRole("group", { name: /absolute/i });
    expect(absolute).toHaveTextContent("Never imply a medical benefit");
    expect(absolute).toHaveTextContent("best in dubai");
    expect(absolute).not.toHaveTextContent("We usually lead with the food");
  });

  it("says a brand has no colours rather than showing three empty swatches", async () => {
    mockIdentity({});
    renderPanel({ canManage: true });

    await waitFor(() => expect(screen.getByText(/no brand colours/i)).toBeInTheDocument());
  });
});
