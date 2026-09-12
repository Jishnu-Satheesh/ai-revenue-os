import { z } from "zod";

/**
 * What a campaign is ready to do — asked four separate times.
 *
 * The failure this file exists to prevent is one readiness answer standing in
 * for all four. A campaign whose publishing contract has lapsed is not a
 * campaign that cannot be researched, drafted or measured; it is a campaign
 * that cannot be *launched*. Collapsing those into a single "ready" flag is
 * what made an expired Meta contract stop internal drafting entirely (audit
 * finding F01), and it is what a single shared readiness type would do again.
 *
 * So each phase carries its own status, its own blockers and its own checked
 * time. A blocker names a stable code, the phase it stops, safe wording for the
 * person reading it, and a typed repair target the client turns into a
 * permitted route. Nothing here reads a database, calls a provider, or invents
 * a platform limit: it is the vocabulary those callers report in.
 *
 * Contract C01 of `docs/superpowers/plans/2026-09-12-campaign-experience-contracts.md`.
 * Governed by `specs/025-campaign-experience-and-marketing-loop.md` and
 * `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md`.
 */

export const campaignReadinessPhases = [
  "proposal",
  "creative_preparation",
  "launch",
  "measurement",
] as const;
export type CampaignReadinessPhase = (typeof campaignReadinessPhases)[number];

/**
 * `unknown` is a first-class answer, not a placeholder for `blocked`.
 *
 * A phase whose evaluation does not exist yet, or whose evidence could not be
 * read this time, must say so. Reporting `ready` would authorize work on
 * nothing; reporting `blocked` would invent a refusal nobody decided.
 */
export const campaignReadinessStatuses = ["ready", "needs_input", "blocked", "unknown"] as const;
export type CampaignReadinessStatus = (typeof campaignReadinessStatuses)[number];

export const campaignReadinessBlockerCodes = [
  /** Task 5 owns proposal evaluation. Until then the phase answers honestly. */
  "proposal_stage_not_implemented",
  "source_facts_unavailable",
  "no_declared_subject",
  "synthetic_path_not_permitted",
  "proposal_not_approved",
  "required_creative_rejected",
  "render_verification_pending",
  "content_changed",
  "provider_contract_expired",
  "provider_content_limits_unverified",
  /** The contract describes this placement and says it is not usable. */
  "provider_placement_blocked",
  /** The contract does not describe this placement at all. */
  "provider_placement_unknown",
  "provider_mapping_missing",
  "provider_mapping_ambiguous",
  "provider_scope_revoked",
  "provider_adapter_absent",
  "measurement_unavailable",
  "budget_missing",
  "publish_confirmation_pending",
  /** The worker died before it could claim its run. Audit finding F02. */
  "generation_bootstrap_failed",
  /** A run that was enqueued and never picked up by any worker. */
  "generation_run_stalled",
  "generation_failed",
] as const;
export type CampaignReadinessBlockerCode = (typeof campaignReadinessBlockerCodes)[number];

/**
 * Where the client should send someone to clear this blocker.
 *
 * Typed rather than a URL, because a domain module that emits routes has
 * decided what the application layer is allowed to render. The client maps a
 * target to a route it already permits; an unmapped target renders as advice
 * with no button, never as a dead link.
 */
export const campaignReadinessRepairTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("supply_campaign_evidence") }),
  z.strictObject({ kind: z.literal("declare_subject") }),
  z.strictObject({ kind: z.literal("approve_proposal") }),
  z.strictObject({ kind: z.literal("review_creative") }),
  z.strictObject({ kind: z.literal("await_render_verification") }),
  z.strictObject({ kind: z.literal("configure_budget") }),
  z.strictObject({ kind: z.literal("configure_measurement") }),
  z.strictObject({
    kind: z.literal("reverify_provider_contract"),
    providerKey: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    kind: z.literal("connect_provider_account"),
    providerKey: z.string().trim().min(1).max(120),
  }),
  z.strictObject({ kind: z.literal("retry_generation") }),
  z.strictObject({ kind: z.literal("contact_support") }),
]);
export type CampaignReadinessRepairTarget = z.infer<typeof campaignReadinessRepairTargetSchema>;

