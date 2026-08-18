// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DigitalTwinWorkspace } from "@/components/organizations/digital-twin-workspace";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => cleanup());

const snapshot: DigitalTwinSnapshot = {
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Al Noor Kitchen",
    slug: "al-noor-kitchen",
    industry: "restaurant",
    country_code: "AE",
    base_currency: "AED",
    default_timezone: "Asia/Dubai",
    industry_pack_slug: "restaurant",
    branchless_confirmed: false,
    status: "draft_onboarding",
    account_id: "33333333-3333-4333-8333-333333333333",
    created_by: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
    archived_at: null,
  },
  branches: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      organization_id: "11111111-1111-4111-8111-111111111111",
      name: "JLT",
      slug: "jlt",
      kind: "physical",
      timezone: "Asia/Dubai",
      currency: "AED",
      service_area: {},
      operating_hours: {},
      contact_details: {},
      capacity_metadata: {},
      is_active: true,
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-12T08:00:00.000Z",
    },
  ],
  profile: {
    organization_id: "11111111-1111-4111-8111-111111111111",
    business_model: "Multi-location casual dining",
    value_proposition: "Reliable family meals",
    customer_segments: [],
    brand_context: {},
    languages: ["en", "ar"],
    operating_model: {},
    source: "owner interview",
    updated_by: "22222222-2222-4222-8222-222222222222",
    created_at: "2026-08-01T08:00:00.000Z",
    updated_at: "2026-08-12T08:00:00.000Z",
  },
  facts: [],
  goals: [],
  constraints: [],
  policies: [],
  auditEvents: [],
};

describe("DigitalTwinWorkspace", () => {
  it("presents all seven authoritative sections as progressive disclosure for a viewer", () => {
    render(
      <DigitalTwinWorkspace
        organizationId={snapshot.organization.id}
        snapshot={snapshot}
        permissions={{
          canManageCore: false,
          canManagePolicies: false,
          canManageLifecycle: false,
        }}
      />,
    );

    for (const label of [
      "Identity",
      "Branches",
      "Business profile",
      "Facts",
      "Goals",
      "Constraints",
      "Policies",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
    expect(screen.queryByText("Organization management")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("lets an operator manage core data but never policies or lifecycle", () => {
    render(
      <DigitalTwinWorkspace
        organizationId={snapshot.organization.id}
        snapshot={snapshot}
        permissions={{
          canManageCore: true,
          canManagePolicies: false,
          canManageLifecycle: false,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open organization management" }));

    expect(screen.getByText("Organization management")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Business profile" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Constraints" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Policies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive draft" })).not.toBeInTheDocument();
  });

  it("lets an admin reach policies and lifecycle controls", () => {
    render(
      <DigitalTwinWorkspace
        organizationId={snapshot.organization.id}
        snapshot={snapshot}
        permissions={{
          canManageCore: true,
          canManagePolicies: true,
          canManageLifecycle: true,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open organization management" }));

    expect(screen.getByRole("tab", { name: "Policies" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive draft" })).toBeInTheDocument();
  });
});
