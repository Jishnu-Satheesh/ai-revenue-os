import type { WorkflowDefinition, WorkflowResult } from "@/workflows/types";
import { logger } from "@/lib/logger";

/** Adapter boundary for Trigger.dev. Business state remains in Postgres, not workflow payloads. */
export function createTriggerWorkflowAdapter() {
  return {
    async dispatch<TInput>(definition: WorkflowDefinition<TInput>, input: TInput, context: Parameters<WorkflowDefinition<TInput>["run"]>[1]): Promise<WorkflowResult> {
      logger.info("workflow.dispatched", { organizationId: context.organizationId, correlationId: context.correlationId });
      return definition.run(input, context);
    },
  };
}
