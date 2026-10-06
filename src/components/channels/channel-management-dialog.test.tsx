// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { toast } from "sonner";
import {
  ChannelManagementDialog,
  type ChannelManagementDialogProps,
} from "@/components/channels/channel-management-dialog";
import type {
  ChannelSourceAliasRow,
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "33333333-3333-4333-8333-333333333333";

const channel: OrganizationChannelRow = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: organizationId,
  key: "keeta",
  display_name: "Keeta",
  category: "marketplace",
  template_key: "keeta",
  status: "active",
  created_by: actorId,
  archived_by: null,
  archived_at: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const archivedChannel: OrganizationChannelRow = {
  ...channel,
  id: "77777777-7777-4777-8777-777777777777",
  key: "previous",
  display_name: "Previous",
  status: "archived",
  archived_by: actorId,
  archived_at: "2026-08-25T00:00:00.000Z",
};

const branch: OrganizationBranchRow = {
  id: "44444444-4444-4444-8444-444444444444",
  organization_id: organizationId,
  name: "Al Barsha",
  slug: "al-barsha",
  kind: "physical",
  timezone: "Asia/Dubai",
  currency: "AED",
  service_area: {},
  operating_hours: {},
  contact_details: {},
  capacity_metadata: {},
  is_active: true,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const mapping: OrganizationChannelBranchRow = {
  id: "55555555-5555-4555-8555-555555555555",
  organization_id: organizationId,
  channel_id: channel.id,
  branch_id: branch.id,
  status: "active",
  effective_from: "2026-02-01",
  effective_to: null,
  created_by: actorId,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const alias: ChannelSourceAliasRow = {
  id: "66666666-6666-4666-8666-666666666666",
  organization_id: organizationId,
  channel_id: channel.id,
  alias: "Keeta orders",
  normalized_alias: "keeta orders",
  source_scope: "report_package",
  source_record_reference: null,
  status: "active",
  effective_from: null,
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

function renderDialog(overrides: Partial<ChannelManagementDialogProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(
    <ChannelManagementDialog
      organizationId={organizationId}
      channel={null}
      open
      onOpenChange={onOpenChange}
      branches={[]}
      branchMappings={[]}
      aliases={[]}
      canManage
      onSaved={onSaved}
      {...overrides}
    />,
    { wrapper },
  );
  return { ...utils, onOpenChange, onSaved, client };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setupFetch() {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fillCreateForm() {
  fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Online store" } });
  fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "online-store" } });
}

describe("create mode (D04)", () => {
  it("renders name/category/key order with the exact contract copy", () => {
    setupFetch();
    renderDialog({ channel: null });

    expect(screen.getByRole("dialog", { name: "Add a channel" })).toBeInTheDocument();
    expect(screen.getByText("Add a sales channel to your business directory.")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Online store")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Marketplace");
    expect(screen.getByPlaceholderText("e.g. online-store")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A permanent identifier for reports and imports. Use lower-case letters, numbers, dots or hyphens.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Advanced identity settings" })).toBeInTheDocument();
    expect(
      screen.getByText("Create this channel first, then add location mappings and report labels."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Adding a channel records its identity. Provider connections are managed in Integration Hub.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create channel" })).toBeInTheDocument();
  });

  it("keeps the provider hint collapsible with its boundary description", () => {
    setupFetch();
    renderDialog({ channel: null });

    expect(screen.queryByLabelText("Optional provider hint")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Advanced identity settings" }));
    expect(screen.getByLabelText("Optional provider hint")).toBeInTheDocument();
    expect(
      screen.getByText("A hint helps recognise reports. It does not create a provider connection."),
    ).toBeInTheDocument();
  });

  it("shows the Zod key message and sends nothing when the key is invalid", () => {
    const fetchMock = setupFetch();
    renderDialog({ channel: null });

    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Online store" } });
    fireEvent.change(screen.getByLabelText("Stable key"), { target: { value: "1 bad key!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(screen.getByText("Channel key must be a lower-case stable key.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks the footer and announces while creating", () => {
    const fetchMock = setupFetch();
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderDialog({ channel: null });
    fillCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    // The Spinner carries its own "Loading" label, so the pending button
    // name is matched loosely; the visible copy stays the exact contract.
    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    // The pending write is announced twice: visibly on the button and once
    // in the polite live region that guards dismissal.
    expect(document.querySelector("[aria-live='polite']")?.textContent).toBe("Creating…");
  });

  it("keeps values on failure, then retries through the same submit", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: "CONFLICT", message: "That key is taken." } }, 409),
    );
    const { onSaved } = renderDialog({ channel: null });
    fillCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    const failure = await screen.findByText("Channel was not saved");
    expect(failure).toBeInTheDocument();
    expect(screen.getByText("That key is taken.")).toBeInTheDocument();
    // Draft survives the failure; the dialog stays open for a retry.
    expect(screen.getByLabelText("Channel name")).toHaveValue("Online store");

    const created = { ...channel, key: "online-store", display_name: "Online store" };
    fetchMock.mockResolvedValueOnce(jsonResponse({ channel: created }, 201));
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Channel created."));
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Validated success transitions into Manage for the returned ID.
    expect(await screen.findByRole("dialog", { name: "Manage Online store" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save channel" })).toBeInTheDocument();
  });
});

describe("manage mode identity (D05)", () => {
  it("renders editable identity with a read-only key and disclosure counts", () => {
    setupFetch();
    renderDialog({
      channel,
      branches: [branch],
      branchMappings: [mapping],
      aliases: [alias],
    });

    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
    expect(
      screen.getByText("Update the channel identity and its reporting labels."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Channel name")).toHaveValue("Keeta");
    const keyInput = screen.getByDisplayValue("keeta");
    expect(keyInput).toHaveAttribute("readonly");
    expect(screen.getByText("This identity is permanent.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save channel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Locations/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /Report labels/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Archive channel" })).toBeInTheDocument();
  });

  it("saves identity without the stable key and stays open for further setup", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValue(jsonResponse({ channel: { ...channel, display_name: "Keeta X" } }));
    const { onSaved } = renderDialog({ channel });

    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Keeta X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Channel saved."));
    expect(onSaved).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("key");
    // One saved section does not close Manage while other drafts may remain.
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
  });

  it("keeps the draft and the dialog open when identity save fails", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: true }, 500));
    renderDialog({ channel });

    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Keeta X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));

    await screen.findByText("Channel was not saved");
    expect(
      screen.getByText("The channel could not be saved. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Channel name")).toHaveValue("Keeta X");
  });

  it("keeps unsaved drafts when refreshed props arrive", () => {
    setupFetch();
    const { rerender } = renderDialog({ channel });
    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Keeta draft" } });

    // Same wrapper/client, only the snapshot row changes: the draft wins.
    rerender(
      <ChannelManagementDialog
        organizationId={organizationId}
        channel={{ ...channel, display_name: "Keeta renamed elsewhere" }}
        open
        onOpenChange={() => {}}
        branches={[]}
        branchMappings={[]}
        aliases={[]}
        canManage
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText("Channel name")).toHaveValue("Keeta draft");
  });

  it("reveals saved mappings and labels inside the disclosure shells", () => {
    setupFetch();
    renderDialog({ channel, branches: [branch], branchMappings: [mapping], aliases: [alias] });

    fireEvent.click(screen.getByRole("button", { name: /Locations/ }));
    expect(screen.getByText("Al Barsha")).toBeInTheDocument();
    expect(screen.getByText("2026-02-01")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Report labels/ }));
    // The alias text appears twice: once in the collapsed saved summary and
    // once in the expanded detail row. The scope label pins the detail row.
    expect(screen.getAllByText("Keeta orders")).toHaveLength(2);
    expect(screen.getByText("Report package")).toBeInTheDocument();
  });

  it("discards an idle dirty form on close without writing", () => {
    const fetchMock = setupFetch();
    const onOpenChange = vi.fn();
    const { rerender } = renderDialog({ channel, onOpenChange });

    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Abandoned" } });
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();

    // Closing unmounts the Radix content; reopening starts from the snapshot.
    rerender(
      <ChannelManagementDialog
        organizationId={organizationId}
        channel={channel}
        open={false}
        onOpenChange={onOpenChange}
        branches={[]}
        branchMappings={[]}
        aliases={[]}
        canManage
        onSaved={() => {}}
      />,
    );
    rerender(
      <ChannelManagementDialog
        organizationId={organizationId}
        channel={channel}
        open
        onOpenChange={onOpenChange}
        branches={[]}
        branchMappings={[]}
        aliases={[]}
        canManage
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText("Channel name")).toHaveValue("Keeta");
  });
});