export const campaignReadinessBlockerSchema = z.strictObject({
  code: z.enum(campaignReadinessBlockerCodes),
  phase: z.enum(campaignReadinessPhases),
  /**
   * The execution action this blocker stops, where one exists. Null means the
   * blocker stops the phase itself rather than a single named action.
   */
  actionKey: z.string().trim().min(1).max(160).nullable(),
  /** Safe for a client to read. Never a stack, a provider payload or a secret. */
  explanation: z.string().trim().min(1).max(400),
  repair: campaignReadinessRepairTargetSchema,
  /**
   * True when repeating the same work with the same inputs must fail the same
   * way. A deterministic blocker is what makes an automatic retry pointless
   * spend and a manual retry a refusal rather than a new attempt.
   */
  deterministic: z.boolean(),
});
export type CampaignReadinessBlocker = z.infer<typeof campaignReadinessBlockerSchema>;

/**
 * What this answer was computed from.
 *
 * Readiness is a statement about a moment. Binding the source revisions is what
 * lets a later caller tell "still blocked" from "blocked when we last looked",
 * without re-deriving the evidence.
 */
export const campaignReadinessSourceBindingSchema = z.strictObject({
  kind: z.string().trim().min(1).max(80),
  id: z.string().trim().min(1).max(200),
  revision: z.string().trim().min(1).max(200).nullable(),
});
export type CampaignReadinessSourceBinding = z.infer<typeof campaignReadinessSourceBindingSchema>;

export const campaignReadinessResultSchema = z.strictObject({
  phase: z.enum(campaignReadinessPhases),
  status: z.enum(campaignReadinessStatuses),
  blockers: z.array(campaignReadinessBlockerSchema).max(40),
  /** UTC, as every stored timestamp in this system is. */
  checkedAt: z.string().datetime(),
  sourceRevisions: z.array(campaignReadinessSourceBindingSchema).max(40),
});
export type CampaignReadinessResult = z.infer<typeof campaignReadinessResultSchema>;

export const campaignReadinessSchema = z.strictObject({
  proposal: campaignReadinessResultSchema,
  creativePreparation: campaignReadinessResultSchema,
  launch: campaignReadinessResultSchema,
  measurement: campaignReadinessResultSchema,
});
export type CampaignReadiness = z.infer<typeof campaignReadinessSchema>;

/** Builds one blocker without repeating the phase at every call site. */
export function campaignReadinessBlocker(input: {
  code: CampaignReadinessBlockerCode;
  phase: CampaignReadinessPhase;
  explanation: string;
  repair: CampaignReadinessRepairTarget;
  deterministic: boolean;
  actionKey?: string | null;
}): CampaignReadinessBlocker {
  return {
    code: input.code,
    phase: input.phase,
    actionKey: input.actionKey ?? null,
    explanation: input.explanation,
    repair: input.repair,
    deterministic: input.deterministic,
  };
}

/**
 * The status a set of blockers implies.
 *
 * Deliberately not "worst wins across four phases" — that is the collapse this
 * file exists to prevent. It resolves one phase's own blockers only.
 */
export function campaignReadinessStatusFor(
  blockers: readonly CampaignReadinessBlocker[],
): CampaignReadinessStatus {
  if (blockers.length === 0) return "ready";
  if (blockers.some((blocker) => blocker.deterministic)) return "blocked";
  return "needs_input";
}

function result(input: {
  phase: CampaignReadinessPhase;
  status: CampaignReadinessStatus;
  blockers: readonly CampaignReadinessBlocker[];
  checkedAt: Date;
  sourceRevisions?: readonly CampaignReadinessSourceBinding[];
}): CampaignReadinessResult {
  return {
    phase: input.phase,
    status: input.status,
    blockers: [...input.blockers],
    checkedAt: input.checkedAt.toISOString(),
    sourceRevisions: [...(input.sourceRevisions ?? [])],
  };
}

/**
 * The proposal phase, until Task 5 implements it.
 *
 * Written as `unknown` with a named code rather than omitted from the type.
 * A two-part readiness type that Task 5 has to widen would mean every consumer
 * written before then reads a shape that is about to change; an honest
 * "not implemented yet" reads the final shape today.
 */
