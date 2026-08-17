// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ReadinessTaskList } from "@/components/onboarding/readiness-task-list";
import type { ReadinessAction } from "@/domain/onboarding/readiness";

afterEach(() => cleanup());

const action = (overrides: Partial<ReadinessAction> = {}): ReadinessAction => ({
  reasonId: "cost_structure_required",
  label: "Variable costs are priced",
  sectionKey: "cost_structure",
  owner: "agency_operator",
  effort: "small",
  critical: false,
  ...overrides,
});

describe("ReadinessTaskList", () => {
  it("names the task rather than showing its identifier", () => {
    render(<ReadinessTaskList actions={[action()]} />);

    // The old rendering printed `cost_structure_required` at the operator.
    expect(screen.getByText("Variable costs are priced")).toBeInTheDocument();
    expect(screen.queryByText("cost_structure_required")).not.toBeInTheDocument();
  });

  it("says where the task is done, what it costs and who owns it", () => {
    render(<ReadinessTaskList actions={[action()]} />);

    expect(screen.getByText(/Cost structure · a few minutes · you/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open/ })).toBeInTheDocument();
  });

  it("marks a blocker and attributes a client task to the client", () => {
    render(
      <ReadinessTaskList
        actions={[
          action({
            reasonId: "customer_consent_required",
            label: "Customer consent is confirmed",
            sectionKey: "customers_consent",
            owner: "client_contact",
            effort: "medium",
            critical: true,
          }),
        ]}
      />,
    );

    const row = screen.getByText("Customer consent is confirmed").closest("li");
    expect(within(row!).getByText("Blocker")).toBeInTheDocument();
    expect(within(row!).getByText(/half an hour · the client/)).toBeInTheDocument();
  });

  it("says nothing is outstanding rather than rendering an empty list", () => {
    render(<ReadinessTaskList actions={[]} />);

    expect(screen.getByText(/Nothing is outstanding/)).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
