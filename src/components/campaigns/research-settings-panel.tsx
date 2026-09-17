"use client";

import { useEffect, useState } from "react";

import {
  ResearchSettingsForm,
  type ResearchLedgerView,
  type ResearchScheduleView,
} from "@/components/campaigns/research-settings-form";

/**
 * The research settings form, wired to its own endpoints.
 *
 * Separate from the form so the form stays a pure function of its props and can
 * be tested without a network. This part owns exactly one thing: turning a save
 * into requests, and a failed request into words a person can act on.
 *
 * The money and the rhythm save separately. The spending limits are a new
 * policy version every time; the cadence is one row that is replaced. If the
 * second save fails the first still stands, and the form says exactly that
 * rather than reporting half a save as whole.
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
  // The cadence loads after mount so the server page stays untouched: it
  // knows the ledger, this knows the rhythm. Null is "not scheduled" only
  // once loaded — before that the form waits rather than rendering blank as
  // if the organization chose nothing.
  const [schedule, setSchedule] = useState<ResearchScheduleView | null>(null);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [scheduleUnavailable, setScheduleUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/organizations/${organizationId}/campaign-research/schedule`,
        );
        if (!response.ok) throw new Error("unreadable");
        const body: unknown = await response.json().catch(() => null);
        const stored =
          typeof body === "object" && body !== null && "schedule" in body
            ? (body as { schedule: unknown }).schedule
            : null;
        if (cancelled) return;
        if (stored === null) {
          setSchedule(null);
        } else if (
          typeof stored === "object" &&
          stored !== null &&
          "enabled" in stored &&
          "intervalDays" in stored &&
          "qualifyingChangeKinds" in stored &&
          typeof (stored as { enabled: unknown }).enabled === "boolean" &&
          typeof (stored as { intervalDays: unknown }).intervalDays === "number" &&
          Array.isArray((stored as { qualifyingChangeKinds: unknown }).qualifyingChangeKinds)
        ) {
          const view = stored as {
            enabled: boolean;
            intervalDays: number;
            qualifyingChangeKinds: unknown;
          };
          setSchedule({
            enabled: view.enabled,
            intervalDays: view.intervalDays,
            qualifyingChangeKinds: (view.qualifyingChangeKinds as unknown[]).filter(
              (kind): kind is string => typeof kind === "string",
            ),
          });
        } else {
          setScheduleUnavailable(true);
        }
      } catch {
        if (!cancelled) setScheduleUnavailable(true);
      } finally {
        if (!cancelled) setScheduleLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  if (!scheduleLoaded) {
    return <p className="text-sm text-muted-foreground">Loading research settings…</p>;
  }

  return (
    <ResearchSettingsForm
      key={current.policy?.version ?? "unset"}
      ledger={current}
      timezone={timezone}
      organizationCurrency={organizationCurrency}
      schedule={schedule}
      scheduleUnavailable={scheduleUnavailable}
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
      onSaveSchedule={async (next) => {
        let response: Response;
        try {
          response = await fetch(
            `/api/organizations/${organizationId}/campaign-research/schedule`,
            {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(next),
            },
          );
        } catch {
          return { ok: false, message: "That could not be sent. The cadence was not saved." };
        }

        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const message =
            typeof body === "object" && body !== null && "message" in body
              ? String((body as { message: unknown }).message)
              : "That could not be saved.";
          return { ok: false, message };
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
