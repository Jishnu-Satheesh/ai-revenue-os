import { ZodError } from "zod";

import {
  INTENT_DENIED_REASON,
  INTENT_REQUIRED_PERMISSION,
  MAX_MISSING_FIELDS,
  type AgentIntent,
  type MissingField,
} from "@/domain/agent-router/intents";
import {
  questionnaireSpecSchema,
  routerInputSchema,
  routerOutputSchema,
  routerProposalSchema,
  type QuestionnaireItem,
  type QuestionnaireSpec,
  type RouterInput,
  type RouterOutput,
  type RouterProposal,
} from "@/domain/agent-router/contracts";
import { DomainError } from "@/lib/errors";

/**
 * Agent router service (spec section 8). Pure, sync, deterministic.
 *
 * The light model only proposes (intent + confidence + missing fields).
 * Everything below is code, never prompt text: strict input validation,
 * permission-to-intent gating, the 3-field missing cap, low-confidence
 * fallback to `answer_memory` with a clarify card, and a routing note built
 * from digests and safe ids only. The router never executes.
 *
 * Message length choice: reject (throw `DomainError` VALIDATION_ERROR) when
 * the trimmed text is empty or exceeds the Task 1 `agent_messages` body cap
 * (20000). No truncate-then-validate: the context-pack rule is "oversized
 * refuses, never silently trims", and the router accepts exactly what the
 * thread store can persist.
 *
 * Deliberately no logging here: the input carries no correlation id, and
 * bodies are never logged. Task 3's route logs intent + confidence + reason
 * codes with its own correlation id.
 */

export type RouterDeps = {
  /**
   * Sync seam for live classification. Task 3's async route calls the
   * light-model provider (`propose`), then either forwards the validated
   * proposal as `{ kind: "stub", ... }` or supplies a resolver here.
   * Without either, `{ kind: "live" }` fails closed to `answer_memory`.
   */
  propose?: (args: {
    text: string;
    page: string;
    contextDigest: string;
    activeWatchCount: number;
  }) => RouterProposal;
};

const QUESTIONNAIRE_LABEL: Record<MissingField, { label: string; helpText: string }> = {
  frequency: { label: "How often should this run?", helpText: "Pick the check-in rhythm." },
  branch: { label: "Which branch is this for?", helpText: "Type the branch name." },
  research_area: { label: "What should the research focus on?", helpText: "One focus area." },
  competitors: { label: "Which competitors should be tracked?", helpText: "Public names only." },
  end_date: { label: "When should monitoring stop?", helpText: "Leave empty for no end date." },
  evidence_window: {
    label: "Which evidence window should advice use?",
    helpText: "Bounded history only.",
  },
};

function itemFor(field: MissingField): QuestionnaireItem {
  if (field === "frequency") {
    return {
      key: field,
      ...QUESTIONNAIRE_LABEL[field],
      kind: "single_select",
      required: true,
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
        { value: "monthly", label: "Monthly" },
      ],
    };
  }
  if (field === "evidence_window") {
    return {
      key: field,
      ...QUESTIONNAIRE_LABEL[field],
      kind: "single_select",
      required: true,
      options: [
        { value: "30d", label: "Last 30 days" },
        { value: "60d", label: "Last 60 days" },
      ],
    };
  }
  if (field === "end_date") {
    return { key: field, ...QUESTIONNAIRE_LABEL[field], kind: "date", required: false };
  }
  return { key: field, ...QUESTIONNAIRE_LABEL[field], kind: "text", required: true };
}

function resumeKey(intent: AgentIntent, page: string, contextDigest: string): string {
  const digestPart = contextDigest.trim().slice(0, 16).replace(/[^a-z0-9]/gi, "x").toLowerCase();
  const pagePart = page
    .trim()
    .slice(0, 60)
    .replace(/[^a-z0-9]/gi, "x")
    .toLowerCase();
  return `router:${intent}:${pagePart}:${digestPart}`;
}

function routingNote(args: {
  page: string;
  intent: AgentIntent;
  confidence: string;
  contextDigest: string;
  historyDigest?: string;
  watchIds: string[];
  missingFields: MissingField[];
  reasonCodes: string[];
  /**
   * B2 handoff invariant (B1 prompt): medium-confidence acts, and the
   * service states the assumption inline. Present only on the escalated
   * medium path; every other note stays byte-identical to before.
   */
  assumption?: string;
}): string {
  const lines = [
    `page=${args.page}`,
    `intent=${args.intent}`,
    `confidence=${args.confidence}`,
    `context_digest=${args.contextDigest}`,
    `history_digest=${args.historyDigest ?? "none"}`,
    `active_watches=${args.watchIds.length > 0 ? args.watchIds.join(",") : "none"}`,
    `missing=${args.missingFields.length > 0 ? args.missingFields.join(",") : "none"}`,
    `reasons=${args.reasonCodes.join(",")}`,
  ];
  if (args.assumption) {
    lines.push(`assumption=${args.assumption}`);
  }
  return lines.join("\n");
}

