// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { GovernanceSection } from "@/components/onboarding/sections/governance-section";

afterEach(() => cleanup());

describe("GovernanceSection", () => {
  it("stores the budget in integer minor units alongside its ISO currency", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GovernanceSection onSave={onSave} />);

    const goals = screen.getByLabelText(/Measurable goals/);
    fireEvent.change(goals, { target: { value: "Increase repeat orders by 15%" } });
    fireEvent.keyDown(goals, { key: "Enter" });

    fireEvent.click(screen.getByLabelText(/Budget currency/));
    fireEvent.click(await screen.findByRole("option", { name: /AED/ }));

    fireEvent.change(screen.getByLabelText(/Monthly budget/), { target: { value: "2500" } });

    const baseline = screen.getByRole("radiogroup", { name: /Baseline status/i });
    fireEvent.click(within(baseline).getByRole("radio", { name: /^Known/ }));

    const approval = screen.getByRole("radiogroup", { name: /Approval mode/i });
    fireEvent.click(within(approval).getByRole("radio", { name: /Approval required/i }));

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          goals: ["Increase repeat orders by 15%"],
          baseline: "known",
          budgetMinor: 250000,
          budgetCurrency: "AED",
          approvalMode: "approval_required",
        }),
        "in_progress",
      ),
    );
  });

  it("marks the section complete only once every requirement is answered", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GovernanceSection onSave={onSave} />);

    const goals = screen.getByLabelText(/Measurable goals/);
    fireEvent.change(goals, { target: { value: "Increase repeat orders by 15%" } });
    fireEvent.keyDown(goals, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    // Budget, currency, baseline, and approval mode are still missing, so the
    // section is persisted as a draft rather than being rejected by the server.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toBe("in_progress");
    expect(screen.getByText(/more to mark this section complete/i)).toBeInTheDocument();
  });
});
