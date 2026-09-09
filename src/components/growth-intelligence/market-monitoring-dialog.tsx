"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { summarizeServiceArea } from "@/components/growth-intelligence/query-options";
import type {
  MarketProfileDocument,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import type {
  MarketProfileVersionView,
  MarketProfileView,
  StartBranchResearchResult,
} from "@/modules/growth-intelligence/application/ports";
import type { ResearchPipelineView } from "@/modules/growth-intelligence/application/research-read-model";

export type MonitoringBranchOption = {
  id: string;
  name: string;
  /** Saved service area summary shown beside the branch name. */
  serviceArea: string | null;
  isActive: boolean;
};

export type MonitoringResearchState = {
  active: ResearchPipelineView | null;
  lastSuccess: ResearchPipelineView | null;
};

export type StartResearchInput = {
  branchId: string;
  document: MarketProfileDocumentV2;
  expectedCurrentVersionId: string | null;
  idempotencyKey: string;
};

export type MarketMonitoringDialogProps = {
  organizationId: string;
  /** Viewers inspect the prefill as words; only managers see editing controls. */
  canManage: boolean;
  branches: MonitoringBranchOption[];
  initialBranchId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadProfile?: (branchId: string) => Promise<MarketProfileView>;
  loadResearch?: (branchId: string) => Promise<MonitoringResearchState>;
  rejectProposal?: (input: { versionId: string; digest: string }) => Promise<void>;
  startResearch?: (input: StartResearchInput) => Promise<StartBranchResearchResult>;
  onStarted?: (pipelineId: string) => void;
};

type CompetitorRow = {
  name: string;
  website: string;
  locationHint: string;
  /** Carried from the prefilled proposal so cited evidence survives review. */
  key: string | null;
  provenance: "operator_lead" | "cited";
  suggestedBy: "operator" | "ai";
  relevanceEvidenceUrls: string[];
};

type TopicRow = {
  label: string;
  key: string | null;
  provenance: "core" | "industry_pack" | "operator" | "ai_proposed";
};

const TOPIC_LIMIT = 20;
const TOPIC_CHARACTERS = 160;
const COMPETITOR_LIMIT = 5;
const COMPETITOR_NAME_CHARACTERS = 160;
const COMPETITOR_URL_CHARACTERS = 2048;
const COMPETITOR_HINT_CHARACTERS = 240;

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Stable digest-friendly key derived from display text. */
export function toStableKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 120);
  const keyed = /^[a-z]/.test(slug) ? slug : `topic_${slug}`;
  return keyed.length >= 2 ? keyed : `topic_${Date.now().toString(36)}`;
}

function slugRef(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, "_")
    .replace(/[^a-z0-9_.-]/g, "")
    .replace(/^[._-]+/, "")
    .slice(0, 80);
  return slug.length >= 2 ? slug : "area";
}

/**
 * One-line summary of a branch service_area record. Re-exported here so
 * existing callers keep compiling; the implementation lives in
 * query-options so server components can use it without importing a client
 * module.
 */
export { summarizeServiceArea };

function latestPendingVersion(profile: MarketProfileView): MarketProfileVersionView | null {
  const decided = new Set(profile.decisions.map((decision) => decision.profileVersionId));
  const candidates = profile.versions
    .filter(
      (version) => version.id !== profile.profile?.currentVersionId && !decided.has(version.id),
    )
    .sort((left, right) => right.version - left.version);
  return candidates[0] ?? null;
}

function currentVersion(profile: MarketProfileView): MarketProfileVersionView | null {
  return (
    profile.versions.find((version) => version.id === profile.profile?.currentVersionId) ?? null
  );
}

function isSameBranchV2(
  document: MarketProfileDocument,
  branchId: string,
): document is MarketProfileDocumentV2 {
  return document.schemaVersion === 2 && document.branchId === branchId;
}

type Prefill = {
  source: MarketProfileVersionView | null;
  pending: MarketProfileVersionView | null;
  legacySource: boolean;
  approvedName: string;
  descriptors: string[];
  topics: TopicRow[];
  competitors: CompetitorRow[];
  serviceArea: string;
  city: string;
  countryCode: string;
  needsLocality: boolean;
};

const EMPTY_PREFILL: Prefill = {
  source: null,
  pending: null,
  legacySource: false,
  approvedName: "",
  descriptors: [],
  topics: [],
  competitors: [],
  serviceArea: "",
  city: "",
  countryCode: "",
  needsLocality: true,
};