/**
 * The one inline assumption the service may state (B2). The proposal
 * carries no free text, so this is deterministic platform copy — never
 * tenant or model text — naming what the medium-confidence act presumes.
 */
const MEDIUM_ESCALATION_ASSUMPTION =
  "medium-confidence research read; acting as one bounded DeepThink task";

function finish(args: {
  intent: AgentIntent;
  confidence: RouterOutput["confidence"];
  missingFields: MissingField[];
  questionnaire: QuestionnaireSpec | null;
  reasonCodes: string[];
  page: string;
  contextDigest: string;
  historyDigest?: string;
  watchIds: string[];
  assumption?: string;
}): RouterOutput {
  const questionnaire =
    args.questionnaire === null ? null : questionnaireSpecSchema.parse(args.questionnaire);
  return routerOutputSchema.parse({
    intent: args.intent,
    confidence: args.confidence,
    missingFields: args.missingFields,
    routingNote: routingNote({
      page: args.page,
      intent: args.intent,
      confidence: args.confidence,
      contextDigest: args.contextDigest,
      historyDigest: args.historyDigest,
      watchIds: args.watchIds,
      missingFields: args.missingFields,
      reasonCodes: args.reasonCodes,
      ...(args.assumption ? { assumption: args.assumption } : {}),
    }),
    questionnaire,
    reasonCodes: args.reasonCodes,
  });
}

/**
 * Classifies one user message and either routes directly (questionnaire
 * null) or returns a Questionnaire spec that accumulates context first.
 */
