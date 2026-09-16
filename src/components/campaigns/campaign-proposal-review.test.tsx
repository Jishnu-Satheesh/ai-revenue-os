// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CampaignProposalReview } from "@/components/campaigns/campaign-proposal-review";
import { type CampaignProposalDocument } from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";
import {
  toProposalReview,
  type CampaignProposalReviewView,
  type ProposalDecisionRow,
  type ProposalRow,
} from "@/modules/campaigns/application/proposal-read-model";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";

afterEach(cleanup);

function document(overrides: Partial<CampaignProposalDocument> = {}): CampaignProposalDocument {
  return {
    schemaVersion: 1,
    title: "Weekday lunch footfall",
    businessProblem: "Weekday lunch covers are down against the same weeks last quarter.",
    objective: "acquisition",
    audience: "People working within a short walk who do not order lunch here.",
    offer: { kind: "no_offer" },
    channels: [{ channelKey: "instagram", delivery: "organic" }],
    deliverables: [{ format: "feed", language: "en", count: 3 }],
    timing: { startAt: "2026-09-20T00:00:00.000Z", endAt: null, timezone: "Asia/Dubai" },
    proposedMediaBudget: null,
    generationCostCeiling: { amountMinor: 8000, currency: "AED" },
    successPlan: {
      primaryMetricKey: "weekday_lunch_covers",
      baselineSource: "point_of_sale",
      baselineRevision: 4,
      baselineFrom: "2026-06-01T00:00:00.000Z",
      baselineTo: "2026-08-31T00:00:00.000Z",
      observationWindowDays: 28,
      reportingDelayDays: 2,
      settlementDelayDays: 7,
      measurementMethod: "pre_post_with_baseline",
      target: null,
      missingData: [],
    },
    pausePolicyRef: "Stop if covers fall further for two weeks running.",
    evidence: [
      {
        kind: "business_memory_context",
        organizationId: ORGANIZATION,
        contextManifestId: MANIFEST,
        sourceRevision: 4,
        observedFrom: "2026-06-01T00:00:00.000Z",
        observedTo: "2026-08-31T00:00:00.000Z",
        supports: "internal_fact",
      },
    ],
    memoryContextManifestId: MANIFEST,
    assumptions: ["Lunch service capacity is not the binding constraint."],
    limitations: [],
    readiness: { canPrepare: true, canLaunch: false, blockers: [] },
    ...overrides,
  };
}

function review(input: {
  state?: string;
  document?: CampaignProposalDocument;
  storedDocument?: unknown;
  decisions?: readonly ProposalDecisionRow[];
  linkedCampaignId?: string | null;
  currentVersionId?: string | null;
} = {}): CampaignProposalReviewView {
  const stored = input.document ?? document();
  const proposal: ProposalRow = {
    id: PROPOSAL,
    sourceKind: "business_signal",
    sourceId: null,
    state: input.state ?? "ready_for_review",
    currentVersionId: input.currentVersionId === undefined ? VERSION : input.currentVersionId,
    linkedCampaignId: input.linkedCampaignId ?? null,
    snoozedUntil: null,
    createdAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
  };
  const built = toProposalReview({
    organizationId: ORGANIZATION,
    proposal,
    version:
      proposal.currentVersionId === null
        ? null
        : {
            id: VERSION,
            proposalId: PROPOSAL,
            version: 2,
            document: input.storedDocument === undefined ? stored : input.storedDocument,
            digest: proposalDigest(stored),
            createdAt: "2026-09-15T07:00:00.000Z",
          },
    decisions: input.decisions ?? [],
  });
  if (built === null) throw new Error("The fixture did not build a review.");
  return built;
}

function renderReview(
  view: CampaignProposalReviewView,
  permissions: { canDecide?: boolean; canApprove?: boolean } = {},
) {
  render(
    <CampaignProposalReview
      review={view}
      organizationId={ORGANIZATION}
      timeZone="Asia/Dubai"
      canDecide={permissions.canDecide ?? true}
      canApprove={permissions.canApprove ?? true}
    />,
  );
}

describe("reading one proposal", () => {
  it("states what approving it authorizes, and what it does not", () => {
    renderReview(review());

    // The one failure mode worth designing against here is somebody believing
    // they approved a publication.
    expect(screen.getByText(/drafting the creative, up to/i)).toBeInTheDocument();
    expect(
      screen.getByText(/publishing anything to a public account/i).closest("li"),
    ).toHaveTextContent(/not allowed/i);
    expect(
      screen.getByText(/reserving or spending any media money/i).closest("li"),
    ).toHaveTextContent(/not allowed/i);
  });

  it("shows no media budget as an organic campaign, never as zero", () => {
    renderReview(review());

    // "AED 0.00" would claim somebody set a budget and set it to nothing.
    expect(screen.getByText(/organic-only campaign/i)).toBeInTheDocument();
    expect(screen.queryByText(/AED 0\.00/)).not.toBeInTheDocument();
  });

  it("keeps the two amounts apart", () => {
    renderReview(
      review({
        document: document({ proposedMediaBudget: { amountMinor: 150000, currency: "AED" } }),
      }),
    );

    expect(screen.getByText("AED 1500.00")).toBeInTheDocument();
    expect(screen.getByText("AED 80.00")).toBeInTheDocument();
  });

  it("says plainly when nobody could justify a target", () => {
    renderReview(review());

    expect(screen.getByText(/a target nothing supports is worse than none/i)).toBeInTheDocument();
  });

  it("labels a target as an estimate rather than a promise", () => {
    renderReview(
      review({
        document: document({
          successPlan: { ...document().successPlan, target: { value: 40, unit: "covers" } },
        }),
      }),
    );

    expect(screen.getByText(/an estimate of 40 covers, not a measurement/i)).toBeInTheDocument();
  });

  it("names the gaps the proposal declares", () => {
    renderReview(review({ document: document({ evidence: [] }) }));

    expect(screen.getByText(/no external market research supports this/i)).toBeInTheDocument();
    expect(screen.getByText(/no profit or outcome estimate is attached/i)).toBeInTheDocument();
  });

  it("shows nothing of a document it cannot read", () => {
    renderReview(review({ storedDocument: { schemaVersion: 1, title: "Half" } }));

    expect(screen.getByText(/cannot be shown/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/weekday lunch covers are down/i)).not.toBeInTheDocument();
  });
});

