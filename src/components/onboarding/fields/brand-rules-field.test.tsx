// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrandRulesField } from "@/components/onboarding/fields/brand-rules-field";
import { PaletteField } from "@/components/onboarding/fields/palette-field";

afterEach(() => cleanup());

describe("BrandRulesField", () => {
  it("refuses to add a rule whose strength was never chosen", () => {
    // Spec §5. Defaulting to either strength would decide, on the operator's
    // behalf, whether the platform may publish work that breaks the rule.
    const onChange = vi.fn();
    render(<BrandRulesField id="rules" value={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Rule"), {
      target: { value: "Never show alcohol" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/absolute or preferred/i);
  });

  it("adds a rule once both halves are answered", () => {
    const onChange = vi.fn();
    render(<BrandRulesField id="rules" value={[]} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Rule"), {
      target: { value: "Never show alcohol" },
    });
    fireEvent.click(screen.getByLabelText(/absolute/i));
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    expect(onChange).toHaveBeenCalledWith([{ text: "Never show alcohol", strength: "hard" }]);
  });

  it("says what each strength will actually do", () => {
    // An operator cannot mark a rule absolute meaningfully without being told
    // that absolute means a campaign can be stopped.
    render(<BrandRulesField id="rules" value={[]} onChange={vi.fn()} />);

    expect(screen.getByText(/can stop a campaign being built/i)).toBeInTheDocument();
    expect(screen.getByText(/a departure is disclosed/i)).toBeInTheDocument();
  });

  it("drops a stored rule it cannot read rather than showing it as preferred", () => {
    // A rule persisted by an older build with no strength must not appear as
    // though somebody had marked it the lenient way.
    render(
      <BrandRulesField
        id="rules"
        value={[{ text: "Never show alcohol" }, { text: "Lead with the food", strength: "soft" }]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText("Never show alcohol")).not.toBeInTheDocument();
    expect(screen.getByText("Lead with the food")).toBeInTheDocument();
  });
});

describe("PaletteField", () => {
  it("emits only the slots that were actually filled", () => {
    // An empty string is not a colour. Passing one on fails validation at save
    // time, which discards the whole record silently.
    const onChange = vi.fn();
    render(<PaletteField id="palette" value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Primary"), { target: { value: "#C8102E" } });

    expect(onChange).toHaveBeenCalledWith({ primary: "#c8102e" });
  });

  it("marks a half-typed colour invalid without discarding what was typed", () => {
    render(<PaletteField id="palette" value={{ primary: "#c81" }} onChange={vi.fn()} />);

    expect(screen.getByLabelText("Primary")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Primary")).toHaveValue("#c81");
  });
});