export function routeAgentMessage(input: RouterInput, deps: RouterDeps = {}): RouterOutput {
  let parsed: ReturnType<typeof routerInputSchema.parse>;
  try {
    parsed = routerInputSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.", error);
    }
    throw error;
  }

  const watchIds = parsed.activeWatches.map((candidate) => candidate.id);
  const shared = {
    page: parsed.page,
    contextDigest: parsed.contextDigest,
    historyDigest: parsed.historyDigest,
    watchIds,
  };

  let proposal: RouterProposal;
  const failClosed = (): RouterOutput =>
    finish({
      ...shared,
      intent: "answer_memory",
      confidence: "low",
      missingFields: [],
      questionnaire: {
        kind: "clarify",
        title: "Say that another way?",
        resumeKey: resumeKey("answer_memory", parsed.page, parsed.contextDigest),
        items: [
          {
            key: "clarify",
            label: "What would you like to know?",
            kind: "text",
            required: true,
            helpText: "Routing is unavailable right now, so answers stay read-only.",
          },
          // Spec section 13 (ruling T3b): every fail-closed answer carries
          // an explicit DeepThink-retry offer, never just a dead end.
          {
            key: "retry_deepthink",
            label: "Retry as DeepThink?",
            kind: "confirm",
            required: false,
            helpText: "Runs one bounded research task with honest progress.",
          },
        ],
      },
      reasonCodes: ["PROVIDER_FAIL_CLOSED"],
    });
  if (parsed.model.kind === "stub") {
    proposal = { intent: parsed.model.intent, confidence: parsed.model.confidence, missing: parsed.model.missing };
  } else if (deps.propose) {
    // The resolver seam is still an AI-boundary input: dispose via schema.
    // An unparseable proposal — or a resolver that throws — fails closed
    // exactly like a missing provider. No raw error ever escapes.
    let raw: unknown;
    try {
      raw = deps.propose({
        text: parsed.text,
        page: parsed.page,
        contextDigest: parsed.contextDigest,
        activeWatchCount: parsed.activeWatches.length,
      });
    } catch {
      return failClosed();
    }
    const resolved = routerProposalSchema.safeParse(raw);
    if (!resolved.success) {
      return failClosed();
    }
    proposal = resolved.data;
  } else {
    return failClosed();
  }

  // Policy gate 1: viewers get read-only answers only.
  if (parsed.role === "viewer" && proposal.intent !== "answer_memory") {
    return finish({
      ...shared,
      intent: "answer_memory",
      confidence: proposal.confidence,
      missingFields: [],
      questionnaire: null,
      reasonCodes: ["VIEWER_RESTRICTED", "MODEL_PROPOSAL_OVERRIDDEN"],
    });
  }

  // Policy gate 2: intent needs a grant the caller lacks.
  if (proposal.intent !== "answer_memory") {
    const required = INTENT_REQUIRED_PERMISSION[proposal.intent];
    if (!parsed.permissions.includes(required)) {
      return finish({
        ...shared,
        intent: "answer_memory",
        confidence: proposal.confidence,
        missingFields: [],
        questionnaire: null,
        reasonCodes: [INTENT_DENIED_REASON[proposal.intent], "MODEL_PROPOSAL_OVERRIDDEN"],
      });
    }
  }

  // Low confidence: ask, never guess.
  if (proposal.confidence === "low" && proposal.intent !== "answer_memory") {
    return finish({
      ...shared,
      intent: "answer_memory",
      confidence: "low",
      missingFields: [],
      questionnaire: {
        kind: "clarify",
        title: "Can you say a little more?",
        resumeKey: resumeKey(proposal.intent, parsed.page, parsed.contextDigest),
        items: [
          {
            key: "clarify",
            label: "What would you like to do?",
            kind: "text",
            required: true,
            helpText: "One sentence is enough to route this correctly.",
          },
          // Spec section 13 (ruling T3b): the low-confidence fallback also
          // offers the DeepThink retry, so an unsure read is recoverable.
          {
            key: "retry_deepthink",
            label: "Retry as DeepThink?",
            kind: "confirm",
            required: false,
            helpText: "Runs one bounded research task with honest progress.",
          },
        ],
      },
      reasonCodes: ["LOW_CONFIDENCE_FALLBACK"],
    });
  }

  const missingFields = proposal.missing.slice(0, MAX_MISSING_FIELDS);
  const capped = proposal.missing.length > MAX_MISSING_FIELDS;

  // Zero-click auto-escalation (Task B2, ADR 0074 — reverses ruling T3a
  // for L1/L2): a Quick thread whose message judges as needing research
  // flips to DeepThink server-side for manage-holders. No nudge card is
  // emitted; the `DEEPTHINK_AUTO_ESCALATED` code below is the thread
  // service's flip signal. Sits after the gates (a denied caller stays
  // denied — viewers and grant-less callers never reach here as research)
  // and after the low-confidence fallback (an unsure read is never judged
  // as research). The grant is re-checked explicitly rather than trusted
  // from gate order, so a future reorder cannot silently escalate a
  // caller who may not spend. Only research_once escalates:
  // watch/campaign/profile executors own their own fences downstream.
  // Missing scope still asks first (the branch below): the flip fires only
  // on the direct route, never blind.
  const autoEscalated =
    parsed.threadMode === "quick" &&
    proposal.intent === "research_once" &&
    parsed.permissions.includes(INTENT_REQUIRED_PERMISSION.research_once);

  // Duplicate-watch card: a similar active scope already exists.
  if (proposal.intent === "watch" && parsed.activeWatches.length > 0) {
    const items: QuestionnaireItem[] = [
      {
        key: "choice",
        label: "A similar watch already exists. What should happen?",
        kind: "single_select",
        required: true,
        options: [
          { value: "view_existing", label: "View existing" },
          { value: "update_fields", label: "Update fields" },
          { value: "start_fresh", label: "Start fresh anyway" },
          { value: "cancel", label: "Cancel" },
        ],
      },
      ...missingFields.slice(0, 4).map(itemFor),
    ];
    return finish({
      ...shared,
      intent: "watch",
      confidence: proposal.confidence,
      missingFields,
      questionnaire: {
        kind: "duplicate_watch",
        title: "Watch already running",
        resumeKey: resumeKey("watch", parsed.page, parsed.contextDigest),
        items: items.slice(0, 5),
      },
      reasonCodes: capped
        ? ["DUPLICATE_WATCH_CANDIDATE", "MISSING_FIELDS_CAPPED"]
        : ["DUPLICATE_WATCH_CANDIDATE"],
    });
  }

  // Missing-fields card (watch / research_once / profile scope / campaign window).
  // Ruling T3c: the campaign card kind follows the missing set — the
  // `evidence_window` picker only when the window is what is missing,
  // otherwise the generic missing-fields card.
  if (missingFields.length > 0 && proposal.intent !== "answer_memory") {
    const campaignNeedsWindow =
      proposal.intent === "campaign_advice" && missingFields.includes("evidence_window");
    const kind = campaignNeedsWindow ? "evidence_window" : "missing_fields";
    const title = campaignNeedsWindow ? "Evidence window needed" : "One more detail";
    return finish({
      ...shared,
      intent: proposal.intent,
      confidence: proposal.confidence,
      missingFields,
      questionnaire: {
        kind,
        title,
        resumeKey: resumeKey(proposal.intent, parsed.page, parsed.contextDigest),
        items: missingFields.map(itemFor),
      },
      reasonCodes: capped
        ? ["QUESTIONNAIRE_REQUIRED", "MISSING_FIELDS_CAPPED"]
        : ["QUESTIONNAIRE_REQUIRED"],
    });
  }

  // Route directly. An escalated Quick research read carries the flip
  // signal; medium confidence additionally states its assumption inline
  // in the note (B1 handoff invariant).
  const directCodes = capped
    ? ["MODEL_PROPOSAL_ACCEPTED", "MISSING_FIELDS_CAPPED"]
    : ["MODEL_PROPOSAL_ACCEPTED"];
  if (autoEscalated) {
    directCodes.push("DEEPTHINK_AUTO_ESCALATED");
  }
  return finish({
    ...shared,
    intent: proposal.intent,
    confidence: proposal.confidence,
    missingFields,
    questionnaire: null,
    reasonCodes: directCodes,
    ...(autoEscalated && proposal.confidence === "medium"
      ? { assumption: MEDIUM_ESCALATION_ASSUMPTION }
      : {}),
  });
}
