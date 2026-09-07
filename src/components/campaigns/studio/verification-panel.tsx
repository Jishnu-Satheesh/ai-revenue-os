"use client";

import { CircleAlert, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { PosterStudioRender } from "@/modules/campaigns/application/poster-studio-view";

/**
 * What was checked before a poster could be used, and what could not be.
 *
 * This panel reports the record `evaluateCreativeVerification` wrote. It does
 * not decide anything and it does not summarise: a green tick this component
 * invented would be a claim nobody made, sitting exactly where the real verdict
 * belongs.
 *
 * The distinction it exists to draw is between *failed* and *unknown*. A
 * checker that could not run is not a pass, and a blank where a verdict belongs
 * reads as one -- so an unavailable check is shown with the same weight as a
 * failed one and says which it is.
 */

const CHECK_LABEL: Readonly<Record<string, string>> = {
  glyphCoverage: "Every character has a glyph",
  plateText: "No text drawn into the picture",
  faces: "No identifiable person in the picture",
  subjectLikeness: "The dish still looks like the dish",
};

/** Advisory by design: it informs a human, and never blocks on its own. */
const ADVISORY_CHECKS: readonly string[] = ["subjectLikeness"];

type Note = { code?: unknown; detail?: unknown };

function notes(value: unknown): Note[] {
  return Array.isArray(value) ? (value as Note[]) : [];
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

export function VerificationPanel(props: { renders: readonly PosterStudioRender[] }) {
  const latest = props.renders[0] ?? null;

  if (!latest) {
    return (
      <Alert>
        <ShieldQuestion />
        <AlertTitle>Nothing checked yet</AlertTitle>
        <AlertDescription>
          Verification runs with a render. Nothing has been rendered for this script and template.
        </AlertDescription>
      </Alert>
    );
  }

  if (latest.state === "refused") {
    return (
      <Alert>
        <CircleAlert />
        <AlertTitle>Refused before verification</AlertTitle>
        <AlertDescription>
          Nothing was drawn, so there was nothing to check. The refusal above says why.
        </AlertDescription>
      </Alert>
    );
  }

  const record = latest.verification;
  const checks = (record.checks ?? {}) as Record<string, { ran?: unknown; reason?: unknown }>;

  // An empty record is not a pass. A render written before verification existed,
  // or one whose record was lost, has no verdict -- and saying so is the whole
  // point of the panel.
  if (Object.keys(record).length === 0) {
    return (
      <Alert>
        <ShieldQuestion />
        <AlertTitle>No verification recorded</AlertTitle>
        <AlertDescription>
          This poster carries no record of being checked. That is not the same as passing, and it
          should not be treated as one.
        </AlertDescription>
      </Alert>
    );
  }

  const blocks = notes(record.blocks);
  const verified = record.verified === true;

  return (
    <Alert variant={verified ? "default" : "destructive"}>
      {verified ? <ShieldCheck /> : <ShieldAlert />}
      <AlertTitle>{verified ? "Checked and clear" : "Held — a check did not pass"}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 flex flex-col gap-1">
          {Object.entries(CHECK_LABEL).map(([key, label]) => {
            const check = checks[key];
            const ran = check?.ran === true;
            return (
              <li key={key} className="text-xs">
                <span className="font-medium">{label}</span>
                {": "}
                {ran ? (
                  "checked"
                ) : (
                  <span>
                    could not run
                    {check === undefined
                      ? " — not recorded"
                      : ` — ${text(check.reason, "no reason recorded")}`}
                    {ADVISORY_CHECKS.includes(key) ? " (advisory)" : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {blocks.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {blocks.map((block, index) => (
              <li key={index} className="text-xs">
                {text(block.detail, text(block.code, "A check failed without a reason."))}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="mt-2 text-xs">
          A check that cannot run blocks rather than passes. Subject likeness is advisory and never
          blocks on its own.
        </p>
      </AlertDescription>
    </Alert>
  );
}
