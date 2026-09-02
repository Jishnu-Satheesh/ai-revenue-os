import { describe, expect, it } from "vitest";

import {
  capabilities,
  capabilitiesIntro,
  closingCta,
  footer,
  governance,
  hero,
  howItWorks,
  howItWorksIntro,
  illustrativeOpportunity,
  nav,
  receipt,
  timeline,
  WALKTHROUGH_MAILTO,
} from "./content";

const FORBIDDEN_PHRASES = [
  "trusted by",
  "#1",
  "guaranteed",
  "world-class",
  "revolutionary",
  "customers love",
  "ai revenue os",
];

function allCopy(): string[] {
  return [
    hero.eyebrow,
    hero.headline,
    hero.subhead,
    capabilitiesIntro,
    ...capabilities.flatMap((c) => [c.title, c.description]),
    howItWorksIntro,
    ...howItWorks.flatMap((s) => [s.title, s.description]),
    governance.heading,
    governance.subheading,
    ...governance.items.flatMap((g) => [g.title, g.description]),
    closingCta.headline,
    closingCta.body,
    footer.tagline,
  ];
}

describe("marketing content guardrails", () => {
  it("exposes a well-formed mailto walkthrough target", () => {
    expect(WALKTHROUGH_MAILTO).toMatch(/^mailto:[^@]+@[^@]+\.[^@]+$/);
  });

  it("brands the public surface as RIO, never the internal product name", () => {
    expect(nav.productName).toBe("RIO");
    const haystack = allCopy().join("\n").toLowerCase();
    expect(haystack).not.toContain("ai revenue os");
  });

  it("never uses inflated marketing language", () => {
    const haystack = allCopy().join("\n").toLowerCase();
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(haystack).not.toContain(phrase);
    }
  });

  it("labels the only forward-looking figure as an estimate", () => {
    expect(illustrativeOpportunity.impact).toMatch(/^AED/);
    expect(illustrativeOpportunity.impactLabel.toLowerCase()).toContain("estimated");
    expect(illustrativeOpportunity.caption.toLowerCase()).toContain("illustrative");
  });

  it("keeps percentages out of public claims except the illustrative mock", () => {
    const outsideMock = allCopy().join(" ");
    expect(outsideMock).not.toMatch(/\d+%/);
    expect(illustrativeOpportunity.confidence).toMatch(/^\d+% confidence$/);
  });

  it("leaves no section empty", () => {
    expect(nav.productName.length).toBeGreaterThan(0);
    expect(capabilities.length).toBeGreaterThanOrEqual(3);
    expect(howItWorks.length).toBe(4);
    expect(governance.items.length).toBeGreaterThanOrEqual(3);
    for (const text of allCopy()) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it("labels every artifact money figure as estimate or policy", () => {
    const moneyStrings: string[] = [];
    for (const capability of capabilities) {
      if (capability.artifact.kind === "facts") {
        for (const row of capability.artifact.rows) {
          if (row.value.includes("AED")) moneyStrings.push(row.value);
        }
      }
      if (capability.artifact.kind === "ranked") {
        for (const row of capability.artifact.rows) {
          if (row.impact.includes("AED")) moneyStrings.push(row.impact);
        }
      }
      if (capability.artifact.kind === "outcome") {
        moneyStrings.push(
          capability.artifact.baseline,
          capability.artifact.measured,
          capability.artifact.delta,
        );
      }
    }
    for (const step of receipt.steps) {
      if (step.detail.includes("AED") || step.detail.includes("+")) moneyStrings.push(step.detail);
    }
    expect(moneyStrings.length).toBeGreaterThan(0);
    for (const value of moneyStrings) {
      expect(value.toLowerCase()).toMatch(/est\.|cap|policy|wk$/);
    }
  });

  it("keeps percentages out of the section artifacts", () => {
    const artifactCopy = capabilities
      .flatMap((capability) => {
        if (capability.artifact.kind === "facts") {
          return capability.artifact.rows.flatMap((row) => [row.label, row.value, row.source]);
        }
        if (capability.artifact.kind === "ranked") {
          return capability.artifact.rows.flatMap((row) => [row.title, row.impact]);
        }
        return [
          capability.artifact.action,
          capability.artifact.baseline,
          capability.artifact.measured,
          capability.artifact.delta,
        ];
      })
      .join(" ");
    expect(artifactCopy).not.toMatch(/\d+%/);
  });

  it("defines a well-formed gantt timeline", () => {
    expect(timeline.weeks.length).toBeGreaterThanOrEqual(4);
    expect(timeline.phases.length).toBeGreaterThanOrEqual(4);
    for (const phase of timeline.phases) {
      expect(phase.start).toBeGreaterThanOrEqual(0);
      expect(phase.span).toBeGreaterThanOrEqual(1);
      expect(["done", "active", "upcoming"]).toContain(phase.state);
      expect(phase.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("defines a well-formed approval receipt", () => {
    expect(receipt.id.trim().length).toBeGreaterThan(0);
    expect(receipt.caption.toLowerCase()).toContain("illustrative");
    expect(receipt.steps.length).toBeGreaterThanOrEqual(4);
    for (const step of receipt.steps) {
      expect(step.label.trim().length).toBeGreaterThan(0);
      expect(step.detail.trim().length).toBeGreaterThan(0);
      expect(step.time.trim().length).toBeGreaterThan(0);
    }
  });
});
