"use client";

import { useEffect, useState } from "react";

import {
  MemoryIntegrationSettingsForm,
  type MemoryIntegrationSettingsView,
} from "@/components/memory/integration-settings-form";
import { useOrganizationSession } from "@/components/organizations/organization-session";

/**
 * The memory settings form, wired to its own endpoint.
 *
 * Separate from the form so the form stays a pure function of its props and
 * can be tested without a network. This part owns exactly two things: loading
 * the stored switches (or their absence), and turning a save into a request
 * and a failed request into words a person can act on.
 *
 * The whole row saves at once and the panel keeps the version just saved, so
 * the page reflects the new posture without a reload.
 */

function parseStoredSettings(body: unknown): MemoryIntegrationSettingsView | null | "invalid" {
  if (typeof body !== "object" || body === null || !("settings" in body)) return "invalid";
  const stored = (body as { settings: unknown }).settings;
  if (stored === null) return null;
  if (typeof stored !== "object" || stored === null) return "invalid";
  const view = stored as Record<string, unknown>;
  const flags = [
    "captureEnabled",
    "channelContextEnabled",
    "growthContextEnabled",
    "campaignContextEnabled",
    "subjectContextEnabled",
    "legacyCorpusQualified",
  ] as const;
  if (
    !flags.every((flag) => typeof view[flag] === "boolean") ||
    typeof view.contextPolicyVersion !== "string"
  ) {
    return "invalid";
  }
  return {
    captureEnabled: view.captureEnabled as boolean,
    channelContextEnabled: view.channelContextEnabled as boolean,
    growthContextEnabled: view.growthContextEnabled as boolean,
    campaignContextEnabled: view.campaignContextEnabled as boolean,
    subjectContextEnabled: view.subjectContextEnabled as boolean,
    legacyCorpusQualified: view.legacyCorpusQualified as boolean,
    contextPolicyVersion: view.contextPolicyVersion as string,
  };
}

/** The submitted switches, read back without trusting the shape. */
function toSettingsView(settings: Record<string, unknown>): MemoryIntegrationSettingsView | null {
  const flags = [
    "captureEnabled",
    "channelContextEnabled",
    "growthContextEnabled",
    "campaignContextEnabled",
    "subjectContextEnabled",
    "legacyCorpusQualified",
  ] as const;
  if (
    !flags.every((flag) => typeof settings[flag] === "boolean") ||
    typeof settings.contextPolicyVersion !== "string"
  ) {
    return null;
  }
  return {
    captureEnabled: settings.captureEnabled as boolean,
    channelContextEnabled: settings.channelContextEnabled as boolean,
    growthContextEnabled: settings.growthContextEnabled as boolean,
    campaignContextEnabled: settings.campaignContextEnabled as boolean,
    subjectContextEnabled: settings.subjectContextEnabled as boolean,
    legacyCorpusQualified: settings.legacyCorpusQualified as boolean,
    contextPolicyVersion: settings.contextPolicyVersion as string,
  };
}

export function MemoryIntegrationSettingsPanel({
  organizationId,
}: Readonly<{ organizationId: string }>) {
  const { data: session, isPending: sessionPending } = useOrganizationSession(organizationId);
  const [current, setCurrent] = useState<MemoryIntegrationSettingsView | null | undefined>(
    undefined,
  );
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/organizations/${organizationId}/memory/integrations`);
        if (!response.ok) throw new Error("unreadable");
        const parsed = parseStoredSettings(await response.json().catch(() => null));
        if (cancelled) return;
        if (parsed === "invalid") {
          setUnavailable(true);
          return;
        }
        setCurrent(parsed);
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  // Null is "never configured" only once loaded — before that the form waits
  // rather than rendering blank as if the organization chose nothing. The
  // role gates the same way: an unknown role is not a denied one.
  if (current === undefined && !unavailable) {
    return <p className="text-sm text-muted-foreground">Loading memory settings…</p>;
  }
  if (sessionPending) {
    return <p className="text-sm text-muted-foreground">Loading memory settings…</p>;
  }

  const role = session?.role;
  const canSave = role === "owner" || role === "admin";

  return (
    <MemoryIntegrationSettingsForm
      // Stable across saves: the saved row arrives as props, so remounting
      // here would discard the form's own saved confirmation before it paints.
      key={organizationId}
      settings={unavailable ? null : (current ?? null)}
      canSave={canSave}
      unavailable={unavailable}
      onSave={async (settings) => {
        let response: Response;
        try {
          response = await fetch(`/api/organizations/${organizationId}/memory/integrations`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(settings),
          });
        } catch {
          return {
            ok: false as const,
            message: "The settings could not be reached. Check your connection and try again.",
          };
        }
        if (response.ok) {
          // The server stores the submitted switches verbatim, so an accepted
          // save is itself the new row. Anything unparseable keeps the old
          // switches rather than inventing the new ones.
          const view = toSettingsView(settings);
          if (view !== null) setCurrent(view);
          return { ok: true as const };
        }
        if (response.status === 403) {
          return {
            ok: false as const,
            message: "Only owners and admins can change memory settings.",
          };
        }
        const body: unknown = await response.json().catch(() => null);
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? (body as { error?: { message?: unknown } }).error?.message
            : null;
        return {
          ok: false as const,
          message:
            typeof message === "string" && message.length > 0
              ? message
              : "The memory settings could not be saved.",
        };
      }}
    />
  );
}
