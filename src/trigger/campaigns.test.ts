import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_PROPOSAL_SCHEMA_VERSION,
  campaignProposalDocumentSchema,
  proposalChannelSchema,
  proposalDeliverableSchema,
  proposalEvidenceReferenceSchema,
  proposalMoneySchema,
  proposalOfferSchema,
  proposalSuccessPlanSchema,
} from "@/domain/campaigns/proposal";

describe("Campaign generation Trigger registration", () => {
  it("registers all generation paths as identifier-only schema tasks on one queue", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    expect(source.match(/schemaTask\(\{/g)).toHaveLength(12);
    for (const id of [
      'id: "campaign.generate-bundle"',
      'id: "campaign.revise-bundle"',
      'id: "campaign.generate-variants"',
      'id: "campaign.create-from-opportunity"',
      'id: "campaign.render-poster"',
      'id: "campaign.edit-plate"',
      // The execution loop. Five workers were written and tested months before
      // anything registered them, so a campaign could be approved and drawn and
      // then nothing published it, measured it, or said what happened.
      'id: "campaign.dispatch-due-actions"',
      'id: "campaign.collect-metrics"',
      'id: "campaign.allocation-cycle"',
      'id: "campaign.settle-outcome"',
      'id: "campaign.propose-learning"',
      // Research drafts the proposal every later lane depends on. It runs on
      // its own lane because it spends allowance, not pixels.
      'id: "campaign.research-proposal"',
    ]) {
      expect(source).toContain(id);
    }
    expect(source.match(/queue: campaignGenerationQueue/g)).toHaveLength(3);
    expect(source).toContain("queue: campaignDraftQueue");
    // Rendering has its own lane. It calls no model and spends nothing, so
    // putting it behind image generation's concurrency of 1 would make the
    // cheap half of the studio wait on the expensive half for no reason.
    expect(source).toContain("queue: campaignRenderQueue");
    // Editing has a third lane. It calls an image model, so a batch of edits
    // behind the render queue would make the cheap half of the studio wait on
    // a provider -- the same reason rendering is not on the generation queue.
    expect(source).toContain("queue: campaignPlateEditQueue");
    // A fourth lane. Sweeps are long and frequent; a render is short and
    // somebody is watching it.
    expect(source).toContain("queue: campaignExecutionQueue");
    // A fifth lane. Research spends allowance, so like generation it runs
    // one at a time rather than bursting parallel spend.
    expect(source).toContain("queue: campaignResearchQueue");
    expect(source).toContain("campaignGenerationPayloadSchema");
    expect(source).toContain("campaignRevisionPayloadSchema");
    expect(source).toContain("campaignVariantPayloadSchema");
    expect(source).toContain("campaignPosterRenderPayloadSchema");
    expect(source).toContain("campaignPlateEditPayloadSchema");
    expect(source).toContain("campaignSweepPayloadSchema");
    expect(source).toContain("campaignCyclePayloadSchema");
    expect(source).toContain("campaignResearchPayloadSchema");
  });

  it("wires research through governed writers and identifier-only payloads", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const research = source.slice(source.indexOf("export const researchCampaignProposalTask"));

    for (const dependency of [
      "createResearchRunStore",
      "createResearchContextReader",
      "createResearchPlanner",
      "createCampaignProposalService",
      "createCampaignEvidenceReader",
      "createAuthenticatedGrowthIntelligenceReadRepository",
    ]) {
      expect(research).toContain(dependency);
    }
    // The draft travels through the governed proposal writer downstream, and
    // research itself never touches a deliverable version.
    expect(research).not.toContain("campaign_deliverable_versions");
    expect(research).not.toContain("research_question");
  });

  it("wires variants through the same governed reference receipt and blueprint path as bundles", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const variants = source.slice(
      source.indexOf("export const generateCampaignVariantsTask"),
      source.indexOf("function campaignRouter"),
    );

    for (const dependency of [
      "createGenerationContextLoader",
      "createReferenceCandidateReader",
      "createSupabaseReferenceObjectReader",
      "createGenerationReferenceContextWriter",
      "createBlueprintPlanner",
      "createVariantPlanner",
    ]) {
      expect(variants).toContain(dependency);
    }
    expect(variants).toContain("provider: generation.provider");
    expect(variants).toContain("repair: generation");
    expect(variants).not.toContain("provider: createGeminiCampaignGenerationProvider()");
  });

  it("keeps privileged dependency construction behind payload validation", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    for (const parser of [
      "parseCampaignGenerationPayload(payload)",
      "parseCampaignRevisionPayload(payload)",
      "parseCampaignVariantPayload(payload)",
      "parseCampaignResearchPayload(payload)",
      "createFromOpportunityPayloadSchema.parse(payload)",
    ]) {
      const parsedAt = source.indexOf(parser, source.indexOf("run: async"));
      const clientAt = source.indexOf("createCampaignWorkerServiceClient()", parsedAt);
      expect(parsedAt).toBeGreaterThan(-1);
      expect(clientAt).toBeGreaterThan(parsedAt);
    }
  });
});