export function evaluateProposalReadiness(input: { now: Date }): CampaignReadinessResult {
  return result({
    phase: "proposal",
    status: "unknown",
    checkedAt: input.now,
    blockers: [
      campaignReadinessBlocker({
        code: "proposal_stage_not_implemented",
        phase: "proposal",
        explanation:
          "Campaign proposals are not part of this release yet, so there is nothing to review at this stage.",
        repair: { kind: "none" },
        deterministic: true,
      }),
    ],
  });
}

export type CreativePreparationReadinessInput = {
  now: Date;
  /** Evidence pinned when the campaign was created, if it is still readable. */
  sourceSnapshotAvailable: boolean;
  /** A campaign with nothing to depict cannot be drawn. */
  subjectDeclared: boolean;
  /** False when the organization forbids synthesis and no real reference exists. */
  syntheticPathPermitted: boolean;
  /** Blockers carried from the generation run's own recorded outcome, if any. */
  runBlockers?: readonly CampaignReadinessBlocker[];
  sourceRevisions?: readonly CampaignReadinessSourceBinding[];
};

/**
 * Whether internal creative work may start.
 *
 * Note what is absent: any provider contract, account, scope or adapter. An
 * internal draft is not published, costs a provider nothing and grants nobody
 * permission to spend. Requiring current publishing evidence to draft one is
 * exactly finding F01, and it is why launch keeps its own evaluation below.
 */
export function evaluateCreativePreparationReadiness(
  input: CreativePreparationReadinessInput,
): CampaignReadinessResult {
  const blockers: CampaignReadinessBlocker[] = [];

  if (!input.sourceSnapshotAvailable) {
    blockers.push(
      campaignReadinessBlocker({
        code: "source_facts_unavailable",
        phase: "creative_preparation",
        explanation: "The business facts this campaign was built on can no longer be read.",
        repair: { kind: "supply_campaign_evidence" },
        deterministic: true,
      }),
    );
  }

  if (!input.subjectDeclared) {
    blockers.push(
      campaignReadinessBlocker({
        code: "no_declared_subject",
        phase: "creative_preparation",
        explanation: "No dish, product or subject has been named for this campaign to show.",
        repair: { kind: "declare_subject" },
        deterministic: true,
      }),
    );
  }

  if (!input.syntheticPathPermitted) {
    blockers.push(
      campaignReadinessBlocker({
        code: "synthetic_path_not_permitted",
        phase: "creative_preparation",
        explanation:
          "This organization does not allow generated imagery, and there is no approved photograph to use instead.",
        repair: { kind: "supply_campaign_evidence" },
        deterministic: true,
      }),
    );
  }

  blockers.push(...(input.runBlockers ?? []));

  return result({
    phase: "creative_preparation",
    status: campaignReadinessStatusFor(blockers),
    blockers,
    checkedAt: input.now,
    sourceRevisions: input.sourceRevisions,
  });
}

export type LaunchReadinessInput = {
  now: Date;
  /** Every channel this campaign intends to publish on needs its own proof. */
  providerKey: string;
  /** False when the verified provider contract is absent or past its review date. */
  providerContractCurrent: boolean;
  /** False when the contract proves no copy or hashtag limit for a used placement. */
  contentLimitsVerified: boolean;
  proposalApproved: boolean;
  /** Every finished output reviewed by a person. Confirmed decision D05. */
  everyDeliverableReviewed: boolean;
  /** No reviewed output has since been rejected. */
  rejectedDeliverablePresent: boolean;
  /** A render whose server verification has not returned yet. */
  renderVerificationPending: boolean;
  /** Approved content no longer matches what would be published. */
  contentChangedSinceApproval: boolean;
  providerAccountMapping: "resolved" | "missing" | "ambiguous";
  providerScopesGranted: boolean;
  providerAdapterRegistered: boolean;
  /** Paid channels only. Organic launch needs no media budget. */
  mediaBudgetDeclared: boolean;
  /** A publish already submitted and not yet confirmed by the provider. */
  publishConfirmationPending: boolean;
  actionKey?: string | null;
  sourceRevisions?: readonly CampaignReadinessSourceBinding[];
};

/**
 * Whether an exact finished output may actually be published.
 *
 * Every condition here is an independent proof requirement (contract C07): the
 * contract being current says nothing about whether an account is mapped, and a
 * mapped account says nothing about whether the person approved this exact
 * output. Missing any one blocks only the actions it affects, and names the
 * evidence that is missing rather than a generic refusal.
 */
