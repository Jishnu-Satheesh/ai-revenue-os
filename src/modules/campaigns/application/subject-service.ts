import { z } from "zod";

import {
  assetTagsSchema,
  namesByScriptSchema,
  subjectExclusionsSchema,
} from "@/domain/campaigns/asset-library";
import type { SubjectProfile } from "@/domain/campaigns/schemas";
import type { MemoryRetrievalPort, MemoryRetrievalResult } from "@/domain/memory/schemas";
import { DomainError } from "@/lib/errors";

const uuidSchema = z.string().uuid();

export const subjectProfileContentSchema = z.strictObject({
  organizationId: uuidSchema,
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000).nullable(),
  tags: assetTagsSchema,
  namesByScript: namesByScriptSchema,
  mustNotAppear: subjectExclusionsSchema,
  illustratedStyle: z.boolean(),
});

export const subjectProfileUpsertSchema = subjectProfileContentSchema.extend({
  subjectProfileId: uuidSchema.nullable(),
  archived: z.boolean().optional(),
});

export const subjectMutationResultSchema = z.strictObject({
  subjectProfileId: uuidSchema,
  state: z.enum(["draft", "confirmed"]),
  created: z.boolean(),
});

export const subjectConfirmationResultSchema = z.strictObject({
  subjectProfileId: uuidSchema,
  state: z.literal("confirmed"),
  confirmedAt: z.string().datetime({ offset: false }),
  replayed: z.boolean(),
});

export const subjectDescriptionProposalSchema = z.strictObject({
  description: z.string().trim().min(1).max(2_000),
  namesByScript: namesByScriptSchema,
  mustNotAppear: subjectExclusionsSchema,
  illustratedStyle: z.boolean(),
});

export const subjectDraftRequestSchema = subjectProfileContentSchema
  .omit({ description: true })
  .extend({
    correlationId: uuidSchema,
    operatorNotes: z.string().trim().min(1).max(2_000).nullable(),
  });

export type SubjectProfileUpsert = z.infer<typeof subjectProfileUpsertSchema>;
export type SubjectMutationResult = z.infer<typeof subjectMutationResultSchema>;
export type SubjectConfirmationResult = z.infer<typeof subjectConfirmationResultSchema>;
export type SubjectDescriptionProposal = z.infer<typeof subjectDescriptionProposalSchema>;

export type SubjectProfileStore = {
  list(organizationId: string): Promise<readonly SubjectProfile[]>;
  get(organizationId: string, subjectProfileId: string): Promise<SubjectProfile | null>;
  upsert(input: SubjectProfileUpsert): Promise<SubjectMutationResult>;
  confirm(input: {
    organizationId: string;
    subjectProfileId: string;
  }): Promise<SubjectConfirmationResult>;
};

export type SubjectDescriptionDrafter = {
  draft(input: {
    organizationId: string;
    correlationId: string;
    system: string;
    prompt: string;
    outputContract: string;
  }): Promise<{ output: unknown; modelId: string }>;
};

export type SubjectServiceDependencies = {
  store: SubjectProfileStore;
  memory: MemoryRetrievalPort;
  drafter: SubjectDescriptionDrafter;
};

const SUBJECT_DESCRIPTION_OUTPUT_CONTRACT = [
  "Return this exact JSON object and no other fields:",
  '{"description":string,"namesByScript":Record<ISO-15924-code,string>,',
  '"mustNotAppear":string[],"illustratedStyle":boolean}',
  "Description maximum: 2000 characters. Use only supplied data.",
].join("\n");

