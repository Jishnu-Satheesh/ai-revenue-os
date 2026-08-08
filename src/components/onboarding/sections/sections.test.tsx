// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { BusinessIdentitySection } from "@/components/onboarding/sections/business-identity-section";
import { BranchesOperationsSection } from "@/components/onboarding/sections/branches-operations-section";
import { CustomersConsentSection } from "@/components/onboarding/sections/customers-consent-section";

afterEach(() => cleanup());

describe("onboarding section editors", () => {
  it("stores the industry slug chosen from the select rather than free text", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BusinessIdentitySection onSave={onSave} />);

    fireEvent.change(screen.getByLabelText(/Organization name/), {
      target: { value: "Al Noor Kitchen" },
    });
    fireEvent.click(screen.getByLabelText(/Industry/));
    fireEvent.click(await screen.findByRole("option", { name: "Restaurant and food service" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Al Noor Kitchen", industry: "restaurant" }),
        "in_progress",
      ),
    );
  });

  it("collects branches as discrete entries and hours as a weekly pattern", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BranchesOperationsSection onSave={onSave} />);

    const branchInput = screen.getByLabelText(/Branches/);
    fireEvent.change(branchInput, { target: { value: "Jumeirah" } });
    fireEvent.keyDown(branchInput, { key: "Enter" });
    fireEvent.change(branchInput, { target: { value: "Downtown" } });
    fireEvent.keyDown(branchInput, { key: "Enter" });

    fireEvent.click(screen.getByLabelText("Monday opening time"));
    fireEvent.click(await screen.findByRole("option", { name: "10:00" }));

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.calls[0];
    expect(payload.branches).toEqual(["Jumeirah", "Downtown"]);
    expect(payload.operatingHours).toContainEqual(
      expect.objectContaining({ day: "mon", opensAt: "10:00" }),
    );
  });

  it("derives the consent boolean from an explicit confirmation source", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<CustomersConsentSection onSave={onSave} />);

    expect(screen.getByText(/AI never infers legal permission/i)).toBeInTheDocument();

    const consent = screen.getByRole("radiogroup");
    fireEvent.click(within(consent).getByRole("radio", { name: /Confirmed by the client/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          consentStatus: "confirmed_by_client",
          consentConfirmed: true,
        }),
        "in_progress",
      ),
    );
  });
});
