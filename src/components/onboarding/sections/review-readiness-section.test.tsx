// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ReviewReadinessSection } from "@/components/onboarding/sections/review-readiness-section";

afterEach(() => cleanup());

describe("ReviewReadinessSection", () => {
  it("requires readiness generation before review confirmation", () => {
    render(
      <ReviewReadinessSection readiness={null} onConfirm={vi.fn().mockResolvedValue(false)} />,
    );
    expect(screen.getByText("Readiness has not been generated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate readiness" })).toBeEnabled();
  });
});
