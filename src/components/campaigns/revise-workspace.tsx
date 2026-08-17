"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, ArrowRight, Info } from "lucide-react";

import {
  idempotencyKey,
  requestRevision,
  saveOperatorEdit,
} from "@/components/campaigns/campaign-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { diffManifestChanges } from "@/domain/campaigns/diff";
import type { CampaignBundleManifest, CampaignGenerationProfile } from "@/domain/campaigns/schemas";

/**
 * The revise screen, as the approved "Prompt Revision & Version Diff" draft
 * composes it: a full-height workspace with its own header, the editable
 * proposal on the left and a live diff of what saving would change on the right.
 *
 * It is a route rather than a dialog on purpose. The back arrow in the draft has
 * to be a real back button, a half-written revision has to survive a refresh,
 * and an operator sharing "the screen where I changed the hook" has to be able
 * to send a link to it.
 *
 * The draft draws one "Save New Version" button. There are two here, because the
 * two things it covers do not behave alike: typed copy is saved the moment the
 * request returns, while a prompt is handed to a model and becomes a version
 * some minutes later. One button would have to describe both, and whichever
 * word it used would be wrong half the time.
 */

const PROFILES: readonly { value: CampaignGenerationProfile; name: string; detail: string }[] = [
  {
    value: "brand_restricted",
    name: "Brand restricted",
    detail: "Fixed assets, strict copy guidelines.",
  },
  {
    value: "brand_guided",
    name: "Brand guided",
    detail: "Dynamic assembly within brand rails.",
  },
  {
    value: "full_visual_freedom",
    name: "Full visual freedom",
    detail: "Unrestricted generative exploration within policy rails.",
  },
];

type Props = Readonly<{
  organizationId: string;
  campaignId: string;
  campaignTitle: string;
  versionId: string;
  versionNumber: number;
  digest: string;
  manifest: CampaignBundleManifest;
  /** Which direction the operator arrived to edit. */
  directionId: string;
  /** Focus the prompt rather than the copy fields, per the entry point used. */
  intent: "edit" | "revise";
}>;

