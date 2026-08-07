import { describe, expect, it } from "vitest";

import {
  createOnboardingService,
  type OnboardingRepository,
  type OnboardingIdempotencyRecord,
  type OnboardingSessionRecord,
  type OnboardingSectionStateRecord,
  type OnboardingSnapshot,
  type OnboardingRequestRecord,
  type OnboardingReadinessRecord,
} from "@/modules/onboarding/application/service";
import type { EventPublisher } from "@/domain/events/types";

function session(id = "session-1"): OnboardingSessionRecord {
  return {
    id,
    organization_id: "org-1",
    owner_id: "user-1",
    status: "in_progress",
    current_section_key: "business_identity",
    started_at: "2026-08-08T00:00:00.000Z",
    completed_at: null,
    created_at: "2026-08-08T00:00:00.000Z",
    updated_at: "2026-08-08T00:00:00.000Z",
  };
}

function createFakeDependencies() {
  const sessions = new Map<string, OnboardingSessionRecord>();
  const states = new Map<string, OnboardingSectionStateRecord>();
  const idempotency = new Map<string, OnboardingIdempotencyRecord>();
  const events: Array<{ eventName: string; payload: Record<string, unknown> }> = [];
  const repository: OnboardingRepository = {
    async findSession(organizationId) {
      return [...sessions.values()].find((item) => item.organization_id === organizationId) ?? null;
    },
    async createSession(input) {
      const created = session(`session-${sessions.size + 1}`);
      created.organization_id = input.organizationId;
      created.owner_id = input.userId;
      sessions.set(created.id, created);
      return created;
    },
    async updateSession(input) {
      const current = sessions.get(input.sessionId);
      if (!current) throw new Error("missing session");
      const updated = { ...current, ...input.patch, updated_at: "2026-08-08T00:01:00.000Z" };
      sessions.set(updated.id, updated);
      return updated;
    },
    async findIdempotency(input) {
      return idempotency.get(`${input.organizationId}:${input.operation}:${input.key}`) ?? null;
    },
    async saveIdempotency(input) {
      const value = {
        id: "idempotency-1",
        organization_id: input.organizationId,
        operation: input.operation,
        idempotency_key: input.key,
        request_hash: input.requestHash,
        response_payload: input.responsePayload,
        created_by: input.userId,
        created_at: "2026-08-08T00:01:00.000Z",
      };
      idempotency.set(`${input.organizationId}:${input.operation}:${input.key}`, value);
      return value;
    },
    async upsertSectionState(input) {
      const key = `${input.sessionId}:${input.sectionKey}`;
      const state = {
        id: states.get(key)?.id ?? `state-${states.size + 1}`,
        organization_id: input.organizationId,
        session_id: input.sessionId,
        section_key: input.sectionKey,
        status: input.status,
        payload: input.payload,
        source_metadata: input.sourceMetadata,
        updated_by: input.userId,
        completed_at: input.status === "complete" ? "2026-08-08T00:01:00.000Z" : null,
        created_at: states.get(key)?.created_at ?? "2026-08-08T00:00:00.000Z",
        updated_at: "2026-08-08T00:01:00.000Z",
      } satisfies OnboardingSectionStateRecord;
      states.set(key, state);
      return state;
    },
    async createRequest(input) {
      return {
        id: "request-1",
        organization_id: input.organization_id,
        session_id: input.session_id,
        section_key: input.section_key,
        title: input.title,
        description: input.description,
        assignee_user_id: input.assignee_user_id ?? null,
        client_contact: input.client_contact ?? null,
        status: "open",
        due_date: input.due_date ?? null,
        created_by: input.created_by,
        updated_by: input.updated_by ?? null,
        created_at: "2026-08-08T00:01:00.000Z",
        updated_at: "2026-08-08T00:01:00.000Z",
      } satisfies OnboardingRequestRecord;
    },
    async getSnapshot() {
      return {
        session: [...sessions.values()][0] ?? null,
        sections: [...states.values()],
        requests: [],
        uploads: [],
        extractions: [],
        candidates: [],
        readiness: null,
      } satisfies OnboardingSnapshot;
    },
    async saveReadinessAssessment(input) {
      return {
        id: "assessment-1",
        organization_id: input.organization_id,
        session_id: input.session_id,
        rubric_version: input.rubric_version,
        overall_score: input.overall_score,
        capability_scores: input.capability_scores,
        blockers: input.blockers,
        next_actions: input.next_actions,
        created_by: input.created_by ?? null,
        created_at: "2026-08-08T00:02:00.000Z",
      } satisfies OnboardingReadinessRecord;
    },
  };
  const publisher: EventPublisher = {
    async publish(event) {
      events.push({
        eventName: event.eventName,
        payload: event.payload as Record<string, unknown>,
      });
    },
  };

  return { repository, publisher, sessions, states, idempotency, events };
}

