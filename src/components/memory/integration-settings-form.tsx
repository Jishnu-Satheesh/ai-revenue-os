"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * What the organization lets Business Memory remember, and who may recall it.
 *
 * Nothing here has a default. A missing row means the organization has never
 * decided, and the form opens with every switch off rather than filling in a
 * posture nobody chose. Saving writes the whole row at once: the switches are
 * one decision, so a half-saved mix can never be in force.
 */

export type MemoryIntegrationSettingsView = {
  captureEnabled: boolean;
  channelContextEnabled: boolean;
  growthContextEnabled: boolean;
  campaignContextEnabled: boolean;
  subjectContextEnabled: boolean;
  legacyCorpusQualified: boolean;
  contextPolicyVersion: string;
};

type Fields = {
  captureEnabled: boolean;
  channelContextEnabled: boolean;
  growthContextEnabled: boolean;
  campaignContextEnabled: boolean;
  subjectContextEnabled: boolean;
  legacyCorpusQualified: boolean;
};

function initialFields(settings: MemoryIntegrationSettingsView | null): Fields {
  return {
    captureEnabled: settings?.captureEnabled ?? false,
    channelContextEnabled: settings?.channelContextEnabled ?? false,
    growthContextEnabled: settings?.growthContextEnabled ?? false,
    campaignContextEnabled: settings?.campaignContextEnabled ?? false,
    subjectContextEnabled: settings?.subjectContextEnabled ?? false,
    legacyCorpusQualified: settings?.legacyCorpusQualified ?? false,
  };
}

export function MemoryIntegrationSettingsForm({
  settings,
  canSave,
  unavailable,
  onSave,
}: Readonly<{
  /** Null is "never configured", never an implied posture. */
  settings: MemoryIntegrationSettingsView | null;
  canSave: boolean;
  /** The settings could not be loaded: nothing shows as set or unset. */
  unavailable: boolean;
  onSave: (
    settings: Record<string, unknown>,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}>) {
  const [fields, setFields] = useState<Fields>(() => initialFields(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (unavailable) {
    return (
      <p role="note" className="text-sm text-muted-foreground">
        The memory settings could not be loaded. Nothing is shown as set or unset; reload to try
        again.
      </p>
    );
  }

  function update<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setSaved(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(null);
    setPending(true);
    const result = await onSave({
      ...fields,
      contextPolicyVersion: settings?.contextPolicyVersion ?? "shared-context-v1",
    });
    setPending(false);

    if (result.ok) {
      setSaved(
        "Saved. New finished work follows these switches from now; earlier work is picked up over the next minutes.",
      );
    } else {
      setError(result.message);
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      {settings === null ? (
        // Guidance, not an alert: arriving here unset is ordinary, and an
        // assertive announcement would compete with a real failure below.
        <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium">Memory is not set up yet</p>
          <p className="text-sm text-muted-foreground">
            Nothing is being remembered until this is saved. Every switch starts off — what the
            platform may remember on your behalf is yours to decide.
          </p>
        </div>
      ) : null}

      {!canSave ? (
        <p className="text-sm text-muted-foreground">
          Only owners and admins can change memory settings. You can see how it is set.
        </p>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">Remember</legend>
        <SwitchRow
          id="memory-capture-enabled"
          label="Remember finished work"
          hint="On means channel findings, recommendations and decisions are recorded into memory as they complete. Off means nothing new is recorded; what is already remembered stays."
          checked={fields.captureEnabled}
          disabled={!canSave}
          onChange={(checked) => update("captureEnabled", checked)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">Who may recall</legend>
        <SwitchRow
          id="memory-channel-context-enabled"
          label="Channel advice may recall"
          hint="On means channel analysis and recommendations can draw on remembered work. Off means they work from the current report alone."
          checked={fields.channelContextEnabled}
          disabled={!canSave}
          onChange={(checked) => update("channelContextEnabled", checked)}
        />
        <SwitchRow
          id="memory-growth-context-enabled"
          label="Growth research may recall"
          hint="On means growth research and briefs can draw on remembered work. Off means they work from fresh research alone."
          checked={fields.growthContextEnabled}
          disabled={!canSave}
          onChange={(checked) => update("growthContextEnabled", checked)}
        />
        <SwitchRow
          id="memory-campaign-context-enabled"
          label="Campaigns may recall"
          hint="On means campaign research and drafting can draw on remembered work. Off means they work from the brief alone."
          checked={fields.campaignContextEnabled}
          disabled={!canSave}
          onChange={(checked) => update("campaignContextEnabled", checked)}
        />
        <SwitchRow
          id="memory-subject-context-enabled"
          label="Writing help may recall"
          hint="On means drafting assistance can draw on remembered work. Off means it works from what you give it alone."
          checked={fields.subjectContextEnabled}
          disabled={!canSave}
          onChange={(checked) => update("subjectContextEnabled", checked)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-medium">Older content</legend>
        <SwitchRow
          id="memory-legacy-corpus-qualified"
          label="Trust older content"
          hint="On means answers may use content saved before memory kept full provenance records. Leave this off until that older content has been reviewed."
          checked={fields.legacyCorpusQualified}
          disabled={!canSave}
          onChange={(checked) => update("legacyCorpusQualified", checked)}
        />
      </fieldset>

      <p className="text-sm text-muted-foreground">
        Rules version: {settings?.contextPolicyVersion ?? "shared-context-v1"}. It travels with
        every save unchanged.
      </p>

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
        <Button type="submit" disabled={pending || !canSave} className="self-start">
          {pending ? "Saving…" : "Save memory settings"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Saving replaces the whole row at once. What was remembered under earlier settings stays
          remembered.
        </p>
      </div>
    </form>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
