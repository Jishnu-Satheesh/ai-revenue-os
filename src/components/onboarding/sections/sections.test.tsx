// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BusinessIdentitySection } from "@/components/onboarding/sections/business-identity-section";
import { CustomersConsentSection } from "@/components/onboarding/sections/customers-consent-section";

afterEach(() => cleanup());

describe("onboarding section editors", () => {
  it("renders shadcn fields and saves a draft through TanStack Form", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BusinessIdentitySection onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Al Noor Kitchen" },
    });
    fireEvent.change(screen.getByLabelText("Industry"), { target: { value: "Restaurant" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Al Noor Kitchen", industry: "Restaurant" }),
        "in_progress",
      ),
    );
  });

  it("makes consent ownership explicit in the editor copy", () => {
    render(<CustomersConsentSection onSave={vi.fn().mockResolvedValue(undefined)} />);

    expect(screen.getByText(/AI never infers legal permission/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Consent confirmation source")).toBeInTheDocument();
  });
});