describe("Campaign research lease sweep registration", () => {
  it("registers the sweep as a cron task that recovers dead claims", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    // A dead worker used to strand its run for good: `claim` takes only queued
    // rows, and both `complete` and `fail` demand a live lease. Nothing
    // recovered such a run until this task existed, so its registration is
    // what makes the reclaim reachable at all.
    expect(source).toContain('id: "campaign.research-lease-sweep"');
    expect(source.match(/schedules\.task\(/g)).toHaveLength(2);

    // The research lease is 900 seconds, so a five-minute cadence recovers a
    // dead run within a few minutes of its lease lapsing rather than leaving
    // its pending slot and reserved budget held until someone notices.
    expect(source).toMatch(/schedules\.task\(\{[\s\S]*?cron: "\*\/5 \* \* \* \*"/);
  });

  it("reports a partial sweep as partial rather than as a clean run", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    // `failed` carries the tenants whose reclaim threw. Logging only the
    // totals would make a sweep that recovered nothing look identical to one
    // with nothing to recover.
    expect(source).toContain("campaign.research_lease_sweep_finished");
    expect(source).toMatch(/failed: result\.failed/);
  });
});

describe("Campaign research schedule sweep registration", () => {
  it("registers the cadence as an hourly cron task that admits through the governed writer", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    // Nothing ever started a scheduled evaluation, so the allowance either
    // sat unused or was spent only by button presses. This task is what asks
    // on an organization's behalf — and it asks through the same governed
    // writer a manual request uses, never by inventing its own admission.
    expect(source).toContain('id: "campaign.research-schedule-sweep"');
    expect(source).toMatch(/schedules\.task\(\{[\s\S]*?cron: "0 \* \* \* \*"/);
  });

  it("evaluates bounded windows with identifier-only dispatch", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const sweep = source.slice(source.indexOf("export const researchScheduleSweepTask"));

    // Bounded per tick, oldest first: a missed sweep claims only the current
    // window per organization rather than flooding catch-up.
    expect(sweep).toContain("maxOrganizationsPerTick: 25");
    expect(sweep).toContain("runResearchScheduleSweep");
    expect(sweep).toContain("createResearchDueReader");
    // Identifiers and one operating limit, like every other research
    // payload: the staged question and the manifest bytes travel through the
    // claim-bound loader, never through queue storage or logs.
    expect(sweep).toContain("dispatchResearchWorker");
    expect(sweep).not.toContain("researchQuestion");
    expect(sweep).toContain("campaign.research_schedule_sweep_finished");
    // A refused purse must not read the same as a tick that warranted
    // nothing, and a partial tick never reads as clean.
    expect(sweep).toMatch(/refused: result\.refused/);
    expect(sweep).toMatch(/failed: result\.failed/);
  });
});

describe("Campaign research draft output contract", () => {
  it("derives the document key list from the validator instead of hand-typing it", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // The validator is the single source of truth: the contract interpolates
    // its key lists at runtime, so a schema change flows into the prompt.
    // A hand-typed list is what caused every draft to fail safeParse with
    // draft_unparseable — the model invented title/objectiveSummary-style
    // fields the strict validator rejects.
    expect(contract).toContain("Object.keys(campaignProposalDocumentSchema.shape)");
    expect(contract).toContain("EXACTLY");
    expect(contract).toContain("No extra keys, no missing keys");

    // Expected keys come from the same schema the planner validates against,
    // so a new document key without contract regeneration fails loudly here.
    // Tautological by construction — both sides read the same schema — but it
    // pins the wiring above: delete the interpolation and the stale-guard
    // below still catches the drift.
    const expectedTopLevel = Object.keys(campaignProposalDocumentSchema.shape);
    expect(expectedTopLevel).toEqual(
      expect.arrayContaining([
        "businessProblem",
        "objective",
        "audience",
        "offer",
        "channels",
        "deliverables",
        "timing",
        "proposedMediaBudget",
        "generationCostCeiling",
        "successPlan",
        "pausePolicyRef",
        "evidence",
        "memoryContextManifestId",
        "assumptions",
        "limitations",
        "readiness",
      ]),
    );
    // The runtime fragment the contract builds from those keys carries each
    // one — rebuilt here with the same derivation the contract uses.
    const runtimeTopLevel = expectedTopLevel.join(", ");
    for (const key of expectedTopLevel) {
      expect(runtimeTopLevel).toContain(key);
    }
  });

  it("pins nested shapes, array floors, nullability, and scalar rules", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // Nested shapes come from their schemas, never a hand-typed list.
    for (const wiring of [
      "Object.keys(campaignProposalDocumentSchema.shape.timing.shape)",
      "Object.keys(campaignProposalDocumentSchema.shape.readiness.shape)",
      "Object.keys(proposalChannelSchema.shape)",
      "Object.keys(proposalDeliverableSchema.shape)",
      "Object.keys(proposalMoneySchema.shape)",
      "Object.keys(proposalSuccessPlanSchema.shape)",
      "proposalOfferSchema.options",
      "proposalEvidenceReferenceSchema.options",
    ]) {
      expect(contract).toContain(wiring);
    }

    // Stale guard: exactness is literal in the prompt; the nested pin is
    // verified through the wiring plus the validator itself. Runtime keys
    // never appear as literals in a drift-proof contract — the interpolation
    // carries them — so asserting the source text contains "startAt" would
    // force a hand-typed list and defeat the fix. Instead: the prompt names
    // timing/readiness literally, the wiring derives their keys, and the
    // validator confirms startAt/canPrepare are among them.
    expect(contract).toContain("EXACTLY");
    expect(contract).toContain("timing");
    expect(contract).toContain("readiness");
    expect(Object.keys(campaignProposalDocumentSchema.shape.timing.shape)).toContain("startAt");
    expect(Object.keys(campaignProposalDocumentSchema.shape.readiness.shape)).toContain(
      "canPrepare",
    );

    // Array floors and nullability: channels/deliverables need at least one
    // entry, and nullable fields travel as null rather than going missing.
    expect(contract).toContain("min 1");
    expect(contract).toMatch(/nullable fields may be null but must be present/i);

    // Scalar rules on one surface so the model stops inventing formats.
    for (const marker of [
      "amountMinor",
      "currency",
      "ISO3",
      "UUID",
      "marketClaimKeys",
      "schemaVersion",
    ]) {
      expect(contract).toContain(marker);
    }

    // The nested key lists themselves come from the schemas.
    expect(Object.keys(proposalChannelSchema.shape)).toEqual(
      expect.arrayContaining(["channelKey", "delivery"]),
    );
    expect(Object.keys(proposalDeliverableSchema.shape)).toEqual(
      expect.arrayContaining(["format", "language", "count"]),
    );
    expect(Object.keys(proposalMoneySchema.shape)).toEqual(
      expect.arrayContaining(["amountMinor", "currency"]),
    );
    expect(Object.keys(proposalSuccessPlanSchema.shape)).toContain("primaryMetricKey");
  });

  it("pins discriminator values, enums, target shape, and nullability from the schemas", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // Expected vocabularies come from schema introspection, never hand-typed
    // lists — except the two tripwires below. A new kind/enum without contract
    // regeneration fails here because the rebuilt fragment below drifts from
    // the schema it validates against.
    const offerKinds = proposalOfferSchema.options.flatMap(
      (option) => option.shape.kind.def.values,
    );
    const evidenceKinds = proposalEvidenceReferenceSchema.options.flatMap(
      (option) => option.shape.kind.def.values,
    );
    const deliveryOptions = proposalChannelSchema.shape.delivery.options;
    const targetKeys = Object.keys(proposalSuccessPlanSchema.shape.target.unwrap().shape);

    // Evidence pin: every kind shares one key set and adds exactly one id
    // key, derived from the same shapes the validator enforces. The model
    // mixed researchRequestId and evidenceId onto business-memory items, so
    // each kind names only its own addition and the contract forbids the rest.
    const evidenceOptions = proposalEvidenceReferenceSchema.options;
    const evidenceSharedKeys = [
      ...new Set(evidenceOptions.flatMap((option) => Object.keys(option.shape))),
    ].filter((key) =>
      evidenceOptions.every((option) => Object.keys(option.shape).includes(key)),
    );
    const evidenceSupportsValues = [
      ...new Set(
        evidenceOptions.flatMap((option) => {
          const supports = option.shape.supports as unknown as {
            options?: readonly string[];
            def: { values?: readonly string[] };
          };
          return supports.options ?? supports.def.values ?? [];
        }),
      ),
    ];
    const evidenceKindExtras = evidenceOptions
      .map(
        (option) =>
          `${option.shape.kind.def.values.join("")} adds ${Object.keys(option.shape)
            .filter((key) => !evidenceSharedKeys.includes(key))
            .join(", ")}`,
      )
      .join("; ");

    // Offer pin: the union key list ("kind, offerRef") reads as if every
    // offer carries both keys, so no_offer drafts fail with an extra
    // offerRef. Each kind names its own exact keys, derived here the same
    // way the contract builds them.
    const offerKindExact = proposalOfferSchema.options
      .map(
        (option) =>
          `${option.shape.kind.def.values.join("")} exactly ${Object.keys(option.shape).join(", ")}`,
      )
      .join("; ");

    // Wiring: the shared set, the supports union, and the per-kind additions
    // all travel via schema introspection, never hand-typed key lists.
    for (const wiring of [
      "options.every((option) => Object.keys(option.shape).includes(key))",
      "supports.options ?? supports.def.values",
      "Per kind add only",
      "No other keys on any evidence item ever",
      "sourceRevision number, never string",
      "supports only",
    ]) {
      expect(contract).toContain(wiring);
    }

    // Tripwires, hardcoded against the derivation: shared keys in schema
    // order, the supports union across all three kinds, and each kind's sole
    // addition. A schema change without contract regeneration fails here.
    expect(evidenceSharedKeys).toEqual([
      "kind",
      "organizationId",
      "sourceRevision",
      "observedFrom",
      "observedTo",
      "supports",
    ]);
    expect(evidenceSupportsValues).toEqual(["internal_fact", "assumption", "market_claim"]);
    expect(evidenceKindExtras).toBe(
      "business_memory_context adds contextManifestId; market_claim_citation adds researchRequestId; performance_evidence adds evidenceId",
    );

    // Wiring: every value list travels via .options/.def introspection.
    for (const wiring of [
      "proposalOfferSchema.options",
      "proposalEvidenceReferenceSchema.options",
      "proposalChannelSchema.shape.delivery.options",
      "proposalSuccessPlanSchema.shape.target",
      ".unwrap()",
      "def.values",
    ]) {
      expect(contract).toContain(wiring);
    }

    // Rebuilt with the same derivation the contract uses, so each literal the
    // validator knows must be present in the prompt fragment.
    const discriminatorFragment = `offer.kind one of: ${offerKinds.join(", ")}; evidence[].kind one of: ${evidenceKinds.join(", ")}.`;
    for (const kind of [...offerKinds, ...evidenceKinds]) {
      expect(discriminatorFragment).toContain(kind);
    }
    const valueFragment = `delivery one of: ${deliveryOptions.join(", ")}; successPlan.target keys: ${targetKeys.join(", ")}`;
    for (const option of deliveryOptions) {
      expect(valueFragment).toContain(option);
    }
    for (const key of targetKeys) {
      expect(valueFragment).toContain(key);
    }

    // Tripwires: if the delivery enum ever stops knowing these, the prompt is stale.
    expect(deliveryOptions).toContain("organic");
    expect(deliveryOptions).toContain("paid");

    // Nullability: unknown strings get best text never null, unknown objects
    // stay objects never flattened to strings.
    expect(contract).toMatch(/null ONLY/);
    expect(contract).toMatch(/never null/);
    expect(contract).toMatch(/never flattened/);

    // The channel/deliverable/successPlan walk finds no other enum today —
    // only delivery — so emitting delivery covers every enum in scope.
    const enumFields = Object.entries({
      ...proposalChannelSchema.shape,
      ...proposalDeliverableSchema.shape,
      ...proposalSuccessPlanSchema.shape,
    }).filter(
      ([, field]) =>
        (field as unknown as { def?: { type?: string } }).def?.type === "enum",
    );
    expect(enumFields.map(([key]) => key)).toEqual(["delivery"]);

    // Prompt-sane: the full contract rebuilt as the source builds it.
    const runtimeContract = [
      "A JSON object with alternatives (1-3 items: title, summary, whyViable, risks[], evidenceRefs[]),",
      `document (a campaign proposal document, schemaVersion ${CAMPAIGN_PROPOSAL_SCHEMA_VERSION}),`,
      "and marketClaimKeys (the claims in the prose about the wider market).",
      `document must be an object with EXACTLY these top-level keys: ${Object.keys(campaignProposalDocumentSchema.shape).join(", ")}. No extra keys, no missing keys.`,
      `timing keys: ${Object.keys(campaignProposalDocumentSchema.shape.timing.shape).join(", ")}; readiness keys: ${Object.keys(campaignProposalDocumentSchema.shape.readiness.shape).join(", ")}; offer keys: ${[...new Set(proposalOfferSchema.options.flatMap((option) => Object.keys(option.shape)))].join(", ")}; channel keys: ${Object.keys(proposalChannelSchema.shape).join(", ")} (min 1); deliverable keys: ${Object.keys(proposalDeliverableSchema.shape).join(", ")} (min 1); money keys: ${Object.keys(proposalMoneySchema.shape).join(", ")}; successPlan keys: ${Object.keys(proposalSuccessPlanSchema.shape).join(", ")}; evidence keys: ${[...new Set(proposalEvidenceReferenceSchema.options.flatMap((option) => Object.keys(option.shape)))].join(", ")}. Nullable fields may be null but must be present.`,
      "Scalar rules: short text 1-200 chars, prose longer, timestamps ISO, money {amountMinor int >=0, currency ISO3}, schemaVersion literal number, memoryContextManifestId UUID-or-null, marketClaimKeys string array.",
      `offer.kind one of: ${offerKinds.join(", ")}; evidence[].kind one of: ${evidenceKinds.join(", ")}.`,
      `delivery one of: ${deliveryOptions.join(", ")}; successPlan.target keys: ${targetKeys.join(", ")} (object or null, never a string).`,
      "null ONLY where the contract names UUID-or-null/nullable (proposedMediaBudget, endAt, memoryContextManifestId); every other key needs a real value — unknown strings get your best text, never null; unknown objects get best-effort objects, never flattened to strings.",
      `Evidence items share exactly: ${evidenceSharedKeys.join(", ")}. sourceRevision number, never string; supports only: ${evidenceSupportsValues.join(", ")}. Per kind add only: ${evidenceKindExtras}. No other keys on any evidence item ever.`,
      "Copy ids verbatim, never invent: evidence.organizationId is the <organization_id>; business_memory_context and document.memoryContextManifestId reuse the <memory_context> manifest; (no pinned entries): manifest null, no business_memory_context; market_claim_citation needs a real <claim> id and window, else evidence [].",
      "Risks, evidenceRefs, assumptions, limitations, blockers, missingData: each entry under 40 chars.",
      `Offer per kind exactly: ${offerKindExact}. No other keys on any offer ever.`,
    ].join(" ");
    expect(runtimeContract.length).toBeLessThan(3100);
  });

  it("pins per-kind offer keys from the schema", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // Wiring: per offer kind, exact keys via schema introspection — the same
    // options.map(kind + exactly + own-keys) pattern as the per-kind
    // evidence line. The union list ("kind, offerRef") reads as if every
    // offer carries both keys, so no_offer drafts fail with an extra
    // offerRef.
    for (const wiring of [
      "proposalOfferSchema.options.map",
      "option.shape.kind.def.values",
      "exactly",
      "Object.keys(option.shape)",
      "No other keys on any offer",
    ]) {
      expect(contract).toContain(wiring);
    }

    // Schema-derived: kinds and keys come from the validator, never
    // hand-typed lists. Rebuilt here with the same derivation the contract
    // uses, so each literal the validator knows must be in the fragment.
    const offerKindExact = proposalOfferSchema.options
      .map(
        (option) =>
          `${option.shape.kind.def.values.join("")} exactly ${Object.keys(option.shape).join(", ")}`,
      )
      .join("; ");
    const offerFragment = `Offer per kind exactly: ${offerKindExact}. No other keys on any offer ever.`;
    for (const kind of proposalOfferSchema.options.flatMap(
      (option) => option.shape.kind.def.values,
    )) {
      expect(offerFragment).toContain(kind);
    }
    for (const key of [...new Set(proposalOfferSchema.options.flatMap((option) => Object.keys(option.shape)))]) {
      expect(offerFragment).toContain(key);
    }

    // Tripwires: no_offer carries only kind, offer carries kind plus
    // offerRef. A schema change without contract regeneration fails here.
    expect(offerKindExact).toBe("no_offer exactly kind; offer exactly kind, offerRef");
    expect(Object.keys(proposalOfferSchema.options[0].shape)).toEqual(["kind"]);
    expect(Object.keys(proposalOfferSchema.options[1].shape)).toEqual(["kind", "offerRef"]);
  });

  it("names the verbatim id-copy rule, the empty-pack case, and the 40-char cap", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // Ids are copied, never invented. The planning prompt itself states no
    // organization id, so the copy rule points at the drafter preamble (wired
    // below) for the org id and at the <memory_context> block for the
    // manifest — both values the prompt carries at run time.
    const copyLine = contract.split("\n").find((line) => line.includes("Copy ids verbatim"));
    expect(copyLine).toBeDefined();
    for (const marker of [
      "never invent",
      "evidence.organizationId is the <organization_id>",
      "reuse the <memory_context> manifest",
      "document.memoryContextManifestId",
      "(no pinned entries)",
      "manifest null, no business_memory_context",
      "market_claim_citation",
      "real <claim>",
      "else evidence []",
    ]) {
      expect(copyLine).toContain(marker);
    }

    // The wiring that makes the copy rule usable: the organization id travels
    // in a preamble on both the first draft and the repair pass, taken from
    // the already-parsed payload already in scope — nothing else changed.
    for (const site of [
      "prompt: `<organization_id>${parsed.organizationId}</organization_id>",
      "body: `<organization_id>${parsed.organizationId}</organization_id>",
    ]) {
      expect(source).toContain(site);
    }

    // Tight cap below the short-text rule: these arrays read as one-liners,
    // after a real draft failed with a missingData entry over the limit.
    const capLine =
      contract.split("\n").find((line) => line.includes("under 40 chars")) ?? "";
    for (const array of [
      "risks",
      "evidenceRefs",
      "assumptions",
      "limitations",
      "blockers",
      "missingData",
    ]) {
      expect(capLine.toLowerCase()).toContain(array.toLowerCase());
    }
  });

  it("states the preparation purse rule the planner enforces", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // The planner renders a <preparation_allowance> tag carrying the platform
    // dispatch figure in the policy currency, and refuses any draft whose
    // generationCostCeiling drifts from it (generation_ceiling_mismatch). The
    // contract states the copy rule; a prompt without the tag drafts an
    // honest zero with preparation blocked rather than inventing a purse.
    const purseLine =
      contract.split("\n").find((line) => line.includes("generationCostCeiling MUST equal")) ?? "";
    for (const marker of [
      "generationCostCeiling MUST equal <preparation_allowance> exactly",
      "same amountMinor, same currency",
      "if the tag is absent, set amountMinor 0",
      "readiness.canPrepare false",
      "missing preparation budget",
    ]) {
      expect(purseLine).toContain(marker);
    }
  });

  it("states the sourceless honest-empty rule", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const contract = source.slice(source.indexOf("const RESEARCH_DRAFT_OUTPUT_CONTRACT"));

    // Sourceless orgs failed only by inventing memory/market citations the
    // prompt never showed. The scaler states the conditional honest-empty
    // shape; an empty array passes, an invented citation fails.
    const emptyLine =
      contract.split("\n").find((line) => line.includes("fails validation")) ?? "";
    for (const marker of ["empty array", "assumptions", "fails validation"]) {
      expect(emptyLine).toContain(marker);
    }
  });
});