describe("who may decide", () => {
  it("gives a viewer the evidence and no controls", () => {
    renderReview(review(), { canDecide: false, canApprove: false });

    expect(screen.getByText(/weekday lunch covers are down/i)).toBeInTheDocument();
    expect(screen.getByText(/you are reading this, not deciding it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it("lets an operator ask for changes but not agree", () => {
    renderReview(review(), { canDecide: true, canApprove: false });

    // C02 separates the person who drafts a proposal from the one who agrees
    // to it. The interface says so rather than failing at the server.
    expect(
      screen.queryByRole("button", { name: /approve & prepare creatives/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /request changes/i })).toBeInTheDocument();
    expect(screen.getByText(/owner or admin decision/i)).toBeInTheDocument();
  });

  it("offers nothing on a proposal the database would refuse a decision on", () => {
    renderReview(review({ state: "approved_for_preparation" }));

    expect(screen.getByText(/nothing to decide right now/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /approve & prepare creatives/i }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing while the proposal is still being researched", () => {
    renderReview(review({ state: "researching", currentVersionId: null }));

    expect(screen.getByText(/still working out whether there is anything worth doing/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
  });
});

describe("recording a decision", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ outcome: "saved" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("binds an approval to the exact version and digest on screen", async () => {
    const view = review();
    renderReview(view);

    await userEvent.click(screen.getByRole("button", { name: /approve & prepare creatives/i }));
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    // The digest is what stops an approval landing on text its approver never
    // read. It comes from the rendered content, not from a fresh read.
    expect(body).toMatchObject({
      proposalVersionId: VERSION,
      proposalDigest: proposalDigest(document()),
      decision: "approved_for_preparation",
    });
    expect(String(body.idempotencyKey).length).toBeGreaterThan(8);
  });

  it("confirms an approval as preparation only", async () => {
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /approve & prepare creatives/i }));
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    expect(await screen.findByText(/nothing has been published/i)).toBeInTheDocument();
  });

  it("will not send a change request with nothing in it", async () => {
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /request changes/i }));

    // "Do it differently" with no detail is not an instruction.
    expect(screen.getByRole("button", { name: /^record:/i })).toBeDisabled();
    expect(screen.getByText(/nobody can act on a request that does not say/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a change request as instructions", async () => {
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /request changes/i }));
    await userEvent.type(screen.getByLabelText(/what has to change/i), "Name the offer.");
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body).toMatchObject({ decision: "changes_requested", instructions: "Name the offer." });
  });

  it("will not snooze without a date", async () => {
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /^snooze$/i }));

    // A snooze with no end is a silent disappearance, and the service refuses
    // one anyway.
    expect(screen.getByRole("button", { name: /^record:/i })).toBeDisabled();
    expect(screen.getByText(/pick a date to come back to/i)).toBeInTheDocument();
  });

  it("will not dismiss without a reason", async () => {
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));

    expect(screen.getByRole("button", { name: /^record:/i })).toBeDisabled();
    expect(screen.getByText(/a refusal with no reason is no use/i)).toBeInTheDocument();
  });

  it("reuses one idempotency key across a retry of the same decision", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /approve & prepare creatives/i }));
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const second = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    // A fresh key on every attempt would turn a timed-out request into a
    // second decision.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("reports a request that never arrived as having saved nothing", async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /approve & prepare creatives/i }));
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing was recorded/i);
  });

  it("refuses to claim success for a typed refusal carrying an ok status", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ outcome: "stale_version" }), { status: 200 }),
    );
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /approve & prepare creatives/i }));
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    // A 200 carrying a refusal is a refusal. Rendering it as success would
    // report a decision nobody recorded.
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed while you were reading it/i);
    expect(screen.queryByText(/nothing has been published/i)).not.toBeInTheDocument();
  });

  it("says a replayed decision changed nothing", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ outcome: "replayed" }), { status: 200 }),
    );
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /approve & prepare creatives/i }));
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    expect(await screen.findByText(/already recorded, so nothing changed/i)).toBeInTheDocument();
  });

  it("names a refusal by role rather than as a generic failure", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: { code: "AUTHORIZATION_ERROR" } }), { status: 403 }),
    );
    renderReview(review());

    await userEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
    await userEvent.type(screen.getByLabelText(/why you are turning this down/i), "Not now.");
    await userEvent.click(screen.getByRole("button", { name: /^record:/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/your role cannot record that/i);
  });
});

describe("the record of what was decided", () => {
  it("marks a decision made on content that has since changed", () => {
    renderReview(
      review({
        state: "changes_requested",
        decisions: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            proposalId: PROPOSAL,
            proposalVersionId: VERSION,
            proposalDigest: "0".repeat(64),
            decision: "changes_requested",
            reason: null,
            instructions: "Name the offer.",
            snoozedUntil: null,
            decidedAt: "2026-09-15T09:00:00.000Z",
          },
        ],
      }),
    );

    // Otherwise an old approval reads as though it still authorizes the words
    // now on screen.
    expect(screen.getByText(/on an earlier version/i)).toBeInTheDocument();
    expect(screen.getByText("Name the offer.")).toBeInTheDocument();
  });
});
