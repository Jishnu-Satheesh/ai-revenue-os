# ADR 0004: Delay Broad LangGraph or LangChain Adoption

## Status

Accepted for V1.

## Context

The initial workers are bounded and can be implemented with TypeScript, typed schemas, the Vercel AI SDK, and Trigger.dev orchestration. A graph framework may add abstraction and debugging cost before complex graph behavior is proven necessary.

## Decision

Use lightweight custom orchestration interfaces for V1. Adopt LangGraph surgically only when a concrete workflow requires dynamic graph state, complex resumability beyond Trigger.dev, or multi-agent coordination that is materially simpler with it.

## Consequences

- Faster initial delivery.
- Less framework lock-in.
- Internal contracts must remain clean enough to support future adoption.
