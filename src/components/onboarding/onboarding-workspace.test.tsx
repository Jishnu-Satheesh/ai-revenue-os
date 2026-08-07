// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { onboardingSectionRegistry } from "@/domain/onboarding/section-registry";
import { OnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";

describe("OnboardingWorkspace", () => {
  afterEach(() => cleanup());

  it("focuses the active section heading after navigation", async () => {
    const sections = onboardingSectionRegistry.map((section, index) => ({
      ...section,
      status: index < 2 ? ("in_progress" as const) : ("not_started" as const),
    }));
    const contents = {
      business_identity: <p>Identity fields</p>,
      branches_operations: <p>Branch fields</p>,
    };

    render(
      <OnboardingWorkspace
        sections={sections}
        contents={contents}
        initialSectionKey="business_identity"
        onSectionChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Branches and operations/i }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Branches and operations" })).toHaveFocus(),
    );
    expect(await screen.findByText("Branch fields")).toBeInTheDocument();
  });
});
