"use client";

import { useState } from "react";
import { Pencil, Plus, Store, X } from "lucide-react";

import {
  useOrganizationCompetitors,
  type OrganizationCompetitorInput,
} from "@/components/growth-intelligence/organization-competitors";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const COMPETITOR_NAME_LIMIT = 160;
const COMPETITOR_HINT_LIMIT = 240;

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function validWebsite(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Organisation-wide competitors inside Guided onboarding. Reads and writes
 * the same store as the New research dialog (Track C1 list API via
 * `useOrganizationCompetitors`): edits here appear as the dialog's starting
 * list and vice versa. Changes save immediately to the organisation — they
 * are not part of the section's Save draft payload.
 */
export function OrganizationCompetitorsBlock({ organizationId }: { organizationId: string }) {
  const store = useOrganizationCompetitors(organizationId, true);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [hint, setHint] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    const trimmedName = normalize(name);
    const trimmedWebsite = website.trim();
    const trimmedHint = normalize(hint);
    if (trimmedName.length === 0) {
      setFormError("A competitor name is required.");
      return;
    }
    if (trimmedName.length > COMPETITOR_NAME_LIMIT) {
      setFormError(`Competitor names hold at most ${COMPETITOR_NAME_LIMIT} characters.`);
      return;
    }
    if (trimmedWebsite.length > 0 && !validWebsite(trimmedWebsite)) {
      setFormError("A competitor website must be a valid public HTTP or HTTPS URL.");
      return;
    }
    if (trimmedHint.length > COMPETITOR_HINT_LIMIT) {
      setFormError(`Location hints hold at most ${COMPETITOR_HINT_LIMIT} characters.`);
      return;
    }
    const duplicate = store.competitors.some(
      (row) =>
        row.id !== editingId &&
        row.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    if (duplicate) {
      setFormError("That competitor is already listed.");
      return;
    }
    const row: OrganizationCompetitorInput = {
      name: trimmedName,
      website: trimmedWebsite,
      locationHint: trimmedHint,
    };
    if (editingId !== null) {
      await store.update(editingId, row);
      setEditingId(null);
    } else {
      await store.add(row);
    }
    setName("");
    setWebsite("");
    setHint("");
    setFormError(null);
  }

  function edit(id: string) {
    const row = store.competitors.find((candidate) => candidate.id === id);
    if (!row) return;
    setEditingId(row.id);
    setName(row.name);
    setWebsite(row.website ?? "");
    setHint(row.locationHint ?? "");
    setFormError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setName("");
    setWebsite("");
    setHint("");
    setFormError(null);
  }

  return (
    <section aria-label="Competitors to watch" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Competitors to watch</h4>
        <span className="text-xs text-muted-foreground">Saved to the organisation</span>
      </div>
      <p className="text-xs text-muted-foreground">
        New research starts from this same list. Changes here save immediately.
      </p>
      {!store.isLoaded ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading saved competitors…
        </p>
      ) : store.competitors.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {store.competitors.map((row) => (
            <li
              key={row.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 text-sm"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"
              >
                <Store className="size-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium break-words">{row.name}</span>
                <span className="block truncate text-muted-foreground">
                  {(row.locationHint || "Location to be checked") +
                    (row.website ? ` · ${row.website}` : "")}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Edit competitor ${row.name}`}
                  onClick={() => edit(row.id)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove competitor ${row.name}`}
                  onClick={() => store.remove(row.id)}
                >
                  <X aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No competitors saved yet.</p>
      )}
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="onboarding-competitor-name">Competitor name</FieldLabel>
          <Input
            id="onboarding-competitor-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Rival Kitchen"
            maxLength={COMPETITOR_NAME_LIMIT + 1}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="onboarding-competitor-website">
            Website <span className="font-normal text-muted-foreground">Optional</span>
          </FieldLabel>
          <Input
            id="onboarding-competitor-website"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="https://example.com"
            inputMode="url"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="onboarding-competitor-hint">
            Location hint <span className="font-normal text-muted-foreground">Optional</span>
          </FieldLabel>
          <Input
            id="onboarding-competitor-hint"
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            placeholder="Near Marina Mall"
            maxLength={COMPETITOR_HINT_LIMIT + 1}
          />
        </Field>
      </div>
      {formError ? <FieldError role="alert">{formError}</FieldError> : null}
      {store.syncError ? (
        <p role="status" className="text-xs text-muted-foreground">
          {store.syncError}
        </p>
      ) : null}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => void save()}>
          <Plus aria-hidden="true" />
          {editingId !== null ? "Save competitor" : "Add a competitor"}
        </Button>
        {editingId !== null ? (
          <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </section>
  );
}