export function evaluateLaunchReadiness(input: LaunchReadinessInput): CampaignReadinessResult {
  const blockers: CampaignReadinessBlocker[] = [];
  const actionKey = input.actionKey ?? null;

  if (!input.proposalApproved) {
    blockers.push(
      campaignReadinessBlocker({
        code: "proposal_not_approved",
        phase: "launch",
        actionKey,
        explanation: "Nobody has approved this campaign's plan yet.",
        repair: { kind: "approve_proposal" },
        deterministic: true,
      }),
    );
  }

  if (!input.providerContractCurrent) {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_contract_expired",
        phase: "launch",
        actionKey,
        explanation:
          "Our record of what this platform currently allows is out of date, so nothing may be published to it until it is checked again.",
        repair: { kind: "reverify_provider_contract", providerKey: input.providerKey },
        deterministic: true,
      }),
    );
  }

  if (!input.contentLimitsVerified) {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_content_limits_unverified",
        phase: "launch",
        actionKey,
        explanation:
          "We cannot yet prove this platform's caption and hashtag limits, so its posts cannot be checked before publishing.",
        repair: { kind: "reverify_provider_contract", providerKey: input.providerKey },
        deterministic: true,
      }),
    );
  }

  if (!input.everyDeliverableReviewed) {
    blockers.push(
      campaignReadinessBlocker({
        code: "render_verification_pending",
        phase: "launch",
        actionKey,
        explanation: "Every finished post still needs a person to look at it and approve it.",
        repair: { kind: "review_creative" },
        deterministic: false,
      }),
    );
  }

  if (input.rejectedDeliverablePresent) {
    blockers.push(
      campaignReadinessBlocker({
        code: "required_creative_rejected",
        phase: "launch",
        actionKey,
        explanation: "One of the finished posts was rejected and has not been replaced.",
        repair: { kind: "review_creative" },
        deterministic: true,
      }),
    );
  }

  if (input.renderVerificationPending) {
    blockers.push(
      campaignReadinessBlocker({
        code: "render_verification_pending",
        phase: "launch",
        actionKey,
        explanation: "A finished image is still being checked and is not ready to publish.",
        repair: { kind: "await_render_verification" },
        deterministic: false,
      }),
    );
  }

  if (input.contentChangedSinceApproval) {
    blockers.push(
      campaignReadinessBlocker({
        code: "content_changed",
        phase: "launch",
        actionKey,
        explanation: "The wording or artwork changed after it was approved, so it needs approving again.",
        repair: { kind: "review_creative" },
        deterministic: true,
      }),
    );
  }

  if (input.providerAccountMapping === "missing") {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_mapping_missing",
        phase: "launch",
        actionKey,
        explanation: "No connected account on this platform has been chosen to publish from.",
        repair: { kind: "connect_provider_account", providerKey: input.providerKey },
        deterministic: true,
      }),
    );
  }

  if (input.providerAccountMapping === "ambiguous") {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_mapping_ambiguous",
        phase: "launch",
        actionKey,
        explanation:
          "More than one connected account on this platform could publish this, so somebody has to choose.",
        repair: { kind: "connect_provider_account", providerKey: input.providerKey },
        deterministic: true,
      }),
    );
  }

  if (!input.providerScopesGranted) {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_scope_revoked",
        phase: "launch",
        actionKey,
        explanation: "The permission this platform needs to post on your behalf is not granted.",
        repair: { kind: "connect_provider_account", providerKey: input.providerKey },
        deterministic: true,
      }),
    );
  }

  if (!input.providerAdapterRegistered) {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_adapter_absent",
        phase: "launch",
        actionKey,
        explanation: "Publishing to this platform is not switched on in this environment yet.",
        repair: { kind: "contact_support" },
        deterministic: true,
      }),
    );
  }

  if (!input.mediaBudgetDeclared) {
    blockers.push(
      campaignReadinessBlocker({
        code: "budget_missing",
        phase: "launch",
        actionKey,
        explanation: "No approved budget has been set for the paid part of this campaign.",
        repair: { kind: "configure_budget" },
        deterministic: true,
      }),
    );
  }

  if (input.publishConfirmationPending) {
    blockers.push(
      campaignReadinessBlocker({
        code: "publish_confirmation_pending",
        phase: "launch",
        actionKey,
        explanation: "A previous publish has not been confirmed by the platform yet.",
        repair: { kind: "none" },
        deterministic: false,
      }),
    );
  }

  return result({
    phase: "launch",
    status: campaignReadinessStatusFor(blockers),
    blockers,
    checkedAt: input.now,
    sourceRevisions: input.sourceRevisions,
  });
}

