// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CandidateReview } from "@/components/onboarding/candidate-review";

afterEach(() => cleanup());

describe("CandidateReview", () => {
  it("requires an explicit operator action before promotion", async () => {
    const onReview = vi.fn().mockResolvedValue(undefined);
    render(
      <CandidateReview
        candidates={[
          {
            id: "11111111-1111-4111-8111-111111111111",
            organization_id: "22222222-2222-4222-8222-222222222222",
            extraction_id: "33333333-3333-4333-8333-333333333333",
            section_key: "products_services",
            candidate_type: "catalog_row",
            fact_key: null,
            candidate_payload: { name: "Soup", price: "25" },
            confidence: null,
            evidence: [{ sourceReference: "menu.csv", location: "line 2" }],
            contradiction_references: [],
            status: "pending",
            reviewed_by: null,
            reviewed_at: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ]}
        onReview={onReview}
      />,
    );

    expect(screen.getByRole("button", { name: "Confirm fact" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm fact" }));
    await waitFor(() =>
      expect(onReview).toHaveBeenCalledWith(
        "11111111-1111-4111-8111-111111111111",
        expect.objectContaining({
          action: "confirm",
          evidence: [{ sourceReference: "menu.csv", location: "line 2" }],
        }),
      ),
    );
  });
});