export function createSubjectService(dependencies: SubjectServiceDependencies) {
  return {
    list(organizationId: string) {
      return dependencies.store.list(uuidSchema.parse(organizationId));
    },

    get(organizationId: string, subjectProfileId: string) {
      return dependencies.store.get(
        uuidSchema.parse(organizationId),
        uuidSchema.parse(subjectProfileId),
      );
    },

    create(input: z.input<typeof subjectProfileContentSchema>): Promise<SubjectMutationResult> {
      const content = subjectProfileContentSchema.parse(input);
      return dependencies.store.upsert({
        ...content,
        subjectProfileId: null,
        archived: false,
      });
    },

    edit(
      input: z.input<typeof subjectProfileContentSchema> & { subjectProfileId: string },
    ): Promise<SubjectMutationResult> {
      const parsed = subjectProfileUpsertSchema.parse(input);
      return dependencies.store.upsert(parsed);
    },

    async draft(input: z.input<typeof subjectDraftRequestSchema>): Promise<SubjectMutationResult> {
      const request = subjectDraftRequestSchema.parse(input);
      const memory = await dependencies.memory.retrieve({
        organizationId: request.organizationId,
        purpose: "onboarding_assist",
        query: request.name,
        memoryTypes: ["structured_fact", "document", "note"],
        sensitivityAllowance: "internal",
        includeSuperseded: false,
        includeExpired: false,
        limit: 12,
        correlationId: request.correlationId,
      });

      const drafted = await dependencies.drafter.draft({
        organizationId: request.organizationId,
        correlationId: request.correlationId,
        system:
          "You draft a precise, drawable description of a subject the operator has already named. You propose; a human confirms.",
        prompt: buildSubjectDraftPrompt(request, memory.results),
        outputContract: SUBJECT_DESCRIPTION_OUTPUT_CONTRACT,
      });
      const proposal = subjectDescriptionProposalSchema.safeParse(drafted.output);
      if (!proposal.success) {
        throw new DomainError(
          "INTEGRATION_ERROR",
          "The drafted subject description could not be validated.",
        );
      }

      return dependencies.store.upsert({
        organizationId: request.organizationId,
        subjectProfileId: null,
        name: request.name,
        slug: request.slug,
        description: proposal.data.description,
        tags: request.tags,
        // Human-entered names win over model suggestions for the same script.
        namesByScript: { ...proposal.data.namesByScript, ...request.namesByScript },
        mustNotAppear: mergeUnique(proposal.data.mustNotAppear, request.mustNotAppear),
        illustratedStyle: proposal.data.illustratedStyle,
        archived: false,
      });
    },

    confirm(input: {
      organizationId: string;
      subjectProfileId: string;
    }): Promise<SubjectConfirmationResult> {
      return dependencies.store.confirm({
        organizationId: uuidSchema.parse(input.organizationId),
        subjectProfileId: uuidSchema.parse(input.subjectProfileId),
      });
    },

    async archive(input: {
      organizationId: string;
      subjectProfileId: string;
    }): Promise<SubjectMutationResult> {
      const organizationId = uuidSchema.parse(input.organizationId);
      const subjectProfileId = uuidSchema.parse(input.subjectProfileId);
      const existing = await dependencies.store.get(organizationId, subjectProfileId);
      if (!existing) {
        throw new DomainError("TENANT_SCOPE_ERROR", "That subject profile is not available.");
      }

      return dependencies.store.upsert({
        organizationId,
        subjectProfileId,
        name: existing.name,
        slug: existing.slug,
        description: existing.description,
        tags: existing.tags,
        namesByScript: existing.namesByScript,
        mustNotAppear: existing.mustNotAppear,
        illustratedStyle: existing.illustratedStyle,
        archived: true,
      });
    },
  };
}

function buildSubjectDraftPrompt(
  request: z.infer<typeof subjectDraftRequestSchema>,
  results: readonly MemoryRetrievalResult[],
): string {
  const subjectData = safeDataJson({
    name: request.name,
    operatorNotes: request.operatorNotes,
    existingNamesByScript: request.namesByScript,
    mustNotAppear: request.mustNotAppear,
    illustratedStyle: request.illustratedStyle,
  });
  const memoryData = safeDataJson(
    results.map((result) => ({
      itemId: result.itemId,
      title: result.title,
      body: result.body ?? null,
      structuredValue: result.structuredValue ?? null,
      verificationState: result.provenance.verificationState,
      sourceTier: result.provenance.sourceTier,
      freshness: result.freshness,
    })),
  );

  return [
    "<operator_subject_data>",
    subjectData,
    "</operator_subject_data>",
    "",
    "<business_memory_data>",
    memoryData,
    "</business_memory_data>",
    "",
    "Describe only the named subject. Include visible components, serving vessel, dominant colours",
    "and textures, normal accompaniments, and anything that must never appear.",
    "Do not add a component, offer, price, claim, or business fact absent from the data.",
  ].join("\n");
}

function safeDataJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

function mergeUnique(primary: readonly string[], secondary: readonly string[]): string[] {
  return [...new Set([...primary, ...secondary])];
}
