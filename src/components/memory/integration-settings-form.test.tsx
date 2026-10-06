// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MemoryIntegrationSettingsForm,
  type MemoryIntegrationSettingsView,
} from "@/components/memory/integration-settings-form";

afterEach(cleanup);

type Save = (
  settings: Record<string, unknown>,
) => Promise<{ ok: true } | { ok: false; message: string }>;

function saver() {
  return vi.fn<Save>(async () => ({ ok: true }) as const);
}

const SETTINGS: MemoryIntegrationSettingsView = {
  captureEnabled: false,
  channelContextEnabled: false,
  growthContextEnabled: false,
  campaignContextEnabled: false,
  subjectContextEnabled: false,
  legacyCorpusQualified: false,
  contextPolicyVersion: "shared-context-v1",
};

function renderForm(
  settings: MemoryIntegrationSettingsView | null = SETTINGS,
  onSave: Save = saver(),
  options: { canSave?: boolean; unavailable?: boolean } = {},
) {
  render(
    <MemoryIntegrationSettingsForm
      settings={settings}
      canSave={options.canSave ?? true}
      unavailable={options.unavailable ?? false}
      onSave={onSave}
    />,
  );
}

describe("memory integration settings", () => {
  it("starts switched off and says why when never configured", async () => {
    renderForm(null);

    expect(screen.getByText(/memory is not set up yet/i)).toBeInTheDocument();
    // Every switch starts off: what the platform may remember is the
    // organization's decision, and no row is no decision.
    for (const name of [
      /remember finished work/i,
      /channel advice may recall/i,
      /growth research may recall/i,
      /campaigns may recall/i,
      /writing help may recall/i,
      /trust older content/i,
    ]) {
      expect(screen.getByRole("switch", { name })).not.toBeChecked();
    }
  });

  it("saves every switch as one explicit choice", async () => {
    const onSave = saver();
    renderForm(SETTINGS, onSave);

    await userEvent.click(screen.getByRole("switch", { name: /remember finished work/i }));
    await userEvent.click(screen.getByRole("switch", { name: /channel advice may recall/i }));
    await userEvent.click(screen.getByRole("button", { name: /save memory settings/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      captureEnabled: true,
      channelContextEnabled: true,
      growthContextEnabled: false,
      campaignContextEnabled: false,
      subjectContextEnabled: false,
      legacyCorpusQualified: false,
      contextPolicyVersion: "shared-context-v1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
  });

  it("disables everything with an explanation when the viewer may not save", async () => {
    const onSave = saver();
    renderForm(SETTINGS, onSave, { canSave: false });

    expect(
      screen.getByText(/only owners and admins can change memory settings/i),
    ).toBeInTheDocument();
    for (const name of [/remember finished work/i, /trust older content/i]) {
      expect(screen.getByRole("switch", { name })).toBeDisabled();
    }
    expect(screen.getByRole("button", { name: /save memory settings/i })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("says plainly when the settings could not be loaded", async () => {
    renderForm(SETTINGS, saver(), { unavailable: true });

    expect(screen.getByRole("note")).toHaveTextContent(/could not be loaded/i);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save memory settings/i })).not.toBeInTheDocument();
  });

  it("reports a refused save in words", async () => {
    const onSave = saver();
    onSave.mockResolvedValueOnce({
      ok: false,
      message: "Only owners and admins can change memory settings.",
    });
    renderForm(SETTINGS, onSave);

    await userEvent.click(screen.getByRole("button", { name: /save memory settings/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only owners and admins can change memory settings/i,
    );
  });
});
