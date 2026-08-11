import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import {
  onboardingSectionRegistry,
  canCompleteSection,
} from "@/domain/onboarding/section-registry";
import {
  onboardingRequestInputSchema,
  sectionSaveSchema,
  type OnboardingRequestInput,
  type OnboardingSectionKey,
} from "@/domain/onboarding/types";
import { calculateReadiness } from "@/domain/onboarding/readiness";
import type { EventPublisher } from "@/domain/events/types";

export type OnboardingSessionRecord = Database["public"]["Tables"]["onboarding_sessions"]["Row"];
export type OnboardingSectionStateRecord =
  Database["public"]["Tables"]["onboarding_section_states"]["Row"];
export type OnboardingRequestRecord = Database["public"]["Tables"]["onboarding_requests"]["Row"];
export type OnboardingIdempotencyRecord =
  Database["public"]["Tables"]["onboarding_idempotency_records"]["Row"];
export type OnboardingUploadRecord = Database["public"]["Tables"]["onboarding_uploads"]["Row"];
export type OnboardingExtractionRecord =
  Database["public"]["Tables"]["onboarding_extractions"]["Row"];
export type OnboardingCandidateRecord =
  Database["public"]["Tables"]["onboarding_extraction_candidates"]["Row"];
export type OnboardingReadinessRecord =
  Database["public"]["Tables"]["ai_readiness_assessments"]["Row"];

/**
 * A cost component the organization may price during onboarding.
 *
 * Registered vocabulary, not a fixed list: what a restaurant is asked to price
 * and what a distributor is asked to price differ entirely, and neither belongs
 * in the onboarding module.
 */
export type OnboardingCostComponent = {
  key: string;
  label: string;
  computationKind: "fixed_amount" | "rate_of_revenue" | "per_unit" | "sourced";
};

export type OnboardingSnapshot = {
  session: OnboardingSessionRecord | null;
  sections: OnboardingSectionStateRecord[];
  requests: OnboardingRequestRecord[];
  uploads: OnboardingUploadRecord[];
  extractions: OnboardingExtractionRecord[];
  candidates: OnboardingCandidateRecord[];
  readiness: OnboardingReadinessRecord | null;
  costComponents: OnboardingCostComponent[];
};

export type OnboardingRepository = {
  findSession(organizationId: string): Promise<OnboardingSessionRecord | null>;
  createSession(input: {
    organizationId: string;
    userId: string;
  }): Promise<OnboardingSessionRecord>;
  updateSession(input: {
    organizationId: string;
    sessionId: string;
    patch: Database["public"]["Tables"]["onboarding_sessions"]["Update"];
  }): Promise<OnboardingSessionRecord>;
  findIdempotency(input: {
    organizationId: string;
    operation: string;
    key: string;
  }): Promise<OnboardingIdempotencyRecord | null>;
  saveIdempotency(input: {
    organizationId: string;
    operation: string;
    key: string;
    requestHash: string;
    responsePayload: Record<string, unknown>;
    userId: string;
  }): Promise<OnboardingIdempotencyRecord>;
  upsertSectionState(input: {
    organizationId: string;
    sessionId: string;
    sectionKey: OnboardingSectionKey;
    status: OnboardingSectionStateRecord["status"];
    payload: Record<string, unknown>;
    sourceMetadata: unknown[];
    userId: string;
  }): Promise<OnboardingSectionStateRecord>;
  createRequest(
    input: Database["public"]["Tables"]["onboarding_requests"]["Insert"],
  ): Promise<OnboardingRequestRecord>;
  getSnapshot(organizationId: string): Promise<OnboardingSnapshot>;
  saveReadinessAssessment(
    input: Database["public"]["Tables"]["ai_readiness_assessments"]["Insert"],
  ): Promise<OnboardingReadinessRecord>;
  persistCanonicalSection?: (input: {
    organizationId: string;
    userId: string;
    sectionKey: OnboardingSectionKey;
    payload: Record<string, unknown>;
  }) => Promise<void>;
};

type ServiceDependencies = {
  repository: OnboardingRepository;
  publisher: EventPublisher;
  now?: () => Date;
};

type SessionInput = { organizationId: string; userId: string };

type SaveSectionInput = {
  organizationId: string;
  userId: string;
  sessionId: string;
  sectionKey: OnboardingSectionKey;
  status: OnboardingSectionStateRecord["status"];
  payload: Record<string, unknown>;
  sourceMetadata?: unknown[];
  idempotencyKey?: string;
  correlationId?: string;
};

type CreateRequestInput = OnboardingRequestInput & {
  organizationId: string;
  userId: string;
};

function hashRequest(input: SaveSectionInput) {
  return Array.from(
    JSON.stringify({
      sectionKey: input.sectionKey,
      status: input.status,
      payload: input.payload,
      sourceMetadata: input.sourceMetadata ?? [],
    }),
  )
    .reduce((hash, character) => `${hash}${character.charCodeAt(0).toString(16)}`, "")
    .slice(0, 64)
    .padEnd(64, "0");
}

function eventPayload(input: SaveSectionInput) {
  return {
    sessionId: input.sessionId,
    sectionKey: input.sectionKey,
    status: input.status,
  };
}

