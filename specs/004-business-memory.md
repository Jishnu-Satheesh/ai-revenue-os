# Feature Specification: Business Memory

## Business outcome

Allow workers and users to reuse trustworthy organizational context and historical lessons.

## In scope

- Structured facts.
- Documents and notes.
- Episodic event summaries.
- Decision and outcome memories.
- Provenance, confidence, sensitivity, and freshness.
- Tenant-filtered retrieval.
- Supersession and expiry.

## Write paths

- User verified.
- Provider imported.
- System generated.
- AI proposed and user confirmed.
- Outcome learning.

## Retrieval API

Inputs:

- organization scope
- optional branch scope
- worker purpose
- query
- memory types
- sensitivity allowance
- freshness requirement
- result limit

Outputs include text or structured value, source, timestamp, confidence, and verification state.

## Acceptance criteria

- Cross-tenant retrieval tests fail closed.
- Verified facts rank above inferences.
- Superseded facts are excluded by default.
- Sensitive memory requires explicit capability.
- Retrieval results expose provenance.
- Workers can store lessons without altering authoritative facts.
