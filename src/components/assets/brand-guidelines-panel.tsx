"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import type { LibraryReference } from "@/components/assets/asset-library-grid";
import { reviewReasonLabel } from "@/components/assets/asset-vocabulary";
import { BrandRulesField } from "@/components/onboarding/fields/brand-rules-field";
import { PaletteField } from "@/components/onboarding/fields/palette-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TagListField } from "@/components/onboarding/fields/tag-list-field";
import { splitRulesByStrength, type BrandGuidelines, type BrandRule } from "@/domain/brand/guidelines";
import { BRAND_LOGO_VARIANTS, type BrandLogoSelection, type BrandLogoVariant } from "@/domain/brand/logo";

/**
 * The organization's mark and the rules generation must respect.
 *
 * Two claims this panel is careful about, because both are the kind a client
 * would act on:
 *
 * **The logo is exact where we draw it and conditioning where a model draws.**
 * The sidebar renders these bytes; an image model is *shown* them and asked to
 * place the mark. It is not guaranteed to reproduce it, and no copy here may
 * suggest otherwise — that is what `brand_mark_distorted` exists to record at
 * review.
 *
 * **A pointer that still resolves is not a logo that is still good.**
 * Usability is checked when a logo is set, but the image behind it can be
 * rejected afterwards. Such a variant is reported broken, with its reason, and
 * the other variant is *not* substituted: a mark somebody rejected must stop
 * appearing, not reappear under a different label.
 */

type BrandIdentityResponse = {
  guidelines: BrandGuidelines;
  logos: BrandLogoSelection[];
};

const VARIANT_COPY: Readonly<Record<BrandLogoVariant, { label: string; help: string }>> = {
  primary: {
    label: "Primary",
    help: "Your mark as it normally appears. Used everywhere unless a dark version is set.",
  },
  dark: {
    label: "Dark backgrounds",
    help: "Optional. Without one, the primary is used on dark ground rather than recoloured.",
  },
};

export function brandIdentityQueryKey(organizationId: string) {
  return ["organizations", organizationId, "brand-identity"] as const;
}

/** What is wrong with a variant, or null when it is fine. */
type LogoState =
  | { kind: "unset" }
  | { kind: "ok"; reference: LibraryReference }
  | { kind: "missing" }
  | { kind: "rejected"; reference: LibraryReference };

function logoState(
  variant: BrandLogoVariant,
  logos: readonly BrandLogoSelection[],
  references: readonly LibraryReference[],
): LogoState {
  const selection = logos.find((logo) => logo.variant === variant);
  if (!selection) return { kind: "unset" };

  // The library lists only versions the server decoded, re-encoded and hashed,
  // so a pointer with no match is one whose bytes were never validated or that
  // has since been archived.
  const reference = references.find(
    (entry) => entry.brandAssetVersionId === selection.brandAssetVersionId,
  );
  if (!reference) return { kind: "missing" };
  if (reference.currentVerdict === "rejected") return { kind: "rejected", reference };
  return { kind: "ok", reference };
}

