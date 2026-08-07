import { z } from "zod";

export const modelProviderSchema = z.enum(["openai", "anthropic", "google"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export type ModelRequest = {
  model: string;
  system?: string;
  prompt: string;
  organizationId: string;
  correlationId: string;
};

export type ModelResponse = {
  provider: ModelProvider;
  model: string;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; estimatedCostMinor?: number };
};

export type AiProvider = {
  readonly provider: ModelProvider;
  generate(request: ModelRequest): Promise<ModelResponse>;
};
