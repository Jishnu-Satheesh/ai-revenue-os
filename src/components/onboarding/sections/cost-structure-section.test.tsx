// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CostStructureSection } from "@/components/onboarding/sections/cost-structure-section";
import type { CostComponentOption } from "@/components/onboarding/sections/shared";

afterEach(() => cleanup());

const components: CostComponentOption[] = [
  { key: "commission", label: "Marketplace commission", computationKind: "rate_of_revenue" },
  { key: "delivery_cost", label: "Delivery cost", computationKind: "fixed_amount" },
  { key: "promotion_funding", label: "Promotion funding share", computationKind: "sourced" },
];

function renderSection(onSave = vi.fn().mockResolvedValue(undefined)) {
  render(
    <CostStructureSection
      components={components}
      channels={["talabat", "deliveroo"]}
      currency="AED"
      onSave={onSave}
    />,
  );
  return onSave;
}

async function chooseConfidence(name: RegExp, option: RegExp) {
  fireEvent.click(screen.getByLabelText(name));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("CostStructureSection", () => {
  it("stores a share of revenue as a percentage with its confidence", async () => {
    const onSave = renderSection();

    fireEvent.change(screen.getByLabelText(/Marketplace commission percentage/), {
      target: { value: "28" },
    });
    await chooseConfidence(/Marketplace commission confidence/, /contract or statement/i);

    fireEvent.change(screen.getByLabelText(/In force from/), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          costRates: [
            {
              componentKey: "commission",
              channel: null,
              percent: 28,
              amountMinor: null,
              confidence: "measured",
            },
          ],
          effectiveFrom: "2026-06-01",
        }),
        "in_progress",
      ),
    );
  });

  it("stores an absolute cost in integer minor units", async () => {
    const onSave = renderSection();

    // AED 3.50 per order.
    fireEvent.change(screen.getByLabelText(/Delivery cost amount/), { target: { value: "3.50" } });
    fireEvent.change(screen.getByLabelText(/In force from/), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].costRates).toEqual([
      {
        componentKey: "delivery_cost",
        channel: null,
        percent: null,
        amountMinor: 350,
        confidence: "assumed",
      },
    ]);
  });

  it("records a zero as an answer rather than dropping it", async () => {
    // Dine-in commission genuinely is zero. Saying so is what turns a bounded
    // margin into a real one, so a zero must survive to the payload.
    const onSave = renderSection();

    fireEvent.change(screen.getByLabelText(/Marketplace commission percentage/), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText(/In force from/), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].costRates).toEqual([
      expect.objectContaining({ componentKey: "commission", percent: 0 }),
    ]);
  });

  it("offers no input for a component that comes from provider reports", () => {
    renderSection();

    // Sourced components cannot be typed. An enabled empty box would read as
    // the operator's omission when it is waiting on a provider report.
    expect(screen.queryByLabelText(/Promotion funding share percentage/)).not.toBeInTheDocument();
    expect(screen.getByText(/Comes from your provider reports/)).toBeInTheDocument();
  });

  it("scopes a channel-specific rate to a channel the operator already named", async () => {
    const onSave = renderSection();

    fireEvent.click(
      screen.getByLabelText(/Add a channel-specific rate for Marketplace commission/),
    );
    fireEvent.click(await screen.findByRole("option", { name: "talabat" }));

    fireEvent.change(screen.getByLabelText(/Marketplace commission on talabat percentage/), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText(/In force from/), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].costRates).toEqual([
      expect.objectContaining({ componentKey: "commission", channel: "talabat", percent: 30 }),
    ]);
  });

  it("keeps the section a draft until a cost and a date are both given", async () => {
    const onSave = renderSection();

    fireEvent.change(screen.getByLabelText(/Marketplace commission percentage/), {
      target: { value: "28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    // No effective date yet, so the section saves as a draft rather than being
    // rejected — the operator is never blocked from moving on.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][1]).toBe("in_progress");
    expect(screen.getByText(/more to mark this section complete/i)).toBeInTheDocument();
  });

  it("says so plainly when the pack registered no components", () => {
    render(<CostStructureSection components={[]} channels={[]} currency="AED" onSave={vi.fn()} />);

    expect(screen.getByText(/No cost components are registered yet/)).toBeInTheDocument();
  });
});