export type MeasurementReadinessInput = {
  now: Date;
  /** A registered, deterministic measurement method exists for this outcome. */
  registeredMethodAvailable: boolean;
  /** The baseline and observation window the method needs are both known. */
  baselineAvailable: boolean;
  sourceRevisions?: readonly CampaignReadinessSourceBinding[];
};

/**
 * Whether a result could ever be attributed to this campaign.
 *
 * Separate from launch on purpose. A campaign may be perfectly publishable and
 * still unmeasurable, and saying so up front is the difference between an
 * honest estimate and a realized-result claim nobody can substantiate.
 */
export function evaluateMeasurementReadiness(
  input: MeasurementReadinessInput,
): CampaignReadinessResult {
  const blockers: CampaignReadinessBlocker[] = [];

  if (!input.registeredMethodAvailable || !input.baselineAvailable) {
    blockers.push(
      campaignReadinessBlocker({
        code: "measurement_unavailable",
        phase: "measurement",
        explanation: !input.registeredMethodAvailable
          ? "There is no agreed way to measure this campaign's result yet, so any number would be a guess."
          : "The before-and-after baseline this campaign would be measured against is not available.",
        repair: { kind: "configure_measurement" },
        deterministic: true,
      }),
    );
  }

  return result({
    phase: "measurement",
    status: campaignReadinessStatusFor(blockers),
    blockers,
    checkedAt: input.now,
    sourceRevisions: input.sourceRevisions,
  });
}

/**
 * All four answers, each computed independently.
 *
 * There is no combined status, and adding one would be a mistake. "Is this
 * campaign ready?" is not a question with a single answer, and every caller
 * that needs one needs it for a specific phase.
 */
export function evaluateCampaignReadiness(input: {
  now: Date;
  creativePreparation: Omit<CreativePreparationReadinessInput, "now">;
  launch: Omit<LaunchReadinessInput, "now">;
  measurement: Omit<MeasurementReadinessInput, "now">;
}): CampaignReadiness {
  return {
    proposal: evaluateProposalReadiness({ now: input.now }),
    creativePreparation: evaluateCreativePreparationReadiness({
      ...input.creativePreparation,
      now: input.now,
    }),
    launch: evaluateLaunchReadiness({ ...input.launch, now: input.now }),
    measurement: evaluateMeasurementReadiness({ ...input.measurement, now: input.now }),
  };
}

/**
 * The prefix a failure recorded before the run was ever claimed carries.
 *
 * Kept as a prefix on the existing `failure_code` column rather than a new
 * column: the distinction that matters to a reader is "it never started" versus
 * "it started and failed", and a prefix says that without a schema change that
 * every existing reader would have to learn.
 */
export const CAMPAIGN_BOOTSTRAP_FAILURE_PREFIX = "bootstrap:";

export type CampaignGenerationFailureDescription = {
  blocker: CampaignReadinessBlocker;
  /** Plain wording for the client. Never a code, a stack or a provider payload. */
  clientCopy: string;
  /** What the person should do next, in their own terms. */
  nextAction: string;
  /**
   * Whether starting again could produce a different outcome. A deterministic
   * blocker returns false: offering a retry that must fail identically wastes
   * the client's time and, once a model is involved, their money.
   */
  retryable: boolean;
};

/**
 * Turns a stored failure code into something a client can act on.
 *
 * Failure codes are written for engineers. This is the one place they become
 * wording, a next action and a truthful retry state, so the portfolio, the
 * detail page and the retry route cannot drift into three different accounts of
 * the same failed run.
 */
