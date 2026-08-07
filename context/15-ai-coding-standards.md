# AI Coding Standards

## Purpose

AI coding agents are implementation accelerators, not architecture authorities. Specifications and ADRs are the source of truth.

## Prompting a coding agent

Provide:

- Exact spec path.
- Current module boundaries.
- Acceptance criteria.
- Allowed files or directories.
- Required tests.
- Explicit non-goals.
- Migration and rollback expectations.

## Agent output requirements

The agent must report:

1. Assumptions.
2. Files changed.
3. Schema or migration changes.
4. Tests added and executed.
5. Security and tenancy implications.
6. Known limitations.
7. Documentation updates.

## Review protocol

Never merge AI-generated code without:

- Reading the diff.
- Running tests locally or in CI.
- Checking generated migrations.
- Verifying organization scoping.
- Reviewing all tool and model boundaries.
- Testing failure and retry paths.

## Context discipline

- Read the relevant spec and context files first.
- Do not load the entire repository into context unless necessary.
- Prefer explicit interfaces and examples over broad natural-language directions.
- Update specs when implementation reveals a missing decision.

## Critical UI regression rule

Before changing UI, inspect `src/components/ui` and compose the installed shadcn/ui primitives. Bare interactive markup in feature components is a regression: use shadcn/ui `Button`, `Input`, `Select`, `Textarea`, `Checkbox`, `Badge`, `Card`, `Alert`, `Empty`, `Sidebar`, `DropdownMenu`, `Field`, and related primitives instead. If a primitive is missing, add it with pnpm and keep the generated component source in the repository.

## AI-specific anti-regression tests

For model-backed features, maintain fixtures for:

- Valid output.
- Malformed output.
- Prompt injection attempts.
- Missing evidence.
- Conflicting facts.
- Unsupported actions.
- Excessive cost or tool loops.
- Cross-tenant retrieval attempts.