describe("status transitions (D06)", () => {
  it("cancels archive confirmation and returns focus to the status trigger", async () => {
    setupFetch();
    renderDialog({ channel });

    // A real click focuses the trigger first; jsdom does not, so focus it
    // explicitly to mirror the browser before opening the confirmation.
    const trigger = screen.getByRole("button", { name: "Archive channel" });
    trigger.focus();
    fireEvent.click(trigger);
    const confirm = await screen.findByRole("alertdialog", { name: "Archive channel?" });
    expect(
      within(confirm).getByText(
        "Keeta will move to Archived. Its history and report labels remain available.",
      ),
    ).toBeInTheDocument();
    expect(
      within(confirm).getByText("Archived channels are excluded from the active portfolio."),
    ).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Archive channel?" })).toBeNull(),
    );
    // Manage itself stays open and focus is back where the flow started.
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Archive channel" })).toHaveFocus(),
    );
  });

  it("archives with pending lock, then closes both dialogs and refreshes", async () => {
    const fetchMock = setupFetch();
    let release!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const { onSaved, onOpenChange } = renderDialog({ channel });
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archive channel" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Archive channel?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Archive" }));

    // Radix hides the Manage dialog behind the modal confirmation, so all
    // pending assertions stay scoped to the confirmation itself.
    expect(await within(confirm).findByRole("button", { name: /Archiving/ })).toBeDisabled();
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toBeDisabled();

    release(jsonResponse({ channel: { ...channel, status: "archived" } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Channel archived."));
    expect(onSaved).toHaveBeenCalledTimes(1);
    // Success closes the confirmation and asks the parent to close Manage.
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Archive channel?" })).toBeNull(),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ status: "archived" });
  });

  it("keeps the failure visible inside the confirmation", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: true }, 500));
    renderDialog({ channel });

    fireEvent.click(screen.getByRole("button", { name: "Archive channel" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Archive channel?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Archive" }));

    await within(confirm).findByText("Channel status was not changed");
    expect(
      within(confirm).getByText("The channel status could not be changed. Please try again."),
    ).toBeInTheDocument();
    // Failure closes neither the confirmation nor the dialog behind it.
    expect(screen.getByRole("alertdialog", { name: "Archive channel?" })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("restores an archived channel with its own copy and toast", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({ channel: { ...archivedChannel, status: "active" } }),
    );
    const { onSaved } = renderDialog({ channel: archivedChannel });

    expect(screen.getByRole("dialog", { name: "Manage Previous" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore channel" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Restore channel?" });
    expect(
      within(confirm).getByText(
        "Previous will return to the active directory with its history intact.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole("button", { name: "Restore" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Channel restored."));
    expect(onSaved).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ status: "active" });
  });
});