export function describeCampaignGenerationFailure(
  failureCode: string | null,
): CampaignGenerationFailureDescription {
  if (!failureCode) {
    return {
      blocker: campaignReadinessBlocker({
        code: "generation_failed",
        phase: "creative_preparation",
        explanation: "Generation stopped without recording a reason.",
        repair: { kind: "retry_generation" },
        deterministic: false,
      }),
      clientCopy: "Building this campaign stopped without saying why.",
      nextAction: "Start it again.",
      retryable: true,
    };
  }

  if (failureCode.startsWith("needs_data:")) {
    const missing = failureCode.slice("needs_data:".length).split(",").filter(Boolean);
    const detail =
      missing.length > 0
        ? `Some details are missing before this campaign can be built: ${missing.join(", ")}.`
        : "Some details are missing before this campaign can be built.";
    return {
      blocker: campaignReadinessBlocker({
        code: missing.includes("no_declared_subject")
          ? "no_declared_subject"
          : "source_facts_unavailable",
        phase: "creative_preparation",
        explanation: detail,
        repair: { kind: "supply_campaign_evidence" },
        deterministic: true,
      }),
      clientCopy: detail,
      // Supplying what is missing is a real change of prerequisite, so this
      // refuses nothing: it asks for the one thing that would let it succeed.
      nextAction: "Add the missing details, then start it again.",
      retryable: true,
    };
  }

  if (failureCode.startsWith(CAMPAIGN_BOOTSTRAP_FAILURE_PREFIX)) {
    const reason = failureCode.slice(CAMPAIGN_BOOTSTRAP_FAILURE_PREFIX.length);
    if (reason === "provider_contract_expired") {
      return {
        blocker: campaignReadinessBlocker({
          code: "provider_contract_expired",
          phase: "creative_preparation",
          explanation:
            "Our record of what the publishing platform currently allows is out of date, and the worker could not start without it.",
          repair: { kind: "reverify_provider_contract", providerKey: "meta_campaign" },
          deterministic: true,
        }),
        clientCopy:
          "Building this campaign could not start because our record of the publishing platform's current rules is out of date.",
        nextAction: "This needs the platform's rules checked again before it can run.",
        retryable: false,
      };
    }
    return {
      blocker: campaignReadinessBlocker({
        code: "generation_bootstrap_failed",
        phase: "creative_preparation",
        explanation: "The worker could not start this run and recorded why before stopping.",
        repair: { kind: "retry_generation" },
        deterministic: false,
      }),
      clientCopy: "Building this campaign could not start.",
      nextAction: "Start it again.",
      retryable: true,
    };
  }

  const known: Record<
    string,
    { code: CampaignReadinessBlockerCode; copy: string; next: string; retryable: boolean }
  > = {
    source_snapshot_missing: {
      code: "source_facts_unavailable",
      copy: "The business facts this campaign was built on are no longer available.",
      next: "Create the campaign again from current information.",
      retryable: false,
    },
    no_declared_subject: {
      code: "no_declared_subject",
      copy: "No dish, product or subject was named for this campaign to show.",
      next: "Name what this campaign is about, then start it again.",
      retryable: true,
    },
    reference_bytes_unavailable: {
      code: "source_facts_unavailable",
      copy: "A chosen reference image could not be read.",
      next: "Check the image is still in the library, then start it again.",
      retryable: true,
    },
    cancelled_before_start: {
      code: "generation_failed",
      copy: "This was cancelled before it started.",
      next: "Start it again when you are ready.",
      retryable: true,
    },
    cancelled_during_generation: {
      code: "generation_failed",
      copy: "This was cancelled while it was being built.",
      next: "Start it again when you are ready.",
      retryable: true,
    },
    generation_run_stalled: {
      code: "generation_run_stalled",
      copy: "This was queued but no worker ever picked it up.",
      next: "Start it again.",
      retryable: true,
    },
  };

  const match = known[failureCode];
  if (match) {
    return {
      blocker: campaignReadinessBlocker({
        code: match.code,
        phase: "creative_preparation",
        explanation: match.copy,
        repair: match.retryable ? { kind: "retry_generation" } : { kind: "supply_campaign_evidence" },
        deterministic: !match.retryable,
      }),
      clientCopy: match.copy,
      nextAction: match.next,
      retryable: match.retryable,
    };
  }

  // An unrecognised code is not described to a client. Echoing it would leak
  // an internal identifier and tell them nothing they can act on.
  return {
    blocker: campaignReadinessBlocker({
      code: "generation_failed",
      phase: "creative_preparation",
      explanation: "Generation failed.",
      repair: { kind: "retry_generation" },
      deterministic: false,
    }),
    clientCopy: "Building this campaign failed.",
    nextAction: "Start it again.",
    retryable: true,
  };
}