function derivePrefill(
  profile: MarketProfileView | null,
  branchId: string,
  branchName: string,
  branchServiceArea: string | null,
): Prefill {
  if (!profile) return { ...EMPTY_PREFILL, approvedName: branchName };
  const pending = latestPendingVersion(profile);
  const active = currentVersion(profile);
  const source = pending ?? active;
  if (!source) return { ...EMPTY_PREFILL, approvedName: branchName };
  const sameBranch = isSameBranchV2(source.document, branchId);
  const topics: TopicRow[] = source.document.topics.map((topic) => ({
    label: topic.label,
    key: topic.key,
    provenance: topic.provenance,
  }));
  const competitors: CompetitorRow[] = source.document.competitors.map((competitor) => ({
    name: competitor.name,
    website:
      "publicUrl" in competitor && typeof competitor.publicUrl === "string"
        ? competitor.publicUrl
        : "",
    locationHint:
      "locationHint" in competitor && typeof competitor.locationHint === "string"
        ? competitor.locationHint
        : "",
    key: competitor.key,
    provenance:
      "provenance" in competitor && competitor.provenance === "cited" ? "cited" : "operator_lead",
    suggestedBy: "suggestedBy" in competitor && competitor.suggestedBy === "ai" ? "ai" : "operator",
    relevanceEvidenceUrls:
      "relevanceEvidenceUrls" in competitor && Array.isArray(competitor.relevanceEvidenceUrls)
        ? (competitor.relevanceEvidenceUrls as string[])
        : [],
  }));
  const geographies = sameBranch ? source.document.geographies : [];
  const tradeArea = geographies.find((geography) => geography.layer === "trade_area");
  const city = geographies.find((geography) => geography.layer === "city");
  const country = geographies.find((geography) => geography.layer === "country");
  const cityName = city && "name" in city ? city.name : "";
  const countryCode =
    country && "countryCode" in country
      ? country.countryCode
      : city && "countryCode" in city
        ? city.countryCode
        : "";
  return {
    source,
    pending,
    legacySource: !sameBranch,
    approvedName: source.document.publicIdentity.approvedName || branchName,
    descriptors: source.document.nicheDescriptors,
    topics,
    competitors,
    serviceArea: tradeArea && "name" in tradeArea ? tradeArea.name : (branchServiceArea ?? ""),
    city: cityName,
    countryCode,
    needsLocality: cityName.trim().length === 0 || countryCode.trim().length === 0,
  };
}

async function defaultLoadProfile(
  organizationId: string,
  branchId: string,
): Promise<MarketProfileView> {
  const response = await fetch(
    `/api/organizations/${organizationId}/market-profile?branchId=${encodeURIComponent(branchId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("PROFILE_LOAD_FAILED");
  const body = (await response.json()) as { marketProfile: MarketProfileView };
  return body.marketProfile;
}

async function defaultLoadResearch(
  organizationId: string,
  branchId: string,
  signal: AbortSignal,
): Promise<MonitoringResearchState> {
  const response = await fetch(
    `/api/organizations/${organizationId}/growth-intelligence?branchId=${encodeURIComponent(branchId)}&historyLimit=1`,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw new Error("RESEARCH_LOAD_FAILED");
  const body = (await response.json()) as {
    research: {
      active: ResearchPipelineView | null;
      lastSuccess: ResearchPipelineView | null;
    } | null;
  };
  return { active: body.research?.active ?? null, lastSuccess: body.research?.lastSuccess ?? null };
}

async function defaultRejectProposal(
  organizationId: string,
  input: { versionId: string; digest: string },
): Promise<void> {
  const response = await fetch(
    `/api/organizations/${organizationId}/market-profile/versions/${input.versionId}/decisions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decision: "rejected",
        profileDigest: input.digest,
        idempotencyKey: crypto.randomUUID(),
      }),
    },
  );
  if (!response.ok) throw new Error("PROPOSAL_REJECT_FAILED");
}

async function defaultStartResearch(
  organizationId: string,
  input: StartResearchInput,
): Promise<StartBranchResearchResult> {
  const response = await fetch(`/api/organizations/${organizationId}/market-profile/research`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      branchId: input.branchId,
      document: input.document,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      idempotencyKey: input.idempotencyKey,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(body?.error?.code ?? "RESEARCH_START_FAILED");
  }
  const body = (await response.json()) as { research: StartBranchResearchResult };
  return body.research;
}

