// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ role: "owner" as string | undefined }));

vi.mock("@/components/organizations/organization-session", () => ({
  useOrganizationSession: () => ({
    data: mocks.role === undefined ? undefined : { role: mocks.role },
    isPending: false,
  }),
}));

import { MemoryIntegrationSettingsPanel } from "@/components/memory/integration-settings-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mocks.role = "owner";
});

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

const STORED = {
  organizationId: ORGANIZATION_ID,
  captureEnabled: false,
  channelContextEnabled: false,
  growthContextEnabled: false,
  campaignContextEnabled: false,
  subjectContextEnabled: false,
  legacyCorpusQualified: false,
  contextPolicyVersion: "shared-context-v1",
};

function stubFetch(respond: (url: string, init?: RequestInit) => unknown) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => respond(url, init));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function renderPanel() {
  render(<MemoryIntegrationSettingsPanel organizationId={ORGANIZATION_ID} />);
}

describe("memory integration settings panel", () => {
  it("loads the stored switches before showing the form", async () => {
    stubFetch(() => jsonResponse({ settings: STORED }));
    renderPanel();

    expect(screen.getByText(/loading memory settings/i)).toBeInTheDocument();
    expect(
      await screen.findByRole("switch", { name: /remember finished work/i }),
    ).not.toBeChecked();
  });

  it("saves through PATCH and reflects the saved switches", async () => {
    const fetch = stubFetch((url, init) => {
      if (init?.method === "PATCH")
        return jsonResponse({ settings: { ...STORED, captureEnabled: true } });
      return jsonResponse({ settings: STORED });
    });
    renderPanel();

    await userEvent.click(await screen.findByRole("switch", { name: /remember finished work/i }));
    await userEvent.click(screen.getByRole("button", { name: /save memory settings/i }));

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/organizations/${ORGANIZATION_ID}/memory/integrations`,
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    const patchInit = fetch.mock.calls.find(([, init]) => init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(patchInit?.body))).toEqual({
      captureEnabled: true,
      channelContextEnabled: false,
      growthContextEnabled: false,
      campaignContextEnabled: false,
      subjectContextEnabled: false,
      legacyCorpusQualified: false,
      contextPolicyVersion: "shared-context-v1",
    });
    // The saved row arrives as props without a remount, so both the switch
    // and the saved confirmation are visible after the save.
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /remember finished work/i })).toBeChecked(),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/saved\./i);
  });

  it("shows the saved confirmation after a save that changes the switches", async () => {
    stubFetch((url, init) => {
      if (init?.method === "PATCH")
        return jsonResponse({ settings: { ...STORED, captureEnabled: true } });
      return jsonResponse({ settings: STORED });
    });
    renderPanel();

    await userEvent.click(await screen.findByRole("switch", { name: /remember finished work/i }));
    await userEvent.click(screen.getByRole("button", { name: /save memory settings/i }));

    // The confirmation must survive the save: the panel re-renders with the
    // saved row, and the note has to still be there afterwards.
    expect(await screen.findByRole("status")).toHaveTextContent(/saved\./i);
  });

  it("shows the switches read-only to members who may not save", async () => {
    mocks.role = "operator";
    stubFetch(() => jsonResponse({ settings: STORED }));
    renderPanel();

    expect(
      await screen.findByText(/only owners and admins can change memory settings/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /remember finished work/i })).toBeDisabled();
  });

  it("says plainly when the settings could not be loaded", async () => {
    stubFetch(() => jsonResponse({ settings: null }, false));
    renderPanel();

    expect(await screen.findByRole("note")).toHaveTextContent(/could not be loaded/i);
  });

  it("turns a refused save into words", async () => {
    stubFetch((url, init) => {
      if (init?.method === "PATCH")
        return jsonResponse({ error: { code: "AUTHORIZATION_ERROR", message: "no" } }, false, 403);
      return jsonResponse({ settings: STORED });
    });
    renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /save memory settings/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only owners and admins can change memory settings/i,
    );
  });
});
