// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetReviewForm } from "@/components/assets/asset-review-form";

afterEach(cleanup);

function renderForm(onSubmit = vi.fn()) {
  render(
    <AssetReviewForm
      subjectKind="brand_asset_version"
      subjectId="a0000000-0000-4000-8000-000000000001"
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe("approving is one click", () => {
  it("sends an approval with no reasons attached", async () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      subjectKind: "brand_asset_version",
      subjectId: "a0000000-0000-4000-8000-000000000001",
      verdict: "approved",
      reasonCodes: [],
      note: null,
    });
  });
});

describe("rejecting cannot happen without a reason", () => {
  it("refuses to submit and says why, rather than failing silently", () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.click(screen.getByRole("button", { name: /send rejection/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one reason/i);
  });

  it("submits once a reason is chosen, carrying the code and not the label", () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.click(screen.getByRole("button", { name: "This is not the dish" }));
    fireEvent.click(screen.getByRole("button", { name: /send rejection/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "rejected", reasonCodes: ["wrong_subject"] }),
    );
  });

  it("shows the operator words, never the stored codes", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));

    expect(screen.getByRole("button", { name: "This is not the dish" })).toBeTruthy();
    expect(screen.queryByText("wrong_subject")).toBeNull();
    expect(screen.queryByText(/alcohol_visible/)).toBeNull();
  });

  it("lets a reason be taken back off again", () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    const reason = screen.getByRole("button", { name: "Wrong cuisine" });
    fireEvent.click(reason);
    fireEvent.click(reason);
    fireEvent.click(screen.getByRole("button", { name: /send rejection/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("the optional note", () => {
  it("travels as null when left empty, never as an empty string", () => {
    const onSubmit = renderForm();

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Something else" }));
    fireEvent.change(screen.getByLabelText(/anything to add/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /send rejection/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
  });
});
