"use client";

import { useState } from "react";

import {
  ResearchSettingsForm,
  type ResearchLedgerView,
} from "@/components/campaigns/research-settings-form";

/**
 * The research settings form, wired to its own endpoint.
 *
 * Separate from the form so the form stays a pure function of its props and can
 * be tested without a network. This part owns exactly one thing: turning a save
 * into a request, and a failed request into words a person can act on.
 */
export function ResearchSettingsPanel({
  organizationId,
  ledger,
  timezone,
  organizationCurrency,
}: Readonly<{
  organizationId: string;
  ledger: ResearchLedgerView;
  timezone: string;
  organizationCurrency: string;
}>) {
  // Kept so the page reflects the version just saved without a reload, which
  // matters because the copy states which version is in force.
  const [current, setCurrent] = useState(ledger);

  return (
    <ResearchSettingsForm
      key={current.policy?.version ?? "unset"}
      ledger={current}
      timezone={timezone}
      organizationCurrency={organizationCurrency}
      onSave={async (policy) => {
        let response: Response;
        try {
          response = await fetch(
            `/api/organizations/${organizationId}/campaign-research/settings`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(policy),
            },
          );
        } catch {
          // A request that never arrived did not save anything, and must not
          // be reported as if it might have.
          return { ok: false, message: "That could not be sent. Nothing was saved." };
        }

        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const message =
            typeof body === "object" && body !== null && "message" in body
              ? String((body as { message: unknown }).message)
              : "That could not be saved.";
          return { ok: false, message };
        }

        const saved: unknown = await response.json().catch(() => null);
        const version =
          typeof saved === "object" && saved !== null && "version" in saved
            ? Number((saved as { version: unknown }).version)
            : null;

        // The new version is now in force, and the pending and reserved figures
        // it is judged against are unchanged by saving it.
        if (version !== null && current.policy !== null) {
          setCurrent({ ...current, policy: { ...current.policy, version, ...readEnabled(policy) } });
        }
        return { ok: true };
      }}
    />
  );
}

/** The one saved field the surface restates, read back without trusting the rest. */
function readEnabled(policy: Record<string, unknown>): { enabled: boolean } | Record<string, never> {
  return typeof policy.enabled === "boolean" ? { enabled: policy.enabled } : {};
}