function LogoVariantCard({
  variant,
  state,
  choices,
  canManage,
  onChoose,
}: {
  variant: BrandLogoVariant;
  state: LogoState;
  choices: readonly LibraryReference[];
  canManage: boolean;
  onChoose: (brandAssetVersionId: string) => void;
}) {
  const copy = VARIANT_COPY[variant];
  const selectId = `brand-logo-${variant}`;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{copy.label}</span>
        <span className="text-xs text-muted-foreground">{copy.help}</span>
      </div>

      <div className="flex min-h-24 items-center justify-center rounded-md bg-muted/40 p-3">
        {state.kind === "ok" ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a session-signed
             private URL, not a static asset the image optimizer can fetch. */
          <img
            src={state.reference.previewUrl ?? ""}
            alt={state.reference.label}
            className="max-h-24 max-w-full object-contain"
          />
        ) : state.kind === "unset" ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageOff className="size-4" aria-hidden="true" />
            No logo set
          </span>
        ) : null}
      </div>

      {state.kind === "rejected" ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>This image was rejected</AlertTitle>
          <AlertDescription>
            It is no longer used as your logo.
            {state.reference.currentReasonCodes.length > 0 ? (
              <> Reason: {state.reference.currentReasonCodes.map(reviewReasonLabel).join(", ")}.</>
            ) : null}{" "}
            Choose another image below.
          </AlertDescription>
        </Alert>
      ) : null}

      {state.kind === "missing" ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>That image is not available</AlertTitle>
          <AlertDescription>
            It was removed from the library, or its file was never checked. Nothing is being shown
            for this variant.
          </AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={selectId} className="text-xs text-muted-foreground">
            Choose from your Brand Kit
          </Label>
          <Select
            value={state.kind === "ok" ? state.reference.brandAssetVersionId : ""}
            onValueChange={onChoose}
          >
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue placeholder="Select an image" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.brandAssetVersionId} value={choice.brandAssetVersionId}>
                  {choice.label} (v{choice.version})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {choices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No approved logos in your Brand Kit yet. Upload one there first.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RuleGroup({
  title,
  description,
  rules,
  terms,
  onRemoveRule,
  onRemoveTerm,
}: {
  title: string;
  description: string;
  rules: readonly string[];
  terms?: readonly string[];
  onRemoveRule?: (text: string) => void;
  onRemoveTerm?: (term: string) => void;
}) {
  return (
    <section
      role="group"
      aria-label={title}
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {rules.length === 0 && (terms?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted-foreground">None set.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rules.map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-sm">
              <span dir="auto" className="min-w-0 flex-1 break-words">
                {rule}
              </span>
              {onRemoveRule ? (
                <button
                  type="button"
                  aria-label={`Remove ${rule}`}
                  className="mt-0.5 shrink-0 opacity-60 transition-opacity hover:opacity-100"
                  onClick={() => onRemoveRule(rule)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
          {(terms ?? []).map((term) => (
            <li key={`term-${term}`} className="flex items-start gap-2 text-sm">
              <Badge variant="outline" className="mt-px shrink-0 text-xs">
                Never write
              </Badge>
              <span dir="auto" className="min-w-0 flex-1 break-words">
                {term}
              </span>
              {onRemoveTerm ? (
                <button
                  type="button"
                  aria-label={`Remove ${term}`}
                  className="mt-0.5 shrink-0 opacity-60 transition-opacity hover:opacity-100"
                  onClick={() => onRemoveTerm(term)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BrandGuidelinesPanel({
  organizationId,
  canManage,
  references,
}: {
  organizationId: string;
  canManage: boolean;
  references: readonly LibraryReference[];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<BrandGuidelines | null>(null);

  const identity = useQuery({
    queryKey: brandIdentityQueryKey(organizationId),
    queryFn: async (): Promise<BrandIdentityResponse> => {
      const response = await fetch(`/api/organizations/${organizationId}/brand`);
      if (!response.ok) throw new Error("Your brand identity could not be loaded.");
      return (await response.json()) as BrandIdentityResponse;
    },
  });

  const save = useMutation({
    mutationFn: async (body: { guidelines?: BrandGuidelines; logo?: BrandLogoSelection }) => {
      const response = await fetch(`/api/organizations/${organizationId}/brand`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | (BrandIdentityResponse & { error?: { message?: string } })
        | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "That did not go through. Nothing was changed.");
      }
      return payload as BrandIdentityResponse;
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(brandIdentityQueryKey(organizationId), updated);
      setDraft(null);
      toast.success("Brand identity saved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const stored = identity.data?.guidelines ?? { palette: {}, rules: [], restrictedTerms: [] };
  const guidelines = draft ?? stored;
  const { hardConstraints, softConventions } = splitRulesByStrength(guidelines.rules);
  const paletteEntries = Object.entries(guidelines.palette).filter(([, hex]) => Boolean(hex));

  // Only usable, unrejected logo-role images can be chosen. Offering a rejected
  // one would invite somebody to set the very mark a reviewer refused.
  const choices = references.filter(
    (reference) =>
      reference.assetRole === "logo" &&
      reference.archivedAt === null &&
      reference.currentVerdict !== "rejected",
  );

  function edit(patch: Partial<BrandGuidelines>) {
    setDraft({ ...guidelines, ...patch });
  }

  if (identity.isPending) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Spinner /> Loading your brand identity…
      </p>
    );
  }

  if (identity.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Your brand identity could not be loaded</AlertTitle>
        <AlertDescription>
          Nothing has been changed. Reload the page to try again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your logo</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Shown exactly as uploaded everywhere the platform displays your mark. When artwork is
            generated, the image model is shown this logo and asked to place it — it is{" "}
            <span className="font-medium text-foreground">not guaranteed to reproduce it</span>, so
            check the mark before approving anything.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {BRAND_LOGO_VARIANTS.map((variant) => (
              <LogoVariantCard
                key={variant}
                variant={variant}
                state={logoState(variant, identity.data?.logos ?? [], references)}
                choices={choices}
                canManage={canManage}
                onChoose={(brandAssetVersionId) =>
                  save.mutate({ logo: { variant, brandAssetVersionId } })
                }
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand colours</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Given to the image model as your colours and checked against the artwork at review.
            They are not enforced while it is being drawn.
          </p>
          {canManage ? (
            <PaletteField
              id="brand-palette"
              value={guidelines.palette}
              onChange={(palette) => edit({ palette })}
            />
          ) : paletteEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No brand colours set.</p>
          ) : (
            <ul className="flex flex-wrap gap-4">
              {paletteEntries.map(([slot, hex]) => (
                <li key={slot} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-8 rounded-md border border-border"
                    style={{ backgroundColor: hex }}
                  />
                  <span className="flex flex-col">
                    <span className="text-sm capitalize">{slot}</span>
                    <span className="text-xs text-muted-foreground">{hex}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canManage && paletteEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No brand colours set yet.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand rules</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Restricted terms sit inside Absolute deliberately: they are
              matched literally and refused, not weighed. Spec §18.4. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <RuleGroup
              title="Absolute"
              description="A campaign is stopped rather than published against one of these."
              rules={hardConstraints}
              terms={guidelines.restrictedTerms}
              onRemoveRule={
                canManage
                  ? (text) => edit({ rules: guidelines.rules.filter((rule) => rule.text !== text) })
                  : undefined
              }
              onRemoveTerm={
                canManage
                  ? (term) =>
                      edit({
                        restrictedTerms: guidelines.restrictedTerms.filter(
                          (entry) => entry !== term,
                        ),
                      })
                  : undefined
              }
            />
            <RuleGroup
              title="Preferred"
              description="These guide the work. A departure is disclosed to you, not hidden."
              rules={softConventions}
              onRemoveRule={
                canManage
                  ? (text) => edit({ rules: guidelines.rules.filter((rule) => rule.text !== text) })
                  : undefined
              }
            />
          </div>

          {guidelines.rules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No brand rules set. Generation runs against your voice and colours alone.
            </p>
          ) : null}

          {canManage ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <div className="flex flex-col gap-1.5">
                <Label id="brand-rules-label" className="text-sm">
                  Add a rule
                </Label>
                {/* The groups above are the list; this only composes new
                    entries, so a manager never sees two copies of the same
                    rule and has to work out which one counts. */}
                <BrandRulesField
                  id="brand-rules"
                  value={guidelines.rules}
                  showList={false}
                  onChange={(rules: BrandRule[]) => edit({ rules })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label id="brand-terms-label" className="text-sm">
                  Add a word never to use
                </Label>
                <TagListField
                  id="brand-terms"
                  values={guidelines.restrictedTerms}
                  showList={false}
                  placeholder="best in dubai"
                  addLabel="Add term"
                  onChange={(restrictedTerms) => edit({ restrictedTerms })}
                />
                <p className="text-xs text-muted-foreground">
                  Matched literally in generated copy, so enter the wording itself.
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={draft === null || save.isPending}
                  onClick={() => save.mutate({ guidelines })}
                >
                  {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                  Save brand rules
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