describe("read-only roles", () => {
  it("renders Channel details with no mutation controls for a viewer", () => {
    setupFetch();
    renderDialog({
      channel: archivedChannel,
      branches: [branch],
      branchMappings: [],
      aliases: [],
      canManage: false,
    });

    expect(screen.getByRole("dialog", { name: "Channel details" })).toBeInTheDocument();
    expect(screen.getByText("Channel identity and reporting configuration.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Channel name")).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore channel" })).not.toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Status:")).toBeInTheDocument();
    // Saved configuration stays discoverable behind the same shells.
    expect(screen.getByRole("button", { name: /Locations/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report labels/ })).toBeInTheDocument();
  });

  it("keeps identity and status read-only for a map-only operator", () => {
    const fetchMock = setupFetch();
    renderDialog({ channel, canManage: false, canMapBranches: true });

    // The operator opens the same Manage entry Task 7 wires its sections into.
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Channel name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save channel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive channel" })).not.toBeInTheDocument();
    expect(screen.getByText(/Status:/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mapping and label sections (D07/D08)", () => {
  it("extends the description and offers both editable sections to a map-only operator", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({
        mapping: {
          id: "55555555-5555-4555-8555-555555555555",
          organization_id: organizationId,
          channel_id: channel.id,
          branch_id: branch.id,
          status: "active",
          effective_from: null,
          effective_to: null,
          created_by: actorId,
          created_at: "2026-09-10T00:00:00.000Z",
          updated_at: "2026-09-10T00:00:00.000Z",
        },
      }),
    );
    const { onSaved } = renderDialog({
      channel,
      branches: [branch],
      branchMappings: [],
      aliases: [],
      canManage: false,
      canMapBranches: true,
    });

    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
    // Task 6 ruling: the viewer base copy stands; Task 7 adds the grant.
    expect(
      screen.getByText(
        "Channel identity and reporting configuration. You can manage locations and report labels.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save channel" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Locations/ }));
    expect(screen.getByRole("combobox", { name: "Outlet" })).toHaveTextContent("Al Barsha");
    expect(screen.getByRole("button", { name: "Save location mapping" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Report labels/ }));
    expect(screen.getByLabelText("Exact report label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save report label" })).toBeInTheDocument();

    // Each section saves independently through its own endpoint.
    fireEvent.click(screen.getByRole("button", { name: "Save location mapping" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Location mapping saved."));
    expect(onSaved).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channel.id}/branches`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      branchId: branch.id,
      applicability: "active",
      effectiveFrom: null,
      effectiveTo: null,
    });
    // One saved section leaves Manage open for the other drafts.
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
  });

  it("shows a viewer the saved lists with badges and dates but no forms", () => {
    setupFetch();
    renderDialog({
      channel,
      branches: [branch],
      branchMappings: [mapping],
      aliases: [alias],
      canManage: false,
    });

    expect(screen.getByText("Channel identity and reporting configuration.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Locations/ }));
    expect(screen.getByText("Al Barsha")).toBeInTheDocument();
    // "Active" also names the channel status line, so pin the badge to its row.
    const mappingRow = screen.getByText("Al Barsha").closest("li");
    expect(mappingRow).not.toBeNull();
    expect(within(mappingRow as HTMLElement).getByText("Active")).toBeInTheDocument();
    expect(within(mappingRow as HTMLElement).getByText("2026-02-01")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Outlet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save location mapping" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Report labels/ }));
    expect(screen.getAllByText("Keeta orders")).toHaveLength(2);
    expect(screen.getByText("Report package")).toBeInTheDocument();
    expect(screen.queryByLabelText("Exact report label")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save report label" })).not.toBeInTheDocument();
  });

  it("keeps an identity success when a later label save fails", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/aliases")) {
        return Promise.resolve(jsonResponse({ error: true }, 500));
      }
      return Promise.resolve(jsonResponse({ channel: { ...channel, display_name: "Keeta X" } }));
    });
    const { onSaved } = renderDialog({
      channel,
      branches: [branch],
      branchMappings: [],
      aliases: [],
      canManage: true,
      canMapBranches: true,
    });

    fireEvent.change(screen.getByLabelText("Channel name"), { target: { value: "Keeta X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save channel" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Channel saved."));

    fireEvent.click(screen.getByRole("button", { name: /Report labels/ }));
    fireEvent.change(screen.getByLabelText("Exact report label"), {
      target: { value: "Website orders" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save report label" }));

    await screen.findByText("Report label was not saved");
    expect(
      screen.getByText("The report label could not be saved. Please try again."),
    ).toBeInTheDocument();
    // The failed section keeps its draft; the dialog stays open on Manage.
    expect(screen.getByLabelText("Exact report label")).toHaveValue("Website orders");
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
    // Partial success is explicit: the only announced success is identity.
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Channel saved.");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("lets a denied mapping response override the assumed permission", async () => {
    const fetchMock = setupFetch();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "FORBIDDEN", message: "Only a branch manager can map locations." } },
        403,
      ),
    );
    renderDialog({
      channel,
      branches: [branch],
      branchMappings: [],
      aliases: [],
      canManage: false,
      canMapBranches: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /Locations/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save location mapping" }));

    await screen.findByText("Location mapping was not saved");
    expect(screen.getByText("Only a branch manager can map locations.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Outlet" })).toHaveTextContent("Al Barsha");
    expect(screen.getByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
  });
});
