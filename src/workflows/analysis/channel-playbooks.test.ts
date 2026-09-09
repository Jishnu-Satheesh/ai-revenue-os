import { describe, expect, it } from "vitest";

import {
  CHANNEL_PLAYBOOK_VERSION,
  PILOT_PLAYBOOK_DETECTOR_KEYS,
  selectPlaybookGuidance,
} from "@/workflows/analysis/channel-playbooks";

const TALABAT = {
  channelKey: "talabat-main",
  templateKey: null as string | null,
  channelDisplayName: "Talabat",
};

describe("channel playbooks", () => {
  it("is versioned at 1 and covers exactly the pilot detector set", () => {
    expect(CHANNEL_PLAYBOOK_VERSION).toBe(1);
    expect([...PILOT_PLAYBOOK_DETECTOR_KEYS].sort()).toEqual([
      "operations.closed_share",
      "orders.cancellation_attribution",
      "orders.cancellation_loss",
    ]);
  });

  it("returns Talabat closed-cancellation checks when a CLOSED reason is present", () => {
    const items = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["orders.cancellation_loss"],
      reasonLabels: ["CLOSED"],
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.detectorKey).toBe("orders.cancellation_loss");
    expect(items[0]?.title).toBe("Talabat closed-cancellation checks");
    expect(items[0]?.sourceLabel).toBe("Curated Talabat operations checklist");
  });

  it("returns Talabat general cancellation checks without a CLOSED reason", () => {
    const withoutReasons = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["orders.cancellation_attribution"],
    });
    const withOtherReason = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["orders.cancellation_loss"],
      reasonLabels: ["CUSTOMER"],
    });

    expect(withoutReasons[0]?.title).toBe("Talabat cancellation checks");
    expect(withOtherReason[0]?.title).toBe("Talabat cancellation checks");
  });

  it("detects Talabat through the template key as well", () => {
    const items = selectPlaybookGuidance({
      channelKey: "store-912",
      templateKey: "TALABAT-v2",
      channelDisplayName: "Store 912",
      detectorKeys: ["orders.cancellation_loss"],
      reasonLabels: ["closed"],
    });

    expect(items[0]?.title).toBe("Talabat closed-cancellation checks");
  });

  it("returns availability checks for the closed-share detector", () => {
    const talabat = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["operations.closed_share"],
    });
    const generic = selectPlaybookGuidance({
      channelKey: "deliveroo-main",
      templateKey: null,
      channelDisplayName: "Deliveroo",
      detectorKeys: ["operations.closed_share"],
    });

    expect(talabat[0]?.title).toBe("Talabat availability checks");
    expect(generic[0]?.title).toBe("Deliveroo availability checks");
    expect(generic[0]?.sourceLabel).toBe("Curated marketplace operations checklist");
  });

  it("falls back to generic marketplace wording naming the channel", () => {
    const items = selectPlaybookGuidance({
      channelKey: "deliveroo-main",
      templateKey: null,
      channelDisplayName: "Deliveroo",
      detectorKeys: ["orders.cancellation_loss"],
      reasonLabels: ["CLOSED"],
    });

    expect(items[0]?.title).toBe("Deliveroo cancellation checks");
    expect(items[0]?.title).toContain("Deliveroo");
  });

  it("returns nothing for detectors outside the pilot set", () => {
    expect(
      selectPlaybookGuidance({ ...TALABAT, detectorKeys: ["revenue.period_movement"] }),
    ).toEqual([]);
    expect(selectPlaybookGuidance({ ...TALABAT, detectorKeys: [] })).toEqual([]);
  });

  it("keeps known detectors when mixed with unknown ones", () => {
    const items = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["revenue.period_movement", "operations.closed_share"],
    });

    expect(items.map((item) => item.detectorKey)).toEqual(["operations.closed_share"]);
  });

  it("is deterministic regardless of detector input order or duplicates", () => {
    const first = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["orders.cancellation_loss", "operations.closed_share"],
      reasonLabels: ["CLOSED"],
    });
    const second = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: [
        "operations.closed_share",
        "orders.cancellation_loss",
        "orders.cancellation_loss",
      ],
      reasonLabels: ["CLOSED"],
    });

    expect(second).toEqual(first);
    expect(first.map((item) => item.detectorKey)).toEqual([
      "operations.closed_share",
      "orders.cancellation_loss",
    ]);
  });

  it("keeps every variant to 3–5 steps", () => {
    const variants = [
      selectPlaybookGuidance({
        ...TALABAT,
        detectorKeys: ["orders.cancellation_loss"],
        reasonLabels: ["CLOSED"],
      }),
      selectPlaybookGuidance({ ...TALABAT, detectorKeys: ["orders.cancellation_loss"] }),
      selectPlaybookGuidance({ ...TALABAT, detectorKeys: ["operations.closed_share"] }),
      selectPlaybookGuidance({
        channelKey: "deliveroo-main",
        templateKey: null,
        channelDisplayName: "Deliveroo",
        detectorKeys: ["orders.cancellation_loss", "operations.closed_share"],
      }),
    ];

    expect(variants.flat()).not.toHaveLength(0);
    for (const item of variants.flat()) {
      expect(item.steps.length).toBeGreaterThanOrEqual(3);
      expect(item.steps.length).toBeLessThanOrEqual(5);
    }
  });

  it("contains no URLs and no menu-path claims in any step", () => {
    const items = selectPlaybookGuidance({
      ...TALABAT,
      detectorKeys: ["orders.cancellation_loss", "operations.closed_share"],
      reasonLabels: ["CLOSED"],
    });
    const text = items.flatMap((item) => item.steps).join("\n");

    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain("www.");
    expect(text).not.toMatch(/\bmenu\b/i);
    expect(text).not.toMatch(/\bclick\b/i);
  });
});