export function ReviseWorkspace({
  organizationId,
  campaignId,
  campaignTitle,
  versionId,
  versionNumber,
  digest,
  manifest,
  directionId,
  intent,
}: Props) {
  const router = useRouter();
  const studioHref = `/organizations/${organizationId}/campaigns/${campaignId}`;

  const directionIndex = Math.max(
    0,
    manifest.directions.findIndex((direction) => direction.id === directionId),
  );
  const direction = manifest.directions[directionIndex]!;
  const copy = direction.copy[0]!;
  const hashtagSet = direction.hashtagSets[0];

  const [profile, setProfile] = useState<CampaignGenerationProfile>(manifest.generationProfile);
  const [prompt, setPrompt] = useState("");
  const [hook, setHook] = useState(copy.hook);
  const [caption, setCaption] = useState(copy.caption);
  const [callToAction, setCallToAction] = useState(copy.callToAction);
  const [tags, setTags] = useState((hashtagSet?.tags ?? []).join(" "));
  const [saving, setSaving] = useState(false);
  const [revising, setRevising] = useState(false);

  /**
   * What saving would change, recomputed as the operator types.
   *
   * Digest-free on purpose: the digest is a SHA-256 over the normalized
   * manifest and is computed on the server. This is the change list only, which
   * is a pure comparison and safe to run here.
   */
  const changes = useMemo(() => {
    const draft = structuredClone(manifest) as CampaignBundleManifest;
    const target = draft.directions[directionIndex]?.copy[0];
    if (!target) return [];
    target.hook = hook;
    target.caption = caption;
    target.callToAction = callToAction;
    const draftTags = draft.directions[directionIndex]?.hashtagSets[0];
    if (draftTags) {
      draftTags.tags = normalizeTags(tags);
    }
    draft.generationProfile = profile;

    try {
      return diffManifestChanges(manifest, draft);
    } catch {
      return [];
    }
  }, [manifest, directionIndex, hook, caption, callToAction, tags, profile]);

  async function onSaveEdit() {
    setSaving(true);
    const result = await saveOperatorEdit({
      organizationId,
      campaignId,
      baseVersionId: versionId,
      baseDigest: digest,
      edit: {
        directionId: direction.id,
        copyIndex: 0,
        hook,
        caption,
        callToAction,
        timingRationale: copy.timingRationale,
        hashtagSetIndex: hashtagSet ? 0 : null,
        tags: hashtagSet ? normalizeTags(tags) : null,
      },
    });
    setSaving(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(`Version ${result.data.version} saved.`);
    router.push(`${studioHref}?version=${result.data.bundleVersionId}`);
  }

  async function onRequestRevision() {
    setRevising(true);
    const result = await requestRevision({
      organizationId,
      campaignId,
      baseVersionId: versionId,
      baseDigest: digest,
      prompt,
      scope: { kind: "direction", directionId: direction.id },
      idempotencyKey: idempotencyKey(),
    });
    setRevising(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success("Revision queued. The new version appears when it finishes.");
    router.push(studioHref);
  }

  const nothingEdited = changes.length === 0;

  return (
    <div className="flex h-[calc(100svh-1rem)] flex-col">
      <header className="sticky top-0 z-30 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 sm:px-8 sm:py-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Button asChild variant="ghost" size="icon" className="rounded-full">
            <Link href={studioHref} aria-label="Back to the campaign">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-bold tracking-tight uppercase">
              Revise strategy &amp; prompt
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {campaignTitle} • Version {versionNumber} → proposed version {versionNumber + 1}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link href={studioHref}>Cancel</Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onRequestRevision}
            disabled={revising || prompt.trim().length === 0}
          >
            {revising ? <Spinner /> : null}
            Run revision
          </Button>
          <Button size="sm" onClick={onSaveEdit} disabled={saving || nothingEdited}>
            {saving ? <Spinner /> : null}
            Save new version
          </Button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:border-r">
          <div className="mx-auto flex max-w-4xl flex-col gap-8">
            <section className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionHeading>1. Generation profile &amp; direction</SectionHeading>
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  Active: {PROFILES.find((entry) => entry.value === profile)?.name}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {PROFILES.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => setProfile(entry.value)}
                    aria-pressed={entry.value === profile}
                    className={
                      entry.value === profile
                        ? "flex flex-col rounded-lg border-2 border-primary bg-card p-4 text-left ring-4 ring-primary/5"
                        : "flex flex-col rounded-lg border bg-card/50 p-4 text-left opacity-60 transition-all hover:opacity-100"
                    }
                  >
                    <span
                      className={
                        entry.value === profile
                          ? "mb-1 text-[9px] font-bold text-primary uppercase"
                          : "mb-1 text-[9px] font-bold text-muted-foreground uppercase"
                      }
                    >
                      Profile
                    </span>
                    <p className="text-xs font-bold">{entry.name}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{entry.detail}</p>
                  </button>
                ))}
              </div>

              {/* Said out loud rather than discovered on save. Changing the
                  profile changes how imagery is generated, and imagery only
                  changes when a model runs. */}
              {profile === manifest.generationProfile ? null : (
                <p className="text-[11px] text-muted-foreground">
                  A different profile only takes effect when a model runs, so this change needs
                  &ldquo;Run revision&rdquo; rather than a direct save.
                </p>
              )}
            </section>

            <section className="flex flex-col gap-4">
              <SectionHeading>2. Scoped operator prompt</SectionHeading>
              <div className="relative">
                <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-1.5 opacity-50">
                  <Info className="size-3" aria-hidden />
                  <span className="text-[9px] font-bold uppercase">Scoped to {direction.name}</span>
                </div>
                <Textarea
                  autoFocus={intent === "revise"}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  spellCheck={false}
                  placeholder="Describe what should change. A model reads this and proposes a new version; it never edits anything directly."
                  className="h-40 resize-none p-5 text-sm leading-relaxed font-medium"
                />
              </div>
            </section>

            <section className="flex flex-col gap-6">
              <SectionHeading>3. Content metadata &amp; hook</SectionHeading>
              <div className="grid gap-6 md:grid-cols-2">
                <Field label="Primary hook line">
                  <Input
                    autoFocus={intent === "edit"}
                    value={hook}
                    onChange={(event) => setHook(event.target.value)}
                  />
                </Field>
                <Field label="CTA button label">
                  <Input
                    value={callToAction}
                    onChange={(event) => setCallToAction(event.target.value)}
                  />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Channel caption body">
                    <Textarea
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                      className="h-24 resize-none leading-relaxed"
                    />
                  </Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Distribution tags">
                    <Input
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      placeholder="No verified platform limit yet"
                    />
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      {hashtagSet?.rationale ??
                        "No verified provider contract states a hashtag limit for this channel yet."}
                    </p>
                  </Field>
                </div>
              </div>
            </section>
          </div>
        </div>

        <aside className="flex w-full shrink-0 flex-col overflow-y-auto bg-card lg:w-[480px]">
          <div className="flex flex-col gap-6 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <SectionHeading>Proposed version diff</SectionHeading>
              <span className="text-[10px] font-bold text-muted-foreground">
                {changes.length} change{changes.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="flex flex-col gap-4 rounded border bg-muted/10 p-4">
              {changes.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Nothing has changed yet. Edit a field to see exactly what a new version would
                  differ by, or write a prompt and let a model propose one.
                </p>
              ) : (
                changes.map((change) => (
                  <div
                    key={change.path}
                    className="flex flex-col gap-2 border-b pb-3 last:border-0"
                  >
                    <span className="block text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
                      {readablePath(change.path)}
                    </span>
                    <div className="flex flex-col gap-1.5 text-[11px]">
                      <div className="rounded border border-dashed bg-muted/20 p-2 opacity-60">
                        <p className="mb-1 text-[9px] font-bold uppercase opacity-50">
                          Current v{versionNumber}
                        </p>
                        <p className="break-words">{change.before ?? "—"}</p>
                      </div>
                      <div className="flex items-center gap-1 text-primary">
                        <ArrowRight className="size-3" aria-hidden />
                      </div>
                      <div className="rounded border border-primary/30 bg-primary/5 p-2">
                        <p className="mb-1 text-[9px] font-bold text-primary uppercase">
                          Proposed v{versionNumber + 1}
                        </p>
                        <p className="break-words">{change.after ?? "—"}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded border bg-muted/20 p-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[10px] font-bold">Version digest</span>
                <span className="truncate font-mono text-[9px] opacity-60">{digest}</span>
              </div>
              <Info className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>

            {changes.length === 0 ? null : (
              <div className="flex flex-col gap-3 rounded border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                  <AlertCircle className="size-4 shrink-0" aria-hidden />
                  <h4 className="text-[10px] font-bold tracking-wider uppercase">
                    Material changes &amp; approval invalidation
                  </h4>
                </div>
                <p className="text-[10px] leading-relaxed">
                  Saving creates a new immutable <strong>version {versionNumber + 1}</strong>. Any
                  approval collected for version {versionNumber} stops covering this campaign, and
                  execution waits until the new version is attested and approved again.
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

/**
 * "lunch #dubai" becomes ["#lunch", "#dubai"].
 *
 * The manifest stores a hashtag with its hash, because that is what gets
 * published. Operators type them either way, so the leading hash is added when
 * it is missing rather than rejected as a formatting mistake.
 */
function normalizeTags(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim().replace(/^#+/, ""))
    .filter((entry) => entry.length > 0)
    .map((entry) => `#${entry}`);
}

function SectionHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h3 className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div>
      <Label className="mb-1.5 block text-[10px] font-bold tracking-tight text-muted-foreground uppercase">
        {label}
      </Label>
      {children}
    </div>
  );
}

/** `directions[0].copy[0].hook` reads as "Hook" to someone editing a hook. */
function readablePath(path: string): string {
  const leaf =
    path
      .split(".")
      .at(-1)
      ?.replace(/\[\d+\]/g, "") ?? path;
  const spaced = leaf.replace(/([A-Z])/g, " $1").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
