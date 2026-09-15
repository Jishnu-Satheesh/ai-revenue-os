// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ResearchSettingsForm,
  type ResearchLedgerView,
} from "@/components/campaigns/research-settings-form";

afterEach(cleanup);

type Save = (policy: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; message: string }>;

function saver() {
  return vi.fn<Save>(async () => ({ ok: true }) as const);
}

const SET_POLICY: ResearchLedgerView = {
  policy: {
    version: 3,
    enabled: true,
    timezone: "Asia/Dubai",
    evidenceMaxAgeDays: 30,
    cooldownSeconds: 3600,
    maxPendingProposals: 5,
    maxAttempts: 2,
    perRunAllowance: { amountMinor: 5000, currency: "AED" },
    windowAllowance: { amountMinor: 20000, currency: "AED" },
    windowDays: 30,
  },
  pendingCount: 1,
  windowSpentMinor: 5000,
  lastAdmittedAt: "2026-09-14T09:00:00.000Z",
};

const NO_POLICY: ResearchLedgerView = {
  policy: null,
  pendingCount: 0,
  windowSpentMinor: 0,
  lastAdmittedAt: null,
};

function renderForm(ledger: ResearchLedgerView, onSave: Save = saver()) {
  render(
    <ResearchSettingsForm
      ledger={ledger}
      timezone="Asia/Dubai"
      organizationCurrency="AED"
      onSave={onSave}
    />,
  );
}

describe("setting what research may spend", () => {
  it("starts blank when nothing has been set, and says why", async () => {
    renderForm(NO_POLICY);

    // Pre-filling plausible numbers is how a budget nobody chose ends up in
    // force. The absence is the point.
    expect(screen.getByText(/research is not set up yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/most one piece of research may cost/i)).toHaveValue("");
    expect(screen.getByLabelText(/how many times one request may be attempted/i)).toHaveValue("");
  });

  it("refuses to save while any figure is missing", async () => {
    const onSave = saver();
    renderForm(NO_POLICY, onSave);

    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /every figure has to be filled in/i,
    );
  });

  it("shows what the policy in force already allows", () => {
    renderForm(SET_POLICY);

    expect(screen.getByText(/version 3 is in force/i)).toBeInTheDocument();
    // A budget means nothing without what is already reserved against it.
    expect(screen.getByText(/1 request is waiting/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/most one piece of research may cost/i)).toHaveValue("50.00");
  });

  it("sends money as integer minor units", async () => {
    const onSave = saver();
    renderForm(SET_POLICY, onSave);

    await userEvent.clear(screen.getByLabelText(/most one piece of research may cost/i));
    await userEvent.type(screen.getByLabelText(/most one piece of research may cost/i), "75.50");
    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // AED 75.50 is 7550 fils. Sending a decimal would put a float into a money
    // column.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      perRunAllowance: { amountMinor: 7550, currency: "AED" },
    });
  });

  it("sends the cooldown in seconds, having asked in minutes", async () => {
    const onSave = saver();
    renderForm(SET_POLICY, onSave);

    await userEvent.clear(screen.getByLabelText(/minutes to wait between runs/i));
    await userEvent.type(screen.getByLabelText(/minutes to wait between runs/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ cooldownSeconds: 900 });
  });

  it("refuses a window allowance smaller than one run", async () => {
    const onSave = saver();
    renderForm(SET_POLICY, onSave);

    await userEvent.clear(screen.getByLabelText(/most all research may cost in a window/i));
    await userEvent.type(screen.getByLabelText(/most all research may cost in a window/i), "10");
    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    // It would read as a budget while admitting nothing.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /cannot be smaller than one run/i,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("lets a budget be set while research stays switched off", async () => {
    const onSave = saver();
    renderForm(SET_POLICY, onSave);

    // Setting a budget and turning it on are different decisions.
    await userEvent.click(screen.getByRole("switch", { name: /research is switched on/i }));
    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ enabled: false });
  });

  it("names the platform's own evidence rules rather than asking for them", async () => {
    const onSave = saver();
    renderForm(SET_POLICY, onSave);

    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // Which qualification rules apply is the platform's own logic, not a choice
    // an organization makes, so it is carried rather than requested.
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      evidenceQualificationRuleVersion: expect.stringContaining("evidence-qualification@"),
    });
    expect(screen.queryByLabelText(/qualification rule/i)).not.toBeInTheDocument();
  });

  it("says a save is a new version rather than an edit", () => {
    renderForm(SET_POLICY);

    // "Save" usually means overwrite. Here it does not, and research already
    // admitted keeps the terms it was admitted under.
    expect(screen.getByText(/saving never edits what is already in force/i)).toBeInTheDocument();
  });

  it("reports a refused save instead of claiming success", async () => {
    const onSave = vi.fn<Save>(async () => ({
      ok: false as const,
      message: "You may not configure campaign research.",
    }));
    renderForm(SET_POLICY, onSave);

    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /you may not configure campaign research/i,
    );
    expect(screen.queryByText(/in force from now/i)).not.toBeInTheDocument();
  });

  it("confirms a save, and says it takes effect now", async () => {
    renderForm(SET_POLICY);

    await userEvent.click(screen.getByRole("button", { name: /save as a new version/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/in force from now/i);
  });
});
