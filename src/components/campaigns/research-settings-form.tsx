"use client";

import { useState } from "react";

import { EVIDENCE_QUALIFICATION_RULE_VERSION } from "@/domain/campaigns/research-policy";
import { fromMinorUnits, toMinorUnits } from "@/domain/reference/currencies";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * What an organization is willing to spend finding out what to do next.
 *
 * Research calls paid providers, so nothing here has a default. A blank field
 * is refused rather than filled in: an organization that has not said what it
 * will spend has not authorized spending, and choosing a number on its behalf
 * would be the platform inventing an operating limit.
 *
 * Every save writes a **new version**. Runs record the version that admitted
 * them, so editing a policy in place would retroactively rewrite what earlier
 * spending was allowed to be. The form says so, because "Save" usually means
 * "overwrite" and here it does not.
 */

export type ResearchPolicyView = {
  version: number;
  enabled: boolean;
  timezone: string;
  evidenceMaxAgeDays: number;
  cooldownSeconds: number;
  maxPendingProposals: number;
  maxAttempts: number;
  perRunAllowance: { amountMinor: number; currency: string };
  windowAllowance: { amountMinor: number; currency: string };
  windowDays: number;
};

export type ResearchLedgerView = {
  policy: ResearchPolicyView | null;
  pendingCount: number;
  windowSpentMinor: number;
  lastAdmittedAt: string | null;
};

/**
 * The rhythm research runs on, when the organization wants one.
 *
 * Null is "not scheduled", never an implied cadence — the section opens
 * blank like the money section, and an enabled schedule names what warrants
 * it. Enabling the rhythm never enables spending, which stays bound to the
 * policy's own switch above.
 */
export type ResearchScheduleView = {
  enabled: boolean;
  intervalDays: number;
  qualifyingChangeKinds: readonly string[];
};

type Fields = {
  enabled: boolean;
  timezone: string;
  currency: string;
  perRun: string;
  window: string;
  windowDays: string;
  cooldownMinutes: string;
  maxPending: string;
  maxAttempts: string;
  evidenceMaxAgeDays: string;
  scheduleEnabled: boolean;
  scheduleIntervalDays: string;
  qualifyOnMemoryRevision: boolean;
  qualifyOnCadence: boolean;
};

function initialFields(
  ledger: ResearchLedgerView,
  fallbackCurrency: string,
  fallbackTimezone: string,
  schedule: ResearchScheduleView | null,
): Fields {
  const policy = ledger.policy;
  // An organization with no policy starts blank on purpose. Pre-filling
  // plausible numbers is how a budget nobody chose ends up in force. The
  // cadence starts blank the same way: no row is "not scheduled", never an
  // implied rhythm.
  const base: Fields = {
    enabled: false,
    timezone: fallbackTimezone,
    currency: fallbackCurrency,
    perRun: "",
    window: "",
    windowDays: "",
    cooldownMinutes: "",
    maxPending: "",
    maxAttempts: "",
    evidenceMaxAgeDays: "",
    scheduleEnabled: false,
    scheduleIntervalDays: "",
    qualifyOnMemoryRevision: false,
    qualifyOnCadence: false,
  };
  if (policy) {
    base.enabled = policy.enabled;
    base.timezone = policy.timezone;
    base.currency = policy.perRunAllowance.currency;
    base.perRun = fromMinorUnits(
      policy.perRunAllowance.amountMinor,
      policy.perRunAllowance.currency,
    );
    base.window = fromMinorUnits(
      policy.windowAllowance.amountMinor,
      policy.windowAllowance.currency,
    );
    base.windowDays = String(policy.windowDays);
    base.cooldownMinutes = String(Math.round(policy.cooldownSeconds / 60));
    base.maxPending = String(policy.maxPendingProposals);
    base.maxAttempts = String(policy.maxAttempts);
    base.evidenceMaxAgeDays = String(policy.evidenceMaxAgeDays);
  }
  if (schedule) {
    base.scheduleEnabled = schedule.enabled;
    base.scheduleIntervalDays = String(schedule.intervalDays);
    base.qualifyOnMemoryRevision = schedule.qualifyingChangeKinds.includes("memory_revision");
    base.qualifyOnCadence = schedule.qualifyingChangeKinds.includes("scheduled_cadence");
  }
  return base;
}

function wholeNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function ResearchSettingsForm({
  ledger,
  timezone,
  organizationCurrency,
  schedule,
  scheduleUnavailable,
  onSave,
  onSaveSchedule,
}: Readonly<{
  ledger: ResearchLedgerView;
  timezone: string;
  /** Offered as the starting currency, never as the answer. */
  organizationCurrency: string;
  /** Null is "not scheduled", never an implied cadence. */
  schedule: ResearchScheduleView | null;
  /** The cadence could not be loaded: its section says so and saves nothing. */
  scheduleUnavailable: boolean;
  onSave: (policy: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; message: string }>;
  onSaveSchedule: (
    schedule: Record<string, unknown>,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}>) {
  const [fields, setFields] = useState<Fields>(() =>
    initialFields(ledger, organizationCurrency, timezone, schedule),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setSaved(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);

    const perRunMinor = toMinorUnits(fields.perRun, fields.currency);
    const windowMinor = toMinorUnits(fields.window, fields.currency);
    const windowDays = wholeNumber(fields.windowDays);
    const cooldownMinutes = wholeNumber(fields.cooldownMinutes);
    const maxPending = wholeNumber(fields.maxPending);
    const maxAttempts = wholeNumber(fields.maxAttempts);
    const evidenceMaxAgeDays = wholeNumber(fields.evidenceMaxAgeDays);
    const scheduleIntervalDays = wholeNumber(fields.scheduleIntervalDays);
    const qualifyingChangeKinds = [
      ...(fields.qualifyOnMemoryRevision ? ["memory_revision"] : []),
      ...(fields.qualifyOnCadence ? ["scheduled_cadence"] : []),
    ];

    if (
      perRunMinor === null ||
      windowMinor === null ||
      windowDays === null ||
      cooldownMinutes === null ||
      maxPending === null ||
      maxAttempts === null ||
      evidenceMaxAgeDays === null
    ) {
      setError("Every figure has to be filled in before research can spend anything.");
      return;
    }

    if (fields.timezone.trim() === "") {
      setError("The schedule needs a timezone before research can run on a rhythm.");
      return;
    }

    if (scheduleUnavailable) {
      setError("The cadence could not be loaded, so nothing was saved. Reload and try again.");
      return;
    }

    if (scheduleIntervalDays === null || scheduleIntervalDays < 1 || scheduleIntervalDays > 30) {
      setError("The cadence needs how many days between evaluations, from 1 to 30.");
      return;
    }

    if (qualifyingChangeKinds.length === 0) {
      setError(
        "The cadence needs at least one qualifying change, or no evaluation would ever warrant research.",
      );
      return;
    }

    if (windowMinor < perRunMinor) {
      setError(
        "The window allowance cannot be smaller than one run's allowance, or nothing would ever be admitted.",
      );
      return;
    }

    setPending(true);
    const result = await onSave({
      enabled: fields.enabled,
      timezone: fields.timezone.trim(),
      // Names the platform's own rules, not a choice this organization makes.
      evidenceQualificationRuleVersion: EVIDENCE_QUALIFICATION_RULE_VERSION,
      evidenceMaxAgeDays,
      cooldownSeconds: cooldownMinutes * 60,
      maxPendingProposals: maxPending,
      maxAttempts,
      perRunAllowance: { amountMinor: perRunMinor, currency: fields.currency },
      windowAllowance: { amountMinor: windowMinor, currency: fields.currency },
      windowDays,
    });
    if (!result.ok) {
      setPending(false);
      setError(result.message);
      return;
    }
    const scheduleResult = await onSaveSchedule({
      enabled: fields.scheduleEnabled,
      intervalDays: scheduleIntervalDays,
      qualifyingChangeKinds,
    });
    setPending(false);

    if (scheduleResult.ok) setSaved("Saved as a new version. It is in force from now.");
    else
      setError(
        `The spending limits were saved, but the cadence was not: ${scheduleResult.message}`,
      );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {ledger.policy === null ? (
        // Guidance, not an alert. A screen reader announcing "not set up yet"
        // assertively on arrival competes with the failure message below, and
        // only one of the two is urgent.
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium">Research is not set up yet</p>
          <p className="text-sm text-muted-foreground">
            Nothing can be researched until this is filled in. There are no suggested figures —
            what the platform may spend on your behalf is yours to decide.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Version {ledger.policy.version} is in force. {ledger.pendingCount} request
          {ledger.pendingCount === 1 ? " is" : "s are"} waiting, and{" "}
          {fromMinorUnits(ledger.windowSpentMinor, ledger.policy.perRunAllowance.currency)}{" "}
          {ledger.policy.perRunAllowance.currency} of this window&rsquo;s allowance is already
          reserved.
        </p>
      )}

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="research-enabled" className="text-sm font-medium">
            Research is switched on
          </Label>
          <p className="text-sm text-muted-foreground">
            Off means nothing is researched and nothing is spent. The figures below can be set
            either way.
          </p>
        </div>
        <Switch
          id="research-enabled"
          checked={fields.enabled}
          onCheckedChange={(checked) => update("enabled", checked)}
        />
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">What it may spend</legend>

        <NumberField
          id="research-currency"
          label="Currency"
          hint="Both allowances are in this currency."
          value={fields.currency}
          onChange={(value) => update("currency", value.toUpperCase())}
          inputMode="text"
        />
        <NumberField
          id="research-per-run"
          label="Most one piece of research may cost"
          hint="A ceiling for a single run, not a target."
          value={fields.perRun}
          onChange={(value) => update("perRun", value)}
        />
        <NumberField
          id="research-window"
          label="Most all research may cost in a window"
          hint="Everything reserved inside the window below counts against this."
          value={fields.window}
          onChange={(value) => update("window", value)}
        />
        <NumberField
          id="research-window-days"
          label="How many days the window covers"
          value={fields.windowDays}
          onChange={(value) => update("windowDays", value)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">How often, and how hard it tries</legend>

        <NumberField
          id="research-timezone"
          label="Schedule timezone"
          hint="Evaluations follow midnight in this timezone."
          value={fields.timezone}
          onChange={(value) => update("timezone", value)}
          inputMode="text"
        />
        <NumberField
          id="research-cooldown"
          label="Minutes to wait between runs"
          hint="Zero means no wait, which is a choice rather than a blank."
          value={fields.cooldownMinutes}
          onChange={(value) => update("cooldownMinutes", value)}
        />
        <NumberField
          id="research-max-pending"
          label="How many requests may be waiting at once"
          value={fields.maxPending}
          onChange={(value) => update("maxPending", value)}
        />
        <NumberField
          id="research-max-attempts"
          label="How many times one request may be attempted"
          hint="A run whose worker dies is returned to the queue until this is reached, then given up on."
          value={fields.maxAttempts}
          onChange={(value) => update("maxAttempts", value)}
        />
        <NumberField
          id="research-evidence-age"
          label="How old outside evidence may be, in days"
          hint="Anything older stops counting as evidence."
          value={fields.evidenceMaxAgeDays}
          onChange={(value) => update("evidenceMaxAgeDays", value)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">When research asks on its own</legend>

        {scheduleUnavailable ? (
          <p role="note" className="text-sm text-muted-foreground">
            The cadence could not be loaded. The limits above still save; reload to change when
            research asks on its own.
          </p>
        ) : null}

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="research-schedule-enabled" className="text-sm font-medium">
              Evaluate on a schedule
            </Label>
            <p className="text-sm text-muted-foreground">
              Off means research only starts when someone asks. Switching this on never switches
              spending on — the policy above still binds every run.
            </p>
          </div>
          <Switch
            id="research-schedule-enabled"
            checked={fields.scheduleEnabled}
            onCheckedChange={(checked) => update("scheduleEnabled", checked)}
          />
        </div>

        <NumberField
          id="research-schedule-interval"
          label="Days between scheduled evaluations"
          hint="From 1 to 30. A missed evaluation stays missed rather than admitting twice."
          value={fields.scheduleIntervalDays}
          onChange={(value) => update("scheduleIntervalDays", value)}
        />

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="research-schedule-kind-memory" className="text-sm font-medium">
              Business Memory changed
            </Label>
            <p className="text-sm text-muted-foreground">
              A new memory digest since the last evaluation warrants research. The same digest seen
              again warrants nothing.
            </p>
          </div>
          <Switch
            id="research-schedule-kind-memory"
            checked={fields.qualifyOnMemoryRevision}
            onCheckedChange={(checked) => update("qualifyOnMemoryRevision", checked)}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="research-schedule-kind-cadence" className="text-sm font-medium">
              Every scheduled window
            </Label>
            <p className="text-sm text-muted-foreground">
              The window itself warrants research, whether or not anything changed.
            </p>
          </div>
          <Switch
            id="research-schedule-kind-cadence"
            checked={fields.qualifyOnCadence}
            onCheckedChange={(checked) => update("qualifyOnCadence", checked)}
          />
        </div>
      </fieldset>

      {error === null ? null : (
        <Alert variant="destructive" role="alert">
          <AlertTitle>This was not saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {saved === null ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {saved}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Saving…" : "Save as a new version"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Saving never edits what is already in force. Research already admitted keeps the terms it
          was admitted under.
        </p>
      </div>
    </form>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  inputMode = "decimal",
}: Readonly<{
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal" | "text";
}>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
