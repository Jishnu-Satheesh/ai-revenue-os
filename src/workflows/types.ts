export type WorkflowContext = {
  organizationId: string;
  correlationId: string;
  actorId?: string;
};

export type WorkflowResult = { status: "completed" | "failed"; runId?: string };

export type WorkflowDefinition<TInput> = {
  name: string;
  version: string;
  run(input: TInput, context: WorkflowContext): Promise<WorkflowResult>;
};
