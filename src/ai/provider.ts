import { DomainError } from "@/lib/errors";
import type { AiProvider } from "@/ai/types";

/** Provider selection is deliberately deferred until a worker has a validated, bounded task. */
export function createAiProviderRegistry(providers: AiProvider[]) {
  const registry = new Map(providers.map((provider) => [provider.provider, provider]));

  return {
    get(provider: AiProvider["provider"]): AiProvider {
      const selected = registry.get(provider);
      if (!selected) throw new DomainError("INTEGRATION_ERROR", `AI provider ${provider} is not configured.`);
      return selected;
    },
  };
}
