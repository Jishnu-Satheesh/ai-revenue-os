// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { IntegrationsUploadsSection } from "@/components/onboarding/sections/integrations-uploads-section";

afterEach(() => cleanup());

describe("IntegrationsUploadsSection", () => {
  it("shows governed handoffs without credential fields", () => {
    render(<IntegrationsUploadsSection onSave={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText("Provider connection")).toBeInTheDocument();
    expect(
      screen.getByText(/Credentials are created through governed provider flows/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/password|secret|token/i)).not.toBeInTheDocument();
  });
});
