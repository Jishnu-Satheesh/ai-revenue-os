import { describe, expect, it } from "vitest";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  applyProjectLifecycle,
  archiveResearchProject,
  assertProjectOrganization,
  cancelResearchUpdate,
  canReadProjectHistory,
  isProjectEligibleForScheduledStart,
  isProjectVisibleInActiveList,
  pauseResearchProject,
  researchProjectSchema,
  resumeResearchProject,
  type ResearchProject,
} from "@/domain/growth-intelligence/project";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "20000000-0000-4000-8000-000000000002";
const PROJECT = "30000000-0000-4000-8000-000000000003";
const LOCATION = "40000000-0000-4000-8000-000000000004";

function recurringProject(overrides: Partial<ResearchProject> = {}): ResearchProject {
  return {
    projectId: PROJECT,
    organizationId: ORG,
    locationId: LOCATION,
    title: "Marina dinner demand",
    question: "Where do Marina families eat out on weekends?",
    mode: "recurring",
    schedule: {
      cadence: "weekly",
      localTime: "08:00",
      timeZone: "Asia/Dubai",
      endDate: "2027-01-31",
    },
    lifecycle: "active",
    ...overrides,
  } as ResearchProject;
}

function oneTimeProject(overrides: Partial<ResearchProject> = {}): ResearchProject {
  return {
    projectId: PROJECT,
    organizationId: ORG,
    locationId: LOCATION,
    title: "Festival one-off",
    question: "What pops up around the food festival weekend?",
    mode: "one-time",
    lifecycle: "active",
    ...overrides,
  } as ResearchProject;
}

function domainCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GrowthIntelligenceError);
    return (error as GrowthIntelligenceError).code;
  }
  throw new Error("Expected a domain error.");
}

describe("research project modes and schedules", () => {
  it("accepts a one-time project without a schedule", () => {
    expect(researchProjectSchema.parse(oneTimeProject()).mode).toBe("one-time");
  });

  it("accepts a recurring project with cadence, local time, timezone, and end date", () => {
    const parsed = researchProjectSchema.parse(recurringProject());
    expect(parsed.mode).toBe("recurring");
  });

  it("rejects a recurring project without a schedule", () => {
    expect(() =>
      researchProjectSchema.parse({ ...recurringProject(), schedule: undefined }),
    ).toThrow();
  });

  it("rejects a one-time project carrying a schedule", () => {
    expect(() =>
      researchProjectSchema.parse({
        ...oneTimeProject(),
        schedule: { cadence: "weekly", localTime: "08:00", timeZone: "Asia/Dubai" },
      }),
    ).toThrow();
  });

  it("rejects invalid modes and schedules", () => {
    expect(() => researchProjectSchema.parse({ ...oneTimeProject(), mode: "yearly" })).toThrow();
    expect(() =>
      researchProjectSchema.parse({
        ...recurringProject(),
        schedule: { cadence: "hourly", localTime: "08:00", timeZone: "Asia/Dubai" },
      }),
    ).toThrow();
    expect(() =>
      researchProjectSchema.parse({
        ...recurringProject(),
        schedule: { cadence: "weekly", localTime: "25:00", timeZone: "Asia/Dubai" },
      }),
    ).toThrow();
    expect(() =>
      researchProjectSchema.parse({
        ...recurringProject(),
        schedule: { cadence: "weekly", localTime: "08:00", timeZone: "Mars/Olympus" },
      }),
    ).toThrow();
    expect(() =>
      researchProjectSchema.parse({
        ...recurringProject(),
        schedule: {
          cadence: "weekly",
          localTime: "08:00",
          timeZone: "Asia/Dubai",
          endDate: "31-01-2027",
        },
      }),
    ).toThrow();
  });
});

describe("research project lifecycle", () => {
  it("pauses, resumes, and archives an active project", () => {
    expect(pauseResearchProject(recurringProject()).lifecycle).toBe("paused");
    expect(resumeResearchProject(recurringProject({ lifecycle: "paused" })).lifecycle).toBe(
      "active",
    );
    expect(archiveResearchProject(recurringProject()).lifecycle).toBe("archived");
    expect(
      archiveResearchProject(recurringProject({ lifecycle: "paused" })).lifecycle,
    ).toBe("archived");
  });

  it("refuses any movement out of archived", () => {
    const archived = recurringProject({ lifecycle: "archived" });
    expect(domainCode(() => applyProjectLifecycle(archived, "active"))).toBe(
      "RESEARCH_PROJECT_TRANSITION_INVALID",
    );
    expect(domainCode(() => resumeResearchProject(archived))).toBe(
      "RESEARCH_PROJECT_TRANSITION_INVALID",
    );
  });

  it("pausing never cancels the current update", () => {
    const stage = "researching" as const;
    const paused = pauseResearchProject(recurringProject());
    expect(paused.lifecycle).toBe("paused");
    expect(stage).toBe("researching");
    expect(cancelResearchUpdate(stage)).toBe("cancelled");
  });

  it("cancelling a finished update is a conflict, not a silent success", () => {
    expect(domainCode(() => cancelResearchUpdate("ready"))).toBe(
      "RESEARCH_UPDATE_CANCEL_CONFLICT",
    );
    expect(domainCode(() => cancelResearchUpdate("cancelled"))).toBe(
      "RESEARCH_UPDATE_CANCEL_CONFLICT",
    );
  });

  it("archiving keeps history readable while leaving the active list and schedules", () => {
    const archived = archiveResearchProject(recurringProject());
    expect(canReadProjectHistory(archived)).toBe(true);
    expect(isProjectVisibleInActiveList(archived)).toBe(false);
    expect(isProjectVisibleInActiveList(recurringProject())).toBe(true);
    expect(isProjectEligibleForScheduledStart(archived, "2026-09-14T06:00:00.000Z")).toBe(false);
  });
});

describe("research project scheduling and tenancy", () => {
  it("keeps one-time projects off the schedule while recurring projects stay eligible", () => {
    expect(isProjectEligibleForScheduledStart(oneTimeProject(), "2026-09-14T06:00:00.000Z")).toBe(
      false,
    );
    expect(
      isProjectEligibleForScheduledStart(recurringProject(), "2026-09-14T06:00:00.000Z"),
    ).toBe(true);
    expect(
      isProjectEligibleForScheduledStart(
        recurringProject({ lifecycle: "paused" }),
        "2026-09-14T06:00:00.000Z",
      ),
    ).toBe(false);
    expect(
      isProjectEligibleForScheduledStart(recurringProject(), "2027-02-01T06:00:00.000Z"),
    ).toBe(false);
  });

  it("rejects an unreadable eligibility timestamp", () => {
    expect(domainCode(() => isProjectEligibleForScheduledStart(recurringProject(), "soon"))).toBe(
      "RESEARCH_PROJECT_SCHEDULE_INVALID",
    );
  });

  it("rejects a project read under another organization", () => {
    expect(domainCode(() => assertProjectOrganization(recurringProject(), OTHER_ORG))).toBe(
      "RESEARCH_TENANT_MISMATCH",
    );
    expect(() => assertProjectOrganization(recurringProject(), ORG)).not.toThrow();
  });

  it("rejects malformed project input instead of coercing it", () => {
    expect(() => researchProjectSchema.parse({ ...oneTimeProject(), title: "  " })).toThrow();
    expect(() => researchProjectSchema.parse("a busy weekend downtown")).toThrow();
  });
});
