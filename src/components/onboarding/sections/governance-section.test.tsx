// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GovernanceSection } from "@/components/onboarding/sections/governance-section";

afterEach(() => cleanup());

describe("GovernanceSection", () => {
  it("keeps budget and approval mode in the operator-owned form", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<GovernanceSection onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Measurable goals"), {
      target: { value: "Increase repeat orders" },
    });
    fireEvent.change(screen.getByLabelText("Baseline status"), { target: { value: "known" } });
    fireEvent.change(screen.getByLabelText("Monthly budget (minor units)"), {
      target: { value: "250000" },
    });
    fireEvent.change(screen.getByLabelText("Budget currency"), { target: { value: "AED" } });
    fireEvent.change(screen.getByLabelText("Approval mode"), {
      target: { value: "approval_required" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ budgetMinor: "250000", approvalMode: "approval_required" }),
        "in_progress",
      ),
    );
  });
});
