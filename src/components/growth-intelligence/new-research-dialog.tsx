"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export type NewResearchBranchOption = {
  id: string;
  name: string;
};

export type NewResearchCompetitor = {
  name: string;
  website?: string;
  locationHint?: string;
  source: "suggestion" | "operator_lead";
};

export type NewResearchStartRequest = {
  title?: string;
  question: string;
  eventDate?: string;
  branchId: string;
  researchArea: string;
  competitors: NewResearchCompetitor[];
  mode: "one-time" | "recurring";
  schedule?: {
    cadence: "daily" | "weekly" | "monthly";
    localTime: string;
    timeZone: string;
    endDate?: string;
  };
  idempotencyKey: string;
};

export type NewResearchStartResult = {
  outcome: "started" | "opened_progress";
  projectId: string;
  updateId: string;
  briefRevisionId?: string;
  revisionNumber?: number;
  correlationId: string;
  notice?: { code: string; message: string } | null;
};

const INVESTIGATION_AREAS = [
  { key: "demand", label: "Local demand" },
  { key: "presence", label: "Digital presence" },
  { key: "offers", label: "Offers & pricing" },
  { key: "reviews", label: "Customer feedback" },
  { key: "observable_performance", label: "Performance signals" },
] as const;

const COMPETITOR_NAME_LIMIT = 160;
const COMPETITOR_HINT_LIMIT = 240;
const QUESTION_LIMIT = 2000;
const TITLE_LIMIT = 200;
const AREA_LIMIT = 160;

const TIMEZONE_OPTIONS = [
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Riyadh",
  "Europe/London",
  "UTC",
];

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