function validWebsite(value: string): boolean {
  if (value.length > COMPETITOR_URL_CHARACTERS) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function MarketMonitoringDialog({
  organizationId,
  canManage,
  branches,
  initialBranchId,
  open,
  onOpenChange,
  loadProfile,
  loadResearch,
  rejectProposal,
  startResearch,
  onStarted,
}: MarketMonitoringDialogProps) {
  const activeBranches = useMemo(() => branches.filter((branch) => branch.isActive), [branches]);
  const [branchId, setBranchId] = useState<string | null>(initialBranchId);
  // The selection follows the seed branch while the dialog opens, and falls
  // back to the only active branch instead of choosing for the operator when
  // several exist. Adjusted during render (never in an effect) so the branch
  // state is settled before the loaders below read it.
  const [selectionSeed, setSelectionSeed] = useState({ initialBranchId, open });
  if (selectionSeed.initialBranchId !== initialBranchId || selectionSeed.open !== open) {
    setSelectionSeed({ initialBranchId, open });
    setBranchId(initialBranchId);
  }
  const singleActiveBranchId = activeBranches.length === 1 ? activeBranches[0]!.id : null;
  if (branchId === null && singleActiveBranchId !== null) {
    setBranchId(singleActiveBranchId);
  }
  const [profile, setProfile] = useState<MarketProfileView | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [research, setResearch] = useState<MonitoringResearchState>({
    active: null,
    lastSuccess: null,
  });
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [topicDraft, setTopicDraft] = useState("");
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([]);
  const [competitorName, setCompetitorName] = useState("");
  const [competitorWebsite, setCompetitorWebsite] = useState("");
  const [competitorHint, setCompetitorHint] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pendingBranchId, setPendingBranchId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "working" | "failed" | "started">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rejectState, setRejectState] = useState<"idle" | "working" | "failed" | "rejected">(
    "idle",
  );
  const requestId = useRef(0);

  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? "";
  const branchServiceArea = branches.find((branch) => branch.id === branchId)?.serviceArea ?? null;
  const branchActive = branches.find((branch) => branch.id === branchId)?.isActive ?? false;

  // The loaders below settle exactly one branch scope at a time. Loading and
  // failure are derived from which scope settled last, so the effect only
  // ever writes settled results from async callbacks — never synchronously.
  const loadKey = !open || branchId === null ? null : `${organizationId}:${branchId}`;
  // Closing the dialog releases the settled scope, so reopening re-reads
  // instead of flashing the previous scope as current.
  if (!open && settledKey !== null) {
    setSettledKey(null);
  }
  const settled = loadKey !== null && settledKey === loadKey;
  const visibleProfile = settled && !loadFailed ? profile : null;
  const profileState: "idle" | "loading" | "failed" =
    loadKey === null ? "idle" : !settled ? "loading" : loadFailed ? "failed" : "idle";

  useEffect(() => {
    if (loadKey === null || branchId === null) return;
    const key = loadKey;
    const seen = (requestId.current += 1);
    const loader = loadProfile ?? ((id: string) => defaultLoadProfile(organizationId, id));
    loader(branchId).then(
      (view) => {
        // A background refresh must never overwrite typed edits: only the
        // latest request for the selected branch may replace the form, and
        // never while the operator has unsaved changes.
        if (requestId.current !== seen) return;
        setProfile(view);
        setLoadFailed(false);
        setSettledKey(key);
        setDirty(false);
        setSubmitState("idle");
        setSubmitError(null);
        setRejectState("idle");
        const prefill = derivePrefill(view, branchId, branchName, branchServiceArea);
        setTopics(prefill.topics);
        setCompetitors(prefill.competitors);
        setServiceArea(prefill.serviceArea);
        setCity(prefill.city);
        setCountry(prefill.countryCode);
        setTopicDraft("");
        setCompetitorName("");
        setCompetitorWebsite("");
        setCompetitorHint("");
        setFormError(null);
      },
      () => {
        if (requestId.current !== seen) return;
        setLoadFailed(true);
        setSettledKey(key);
      },
    );
    const controller = new AbortController();
    const researchLoader =
      loadResearch ?? ((id: string) => defaultLoadResearch(organizationId, id, controller.signal));
    researchLoader(branchId).then(
      (state) => {
        if (requestId.current !== seen) return;
        setResearch(state);
      },
      () => {
        if (requestId.current !== seen) return;
        setResearch({ active: null, lastSuccess: null });
      },
    );
    return () => controller.abort();
  }, [loadKey, branchId, organizationId, loadProfile, loadResearch, branchName, branchServiceArea]);

  const prefill = useMemo(
    () => derivePrefill(visibleProfile, branchId ?? "", branchName, branchServiceArea),
    [visibleProfile, branchId, branchName, branchServiceArea],
  );

  const inProgress = research.active !== null && !dirty;
  const lastSuccess = research.lastSuccess;

  function requestBranchChange(next: string) {
    if (next === branchId || submitState === "working") return;
    if (dirty) {
      setPendingBranchId(next);
      return;
    }
    setBranchId(next);
  }

  function addTopic() {
    const label = normalizeLabel(topicDraft);
    if (label.length === 0) {
      setFormError("Add a topic before adding it to the list.");
      return;
    }
    if (label.length > TOPIC_CHARACTERS) {
      setFormError(`Topics hold at most ${TOPIC_CHARACTERS} characters.`);
      return;
    }
    if (topics.length >= TOPIC_LIMIT) {
      setFormError(`Research covers at most ${TOPIC_LIMIT} topics.`);
      return;
    }
    if (topics.some((topic) => topic.label.toLowerCase() === label.toLowerCase())) {
      setFormError("That topic is already listed.");
      return;
    }
    setTopics((current) => [...current, { label, key: null, provenance: "operator" }]);
    setTopicDraft("");
    setFormError(null);
    setDirty(true);
  }

  function removeTopic(label: string) {
    setTopics((current) => current.filter((topic) => topic.label !== label));
    setDirty(true);
  }

  function addCompetitor() {
    const name = normalizeLabel(competitorName);
    const website = competitorWebsite.trim();
    const hint = normalizeLabel(competitorHint);
    if (name.length === 0) {
      setFormError("A competitor name is required.");
      return;
    }
    if (name.length > COMPETITOR_NAME_CHARACTERS) {
      setFormError(`Competitor names hold at most ${COMPETITOR_NAME_CHARACTERS} characters.`);
      return;
    }
    if (website.length > 0 && !validWebsite(website)) {
      setFormError("A competitor website must be a valid public HTTP or HTTPS URL.");
      return;
    }
    if (hint.length > COMPETITOR_HINT_CHARACTERS) {
      setFormError(`Location hints hold at most ${COMPETITOR_HINT_CHARACTERS} characters.`);
      return;
    }
    if (competitors.length >= COMPETITOR_LIMIT) {
      setFormError(`Research covers at most ${COMPETITOR_LIMIT} competitors.`);
      return;
    }
    if (competitors.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      setFormError("That competitor is already listed.");
      return;
    }
    setCompetitors((current) => [
      ...current,
      {
        name,
        website,
        locationHint: hint,
        key: null,
        provenance: "operator_lead",
        suggestedBy: "operator",
        relevanceEvidenceUrls: [],
      },
    ]);
    setCompetitorName("");
    setCompetitorWebsite("");
    setCompetitorHint("");
    setFormError(null);
    setDirty(true);
  }

  function removeCompetitor(name: string) {
    setCompetitors((current) => current.filter((row) => row.name !== name));
    setDirty(true);
  }

  async function rejectPending() {
    const pending = prefill.pending;
    if (!pending || submitState === "working") return;
    setRejectState("working");
    try {
      const reject = rejectProposal ?? ((input) => defaultRejectProposal(organizationId, input));
      await reject({ versionId: pending.id, digest: pending.digest });
      setRejectState("rejected");
      // Re-read through the same loader so the form falls back to active
      // settings without losing the branch context.
      const loader = loadProfile ?? ((id: string) => defaultLoadProfile(organizationId, id));
      if (branchId !== null) {
        const seen = (requestId.current += 1);
        const view = await loader(branchId);
        if (requestId.current !== seen) return;
        setProfile(view);
        setLoadFailed(false);
        if (loadKey !== null) setSettledKey(loadKey);
        setDirty(false);
        const next = derivePrefill(view, branchId, branchName, branchServiceArea);
        setTopics(next.topics);
        setCompetitors(next.competitors);
        setServiceArea(next.serviceArea);
        setCity(next.city);
        setCountry(next.countryCode);
      }
    } catch {
      setRejectState("failed");
    }
  }

  function startBlocked(): string | null {
    if (branchId === null) return "Choose a location to review its monitoring scope.";
    if (!branchActive) return "That branch is not active, so research cannot start for it.";
    if (!prefill.source) return "No proposal exists for this branch yet.";
    if (topics.length < 1) return "Add at least one topic.";
    if (prefill.needsLocality) {
      if (
        serviceArea.trim().length === 0 ||
        city.trim().length === 0 ||
        country.trim().length === 0
      ) {
        return "Confirm the research area: service area, city and country are all required.";
      }
    }
    if (research.active !== null && !dirty) return "Research in progress for the reviewed scope.";
    return null;
  }

  async function start() {
    const blocked = startBlocked();
    if (blocked || branchId === null || !prefill.source) {
      setFormError(blocked ?? "Review the highlighted fields before starting research.");
      return;
    }
    const code = country.trim().toUpperCase();
    const area = serviceArea.trim();
    const cityName = normalizeLabel(city);
    const tradeAreaRef = `branch:${branchId}`;
    const cityRef = `city:${slugRef(cityName)}:${code.toLowerCase()}`;
    const countryRef = `country:${code.toLowerCase()}`;
    const source = prefill.source.document;
    const baseV2 = isSameBranchV2(source, branchId) ? source : null;
    const geographies: MarketProfileDocumentV2["geographies"] = prefill.needsLocality
      ? [
          { layer: "trade_area", locationRef: tradeAreaRef, name: area, branchId },
          { layer: "city", locationRef: cityRef, name: cityName, countryCode: code },
          { layer: "country", locationRef: countryRef, name: code, countryCode: code },
        ]
      : (baseV2?.geographies ?? []);
    const document: MarketProfileDocumentV2 = {
      schemaVersion: 2,
      branchId,
      publicIdentity: source.publicIdentity,
      nicheDescriptors: source.nicheDescriptors,
      geographies,
      competitors: competitors.map((row) => ({
        key: row.key ?? toStableKey(row.name),
        name: row.name,
        ...(row.website.length > 0 ? { publicUrl: row.website } : {}),
        ...(row.locationHint.length > 0 ? { locationHint: row.locationHint } : {}),
        geographyRefs: [tradeAreaRef],
        provenance: row.provenance,
        suggestedBy: row.suggestedBy,
        relevanceEvidenceUrls: row.relevanceEvidenceUrls,
        ...(row.locationHint.length > 0 ? { relevanceReason: row.locationHint } : {}),
      })),
      topics: topics.map((topic) => ({
        key: topic.key ?? toStableKey(topic.label),
        label: topic.label,
        provenance: topic.provenance,
      })),
      sourcePolicy: source.sourcePolicy,
      cadence: source.cadence,
    };
    setSubmitState("working");
    setSubmitError(null);
    try {
      const starter = startResearch ?? ((input) => defaultStartResearch(organizationId, input));
      const outcome = await starter({
        branchId,
        document,
        expectedCurrentVersionId: visibleProfile?.profile?.currentVersionId ?? null,
        idempotencyKey: crypto.randomUUID(),
      });
      // Conflict and timeout paths throw above, so reaching here means the
      // atomic start committed: the dialog closes and the caller refreshes.
      setSubmitState("started");
      onStarted?.(outcome.pipelineId);
      onOpenChange(false);
    } catch (error) {
      // Failure rolls back the start server-side; typed edits stay exactly
      // as the operator left them for retry. Never a success message here.
      setSubmitState("failed");
      setSubmitError(
        error instanceof Error && error.message
          ? `Research could not start (${error.message}). Your edits are kept — review and try again.`
          : "Research could not start. Your edits are kept — review and try again.",
      );
    }
  }

  const blockedReason = startBlocked();
  const showLocality = prefill.needsLocality && branchId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[580px]">
        <DialogHeader>
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Settings2 aria-hidden="true" />
            Market monitoring
          </p>
          <DialogTitle>Review market monitoring</DialogTitle>
          <DialogDescription>
            Choose the business and local market the research should cover.
          </DialogDescription>
        </DialogHeader>

        {activeBranches.length === 0 ? (
          <p role="alert" className="text-sm text-muted-foreground">
            No active branch is available, so market research cannot start. Add or reactivate a
            branch first — no branch is invented here.
          </p>
        ) : !canManage ? (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="flex flex-col gap-3">
              <div>
                <dt className="font-semibold">Business</dt>
                <dd className="text-muted-foreground">
                  {prefill.approvedName || branchName}
                  {prefill.descriptors.length > 0 ? ` · ${prefill.descriptors.join(", ")}` : null}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Location</dt>
                <dd className="text-muted-foreground">{branchName || "Not selected"}</dd>
              </div>
              <div>
                <dt className="font-semibold">Topics</dt>
                <dd className="text-muted-foreground">
                  {topics.length > 0 ? topics.map((topic) => topic.label).join(", ") : "None"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Competitors</dt>
                <dd className="text-muted-foreground">
                  {competitors.length > 0
                    ? competitors
                        .map((row) =>
                          row.website.length === 0 ? `${row.name} (Unverified lead)` : row.name,
                        )
                        .join(", ")
                    : "None"}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground">
              Read-only for your role. An operator reviews monitoring.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="market-monitoring-branch">Location</FieldLabel>
                <Select
                  value={branchId ?? ""}
                  onValueChange={requestBranchChange}
                  disabled={submitState === "working"}
                >
                  <SelectTrigger id="market-monitoring-branch" aria-label="Location">
                    <SelectValue placeholder="Choose a location" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {branches.map((branch) => (
                        <SelectItem key={branch.id} value={branch.id} disabled={!branch.isActive}>
                          {branch.name}
                          {branch.serviceArea ? ` · ${branch.serviceArea}` : null}
                          {!branch.isActive ? " (inactive)" : null}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {branchId === null && activeBranches.length > 1 ? (
                  <FieldDescription>The first branch is never chosen for you.</FieldDescription>
                ) : null}
              </Field>
            </FieldGroup>

            {pendingBranchId !== null ? (
              <div role="alert" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                <p className="font-semibold">Discard unsaved changes for this location?</p>
                <p className="text-muted-foreground">
                  Switching locations replaces the form. Your edits for {branchName} are kept only
                  if you keep editing.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setBranchId(pendingBranchId);
                      setPendingBranchId(null);
                    }}
                  >
                    Discard changes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingBranchId(null)}>
                    Keep editing
                  </Button>
                </div>
              </div>
            ) : null}

            {branchId !== null ? (
              <>
                {profileState === "loading" ? (
                  <p className="text-sm text-muted-foreground">Loading the branch scope…</p>
                ) : profileState === "failed" ? (
                  <p role="alert" className="text-sm text-destructive">
                    The branch scope could not be loaded. Nothing changed.
                  </p>
                ) : (
                  <>
                    <dl className="flex flex-col gap-3 text-sm">
                      <div>
                        <dt className="font-semibold">Business</dt>
                        <dd className="text-muted-foreground">
                          {prefill.approvedName || branchName}
                          {prefill.descriptors.length > 0
                            ? ` · ${prefill.descriptors.join(", ")}`
                            : null}
                        </dd>
                      </div>
                      {prefill.legacySource ? (
                        <div>
                          <dt className="font-semibold">Proposal</dt>
                          <dd className="text-muted-foreground">
                            <Badge variant="outline">Draft suggestion</Badge> This organization
                            proposal is a starting point only — it never carries one city&apos;s
                            context to every branch.
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    {prefill.pending?.proposalSource === "ai" ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant="outline">AI proposal pending</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rejectState === "working"}
                          onClick={rejectPending}
                        >
                          Reject proposal
                        </Button>
                        {rejectState === "rejected" ? (
                          <span className="text-muted-foreground">
                            Proposal rejected. Showing active settings.
                          </span>
                        ) : null}
                        {rejectState === "failed" ? (
                          <span role="alert" className="text-destructive">
                            The rejection could not be saved. Nothing changed.
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    <Separator />

                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="market-monitoring-topic">Add a topic</FieldLabel>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input
                            id="market-monitoring-topic"
                            value={topicDraft}
                            onChange={(event) => setTopicDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addTopic();
                              }
                            }}
                            placeholder="Local dining demand"
                            maxLength={TOPIC_CHARACTERS + 1}
                            aria-invalid={formError !== null}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={addTopic}
                            disabled={submitState === "working"}
                          >
                            Add topic
                          </Button>
                        </div>
                      </Field>
                    </FieldGroup>
                    {topics.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {topics.map((topic) => (
                          <li
                            key={topic.key ?? topic.label}
                            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                          >
                            <span>{topic.label}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove topic ${topic.label}`}
                              onClick={() => removeTopic(topic.label)}
                              disabled={submitState === "working"}
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Add between 1 and {TOPIC_LIMIT} topics to follow.
                      </p>
                    )}

                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor="market-monitoring-competitor">
                          Competitor name
                        </FieldLabel>
                        <Input
                          id="market-monitoring-competitor"
                          value={competitorName}
                          onChange={(event) => setCompetitorName(event.target.value)}
                          placeholder="Rival Kitchen"
                          maxLength={COMPETITOR_NAME_CHARACTERS + 1}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="market-monitoring-competitor-url">
                          Public website (optional)
                        </FieldLabel>
                        <Input
                          id="market-monitoring-competitor-url"
                          value={competitorWebsite}
                          onChange={(event) => setCompetitorWebsite(event.target.value)}
                          placeholder="https://example.com"
                          inputMode="url"
                        />
                        <FieldDescription>
                          A website is context only — it never verifies the competitor.
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="market-monitoring-competitor-hint">
                          Location hint (optional)
                        </FieldLabel>
                        <Input
                          id="market-monitoring-competitor-hint"
                          value={competitorHint}
                          onChange={(event) => setCompetitorHint(event.target.value)}
                          placeholder="Near Marina Mall"
                          maxLength={COMPETITOR_HINT_CHARACTERS + 1}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addCompetitor}
                        disabled={submitState === "working"}
                      >
                        Add competitor
                      </Button>
                    </FieldGroup>
                    {competitors.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {competitors.map((row) => (
                          <li
                            key={row.key ?? row.name}
                            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                          >
                            <span>
                              <span className="font-medium">{row.name}</span>{" "}
                              {row.website.length === 0 ? (
                                <Badge variant="outline">Unverified lead</Badge>
                              ) : null}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Remove competitor ${row.name}`}
                              onClick={() => removeCompetitor(row.name)}
                              disabled={submitState === "working"}
                            >
                              Remove
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {showLocality ? (
                      <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
                        <legend className="px-1 text-sm font-semibold">
                          Confirm research area
                        </legend>
                        <p className="text-sm text-muted-foreground">
                          Used for research; does not change your business location.
                        </p>
                        <Field>
                          <FieldLabel htmlFor="market-monitoring-service-area">
                            Service area
                          </FieldLabel>
                          <Input
                            id="market-monitoring-service-area"
                            value={serviceArea}
                            onChange={(event) => {
                              setServiceArea(event.target.value);
                              setDirty(true);
                            }}
                            placeholder="Marina walk"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="market-monitoring-city">City</FieldLabel>
                          <Input
                            id="market-monitoring-city"
                            value={city}
                            onChange={(event) => {
                              setCity(event.target.value);
                              setDirty(true);
                            }}
                            placeholder="Dubai"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="market-monitoring-country">Country</FieldLabel>
                          <Input
                            id="market-monitoring-country"
                            value={country}
                            onChange={(event) => {
                              setCountry(event.target.value);
                              setDirty(true);
                            }}
                            placeholder="AE"
                            maxLength={2}
                          />
                        </Field>
                      </fieldset>
                    ) : null}

                    {formError !== null ? <FieldError role="alert">{formError}</FieldError> : null}

                    {inProgress ? (
                      <p className="rounded-lg bg-muted p-3 text-sm">
                        Research in progress for the reviewed scope. Editing the scope enables a
                        replacement run for this branch only.
                      </p>
                    ) : null}

                    {lastSuccess !== null ? (
                      <p className="text-sm text-muted-foreground">
                        Earlier research from{" "}
                        {new Date(lastSuccess.stageChangedAt).toLocaleDateString("en-AE", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                        {lastSuccess.settingsMatchCurrent === false
                          ? " · Earlier research settings"
                          : null}{" "}
                        stays visible while the replacement runs.
                      </p>
                    ) : null}

                    {submitState === "failed" && submitError !== null ? (
                      <p role="alert" className="text-sm text-destructive">
                        {submitError}
                      </p>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {activeBranches.length > 1
                  ? "Choose a location to review its monitoring scope."
                  : "Loading the branch scope…"}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {canManage && activeBranches.length > 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={
                  submitState === "working" || blockedReason !== null || profileState !== "idle"
                }
                onClick={start}
              >
                {submitState === "working"
                  ? "Starting…"
                  : blockedReason === "Research in progress for the reviewed scope."
                    ? "Research in progress"
                    : "Start market research"}
              </Button>
            </>
          ) : !canManage ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
