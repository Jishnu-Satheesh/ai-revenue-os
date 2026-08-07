import type { WorkflowDefinition } from "@/workflows/types";

/** Durable worker contract. The HTTP completion route records the pending run; a deployed worker executes the bounded extractor. */
export type OnboardingExtractInput = {
  organizationId: string;
  uploadId: string;
  extractionId: string;
};

export const onboardingExtractWorkflow: WorkflowDefinition<OnboardingExtractInput> = {
  name: "onboarding-extract",
  version: "1",
  async run() {
    return { status: "completed" };
  },
};
