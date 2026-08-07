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

  it("renders all ten sections and groups them into six phases", () => {
    render(
      <OnboardingSectionRail
        sections={sections}
        currentSectionKey="business_identity"
        visitedSectionKeys={["business_identity"]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(10);
    expect(screen.getByText("Foundation")).toBeInTheDocument();
    expect(screen.getByText("Commercial context")).toBeInTheDocument();
    expect(screen.getByText("Customer context")).toBeInTheDocument();
    expect(screen.getByText("Governance")).toBeInTheDocument();
    expect(screen.getByText("Data intake")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("disables unvisited future sections and allows revisiting visited sections", () => {
    const onSelect = vi.fn();
    render(
      <OnboardingSectionRail
        sections={sections}
        currentSectionKey="branches_operations"
        visitedSectionKeys={["business_identity", "branches_operations"]}
        onSelect={onSelect}
      />,
    );

    const identity = screen.getByRole("button", { name: /Business identity/i });
    const products = screen.getByRole("button", { name: /Products or services/i });
    fireEvent.click(identity);
    fireEvent.click(products);

    expect(onSelect).toHaveBeenCalledWith("business_identity");
    expect(products).toBeDisabled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