async function defaultStartResearch(
  organizationId: string,
  input: NewResearchStartRequest,
): Promise<NewResearchStartResult> {
  const response = await fetch(
    `/api/organizations/${organizationId}/growth-intelligence/monitoring/projects`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json().catch(() => null)) as {
    start?: NewResearchStartResult;
    notice?: { code: string; message: string } | null;
    error?: { code?: string; message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(body?.error?.message ?? body?.error?.code ?? "RESEARCH_START_FAILED");
  }
  if (!body?.start) throw new Error("RESEARCH_START_FAILED");
  return { ...body.start, notice: body.notice ?? body.start.notice ?? null };
}

type Draft = {
  question: string;
  title: string;
  eventDate: string;
  branchId: string;
  researchArea: string;
  competitors: NewResearchCompetitor[];
  mode: "one-time" | "recurring" | null;
  cadence: "daily" | "weekly" | "monthly" | "";
  localTime: string;
  timeZone: string;
  endDate: string;
};

const EMPTY_DRAFT: Draft = {
  question: "",
  title: "",
  eventDate: "",
  branchId: "",
  researchArea: "",
  competitors: [],
  mode: null,
  cadence: "",
  localTime: "09:00",
  timeZone: "",
  endDate: "",
};

/**
 * Three-step New research dialog (Brief → Scope → Review).
 *
 * Validation is inline and never clears typed input; closing with edits
 * offers Keep editing or Discard draft and restores focus to the opener;
 * closing never cancels background work — an in-flight start keeps its
 * single flight while the dialog simply goes away.
 */
export function NewResearchDialog({
  organizationId,
  branches,
  timeZone,
  evidencePeriods,
  businessGoals = [],
  suggestions = [],
  canManage,
  open,
  onOpenChange,
  startResearch,
  onStarted,
}: {
  organizationId: string;
  branches: readonly NewResearchBranchOption[];
  /** Default location timezone for a recurring schedule. */
  timeZone: string;
  evidencePeriods: readonly { label: string }[];
  businessGoals?: readonly string[];
  /** Competitor names worth suggesting, always labelled as suggestions. */
  suggestions?: readonly string[];
  /** Viewers read with the reason; only managers see start controls. */
  canManage: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startResearch?: (input: NewResearchStartRequest) => Promise<NewResearchStartResult>;
  onStarted?: (result: NewResearchStartResult) => void;
}) {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, timeZone });
  const [errors, setErrors] = useState<{ question?: string; branch?: string; area?: string; mode?: string; schedule?: string }>({});
  const [competitorFormError, setCompetitorFormError] = useState<string | null>(null);
  const [competitorName, setCompetitorName] = useState("");
  const [competitorWebsite, setCompetitorWebsite] = useState("");
  const [competitorHint, setCompetitorHint] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [submitState, setSubmitState] = useState<"idle" | "working" | "failed">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Focus containment rides the Radix dialog trap. Restoration is ours:
  // the opener is captured while the dialog opens and refocused after the
  // close commits — deferred past unmount so the trap never pulls it back.
  // State settles during render (never in an effect) so the draft is ready
  // before the step validators below read it.
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    if (open) openerRef.current = document.activeElement;
  }, [open ]);
  const [draftSeed, setDraftSeed] = useState({ open, timeZone });
  if (draftSeed.open !== open || draftSeed.timeZone !== timeZone) {
    setDraftSeed({ open, timeZone });
    if (open) {
      setDraft((current) => (current.timeZone ? current : { ...current, timeZone }));
    }
  }

  function restoreFocus() {
    const opener = openerRef.current;
    window.setTimeout(() => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }, 0);
  }

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setDirty(true);
  }

  function requestClose() {
    if (submitState === "working") {
      // An in-flight start keeps its single flight; the dialog only goes
      // away and never cancels the background work.
      closeNow(false);
      return;
    }
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    closeNow(false);
  }

  function closeNow(reset: boolean) {
    if (reset) {
      setDraft({ ...EMPTY_DRAFT, timeZone });
      setStep(1);
      setErrors({});
      setCompetitorFormError(null);
      setCompetitorName("");
      setCompetitorWebsite("");
      setCompetitorHint("");
      setEditingIndex(null);
      setDirty(false);
      setSubmitState("idle");
      setSubmitError(null);
      setScopeNotice(null);
    }
    setConfirmDiscard(false);
    onOpenChange(false);
    restoreFocus();
  }

  function briefValid(): boolean {
    const next: typeof errors = {};
    if (normalize(draft.question).length === 0) {
      next.question = "Describe the business question so the research has something to answer.";
    }
    setErrors((current) => ({ ...current, ...next }));
    return Object.keys(next).length === 0;
  }

  function scopeValid(): boolean {
    const next: typeof errors = {};
    if (!draft.branchId) next.branch = "Choose the location this research should help.";
    if (normalize(draft.researchArea).length === 0) {
      next.area = "Name the area your customers and competitors serve.";
    }
    setErrors((current) => ({ ...current, ...next }));
    return Object.keys(next).length === 0;
  }

  function reviewValid(): boolean {
    const next: typeof errors = {};
    if (!draft.mode) {
      next.mode = "Choose one-time or keep monitoring — research never starts on a silent default.";
    }
    if (draft.mode === "recurring" && !draft.cadence) {
      next.schedule = "Choose how often the market should be researched.";
    }
    setErrors((current) => ({ ...current, ...next }));
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (step === 1 && briefValid()) setStep(2);
    else if (step === 2 && scopeValid()) setStep(3);
  }

  function addCompetitor() {
    const name = normalize(competitorName);
    const website = competitorWebsite.trim();
    const hint = normalize(competitorHint);
    if (name.length === 0) {
      setCompetitorFormError("A competitor name is required.");
      return;
    }
    if (name.length > COMPETITOR_NAME_LIMIT) {
      setCompetitorFormError(`Competitor names hold at most ${COMPETITOR_NAME_LIMIT} characters.`);
      return;
    }
    if (website.length > 0 && !validWebsite(website)) {
      setCompetitorFormError("A competitor website must be a valid public HTTP or HTTPS URL.");
      return;
    }
    if (hint.length > COMPETITOR_HINT_LIMIT) {
      setCompetitorFormError(`Location hints hold at most ${COMPETITOR_HINT_LIMIT} characters.`);
      return;
    }
    const duplicate = draft.competitors.some(
      (row, index) =>
        index !== editingIndex && row.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      setCompetitorFormError("That competitor is already listed.");
      return;
    }
    const row: NewResearchCompetitor = {
      name,
      website,
      locationHint: hint,
      source: "operator_lead",
    };
    if (editingIndex !== null) {
      patch({
        competitors: draft.competitors.map((current, index) =>
          index === editingIndex ? { ...row, source: current.source } : current,
        ),
      });
      setEditingIndex(null);
    } else {
      patch({ competitors: [...draft.competitors, row] });
    }
    setCompetitorName("");
    setCompetitorWebsite("");
    setCompetitorHint("");
    setCompetitorFormError(null);
  }

  function addSuggestion(name: string) {
    const normalized = normalize(name);
    if (
      normalized.length === 0 ||
      draft.competitors.some((row) => row.name.toLowerCase() === normalized.toLowerCase())
    ) {
      return;
    }
    patch({
      competitors: [...draft.competitors, { name: normalized, source: "suggestion" }],
    });
  }

  function removeCompetitor(index: number) {
    patch({ competitors: draft.competitors.filter((_, current) => current !== index) });
    if (editingIndex === index) {
      setEditingIndex(null);
      setCompetitorName("");
      setCompetitorWebsite("");
      setCompetitorHint("");
    }
  }

  function editCompetitor(index: number) {
    const row = draft.competitors[index];
    if (!row) return;
    setEditingIndex(index);
    setCompetitorName(row.name);
    setCompetitorWebsite(row.website ?? "");
    setCompetitorHint(row.locationHint ?? "");
    setCompetitorFormError(null);
  }

  async function start() {
    if (!briefValid() || !scopeValid() || !reviewValid()) {
      if (!briefValid()) setStep(1);
      else if (!scopeValid()) setStep(2);
      return;
    }
    if (draft.mode === null) return;
    setSubmitState("working");
    setSubmitError(null);
    setScopeNotice(null);
    const starter = startResearch ?? ((input) => defaultStartResearch(organizationId, input));
    const request: NewResearchStartRequest = {
      question: normalize(draft.question),
      branchId: draft.branchId,
      researchArea: normalize(draft.researchArea),
      competitors: draft.competitors.map((row) => ({
        name: row.name,
        ...(row.website ? { website: row.website } : {}),
        ...(row.locationHint ? { locationHint: row.locationHint } : {}),
        source: row.source,
      })),
      mode: draft.mode,
      idempotencyKey: crypto.randomUUID(),
      ...(normalize(draft.title) ? { title: normalize(draft.title).slice(0, TITLE_LIMIT) } : {}),
      ...(draft.eventDate ? { eventDate: draft.eventDate } : {}),
      ...(draft.mode === "recurring" && draft.cadence
        ? {
            schedule: {
              cadence: draft.cadence,
              localTime: draft.localTime,
              timeZone: draft.timeZone || timeZone,
              ...(draft.endDate ? { endDate: draft.endDate } : {}),
            },
          }
        : {}),
    };
    try {
      const result = await starter(request);
      if (!mountedRef.current) {
        // The dialog closed mid-flight: the single start still counts, so
        // the list refreshes through the callback without touching state.
        onStarted?.(result);
        return;
      }
      setDirty(false);
      onStarted?.(result);
      if (result.notice) {
        // Scope drift: the changed settings were not applied and the active
        // progress is shown instead. The notice stays on screen until it is
        // acknowledged — closing it never cancels the background work.
        setScopeNotice(result.notice.message);
        setSubmitState("idle");
        return;
      }
      closeNow(true);
    } catch (error) {
      if (!mountedRef.current) return;
      setSubmitState("failed");
      setSubmitError(
        error instanceof Error && error.message
          ? `Research could not start (${error.message}). Your brief is kept — review and try again.`
          : "Research could not start. Your brief is kept — review and try again.",
      );
    }
  }

  const branchName = branches.find((branch) => branch.id === draft.branchId)?.name ?? "";
  const stepReached = { 1: true, 2: normalize(draft.question).length > 0, 3: draft.branchId !== "" && normalize(draft.researchArea).length > 0 };
  const visibleSuggestions = suggestions.filter(
    (name) =>
      !draft.competitors.some((row) => row.name.toLowerCase() === normalize(name).toLowerCase()),
  );

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[90vh] w-full flex-col gap-0 p-0 sm:max-w-[820px] max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none"
          onEscapeKeyDown={(event) => {
            if (dirty && submitState !== "working") {
              event.preventDefault();
              setConfirmDiscard(true);
            }
          }}
          onInteractOutside={(event) => {
            if (dirty) {
              event.preventDefault();
              setConfirmDiscard(true);
            }
          }}
        >
          <DialogHeader className="shrink-0 border-b px-6 py-5 text-left">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  Market Watch
                </p>
                <DialogTitle className="mt-1 text-lg font-semibold">New research</DialogTitle>
                <DialogDescription className="mt-0.5">
                  {step === 1
                    ? "A useful answer starts with a clear question."
                    : step === 2
                      ? "Choose the local market and context to investigate."
                      : "Check the brief before research starts."}
                </DialogDescription>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close research dialog"
                onClick={requestClose}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <nav aria-label="Research setup steps" className="mt-4 flex items-center gap-2">
              {(
                [
                  { number: 1, label: "Brief" },
                  { number: 2, label: "Scope" },
                  { number: 3, label: "Review" },
                ] as const
              ).map((item, index) => (
                <div key={item.number} className="flex items-center gap-2">
                  {index > 0 ? <span aria-hidden="true" className="h-px w-6 bg-border" /> : null}
                  <Button
                    variant={step === item.number ? "default" : "outline"}
                    size="sm"
                    aria-current={step === item.number ? "step" : undefined}
                    disabled={!stepReached[item.number] || submitState === "working"}
                    onClick={() => setStep(item.number)}
                  >
                    {step > item.number ? (
                      <>
                        <Check aria-hidden="true" />
                        {item.label}
                      </>
                    ) : (
                      <>
                        {item.number} {item.label}
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </nav>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {!canManage ? (
              <div className="flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">
                  Read-only for your role. An operator starts research; your view of projects and
                  reports stays available on Market Watch.
                </p>
                <Button variant="outline" className="self-start" onClick={() => closeNow(false)}>
                  Close
                </Button>
              </div>
            ) : step === 1 ? (
              <div className="flex flex-col gap-5">
                <Field>
                  <FieldLabel htmlFor="new-research-question">
                    What would you like to achieve?
                  </FieldLabel>
                  <Textarea
                    id="new-research-question"
                    value={draft.question}
                    onChange={(event) => {
                      patch({ question: event.target.value.slice(0, QUESTION_LIMIT + 1) });
                      setErrors((current) => ({ ...current, question: undefined }));
                    }}
                    rows={5}
                    placeholder="Which family offers are competitors promoting for National Day, and what should we prepare?"
                    aria-invalid={errors.question !== undefined}
                    className="min-h-32"
                  />
                  <FieldDescription>
                    Tell us the business question, occasion or opportunity you want to explore.
                  </FieldDescription>
                  {errors.question ? <FieldError role="alert">{errors.question}</FieldError> : null}
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="new-research-title">
                      Project name <span className="font-normal text-muted-foreground">Optional</span>
                    </FieldLabel>
                    <Input
                      id="new-research-title"
                      value={draft.title}
                      onChange={(event) => patch({ title: event.target.value })}
                      placeholder="National Day preparation"
                      maxLength={TITLE_LIMIT + 1}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-research-event-date">
                      Event or target date{" "}
                      <span className="font-normal text-muted-foreground">Optional</span>
                    </FieldLabel>
                    <Input
                      id="new-research-event-date"
                      type="date"
                      value={draft.eventDate}
                      onChange={(event) => patch({ eventDate: event.target.value })}
                    />
                  </Field>
                </div>
                <p className="rounded-lg bg-muted p-3 text-sm">
                  We&rsquo;ll research your market, connect it with your business context and
                  prepare draft advice for you to review.
                </p>
              </div>
            ) : step === 2 ? (
              <div className="flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="new-research-location">Business location</FieldLabel>
                    <Select
                      value={draft.branchId}
                      onValueChange={(value) => {
                        patch({ branchId: value });
                        setErrors((current) => ({ ...current, branch: undefined }));
                      }}
                    >
                      <SelectTrigger id="new-research-location" aria-invalid={errors.branch !== undefined}>
                        <SelectValue placeholder="Choose a location" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map((branch) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>The outlet this research should help.</FieldDescription>
                    {errors.branch ? <FieldError role="alert">{errors.branch}</FieldError> : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-research-area">Research area</FieldLabel>
                    <Input
                      id="new-research-area"
                      value={draft.researchArea}
                      onChange={(event) => {
                        patch({ researchArea: event.target.value });
                        setErrors((current) => ({ ...current, area: undefined }));
                      }}
                      placeholder="Neighbourhood, city or service area"
                      maxLength={AREA_LIMIT + 1}
                      aria-invalid={errors.area !== undefined}
                    />
                    <FieldDescription>
                      Use the area your customers and competitors serve.
                    </FieldDescription>
                    {errors.area ? <FieldError role="alert">{errors.area}</FieldError> : null}
                  </Field>
                </div>

                <Separator />

                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-semibold">Competitors to investigate</h3>
                    <span className="text-xs text-muted-foreground">
                      Optional · Add the ones you know
                    </span>
                  </div>
                  {draft.competitors.length > 0 ? (
                    <ul className="flex flex-col gap-2">
                      {draft.competitors.map((row, index) => (
                        <li
                          key={`${row.name}-${index}`}
                          className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                        >
                          <span className="min-w-0 flex-1 break-words">
                            <span className="font-medium">{row.name}</span>{" "}
                            {row.website ? (
                              <span className="text-muted-foreground">{row.website}</span>
                            ) : null}{" "}
                            {row.locationHint ? (
                              <span className="text-muted-foreground">· {row.locationHint}</span>
                            ) : null}{" "}
                            {row.source === "suggestion" ? (
                              <Badge variant="outline">Suggestion</Badge>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Edit competitor ${row.name}`}
                              onClick={() => editCompetitor(index)}
                              disabled={submitState === "working"}
                            >
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove competitor ${row.name}`}
                              onClick={() => removeCompetitor(index)}
                              disabled={submitState === "working"}
                            >
                              Remove
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="new-research-competitor-name">Competitor name</FieldLabel>
                      <Input
                        id="new-research-competitor-name"
                        value={competitorName}
                        onChange={(event) => setCompetitorName(event.target.value)}
                        placeholder="Rival Kitchen"
                        maxLength={COMPETITOR_NAME_LIMIT + 1}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-research-competitor-website">
                        Website <span className="font-normal text-muted-foreground">Optional</span>
                      </FieldLabel>
                      <Input
                        id="new-research-competitor-website"
                        value={competitorWebsite}
                        onChange={(event) => setCompetitorWebsite(event.target.value)}
                        placeholder="https://example.com"
                        inputMode="url"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-research-competitor-hint">
                        Location hint{" "}
                        <span className="font-normal text-muted-foreground">Optional</span>
                      </FieldLabel>
                      <Input
                        id="new-research-competitor-hint"
                        value={competitorHint}
                        onChange={(event) => setCompetitorHint(event.target.value)}
                        placeholder="Near Marina Mall"
                        maxLength={COMPETITOR_HINT_LIMIT + 1}
                      />
                    </Field>
                  </div>
                  {competitorFormError ? (
                    <FieldError role="alert">{competitorFormError}</FieldError>
                  ) : null}
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addCompetitor}
                      disabled={submitState === "working"}
                    >
                      <Plus aria-hidden="true" />
                      {editingIndex !== null ? "Save competitor" : "Add a competitor"}
                    </Button>
                    {editingIndex !== null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingIndex(null);
                          setCompetitorName("");
                          setCompetitorWebsite("");
                          setCompetitorHint("");
                          setCompetitorFormError(null);
                        }}
                      >
                        Cancel edit
                      </Button>
                    ) : null}
                  </div>
                  {visibleSuggestions.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Suggestions
                      </p>
                      <ul className="flex flex-wrap gap-2">
                        {visibleSuggestions.map((name) => (
                          <li key={name}>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => addSuggestion(name)}
                              disabled={submitState === "working"}
                              aria-label={`Add suggested competitor ${name}`}
                            >
                              <Plus aria-hidden="true" />
                              <span className="max-w-48 truncate">{name}</span>
                              <Badge variant="secondary">Suggestion</Badge>
                            </Button>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        Suggestions are starting points, not verified competitors.
                      </p>
                    </div>
                  ) : null}
                </div>

                <Separator />

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">What we&rsquo;ll look into</h3>
                  <ul className="flex flex-wrap gap-2">
                    {INVESTIGATION_AREAS.map((area) => (
                      <li key={area.key}>
                        <Badge variant="secondary">{area.label}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>

                <Collapsible className="rounded-lg border">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between px-3">
                      Business context used for this research
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-3 text-sm">
                    {evidencePeriods.length === 0 && businessGoals.length === 0 ? (
                      <p className="text-muted-foreground">
                        No business context connected yet. The research will rely on public
                        evidence only.
                      </p>
                    ) : (
                      <dl className="flex flex-col gap-2">
                        {evidencePeriods.length > 0 ? (
                          <div>
                            <dt className="font-semibold">Channel evidence</dt>
                            {evidencePeriods.map((period) => (
                              <dd key={period.label} className="text-muted-foreground">
                                {period.label}
                              </dd>
                            ))}
                          </div>
                        ) : null}
                        {businessGoals.length > 0 ? (
                          <div>
                            <dt className="font-semibold">Saved goals</dt>
                            {businessGoals.map((goal) => (
                              <dd key={goal} className="text-muted-foreground">
                                {goal}
                              </dd>
                            ))}
                          </div>
                        ) : null}
                      </dl>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Your business context stays private: it guides relevance and never enters
                      public queries as fact.
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <fieldset>
                  <legend className="text-sm font-semibold">How often should we research this?</legend>
                  <RadioGroup
                    value={draft.mode ?? ""}
                    onValueChange={(value: "one-time" | "recurring") => {
                      patch({ mode: value });
                      setErrors((current) => ({ ...current, mode: undefined }));
                    }}
                    className="mt-2 grid gap-2 sm:grid-cols-2"
                  >
                    <label
                      htmlFor="new-research-once"
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                    >
                      <RadioGroupItem id="new-research-once" value="one-time" />
                      <span>
                        <strong className="block text-sm">One-time</strong>
                        <small className="text-muted-foreground">Answer this question once.</small>
                      </span>
                    </label>
                    <label
                      htmlFor="new-research-recurring"
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
                    >
                      <RadioGroupItem id="new-research-recurring" value="recurring" />
                      <span>
                        <strong className="block text-sm">Keep monitoring</strong>
                        <small className="text-muted-foreground">
                          Receive fresh reports as the market changes.
                        </small>
                      </span>
                    </label>
                  </RadioGroup>
                  {errors.mode ? <FieldError role="alert">{errors.mode}</FieldError> : null}
                </fieldset>

                {draft.mode === "recurring" ? (
                  <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="new-research-cadence">Frequency</FieldLabel>
                      <Select
                        value={draft.cadence}
                        onValueChange={(value: Draft["cadence"]) => {
                          patch({ cadence: value });
                          setErrors((current) => ({ ...current, schedule: undefined }));
                        }}
                      >
                        <SelectTrigger id="new-research-cadence">
                          <SelectValue placeholder="Choose frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-research-time">Research start time</FieldLabel>
                      <Input
                        id="new-research-time"
                        type="time"
                        value={draft.localTime}
                        onChange={(event) => patch({ localTime: event.target.value })}
                      />
                      <FieldDescription>Location timezone · {draft.timeZone || timeZone}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-research-timezone">Timezone</FieldLabel>
                      <Select
                        value={TIMEZONE_OPTIONS.includes(draft.timeZone || timeZone) ? draft.timeZone || timeZone : "Asia/Dubai"}
                        onValueChange={(value) => patch({ timeZone: value })}
                      >
                        <SelectTrigger id="new-research-timezone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(new Set([...TIMEZONE_OPTIONS, timeZone])).map((zone) => (
                            <SelectItem key={zone} value={zone}>
                              {zone}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="new-research-end-date">
                        Stop monitoring on{" "}
                        <span className="font-normal text-muted-foreground">Optional</span>
                      </FieldLabel>
                      <Input
                        id="new-research-end-date"
                        type="date"
                        value={draft.endDate}
                        onChange={(event) => patch({ endDate: event.target.value })}
                      />
                      <FieldDescription>
                        Leave empty to continue until you pause monitoring.
                      </FieldDescription>
                    </Field>
                  </div>
                ) : null}
                {errors.schedule ? <FieldError role="alert">{errors.schedule}</FieldError> : null}

                <div className="rounded-lg border">
                  <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                    <span className="text-sm font-semibold">Your research brief</span>
                    <Button variant="link" size="sm" onClick={() => setStep(1)}>
                      Edit brief
                    </Button>
                  </div>
                  <dl className="flex flex-col gap-2 px-3 py-3 text-sm">
                    <div>
                      <dt className="font-semibold">Question</dt>
                      <dd className="break-words">{normalize(draft.question)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Location</dt>
                      <dd>
                        {branchName} · {normalize(draft.researchArea)}{" "}
                        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setStep(2)}>
                          Edit scope
                        </Button>
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Competitors</dt>
                      <dd>
                        {draft.competitors.length === 0
                          ? "Find relevant competitors in the research area"
                          : draft.competitors
                              .map((row) =>
                                row.source === "suggestion"
                                  ? `${row.name} (suggestion)`
                                  : row.name,
                              )
                              .join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Coverage</dt>
                      <dd>Presence, offers, feedback, local demand and performance signals</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Business context</dt>
                      <dd>
                        {evidencePeriods.length > 0
                          ? evidencePeriods.map((period) => period.label).join("; ")
                          : "Public evidence only; no business context connected"}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Frequency</dt>
                      <dd>
                        {draft.mode === null
                          ? "Not chosen yet"
                          : draft.mode === "one-time"
                            ? "One-time"
                            : `Keep monitoring · ${draft.cadence || "choose frequency"} · ${draft.localTime} ${draft.timeZone || timeZone}${draft.endDate ? ` · until ${draft.endDate}` : ""}`}
                      </dd>
                    </div>
                  </dl>
                </div>

                <p className="rounded-lg bg-muted p-3 text-sm">
                  You&rsquo;ll receive a report and draft advice to review.
                  <br />
                  <span className="text-muted-foreground">
                    This creates a separate project. Existing research keeps its own schedule and
                    history.
                  </span>
                </p>
                {scopeNotice ? (
                  <p role="status" className="rounded-lg border p-3 text-sm">
                    {scopeNotice}
                  </p>
                ) : null}
                {submitState === "failed" && submitError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {submitError}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {canManage ? (
            <DialogFooter className="shrink-0 flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:items-center">
              <span className="mr-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                Your business context stays private.
              </span>
              {step > 1 ? (
                <Button variant="outline" onClick={() => setStep(step - 1)} disabled={submitState === "working"}>
                  Back
                </Button>
              ) : (
                <Button variant="outline" onClick={requestClose}>
                  Cancel
                </Button>
              )}
              {scopeNotice ? (
                <Button onClick={() => closeNow(true)}>Done</Button>
              ) : step < 3 ? (
                <Button onClick={goNext} disabled={submitState === "working"}>
                  Continue
                </Button>
              ) : (
                <Button onClick={start} disabled={submitState === "working"}>
                  {submitState === "working" ? "Starting…" : "Start research"}
                </Button>
              )}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this research brief?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits are kept only if you keep editing. Existing projects are never affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => closeNow(true)}>Discard draft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
