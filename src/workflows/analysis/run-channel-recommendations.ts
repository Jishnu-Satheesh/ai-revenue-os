import { z } from "zod";

import {
  MAX_RECOMMENDATIONS_PER_RUN,
  narrationSubmissionSchema,
  type NarratedItem,
  type NarrationSubmission,
} from "@/domain/analysis/recommendations";
import { logger } from "@/lib/logger";
import {
  buildNarrationPrompt,
  sha256Hex,
  type NarrationChannelContext,
  type NarrationPromptFinding,
} from "@/workflows/analysis/recommendation-prompt";
import {
  INTERNAL_ONLY_CONTEXT,
  shareLogFields,
  type ShareContext,
  type ShareMode,
  type SharePromptEntry,
} from "@/workflows/analysis/grounded-share-mode";
import {
  selectGroundedShareSubset,
  type GroundedShareCandidate,
} from "@/domain/memory/grounded-share";

/**
 * The narration worker.
 *
 * The same shape as the channel analysis worker one file over: claim a lease,
 * read what the run found, hand it to a model, and give the reply to a fenced
 * database function that checks every rule again. The worker is not the
 * authority on what may be recorded as a recommendation — the schema and the
 * fence are, which is why a model reply that survives this module has already
 * been parsed twice before anything is stored.
 *
 * See `specs/018-governed-channel-intelligence.md` sections 11.3–11.4 and
 * ADR 0037.
 */

