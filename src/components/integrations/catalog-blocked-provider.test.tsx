// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Without this each render stacks another tree into the same document and
// single-element queries start reporting duplicates.
afterEach(cleanup);

import { CatalogTab } from "@/components/integrations/catalog-tab";
import { metaDefinition } from "@/modules/integrations/providers/meta/definition";

const organizationId = "11111111-1111-4111-8111-111111111111";

function renderCatalog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CatalogTab
        organizationId={organizationId}
        catalog={[metaDefinition]}
        connections={[]}
        role="owner"
      />
    </QueryClientProvider>,
  );
}

/**
 * Meta is visible so an operator can see what is planned and why none of it
 * works. The catalog must never imply it is one click away.
 */
describe("catalog — declared but blocked provider", () => {
  it("shows Meta as blocked with no connect control, even for an owner", () => {
    renderCatalog();

    expect(screen.getByText("Meta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect/i })).not.toBeInTheDocument();
    expect(screen.getByText(/blocked by the V1 rollout policy/i)).toBeInTheDocument();
  });

  it("names every intended capability with its stable restriction code", () => {
    renderCatalog();

    for (const declaration of metaDefinition.declaredBlockedCapabilities ?? []) {
      expect(screen.getByText(declaration.key)).toBeInTheDocument();
      expect(screen.getByText(declaration.summary)).toBeInTheDocument();
      // `getAll`, because one restriction code legitimately blocks more than
      // one capability: missing controlled-account evidence blocks both
      // advertising and metrics reads.
      expect(
        screen.getAllByText(new RegExp(declaration.restrictionCodes[0] as string)).length,
      ).toBeGreaterThan(0);
    }
  });

  it("states plainly that no action is proven, rather than leaving it implied", () => {
    renderCatalog();

    expect(
      screen.getByText(/no action is proven against a controlled account/i),
    ).toBeInTheDocument();
  });

  it("never presents a blocked declaration as an available capability", () => {
    renderCatalog();

    // "Available" is the badge the catalog uses for a usable provider. A
    // provider with nothing grantable must never carry it.
    expect(screen.queryByText("Available")).not.toBeInTheDocument();
    expect(screen.getAllByText("Blocked").length).toBeGreaterThan(0);
  });
});
