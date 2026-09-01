import { describe, expect, it } from "vitest";

import {
  CHANNEL_ANALYSIS_REGISTRY_VERSION,
  channelAnalysisDetectors,
  requiredMetricKeys,
  runDetectors,
  selectDetectors,
} from "@/domain/analysis/registry";
import { createFindingCalculationDigest } from "@/domain/analysis/digest";
import { WORKSPACE_CHAPTERS } from "@/domain/analysis/copy";
import { PROVIDER_REPORT_DEFINITIONS } from "@/domain/reports/provider-library";
import { evidence, point, window } from "@/domain/analysis/test-fixtures";

describe("the detector registry", () => {
  it("registers exactly the eleven detectors shipped so far", () => {
    expect(channelAnalysisDetectors.map((detector) => detector.key).sort()).toEqual([
      "customer.new_share",
      "economics.channel_cost_load",
      "economics.commission_share",
      "evidence.period_coverage",
      "evidence.reconciliation_blocked",
      "funnel.stage_conversion",
      "operations.closed_share",
      "orders.cancellation_loss",
      "revenue.channel_share",
      "revenue.period_movement",
      "revenue.window_gross",
    ]);
    expect(CHANNEL_ANALYSIS_REGISTRY_VERSION).toBe(7);
  });

  it("charts no detector the registry does not have", () => {
    // The other direction: a chapter naming a detector nobody registered waits
    // forever for findings that cannot arrive.
    const registered = new Set(channelAnalysisDetectors.map((detector) => detector.key));
    const dangling = WORKSPACE_CHAPTERS.flatMap((chapter) => chapter.detectorKeys).filter(
      (key) => !registered.has(key),
    );

    expect(dangling).toEqual([]);
  });

  it("keeps a deferred chapter honest about having no detector", () => {
    // `deferredReason` is the sentence an operator reads instead of findings.
    // A chapter carrying both a reason and a detector would show the findings
    // and keep the excuse.
    for (const chapter of WORKSPACE_CHAPTERS) {
      if (chapter.detectorKeys.length > 0) {
        expect(chapter.deferredReason, chapter.id).toBeUndefined();
      }
    }
  });

  it("binds only the detectors that can answer without periods at the span grain", () => {
    // A span is one figure for the whole window. Every detector that counts
    // periods, compares one against the previous, or reports coverage has
    // nothing to say about it, so it is not bound at all rather than bound and
    // refusing seven times over.
    expect(
      selectDetectors({ scope: "channel", grain: "span" })
        .map((detector) => detector.key)
        .sort(),
    ).toEqual(["evidence.reconciliation_blocked", "revenue.window_gross"]);
  });

  it("still binds the full channel catalogue at a repeating grain", () => {
    // The span grain is additive. A day window must bind exactly what it bound
    // before, which is what keeps talabat and Keeta unchanged.
    expect(selectDetectors({ scope: "channel", grain: "day" }).length).toBe(10);
  });

  it("declares every field section 11.1 requires, with no empty prose", () => {
    for (const detector of channelAnalysisDetectors) {
      expect(detector.calculationVersion).toBeGreaterThan(0);
      expect(detector.owner).toBe("core");
      expect(detector.acceptedReconciliationStates).toEqual(["current"]);
      expect(detector.compatibleGrains.length).toBeGreaterThan(0);
      expect(detector.evidenceContract.length).toBeGreaterThan(0);
      expect(detector.severityRules.length).toBeGreaterThan(0);
      expect(detector.limitations.length).toBeGreaterThan(0);
      expect(detector.needsDataConditions.length).toBeGreaterThan(0);
    }
  });

  it("registers nothing against metric vocabulary no governed report writes", () => {
    // Derived from the provider library rather than copied from it. A hand-kept
    // list drifts: it silently stops testing the moment a projection changes,
    // and the failure it was written to catch -- a detector reading a metric
    // nothing produces, answering `needs_data` forever -- is exactly the failure
    // a stale copy stops catching. See ADR 0031.
    const written = new Set(
      PROVIDER_REPORT_DEFINITIONS.flatMap((definition) =>
        definition.projection.outputs.map((output) => output.metricKey),
      ),
    );
    for (const detector of channelAnalysisDetectors) {
      for (const key of detector.requiredMetricKeys) {
        expect(
          written.has(key),
          `${detector.key} requires ${key}, which no approved report projection writes`,
        ).toBe(true);
      }
    }
  });

  it("declares monetary impact computable only where it names the method", () => {
    const computable = channelAnalysisDetectors.filter(
      (detector) => detector.monetaryImpact.computable,
    );
    // Exactly two, per ADR 0035: the movement itself, and the provider's own
    // reported rejection loss. Every other detector states why it refuses.
    expect(computable.map((detector) => detector.key)).toEqual([
      "revenue.period_movement",
      "orders.cancellation_loss",
    ]);
    for (const detector of channelAnalysisDetectors) {
      const impact = detector.monetaryImpact;
      expect(impact.computable ? impact.method : impact.reason).toBeTruthy();
    }
  });

  it("emits observations and refusals only where no severity rule exists", () => {
    for (const detector of channelAnalysisDetectors) {
      const declaresSeverity = detector.key === "evidence.reconciliation_blocked";
      if (declaresSeverity) continue;
      // ADR 0031: without a defensible threshold there is no severity to
      // state, so every outcome these detectors can produce omits it.
      expect(detector.severityRules.join(" ")).toMatch(/^None\./);
    }
  });

  it("binds a cross-channel detector only to a run that names no channel", () => {
    const channelScoped = selectDetectors({ scope: "channel", grain: "day" }).map((d) => d.key);
    const organizationScoped = selectDetectors({ scope: "organization", grain: "day" }).map(
      (d) => d.key,
    );

    expect(channelScoped).toEqual([
      "evidence.period_coverage",
      "evidence.reconciliation_blocked",
      "revenue.period_movement",
      "revenue.window_gross",
      "funnel.stage_conversion",
      "orders.cancellation_loss",
      "operations.closed_share",
      "customer.new_share",
      "economics.commission_share",
      "economics.channel_cost_load",
    ]);
    expect(organizationScoped).toEqual(["revenue.channel_share"]);
  });

  it("asks for only the vocabulary the bound detectors need", () => {
    expect(requiredMetricKeys(selectDetectors({ scope: "channel", grain: "day" }))).toEqual([
      "cost.commission",
      "cost.equipment_fee",
      "cost.payment_processing",
      "customer.new_order_count",
      "customer.returning_order_count",
      "listing.cart_additions",
      "listing.impressions",
      "listing.menu_views",
      "listing.placed_orders",
      "operations.closed_days",
      "operations.closed_minutes",
      "operations.scheduled_minutes",
      "order.avoidable_cancellation_count",
      "order.avoidable_cancellation_reason",
      "promotion.funding",
      "revenue.gross",
      "revenue.rejection_loss",
    ]);
  });

  it("runs every bound detector over the same evidence and attributes each outcome", () => {
    const detectors = selectDetectors({ scope: "channel", grain: "day" });
    const outcomes = runDetectors(
      detectors,
      evidence({ points: [point("2026-01-01", 120_000), point("2026-01-02", 90_000)] }),
    );

    // Over revenue-only evidence, the four new detectors each answer with a
    // named refusal rather than staying silent.
    expect(outcomes.map((attributed) => attributed.detector.key)).toEqual([
      "evidence.period_coverage",
      "evidence.reconciliation_blocked",
      "revenue.period_movement",
      "revenue.window_gross",
      "funnel.stage_conversion",
      "orders.cancellation_loss",
      "operations.closed_share",
      "customer.new_share",
      "economics.commission_share",
      "economics.channel_cost_load",
    ]);
  });

  it("digests the same evidence identically and different evidence differently", () => {
    const detectors = selectDetectors({ scope: "channel", grain: "day" });
    const points = [point("2026-01-01", 120_000), point("2026-01-02", 90_000)];
    const digestFor = (numerator: number) =>
      runDetectors(
        detectors,
        evidence({ points: [points[0], point("2026-01-02", numerator)] }),
      ).map((attributed) =>
        createFindingCalculationDigest({
          detectorKey: attributed.detector.key,
          calculationVersion: attributed.detector.calculationVersion,
          window: window(),
          outcome: attributed.outcome,
        }),
      );

    expect(digestFor(90_000)).toEqual(digestFor(90_000));
    expect(digestFor(90_000)).not.toEqual(digestFor(95_000));
  });
});
