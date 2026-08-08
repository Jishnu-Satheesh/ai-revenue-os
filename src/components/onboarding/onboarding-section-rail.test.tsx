// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { onboardingSectionRegistry } from "@/domain/onboarding/section-registry";
import { OnboardingSectionRail } from "@/components/onboarding/onboarding-section-rail";

const sections = onboardingSectionRegistry.map((section, index) => ({
  ...section,
  status: index === 0 ? ("in_progress" as const) : ("not_started" as const),
}));

describe("OnboardingSectionRail", () => {
  afterEach(() => cleanup());

  it("groups sections into six collapsible phases with only the current phase open", () => {
    render(
      <OnboardingSectionRail
        sections={sections}
        currentSectionKey="business_identity"
        onSelect={vi.fn()}
      />,
    );

    for (const phase of [
      "Foundation",
      "Commercial context",
      "Customer context",
      "Governance",
      "Data intake",
      "Review",
    ]) {
      expect(screen.getByText(phase)).toBeInTheDocument();
    }

    // Foundation holds the current section, so its two entries are visible and
    // the other phases stay collapsed.
    expect(screen.getByRole("button", { name: /Business identity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Branches and operations/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Products or services/i })).not.toBeInTheDocument();
  });

  it("expands a collapsed phase and navigates to any section without gating", () => {
    const onSelect = vi.fn();
    render(
      <OnboardingSectionRail
        sections={sections}
        currentSectionKey="business_identity"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Commercial context/i }));

    const products = screen.getByRole("button", { name: /Products or services/i });
    expect(products).not.toBeDisabled();
    fireEvent.click(products);

    expect(onSelect).toHaveBeenCalledWith("products_services");
  });

  it("keeps every section in the final phase reachable from the first section", () => {
    const onSelect = vi.fn();
    render(
      <OnboardingSectionRail
        sections={sections}
        currentSectionKey="business_identity"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Review:/i }));
    fireEvent.click(screen.getByRole("button", { name: /Review and readiness/i }));

    expect(onSelect).toHaveBeenCalledWith("review_readiness");
  });
});