export const channelRecommendationsTaskSchema = z
  .object({
    organizationId: z.string().uuid(),
    /** The run's own scope is authoritative; this only says who asked. */
    channelId: z.string().uuid().nullable(),
    analysisRunId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

export type ChannelRecommendationsPayload = z.infer<typeof channelRecommendationsTaskSchema>;

/** The window the claim bound, echoed back so the prompt matches the run. */
export type ChannelRecommendationWindow = {
  windowStart: string;
  windowEnd: string;
  periodGrain: string;
};

export type ChannelRecommendationsClaim =
  | { outcome: "acquired"; window: ChannelRecommendationWindow }
  | { outcome: "gapfill_acquired"; window: ChannelRecommendationWindow }
  | {
      outcome: "completed" | "not_found" | "not_ready" | "in_progress" | "conflict";
      window?: ChannelRecommendationWindow;
    };

/**
 * Every code `fail_channel_recommendations` accepts (Task 2's ruled
 * vocabulary). The brief called the invalid-narration code `NARRATION_INVALID`;
 * the fence refuses any name outside this list with 22023, so an unusable
 * submission reports as `NARRATION_VALIDATION_FAILED` instead.
 */
export type ChannelRecommendationFailureCode =
  | "MODEL_PROVIDER_UNAVAILABLE"
  | "NARRATION_VALIDATION_FAILED"
  | "NARRATION_PROCESSING_FAILED";

export class ChannelRecommendationsFailure extends Error {
  constructor(public readonly code: ChannelRecommendationFailureCode) {
    super(code);
    this.name = "ChannelRecommendationsFailure";
  }
}

/**
 * The narrator's courier, structurally typed so Task 8 can pass the Gemini
 * adapter without this module importing server-only infrastructure.
 */
export type NarrationGenerator = {
  providerName: string;
  modelId: string;
  generate(
    system: string,
    user: string,
    options?: { useGrounding?: boolean },
  ): Promise<unknown>;
};

export type ChannelRecommendationsDependencies = {
  claim(input: {
    organizationId: string;
    analysisRunId: string;
    correlationId: string;
    claimToken: string;
  }): Promise<ChannelRecommendationsClaim>;
  loadFindings(input: {
    organizationId: string;
    analysisRunId: string;
  }): Promise<readonly NarrationPromptFinding[]>;
  /**
   * Findings the run's filed items already cite. The gap-fill narration may
   * only rest on findings no item cites yet, so the worker needs the cited
   * set to scope its prompt. Optional so existing callers compile; absent on
   * a gap-fill claim fails the run rather than risking a duplicate filing
   * the fence would refuse anyway.
   */
  loadCitedFindingIds?(input: {
    organizationId: string;
    analysisRunId: string;
  }): Promise<readonly string[]>;
  /**
   * Items this run already filed. Gap-fill only: the prompt binds its item
   * budget to the free slots, so coverage and the run-total cap cannot ask
   * for different things. Optional so existing callers compile; absent, the
   * prompt carries no budget line and the fence stays the only cap, exactly
   * as before this dependency existed.
   */
  loadFiledRecommendationCount?(input: {
    organizationId: string;
    analysisRunId: string;
  }): Promise<number>;
  /**
   * Stored channel context for the prompt, loaded server-side by the
   * caller (the Trigger task reads the stored org/channel/branch rows).
   * Optional so existing callers compile; absent — or throwing, which fails
   * open below — renders the prompt without the channel block and grounding
   * rules (the global plain-language rules still render).
   */
  loadPilotContext?(input: {
    organizationId: string;
    analysisRunId: string;
    findings: readonly NarrationPromptFinding[];
  }): Promise<ChannelPilotContext>;
  /**
   * Consent-gated shared context (Spec 024). Optional so existing callers
   * compile; absent means the wiring predates sharing and the run stays
   * internal-only. Entries arrive pre-allowlisted and bounded by the domain
   * subset, so the workflow never judges eligibility here.
   *
   * This stays the status gate: `grounded_share` means the database currently
   * pairs an active consent with a current Google qualification. What the
   * prompt may actually carry is decided by `prepareSharePack` below, which
   * assembles the channel_advice pack and subsets it through the domain
   * allowlist. Until that dep is wired, entries arrive as the gate provides
   * them (empty until capture lands qualified rows).
   */
  loadShareContext?(input: {
    organizationId: string;
  }): Promise<ShareContext>;
  /**
   * Governed channel_advice pack for a grounded_share run (Spec 023 §7).
   * Optional so existing callers compile; absent means the trigger wiring
   * predates pack assembly and the run uses `loadShareContext` entries
   * exactly as before. Present, it is called only when the status gate
   * reports `grounded_share`, and its entries — not the gate's — are
   * allowlisted, threaded into the prompt, and pinned by manifest.
   *
   * The trigger implements this with the context assembler
   * (`assembleContextPack` in `src/modules/memory`) over retrieval scoped
   * to this run, finalized through the context repository; the workflow
   * never touches storage directly, so tests stub this with fixed packs.
   * A throw fails closed for disclosure and open for narration: the run
   * completes evidence-only, honestly labeled internal-only, never with
   * faked provenance.
   */
  prepareSharePack?(input: {
    organizationId: string;
    analysisRunId: string;
    attemptKey: string;
    correlationId: string;
  }): Promise<SharePack>;
  /**
   * Revalidation of a pinned manifest before completion (Spec 023 §9).
   * Optional; absent means the run completes over the prepared entries
   * without a second check, exactly as before. Present, a `changed` answer
   * triggers one bounded fresh attempt (new pack, new prompt, new
   * generation); `revoked`/`unavailable` falls back to one evidence-only
   * generation. The run never completes over entries the database no longer
   * stands behind.
   */
  revalidateSharePack?(input: {
    organizationId: string;
    manifestId: string;
  }): Promise<ShareRevalidation>;
  generator: NarrationGenerator;
  complete(input: {
    organizationId: string;
    analysisRunId: string;
    claimToken: string;
    provider: string;
    modelId: string;
    promptVersion: number;
    promptDigest: string;
    outputDigest: string;
    resultDigest: string;
    items: readonly NarratedItem[];
    /**
     * Provenance of the shared block, when one was pinned and consumed.
     * Optional so existing callers compile; absent means the run completed
     * evidence-only. The trigger records it through
     * `record_channel_recommendation_context` once wired; until then these
     * fields are carried but not persisted, and nothing claims otherwise.
     */
    shareManifestId?: string | null;
    shareMode?: ShareMode;
    shareProvidedRefs?: readonly string[];
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    analysisRunId: string;
    claimToken: string;
    code: ChannelRecommendationFailureCode;
    resultDigest: string;
  }): Promise<void>;
};

/**
 * The stored channel context the prompt builder renders as a fenced block.
 * The trigger task's loader assembles this from stored rows; the workflow
 * only threads it through, so a context the database cannot supply never
 * blocks a narration. Grounding needs no pre-fetched slot — the model
 * searches at generation time — so context is all that travels here.
 */
export type ChannelPilotContext = {
  channelContext: NarrationChannelContext | null;
};

/**
 * One assembled pack entry as the trigger hands it over: the bounded safe
 * title/summary the prompt may carry, plus the eligibility facts the domain
 * allowlist judges. The workflow never derives these facts itself — they
 * arrive from retrieval/projection metadata — it only subsets on them.
 */
export type SharePackEntry = {
  /** Stable per-pack ref (ctx-NNNN) pinned under the manifest. */
  contextRef: string;
  title: string;
  summary: string;
  sensitivity: GroundedShareCandidate["sensitivity"];
  reuseClass: GroundedShareCandidate["reuseClass"];
  knowledgeKind: GroundedShareCandidate["knowledgeKind"];
  hasMoneyAmount: boolean;
  hasPii: boolean;
  rootsLive: boolean;
  scopeOk: boolean;
  isLegacyUnqualified: boolean;
  priority: number;
};

/**
 * A pinned channel_advice manifest and the entries assembled under it.
 * Status mirrors the manifest vocabulary; `unavailable`/`disabled` arrive
 * with zero entries and complete evidence-only.
 */
export type SharePack = {
  manifestId: string;
  status: "ready" | "empty" | "partial" | "unavailable" | "disabled";
  entries: readonly SharePackEntry[];
};

export type ShareRevalidation = "valid" | "changed" | "revoked" | "unavailable";

/**
 * Allowlisted prompt entries from an assembled pack: eligible candidates
 * ordered by priority then ref, capped at 8 entries / 4096 bytes. Ineligible
 * entries are dropped with their exclusion reported to the log as a count —
 * bodies never travel to a log — and an empty selection renders no shared
 * block at all, keeping the prompt byte-identical.
 */
function subsetSharePackEntries(entries: readonly SharePackEntry[]): {
  selected: SharePromptEntry[];
  providedRefs: string[];
  excludedCount: number;
} {
  const candidates: GroundedShareCandidate[] = entries.map((entry) => ({
    id: entry.contextRef,
    sensitivity: entry.sensitivity,
    reuseClass: entry.reuseClass,
    knowledgeKind: entry.knowledgeKind,
    hasMoneyAmount: entry.hasMoneyAmount,
    hasPii: entry.hasPii,
    rootsLive: entry.rootsLive,
    scopeOk: entry.scopeOk,
    isLegacyUnqualified: entry.isLegacyUnqualified,
    summary: entry.summary,
    priority: entry.priority,
  }));
  const { selected, excluded } = selectGroundedShareSubset(candidates);
  const byId = new Map(entries.map((entry) => [entry.contextRef, entry]));
  return {
    selected: selected.map((candidate) => {
      const entry = byId.get(candidate.id);
      return { title: entry?.title ?? "(untitled)", summary: candidate.summary };
    }),
    providedRefs: selected.map((candidate) => candidate.id),
    excludedCount: excluded.length,
  };
}

function failureDigest(code: ChannelRecommendationFailureCode): string {
  // The same convention as the analysis worker: a failure still carries a
  // digest, and it identifies the failure rather than pretending to identify
  // a submission nobody filed.
  return sha256Hex(`channel-recommendations-failure:${code}`);
}

/**
 * A provider reply becomes a submission or nothing at all.
 *
 * The explicit shape check first is deliberate (carried from the Task 6
 * review): bare scalars survive JSON.parse, so `42` arrives here as a number,
 * and refusing it before `.parse` keeps the schema from ever being asked to
 * make sense of something that was never an object.
 */
function parseSubmission(reply: unknown): NarrationSubmission | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const parsed = narrationSubmissionSchema.safeParse(reply);
  return parsed.success ? parsed.data : null;
}

/**
 * Key-sorted canonical JSON of a parsed value.
 *
 * The provider dep returns a *parsed* reply (`extractJsonText`), not raw text,
 * so there is no raw text to digest here. Canonical JSON over the parsed value
 * is the identity this layer can actually compute: deterministic for identical
 * content regardless of the key order the model happened to emit.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function generateOnce(
  generator: NarrationGenerator,
  prompt: { system: string; user: string },
  options: { useGrounding: boolean },
): Promise<unknown> {
  try {
    return await generator.generate(prompt.system, prompt.user, options);
  } catch {
    // The provider's own errors stay in its structured log; nothing about the
    // reply or the business context escapes through this module.
    throw new ChannelRecommendationsFailure("MODEL_PROVIDER_UNAVAILABLE");
  }
}

export async function runChannelRecommendations(
  input: unknown,
  dependencies: ChannelRecommendationsDependencies,
): Promise<{
  outcome: "completed" | "failed" | "skipped";
  recommendationCount: number;
  /** Present only on `failed`. The same code the fence recorded, so the caller
   * can name the reason without reading `private.channel_recommendation_operations`. */
  failureCode?: ChannelRecommendationFailureCode;
  /** Which context mode the narration ran in. Internal-only until an active
   * consent plus a current qualification plus qualified entries all hold. */
  shareMode: ShareMode;
  /** Shared entries placed in the prompt. Zero until Spec 023 capture lands. */
  shareEntryCount: number;
}> {
  const payload = channelRecommendationsTaskSchema.parse(input);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({
    organizationId: payload.organizationId,
    analysisRunId: payload.analysisRunId,
    correlationId: payload.correlationId,
    claimToken,
  });
  if (claim.outcome !== "acquired" && claim.outcome !== "gapfill_acquired") {
    // Recommendations already filed means the run finished this stage, not
    // that it was skipped; every other refusal leaves the stage untouched.
    // No prompt was built, so no context mode applies beyond internal-only.
    return {
      outcome: claim.outcome === "completed" ? "completed" : "skipped",
      recommendationCount: 0,
      shareMode: "internal_only",
      shareEntryCount: 0,
    };
  }
  const gapFill = claim.outcome === "gapfill_acquired";
  // Hoisted while the claim is narrowed to the acquired variants, so the
  // prompt builder below never re-reads an optional field.
  const claimWindow = claim.window;

  try {
    let findings: readonly NarrationPromptFinding[];
    // Items this run already filed; gap-fill only, and only when the loader
    // below is provided. Carried out of the branch so the prompt binds it.
    let filedCount: number | null = null;
    try {
      findings = await dependencies.loadFindings({
        organizationId: payload.organizationId,
        analysisRunId: payload.analysisRunId,
      });
    } catch {
      throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
    }
    // An empty folder cannot produce a citable sentence — every item needs at
    // least one finding id the fence can resolve — so generating over it would
    // only buy a guaranteed rejection.
    if (findings.length === 0) {
      throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
    }

    if (gapFill) {
      // The fence leases a gap-fill only while uncited findings exist, and it
      // refuses any filing that re-cites. Scoping the prompt to the uncited
      // set here keeps the model from spending its items on chapters that
      // already have advice. The detector keys travel to the log as
      // identifiers only — the deterministic coverage signal ADR 0053 asks
      // for, with no figure attached.
      if (!dependencies.loadCitedFindingIds) {
        throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
      }
      let cited: readonly string[];
      try {
        cited = await dependencies.loadCitedFindingIds({
          organizationId: payload.organizationId,
          analysisRunId: payload.analysisRunId,
        });
      } catch {
        throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
      }
      const citedSet = new Set(cited);
      findings = findings.filter((finding) => !citedSet.has(finding.id));
      logger.info("channel_recommendations.coverage_gap", {
        organizationId: payload.organizationId,
        runId: payload.analysisRunId,
        detectorKeys: [...new Set(findings.map((finding) => finding.detectorKey))].sort(),
      });
      if (findings.length === 0) {
        throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
      }

      // The budget the prompt will bind: a gap-fill whose filed items leave
      // no free slot cannot file anything the fence would accept, so it fails
      // here, before a single provider call burns. Absent loader keeps the
      // old behavior — no budget line, fence as the only cap.
      if (dependencies.loadFiledRecommendationCount) {
        try {
          filedCount = await dependencies.loadFiledRecommendationCount({
            organizationId: payload.organizationId,
            analysisRunId: payload.analysisRunId,
          });
        } catch {
          throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
        }
        if (MAX_RECOMMENDATIONS_PER_RUN - filedCount < 1) {
          throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
        }
      }
    }

    // Channel context is advisory, never load-bearing: any throw from the
    // loader — a database error, a drifted row — falls back to null context,
    // which the prompt builder renders without the channel block and grounding
    // rules (the global plain-language rules still render). The run still
    // completes; only findings-empty above fails the run.
    let pilot: ChannelPilotContext = { channelContext: null };
    if (dependencies.loadPilotContext) {
      try {
        pilot = await dependencies.loadPilotContext({
          organizationId: payload.organizationId,
          analysisRunId: payload.analysisRunId,
          findings,
        });
      } catch {
        logger.warn("channel_recommendations.pilot_context_unavailable", {
          organizationId: payload.organizationId,
          runId: payload.analysisRunId,
        });
        pilot = { channelContext: null };
      }
    }

    // Consent-gated sharing (Spec 024) fails closed for disclosure and open
    // for narration, exactly like pilot context above: a status miss means
    // the run completes internal-only, never blocked and never sharing. The
    // dependency is optional so callers wired before sharing compile; absent
    // also means internal-only.
    let share: ShareContext = INTERNAL_ONLY_CONTEXT;
    if (dependencies.loadShareContext) {
      try {
        share = await dependencies.loadShareContext({
          organizationId: payload.organizationId,
        });
      } catch {
        logger.warn("channel_recommendations.share_context_unavailable", {
          organizationId: payload.organizationId,
          runId: payload.analysisRunId,
        });
        share = { ...INTERNAL_ONLY_CONTEXT, reason: "status_unavailable" };
      }
    }
    logger.info("channel_recommendations.share_mode", {
      organizationId: payload.organizationId,
      runId: payload.analysisRunId,
      ...shareLogFields(share),
    });

    // Governed pack (Spec 023 §7): only for a grounded_share gate, only when
    // the trigger wired assembly. The gate's entries stay the fallback until
    // that wiring lands; once present, the pack's allowlisted entries replace
    // them, and the manifest is pinned for revalidation and provenance. Any
    // throw assembles nothing: the run completes evidence-only, honestly
    // labeled internal-only, never with faked provenance.
    let packManifestId: string | null = null;
    let packProvidedRefs: string[] = [];
    if (share.mode === "grounded_share" && dependencies.prepareSharePack) {
      try {
        const pack = await dependencies.prepareSharePack({
          organizationId: payload.organizationId,
          analysisRunId: payload.analysisRunId,
          attemptKey: crypto.randomUUID(),
          correlationId: payload.correlationId,
        });
        if (pack.status === "unavailable" || pack.status === "disabled") {
          // Only org + run travel to the log: the logger's closed allowlist
          // has no manifest/status/count keys, and logger.ts sits outside
          // this slice (flagged in the swarm report). The pinned manifest
          // and provided refs persist through complete(), not the log.
          logger.warn("channel_recommendations.share_pack_unavailable", {
            organizationId: payload.organizationId,
            runId: payload.analysisRunId,
          });
          share = {
            ...INTERNAL_ONLY_CONTEXT,
            reason: pack.status === "disabled" ? "disabled" : "status_unavailable",
          };
        } else {
          const subset = subsetSharePackEntries(pack.entries);
          packManifestId = pack.manifestId;
          packProvidedRefs = subset.providedRefs;
          logger.info("channel_recommendations.share_pack_prepared", {
            organizationId: payload.organizationId,
            runId: payload.analysisRunId,
          });
          share = {
            mode: "grounded_share",
            entries: subset.selected,
            excludedCount: subset.excludedCount,
            reason: pack.status === "empty" ? "corpus_unqualified" : "ready",
          };
        }
      } catch {
        logger.warn("channel_recommendations.share_pack_unavailable", {
          organizationId: payload.organizationId,
          runId: payload.analysisRunId,
        });
        share = { ...INTERNAL_ONLY_CONTEXT, reason: "status_unavailable" };
      }
    }

    function buildPrompt(sharedEntries: readonly SharePromptEntry[]) {
      return buildNarrationPrompt({
        windowStart: claimWindow.windowStart,
        windowEnd: claimWindow.windowEnd,
        periodGrain: claimWindow.periodGrain,
        findings,
        channelContext: pilot.channelContext,
        // Full narrations pass nothing: their prompt stays byte-identical, and
        // a gap-fill without a filed count keeps the old behavior too.
        ...(gapFill && filedCount !== null ? { gapFill: { filedCount } } : {}),
        // Shared entries render only when the allowlist produced some, so
        // runs without shareable entries keep byte-identical prompts.
        ...(sharedEntries.length > 0 ? { sharedContext: sharedEntries } : {}),
      });
    }

    // Grounding follows the run having findings, not the loader's luck and
    // not any detector allowlist (Amendment B retired the 3-key pilot gate):
    // findings-empty fails above, so reaching here means findings exist and
    // the tool is always on. A run whose context failed to load still
    // searches. A grounding failure surfaces as a provider error and takes
    // the existing fail paths below.
    const useGrounding = findings.length > 0;

    async function generateSubmission(prompt: {
      system: string;
      user: string;
      promptVersion: number;
    }): Promise<{ reply: unknown; submission: NarrationSubmission }> {
      let reply = await generateOnce(dependencies.generator, prompt, { useGrounding });
      let submission = parseSubmission(reply);
      if (submission === null) {
        // Exactly one retry: models correct a format miss far more often than
        // two consecutive misses mean a third would help.
        reply = await generateOnce(dependencies.generator, prompt, { useGrounding });
        submission = parseSubmission(reply);
      }
      if (submission === null) {
        throw new ChannelRecommendationsFailure("NARRATION_VALIDATION_FAILED");
      }
      return { reply, submission };
    }

    async function completeSubmission(input: {
      prompt: { system: string; user: string; promptVersion: number };
      reply: unknown;
      submission: NarrationSubmission;
      manifestId: string | null;
      mode: ShareMode;
      providedRefs: readonly string[];
      entryCount: number;
    }): Promise<{
      outcome: "completed";
      recommendationCount: number;
      shareMode: ShareMode;
      shareEntryCount: number;
    }> {
      await dependencies.complete({
        organizationId: payload.organizationId,
        analysisRunId: payload.analysisRunId,
        claimToken,
        provider: dependencies.generator.providerName,
        modelId: dependencies.generator.modelId,
        promptVersion: input.prompt.promptVersion,
        promptDigest: sha256Hex(JSON.stringify({ system: input.prompt.system, user: input.prompt.user })),
        outputDigest: sha256Hex(canonicalJson(input.reply)),
        resultDigest: sha256Hex(JSON.stringify(input.submission)),
        items: input.submission.items,
        shareManifestId: input.manifestId,
        shareMode: input.mode,
        shareProvidedRefs: input.providedRefs,
      });
      return {
        outcome: "completed",
        recommendationCount: input.submission.items.length,
        shareMode: input.mode,
        shareEntryCount: input.entryCount,
      };
    }

    let prompt = buildPrompt(share.entries);
    let generated = await generateSubmission(prompt);

    // Revalidation before completion (Spec 023 §9): only when a manifest is
    // pinned and the dep exists. `changed` earns one bounded fresh attempt;
    // `revoked`/`unavailable` falls back to one evidence-only generation so
    // the run never completes over entries the database withdrew. Without
    // the dep the run completes over the prepared entries as before.
    if (packManifestId !== null && dependencies.revalidateSharePack) {
      let status: ShareRevalidation;
      try {
        status = await dependencies.revalidateSharePack({
          organizationId: payload.organizationId,
          manifestId: packManifestId,
        });
      } catch {
        status = "unavailable";
      }
      logger.info("channel_recommendations.share_revalidated", {
        organizationId: payload.organizationId,
        runId: payload.analysisRunId,
      });
      if (status === "changed") {
        let freshEntries: SharePromptEntry[] = [];
        let freshManifestId: string | null = null;
        let freshRefs: string[] = [];
        if (dependencies.prepareSharePack) {
          try {
            const fresh = await dependencies.prepareSharePack({
              organizationId: payload.organizationId,
              analysisRunId: payload.analysisRunId,
              attemptKey: crypto.randomUUID(),
              correlationId: payload.correlationId,
            });
            if (fresh.status !== "unavailable" && fresh.status !== "disabled") {
              const subset = subsetSharePackEntries(fresh.entries);
              freshEntries = subset.selected;
              freshRefs = subset.providedRefs;
              freshManifestId = fresh.manifestId;
              logger.info("channel_recommendations.share_pack_prepared", {
                organizationId: payload.organizationId,
                runId: payload.analysisRunId,
              });
            }
          } catch {
            logger.warn("channel_recommendations.share_pack_unavailable", {
              organizationId: payload.organizationId,
              runId: payload.analysisRunId,
            });
          }
        }
        if (freshManifestId !== null && dependencies.revalidateSharePack) {
          prompt = buildPrompt(freshEntries);
          generated = await generateSubmission(prompt);
          let freshStatus: ShareRevalidation;
          try {
            freshStatus = await dependencies.revalidateSharePack({
              organizationId: payload.organizationId,
              manifestId: freshManifestId,
            });
          } catch {
            freshStatus = "unavailable";
          }
          logger.info("channel_recommendations.share_revalidated", {
            organizationId: payload.organizationId,
            runId: payload.analysisRunId,
          });
          if (freshStatus === "valid") {
            return completeSubmission({
              prompt,
              reply: generated.reply,
              submission: generated.submission,
              manifestId: freshManifestId,
              mode: "grounded_share",
              providedRefs: freshRefs,
              entryCount: freshEntries.length,
            });
          }
        }
        // Distinct message names keep the fallback reason observable while
        // the logger allowlist stays closed: changed → regenerated below,
        // revoked/unavailable → regenerated in the branch after.
        logger.info("channel_recommendations.share_regenerated", {
          organizationId: payload.organizationId,
          runId: payload.analysisRunId,
        });
        prompt = buildPrompt([]);
        generated = await generateSubmission(prompt);
        return completeSubmission({
          prompt,
          reply: generated.reply,
          submission: generated.submission,
          manifestId: null,
          mode: "internal_only",
          providedRefs: [],
          entryCount: 0,
        });
      }
      if (status === "revoked" || status === "unavailable") {
        logger.info("channel_recommendations.share_regenerated", {
          organizationId: payload.organizationId,
          runId: payload.analysisRunId,
        });
        prompt = buildPrompt([]);
        generated = await generateSubmission(prompt);
        return completeSubmission({
          prompt,
          reply: generated.reply,
          submission: generated.submission,
          manifestId: null,
          mode: "internal_only",
          providedRefs: [],
          entryCount: 0,
        });
      }
    }

    return completeSubmission({
      prompt,
      reply: generated.reply,
      submission: generated.submission,
      manifestId: packManifestId,
      mode: share.mode,
      providedRefs: packProvidedRefs,
      entryCount: share.entries.length,
    });
  } catch (error) {
    const code: ChannelRecommendationFailureCode =
      error instanceof ChannelRecommendationsFailure ? error.code : "NARRATION_PROCESSING_FAILED";
    await dependencies.fail({
      organizationId: payload.organizationId,
      analysisRunId: payload.analysisRunId,
      claimToken,
      code,
      resultDigest: failureDigest(code),
    });
    return {
      outcome: "failed",
      recommendationCount: 0,
      failureCode: code,
      shareMode: "internal_only",
      shareEntryCount: 0,
    };
  }
}