export function createOnboardingService({
  repository,
  publisher,
  now = () => new Date(),
}: ServiceDependencies) {
  async function startOrResumeSession(input: SessionInput) {
    const existing = await repository.findSession(input.organizationId);
    if (existing) return existing;

    const created = await repository.createSession(input);
    await publisher.publish({
      eventId: crypto.randomUUID(),
      eventName: "onboarding.started",
      occurredAt: now().toISOString(),
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: { sessionId: created.id },
    });
    return created;
  }

  async function saveSection(input: SaveSectionInput) {
    const parsed = sectionSaveSchema.parse({
      sectionKey: input.sectionKey,
      status: input.status,
      payload: input.payload,
      sourceMetadata: input.sourceMetadata ?? [],
      idempotencyKey: input.idempotencyKey,
    });
    const session = await repository.findSession(input.organizationId);
    if (!session || session.id !== input.sessionId) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding session is not available.");
    }
    if (parsed.status === "complete" && !canCompleteSection(input.sectionKey, parsed.payload)) {
      throw new DomainError(
        "VALIDATION_ERROR",
        "This section does not meet its completion requirements.",
      );
    }

    const operation = `onboarding.section.save:${input.sectionKey}`;
    const existingIdempotency = input.idempotencyKey
      ? await repository.findIdempotency({
          organizationId: input.organizationId,
          operation,
          key: input.idempotencyKey,
        })
      : null;
    if (existingIdempotency)
      return existingIdempotency.response_payload as OnboardingSectionStateRecord;

    const state = await repository.upsertSectionState({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      sectionKey: input.sectionKey,
      status: parsed.status,
      payload: parsed.payload,
      sourceMetadata: parsed.sourceMetadata,
      userId: input.userId,
    });
    if (parsed.status === "complete") {
      await repository.persistCanonicalSection?.({
        organizationId: input.organizationId,
        userId: input.userId,
        sectionKey: input.sectionKey,
        payload: parsed.payload,
      });
    }
    const currentIndex = onboardingSectionRegistry.findIndex(
      (section) => section.key === input.sectionKey,
    );
    const nextSection = onboardingSectionRegistry[currentIndex + 1]?.key ?? input.sectionKey;
    await repository.updateSession({
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      patch:
        input.sectionKey === "review_readiness" && parsed.status === "complete"
          ? {
              current_section_key: nextSection,
              status: "completed",
              completed_at: now().toISOString(),
            }
          : { current_section_key: nextSection },
    });

    if (parsed.status === "complete") {
      await publisher.publish({
        eventId: crypto.randomUUID(),
        eventName: "onboarding.step_completed",
        occurredAt: now().toISOString(),
        organizationId: input.organizationId,
        actorType: "user",
        actorId: input.userId,
        correlationId: input.correlationId ?? crypto.randomUUID(),
        schemaVersion: 1,
        payload: eventPayload(input),
      });
      if (input.sectionKey === "review_readiness") {
        await publisher.publish({
          eventId: crypto.randomUUID(),
          eventName: "onboarding.completed",
          occurredAt: now().toISOString(),
          organizationId: input.organizationId,
          actorType: "user",
          actorId: input.userId,
          correlationId: input.correlationId ?? crypto.randomUUID(),
          schemaVersion: 1,
          payload: { sessionId: input.sessionId },
        });
      }
    }

    if (input.idempotencyKey) {
      await repository.saveIdempotency({
        organizationId: input.organizationId,
        operation,
        key: input.idempotencyKey,
        requestHash: hashRequest(input),
        responsePayload: state as unknown as Record<string, unknown>,
        userId: input.userId,
      });
    }
    return state;
  }

  async function getSnapshot(organizationId: string) {
    return repository.getSnapshot(organizationId);
  }

  async function createRequest(input: CreateRequestInput) {
    const parsed = onboardingRequestInputSchema.parse(input);
    const session = await repository.findSession(input.organizationId);
    if (!session || session.id !== parsed.sessionId) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding session is not available.");
    }
    const request = await repository.createRequest({
      organization_id: input.organizationId,
      session_id: parsed.sessionId,
      section_key: parsed.sectionKey,
      title: parsed.title,
      description: parsed.description,
      assignee_user_id: parsed.assigneeUserId ?? null,
      client_contact: parsed.clientContact ?? null,
      status: "open",
      due_date: parsed.dueDate ?? null,
      created_by: input.userId,
      updated_by: input.userId,
    });
    await publisher.publish({
      eventId: crypto.randomUUID(),
      eventName: "onboarding.request.created",
      occurredAt: now().toISOString(),
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: {
        sessionId: parsed.sessionId,
        sectionKey: parsed.sectionKey,
        requestId: request.id,
      },
    });
    return request;
  }

  async function generateReadiness(input: {
    organizationId: string;
    userId: string;
    sessionId: string;
  }) {
    const snapshot = await repository.getSnapshot(input.organizationId);
    if (!snapshot.session || snapshot.session.id !== input.sessionId) {
      throw new DomainError("TENANT_SCOPE_ERROR", "The onboarding session is not available.");
    }
    const readiness = calculateReadiness({
      sections: Object.fromEntries(
        snapshot.sections.map((section) => [
          section.section_key,
          { status: section.status, payload: section.payload },
        ]),
      ),
    });
    const assessment = await repository.saveReadinessAssessment({
      organization_id: input.organizationId,
      session_id: input.sessionId,
      rubric_version: readiness.rubricVersion,
      overall_score: readiness.overallScore,
      capability_scores: readiness.capabilityScores,
      blockers: readiness.criticalBlockers,
      next_actions: readiness.nextActions,
      created_by: input.userId,
    });
    await publisher.publish({
      eventId: crypto.randomUUID(),
      eventName: "onboarding.readiness.generated",
      occurredAt: now().toISOString(),
      organizationId: input.organizationId,
      actorType: "user",
      actorId: input.userId,
      correlationId: crypto.randomUUID(),
      schemaVersion: 1,
      payload: { sessionId: input.sessionId, rubricVersion: readiness.rubricVersion },
    });
    return assessment;
  }

  return { startOrResumeSession, saveSection, getSnapshot, createRequest, generateReadiness };
}
