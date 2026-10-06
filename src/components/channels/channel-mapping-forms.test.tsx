// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChannelLocationForm,
  ChannelReportLabelForm,
} from "@/components/channels/channel-mapping-forms";
import type {
  ChannelSourceAliasRow,
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
} from "@/modules/channels/application/ports";

const organizationId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";

function branchRow(id: string, name: string, isActive: boolean): OrganizationBranchRow {
  return {
    id,
    organization_id: organizationId,
    name,
    slug: name.toLowerCase().replace(/ /g, "-"),
    kind: "physical",
    timezone: "Asia/Dubai",
    currency: "AED",
    service_area: {},
    operating_hours: {},
    contact_details: {},
    capacity_metadata: {},
    is_active: isActive,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

const branchB = branchRow("44444444-4444-4444-8444-444444444444", "Al Barsha", true);
const branchA = branchRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Deira", true);
const branchC = branchRow("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Jumeirah", true);
const branchRetired = branchRow("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Old Souq", false);

function mappingRow(
  id: string,
  branchId: string,
  status: "active" | "inactive",
  effectiveFrom: string | null,
  effectiveTo: string | null,
): OrganizationChannelBranchRow {
  return {
    id,
    organization_id: organizationId,
    channel_id: channelId,
    branch_id: branchId,
    status,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    created_by: actorId,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

const mappingB = mappingRow(
  "55555555-5555-4555-8555-555555555555",
  branchB.id,
  "inactive",
  "2026-01-01",
  null,
);
const mappingA = mappingRow(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  branchA.id,
  "active",
  "2026-02-01",
  "2026-02-28",
);
const mappingGhost = mappingRow(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "99999999-9999-4999-8999-999999999999",
  "inactive",
  "2025-01-01",
  "2025-12-31",
);

const aliasRow: ChannelSourceAliasRow = {
  id: "66666666-6666-4666-8666-666666666666",
  organization_id: organizationId,
  channel_id: channelId,
  alias: "Keeta orders",
  normalized_alias: "keeta orders",
  source_scope: "report_package",
  source_record_reference: null,
  status: "active",
  effective_from: "2026-02-01",
  effective_to: null,
  confirmed_at: null,
  created_by: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setupFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderLocationForm(props: {
  branches?: readonly OrganizationBranchRow[];
  mappings?: readonly OrganizationChannelBranchRow[];
  canMap?: boolean;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <ChannelLocationForm
      organizationId={organizationId}
      channelId={channelId}
      branches={props.branches ?? [branchA]}
      mappings={props.mappings ?? []}
      canMap={props.canMap ?? true}
      onSaved={onSaved}
    />,
    { wrapper },
  );
  return { onSaved };
}

function renderAliasForm(props: { aliases?: readonly ChannelSourceAliasRow[]; canMap?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <ChannelReportLabelForm
      organizationId={organizationId}
      channelId={channelId}
      aliases={props.aliases ?? []}
      canMap={props.canMap ?? true}
      onSaved={onSaved}
    />,
    { wrapper },
  );
  return { onSaved };
}

async function chooseOption(triggerName: string, optionName: string) {
  const trigger = screen.getByRole("combobox", { name: triggerName });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  const option = within(await screen.findByRole("listbox")).getByRole("option", {
    name: optionName,
  });
  fireEvent.click(option);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ChannelLocationForm (D07)", () => {
  it("saves one mapping via PUT with the UUID, applicability and dates", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({
        mapping: {
          id: "55555555-5555-4555-8555-555555555555",
          organization_id: organizationId,
          channel_id: channelId,
          branch_id: branchA.id,
          status: "inactive",
          effective_from: "2026-02-01",
          effective_to: "2026-02-28",
          created_by: actorId,
          created_at: "2026-09-10T00:00:00.000Z",
          updated_at: "2026-09-10T00:00:00.000Z",
        },
      }),
    );
    const { onSaved } = renderLocationForm({ branches: [branchA], mappings: [] });

    await chooseOption("Applicability", "Inactive");
    fireEvent.change(screen.getByLabelText("Effective from"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.change(screen.getByLabelText("Effective to"), {
      target: { value: "2026-02-28" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save location mapping" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channelId}/branches`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      branchId: branchA.id,
      applicability: "inactive",
      effectiveFrom: "2026-02-01",
      effectiveTo: "2026-02-28",
    });
  });

  it("blocks a reversed date range without a request and focuses Effective to", () => {
    const fetchMock = setupFetch();
    renderLocationForm({ branches: [branchA], mappings: [] });

    fireEvent.change(screen.getByLabelText("Effective from"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(screen.getByLabelText("Effective to"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save location mapping" }));

    expect(screen.getByText("The end date cannot be before the start date.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Effective to")).toHaveFocus();
  });

  it("loads the selected branch's saved status and dates; fresh branches start active with open dates", async () => {
    setupFetch();
    // Al Barsha sorts first, so the draft starts from its inactive January
    // record — never from the first arbitrary mapping in the array.
    renderLocationForm({
      branches: [branchB, branchA, branchC],
      mappings: [mappingA, mappingB],
    });

    expect(screen.getByRole("combobox", { name: "Outlet" })).toHaveTextContent("Al Barsha");
    expect(screen.getByRole("combobox", { name: "Applicability" })).toHaveTextContent("Inactive");
    expect(screen.getByLabelText("Effective from")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Effective to")).toHaveValue("");

    await chooseOption("Outlet", "Deira");
    expect(screen.getByRole("combobox", { name: "Applicability" })).toHaveTextContent("Active");
    expect(screen.getByLabelText("Effective from")).toHaveValue("2026-02-01");
    expect(screen.getByLabelText("Effective to")).toHaveValue("2026-02-28");

    await chooseOption("Outlet", "Jumeirah");
    expect(screen.getByRole("combobox", { name: "Applicability" })).toHaveTextContent("Active");
    expect(screen.getByLabelText("Effective from")).toHaveValue("");
    expect(screen.getByLabelText("Effective to")).toHaveValue("");

    // Switching back restores the stored record; the Jumeirah draft is gone.
    await chooseOption("Outlet", "Al Barsha");
    expect(screen.getByRole("combobox", { name: "Applicability" })).toHaveTextContent("Inactive");
    expect(screen.getByLabelText("Effective from")).toHaveValue("2026-01-01");
    expect(screen.getByLabelText("Effective to")).toHaveValue("");
  });

  it("keeps inactive history, unknown branches and the no-active notice", () => {
    setupFetch();
    renderLocationForm({
      branches: [branchA, branchB],
      mappings: [mappingGhost, mappingB],
      canMap: false,
    });

    expect(screen.getByText("No active mappings")).toBeInTheDocument();
    expect(screen.getByText("Historical location")).toBeInTheDocument();
    expect(screen.getAllByText("Inactive")).toHaveLength(2);
    expect(screen.getByText("2025-01-01")).toBeInTheDocument();
    expect(screen.getByText("2025-12-31")).toBeInTheDocument();
    // The open-ended January record states its limits honestly.
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();
  });

  it("shows an unbounded record as No date limits", () => {
    setupFetch();
    renderLocationForm({
      branches: [branchB],
      mappings: [
        mappingRow("55555555-5555-4555-8555-555555555555", branchB.id, "active", null, null),
      ],
      canMap: false,
    });

    expect(screen.getByText("Al Barsha")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("No date limits")).toBeInTheDocument();
  });

  it("shows the no-branch empty state with no enabled save", () => {
    setupFetch();
    renderLocationForm({ branches: [], mappings: [] });

    expect(
      screen.getByText(
        "Add an active branch in organization settings before mapping this channel.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("treats retired-only branches as no mappable outlet", () => {
    setupFetch();
    renderLocationForm({ branches: [branchRetired], mappings: [] });

    expect(
      screen.getByText(
        "Add an active branch in organization settings before mapping this channel.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });

  it("renders the saved list without forms for a viewer", () => {
    setupFetch();
    renderLocationForm({ branches: [branchA], mappings: [mappingA], canMap: false });

    expect(screen.getByText("Deira")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("2026-02-01")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Outlet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save location mapping" })).not.toBeInTheDocument();
  });
});

describe("ChannelReportLabelForm (D08)", () => {
  it("posts one exact punctuated alias without splitting and clears only that field", async () => {
    const fetchMock = setupFetch();
    let release!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const { onSaved } = renderAliasForm({ aliases: [] });

    const punctuated = "Website orders; Smile (Easy-Eats), v2.0";
    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: punctuated },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    expect(await screen.findByRole("button", { name: /Saving/ })).toBeDisabled();
    // Nothing clears before the validated response arrives.
    expect(screen.getByLabelText("Exact report label")).toHaveValue(punctuated);

    release(
      jsonResponse(
        {
          alias: {
            id: "66666666-6666-4666-8666-666666666666",
            organization_id: organizationId,
            channel_id: channelId,
            alias: punctuated,
            normalized_alias: punctuated.toLowerCase(),
            source_scope: "manual",
            source_record_reference: null,
            status: "active",
            effective_from: null,
            effective_to: null,
            confirmed_at: null,
            created_by: null,
            created_at: "2026-09-10T00:00:00.000Z",
            updated_at: "2026-09-10T00:00:00.000Z",
          },
        },
        201,
      ),
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Exact report label")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channelId}/aliases`);
    expect(init.method).toBe("POST");
    // One alias, punctuation and semicolons intact — never a bulk split.
    expect(JSON.parse(String(init.body))).toEqual({
      alias: punctuated,
      sourceScope: "manual",
      effectiveFrom: null,
      effectiveTo: null,
    });
  });

  it("offers all six real scopes and sends the chosen one", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValue(jsonResponse({ alias: { ...aliasRow, alias: "X" } }, 201));
    renderAliasForm({ aliases: [] });

    const trigger = screen.getByRole("combobox", { name: "Where did this label come from?" });
    expect(trigger).toHaveTextContent("Manual label");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Manual label",
      "Report package",
      "Onboarding",
      "Normalized metric",
      "Economics entry",
      "Cost rate",
    ]);

    // The open listbox hides its trigger from the accessibility tree, so pick
    // from the already-open menu instead of reopening it.
    fireEvent.click(within(listbox).getByRole("option", { name: "Report package" }));
    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: "Keeta package feed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ sourceScope: "report_package" });
  });

  it("retains every input on conflict and surfaces the server message", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "CONFLICT", message: "That label is already used." } }, 409),
    );
    const { onSaved } = renderAliasForm({ aliases: [] });

    await chooseOption("Where did this label come from?", "Onboarding");
    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: "Taken label" },
    });
    fireEvent.change(screen.getByLabelText("Effective from"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    await screen.findByText("Report label was not saved");
    expect(screen.getByText("That label is already used.")).toBeInTheDocument();
    expect(screen.getByLabelText("Exact report label")).toHaveValue("Taken label");
    expect(
      screen.getByRole("combobox", { name: "Where did this label come from?" }),
    ).toHaveTextContent("Onboarding");
    expect(screen.getByLabelText("Effective from")).toHaveValue("2026-02-01");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("makes a single request after an ambiguous network failure", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockRejectedValueOnce(new TypeError("connection reset"));
    const { onSaved } = renderAliasForm({ aliases: [] });

    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: "Unsent label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    await screen.findByText("Report label was not saved");
    expect(
      screen.getByText("The report label could not be saved. Please try again."),
    ).toBeInTheDocument();
    // No auto-retry: one ambiguous failure stays one request, draft intact.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Exact report label")).toHaveValue("Unsent label");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rejects a malformed success without clearing and reports the safe error", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 201));
    const { onSaved } = renderAliasForm({ aliases: [] });

    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: "Ghost label" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    await screen.findByText("Report label was not saved");
    expect(
      screen.getByText("The report label could not be saved. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Exact report label")).toHaveValue("Ghost label");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("blocks a reversed date range without a request and focuses Effective to", () => {
    const fetchMock = setupFetch();
    renderAliasForm({ aliases: [] });

    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: "Dated label" },
    });
    fireEvent.change(screen.getByLabelText("Effective from"), {
      target: { value: "2026-03-01" },
    });
    fireEvent.change(screen.getByLabelText("Effective to"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    expect(screen.getByText("The end date cannot be before the start date.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Effective to")).toHaveFocus();
  });

  it("renders saved labels with scope and dates, read-only for a viewer", () => {
    setupFetch();
    renderAliasForm({ aliases: [aliasRow], canMap: false });

    expect(screen.getByText("Keeta orders")).toBeInTheDocument();
    expect(screen.getByText("Report package")).toBeInTheDocument();
    expect(screen.getByText("2026-02-01")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exact report label")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save report label" })).not.toBeInTheDocument();
  });

  it("shows the empty saved list without a form for a viewer", () => {
    setupFetch();
    renderAliasForm({ aliases: [], canMap: false });

    expect(screen.getByText("No report labels yet.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exact report label")).not.toBeInTheDocument();
  });
});