describe("onboarding service", () => {
  it("creates one resumable session and emits onboarding.started once", async () => {
    const dependencies = createFakeDependencies();
    const service = createOnboardingService(dependencies);

    const first = await service.startOrResumeSession({ organizationId: "org-1", userId: "user-1" });
    const second = await service.startOrResumeSession({
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(second.id).toBe(first.id);
    expect(dependencies.sessions.size).toBe(1);
    expect(
      dependencies.events.filter((event) => event.eventName === "onboarding.started"),
    ).toHaveLength(1);
  });

  it("saves a partial section and returns the same result for an idempotent retry", async () => {
    const dependencies = createFakeDependencies();
    const service = createOnboardingService(dependencies);
    const current = await service.startOrResumeSession({
      organizationId: "org-1",
      userId: "user-1",
    });

    const input = {
      organizationId: "org-1",
      userId: "user-1",
      sessionId: current.id,
      sectionKey: "business_identity" as const,
      status: "in_progress" as const,
      payload: { name: "Al Noor Kitchen" },
      idempotencyKey: "idempotency-key-0001",
    };
    const first = await service.saveSection(input);
    const retry = await service.saveSection(input);

    expect(retry.id).toBe(first.id);
    expect(dependencies.states.size).toBe(1);
    expect(dependencies.idempotency.size).toBe(1);
  });

  it("rejects completion when the section has not met its completion rule", async () => {
    const dependencies = createFakeDependencies();
    const service = createOnboardingService(dependencies);
    const current = await service.startOrResumeSession({
      organizationId: "org-1",
      userId: "user-1",
    });

    await expect(
      service.saveSection({
        organizationId: "org-1",
        userId: "user-1",
        sessionId: current.id,
        sectionKey: "business_identity",
        status: "complete",
        payload: { name: "Only a name" },
      }),
    ).rejects.toThrow("completion requirements");
  });

  it("creates a missing-data request assigned to a client contact", async () => {
    const dependencies = createFakeDependencies();
    const service = createOnboardingService(dependencies);
    const current = await service.startOrResumeSession({
      organizationId: "org-1",
      userId: "user-1",
    });

    const request = await service.createRequest({
      organizationId: "org-1",
      userId: "user-1",
      sessionId: current.id,
      sectionKey: "customers_consent",
      title: "Confirm consent source",
      description: "Please confirm the source and retention period.",
      clientContact: "owner@example.com",
    });

    expect(request.client_contact).toBe("owner@example.com");
  });

  it("persists a deterministic readiness assessment for the current session", async () => {
    const dependencies = createFakeDependencies();
    const service = createOnboardingService(dependencies);
    const current = await service.startOrResumeSession({
      organizationId: "org-1",
      userId: "user-1",
    });

    const assessment = await service.generateReadiness({
      organizationId: "org-1",
      userId: "user-1",
      sessionId: current.id,
    });

    expect(assessment.rubric_version).toBe("v1");
    expect(assessment.overall_score).toBeGreaterThanOrEqual(0);
  });
});
