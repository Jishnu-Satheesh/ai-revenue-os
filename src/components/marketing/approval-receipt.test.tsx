// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { receipt } from "@/components/marketing/content";
import { ApprovalReceipt } from "./approval-receipt";

afterEach(cleanup);

describe("ApprovalReceipt", () => {
  it("renders the decision header", () => {
    render(<ApprovalReceipt />);

    expect(screen.getByText(`Decision · ${receipt.id}`)).toBeTruthy();
    expect(screen.getByText(receipt.title)).toBeTruthy();
  });

  it("renders every audit step with its detail", () => {
    render(<ApprovalReceipt />);

    for (const step of receipt.steps) {
      expect(screen.getByText(step.label)).toBeTruthy();
      expect(screen.getByText(step.detail)).toBeTruthy();
      expect(screen.getAllByText(step.time).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders the illustrative caption", () => {
    render(<ApprovalReceipt />);

    expect(screen.getByText(receipt.caption)).toBeTruthy();
  });
});
