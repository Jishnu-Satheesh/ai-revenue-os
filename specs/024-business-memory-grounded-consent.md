# Feature Specification: Business Memory grounded consent share

## Status

Approved 2026-09-11 — narrow exception to Spec 023. No code written yet. Default behavior remains Spec 023: private memory never enters a Google Search grounded call unless all grounded-share gates hold. Share subset cap 8 entries and 4096 bytes confirmed. Grant may come from owner or admin. Revoke may come from owner or admin.

This is a Tier 3 slice because it moves a third-party disclosure boundary between the control plane and the execution plane. That is why it has its own spec before any Execution Plan or code.

## Business outcome

One Channel narration path can use organization-approved internal context together with Google Search grounding, only for organizations that explicitly opt in with a recorded provider qualification. Success is stronger portal guidance where permitted, with zero silent disclosure and full recall of what left Postgres.

Like lending one labeled folder, not the whole filing cabinet: only the pages marked safe to share leave the office, the loan is logged, and the owner can demand the folder back for future loans at any time.

## User stories

- As an owner, I opt in one organization to grounded-share so Channel advice can combine our approved context with live web guidance.
- As an operator, I see which answers shared context with Google and which stayed internal-only.
- As an owner, I revoke grounded-share and future narrations stop sharing immediately, while past use history remains auditable.
- As an auditor, I can prove which provider terms, consent version, and entries were involved in any grounded call.

## Scope

### In scope

- One new purpose-bound share mode for channel_advice narration only.
- Per-organization opt-in flag, consent record, provider qualification record, and audit fields.
- Sensitivity and reuse allowlist, PII and money-amount blocks, tighter grounded-share pack subset.
- Manifest and UI labels distinguishing shared-with-Google from internal-only.
- Revocation and qualification-expiry fail-closed behavior.

### Out of scope

- Sending confidential, customer_content, denied, or metadata_only grounded bodies to Google for any reason.
- Growth public query text, Campaign image generation, embeddings to Google, or any cross-organization share.
- Bulk reclassification of legacy memory, auto-approval of lessons, policy or budget changes.
- General onboarding consent covering this share. A separate explicit opt-in is required.
- Storing full prompts, provider responses, credentials, or raw customer text in audit logs.

## UX flow

- Owner or admin opens Memory health/settings, sees Grounded-share status: disabled, qualification state, entries eligible count, last share use.
- Owner reviews exact consent wording, data classes, provider retention notice, and revocation effect, then confirms with explicit checkbox plus typed organization name.
- Operator runs Channel narration as today. When grounded-share is active and qualified, the narration detail shows Shared with Google Search with entry list. Otherwise it shows Internal-only.
- Owner revokes at any time. UI confirms future calls stop sharing, past history stays.
- Viewer sees status and history labels but no configure or revoke controls and no privileged identifiers.

## Domain rules

- Default deny. Grounded-share is off unless all hold: per-org flag on, unexpired provider qualification, unrevoked consent on the current consent version, purpose channel_advice, sensitivity and reuse allowlist pass.
- Exact data classes allowed, all must hold for an entry to be grounded-share eligible:
  - Sensitivity public or internal only. Never confidential or customer_content.
  - Reuse class qualified_reusable only. internal_reusable alone is not enough for Google. metadata_only and denied never share.
  - Knowledge kind observation, recommendation, or operator_decision only. Never measured_outcome values, never pending lesson bodies, never legacy unqualified rows.
  - Source roots live, unwithdrawn, unexpired, same organization, exact branch or organization-wide scope.
  - Text passes PII and money blocks: no email, phone, national ID pattern, no customer name list, no spend ceiling, budget, margin amount, or minor-unit money field. Summaries that carry a money amount are excluded even if otherwise eligible.
  - Grounded-share subset cap: at most 8 entries and 4096 UTF-8 bytes within the existing 24 entry and 16384 byte pack. Tighter bound wins.
- Forbidden even with opt-in: historical Google-grounded narrative bodies, Growth research source excerpts, Campaign creative bytes, rejected design bytes, raw report rows, secrets, credentials, provider payloads.
- Consent is per organization, owner or admin to grant and to revoke. One active consent per organization. Consent records consent version, actor, time, exact wording hash, and qualification reference.
- Provider qualification must predate first share and be rechecked before each grounded-share narration. Expired or missing qualification fails closed to internal-only non-grounded path with status unavailable_qualification, never silent fallback to full private share.
- Revocation takes effect on the next narration attempt. In-flight attempt that already sent context completes with its pinned manifest labeled shared, but its completion record notes revoked-during-run. No new attempt may share after revocation.
- A model cannot raise sensitivity, widen scope, or mark an entry shareable. Share eligibility is deterministic code over stored metadata.

## Data model

Additive only, disabled by default, no edits to applied migrations:

- memory_integration_settings gains grounded_share_enabled boolean default false, grounded_share_consent_id nullable, grounded_share_qualification_id nullable, grounded_share_updated_by and updated_at. Worker cursor updates must not alter these consent fields.
- New grounded_share_consents: organization, consent version, wording hash, actor, granted and revoked timestamps, status granted or revoked, reason. One active granted row per organization enforced by partial unique index.
- New grounded_share_qualifications: provider google, product and agreement version, retention clause reference, checked date, expiry date, approver, status current or expired or withdrawn. No credential or contract body stored.
- memory_context_manifests gains grounded_share boolean, consent reference, qualification reference, share entry count and bytes. memory_context_entries gains shared_externally boolean for the grounded-share subset.
- No browser table writes. Consent grant and revoke go through audited owner-gated RPCs. Qualification rows are written through a separate governed staging step, never by the worker.

## API and events

- PATCH integrations toggles grounded-share only together with valid consent and qualification references. Separate booleans, explicit versions, audited.
- POST retry never re-enables share. Replay of a manifest never widens its share flag.
- GET health exposes grounded-share enabled, qualification expiry, eligible count, last share use, no bodies.
- GET context detail shows shared versus internal-only per entry for currently visible rows only.
- Events emitted with identifiers and safe codes only: memory.grounded_share_consented, memory.grounded_share_revoked, memory.grounded_share_qualified, memory.grounded_share_expired, memory.context_consumed with grounded_share flag. No bodies, queries, or prompts in events or logs.

## AI behavior

- Channel narration has two explicit modes. Internal-only non-grounded: full eligible internal pack, no google_search tool. Grounded-share: same findings plus only the grounded-share eligible subset, with google_search tool enabled.
- Worker resolves mode after claim from stored flag, consent, and qualification. Request text never selects the mode.
- Prompt carries a labeled data section for shared context separate from findings. System rules keep findings as mandatory citations. Shared context uses contextRefs validated against the same manifest. Memory alone cannot create a finding, admit a claim, or invent portal paths.
- If share eligibility filtering empties the subset, the call proceeds grounded with findings only and records empty share subset, not a failure. If consent or qualification fails mid-preparation, the attempt fails with safe code and one bounded retry may run internal-only with a new manifest. Never silently downgrade a shared manifest to internal or vice versa.

## Security and tenancy

- RLS on every new table, composite tenant keys, no anonymous access, no browser writes to capture or manifest infrastructure.
- User reads intersect organization permission, source sensitivity, and share eligibility. Owner and admin see operational detail. Operator sees share labels without privileged qualification internals. Viewer sees labels only.
- Worker binds purpose, tenant, run lease, flag, consent, and qualification on every grounded-share preparation. Service role alone authorizes nothing.
- Prove isolation with two organizations in different accounts and sibling organizations in one account. Test forged org, other-branch scope, stale claim token, revoked membership, and expired qualification. Cross-tenant share attempt is refused and audited.

## Observability

- Counts: share-eligible versus excluded by code, share manifests versus internal-only, revoked-during-run, qualification-expiry blocks.
- Latency and bytes for share subset assembly, provider usage where measured. No invented zero cost for failed attempts.
- Logs carry manifest, consent, qualification identifiers and safe codes only. No bodies, queries, prompts, or credentials.

## Failure states

- Consent missing or revoked: internal-only path with status share_disabled. No grounded-share entries sent.
- Qualification missing or expired: fail closed with unavailable_qualification. No share until requalified.
- Included root withdrawn or expired between selection and completion: refuse completion with CONTEXT_CHANGED, one bounded new attempt rebuilds without that root.
- PII or money pattern hit during share subset build: exclude entry with code, continue with remaining eligible subset. Never redact-and-share a blocked entry by truncation.
- Manifest write failure: no memory content sent. Evidence-only mode with honest persisted status.
- Provider error quoting prompt back: caller receives stable error only. Detail stays in provider-structured log without bodies.

## Acceptance criteria

- A01 Disabled by default: fresh organization shares nothing until owner opt-in plus current qualification both exist.
- A02 Non-owner grant refused: viewer and operator cannot enable. Owner or admin grant without current qualification refused.
- A03 Exact allowlist holds: confidential, customer_content, denied, metadata_only, outcomes with amounts, pending lessons, and PII-bearing summaries never enter the grounded-share subset even when flagged internal.
- A04 General onboarding consent alone never enables share. Only the separate grounded-share consent version enables it.
- A05 Expired qualification blocks share on the next attempt and records unavailable_qualification.
- A06 Revocation stops the next attempt. In-flight pinned manifest keeps its shared label with revoked-during-run note. No silent rewrite.
- A07 Cross-tenant share refused: other-org entry, other-branch private entry, and forged consumer binding all fail closed and audited.
- A08 Provenance honest: detail view distinguishes provided to AI from cited in answer and shared with Google from internal-only. Past shared manifest remains inspectable after revocation without resurrecting withdrawn bodies.
- A09 Limits enforced in SQL and code: 8 entries and 4096 bytes for the share subset within the 24 entry and 16384 byte pack. Overflow drops lowest-priority optional share entries first, never limitations text.
- A10 No leakage to logs or events: share audit carries identifiers, hashes, counts, and codes only.

## Test plan

- Unit and property: allowlist matrix, PII and money blocks, subset caps, digest stability, consent version binding, mode resolution from stored flag rather than request text.
- Repository and RPC: grant and revoke paths, role denial, cross-tenant denial, stale token, expired qualification, withdrawn root during latency, manifest share flag immutability.
- pgTAP on staging: transaction atomicity for consent plus flag, RLS on new tables, every new function executed including refusal paths.
- Workflow: inspect provider input to prove only eligible subset reaches grounded calls and full pack never does. Prove revocation and expiry fail closed.
- E2E authenticated: opt in to share to revoke across two Channel runs with drawer labels. Report skipped authenticated scenarios explicitly.
- Frozen evaluation: at least 20 grounded-share cases covering corrections, missing info, repeated suggestions, adversarial inserts, and over-broad internal notes. Zero critical tenant, trust, rights, or disclosure failures.

## Migration and rollback

- Ship behind disabled flags. Enable live capture first per Spec 023. Add consent and qualification tables before any share read.
- Roll back by disabling grounded_share_enabled first, then capture if needed. Preserve queue, manifests, and history. Stop dispatch for opted-out organizations. Forward repair only. Never drop tables, reset staging, or edit applied migrations.
- Provider-rights failure immediately blocks share content regardless of flags. Past shared bodies are not recalled from Google. Revocation notice states this limit plainly.

## Documentation updates

- On approval, amend Spec 023 sections 8 and 11, ADR 0054 decision 7, context 09 and module map for the consent-gated exception. Keep non-grounded private path as default. Record consent wording version and qualification process in the verification log.
- Per-org opt-in wording v1 for approval:
  - Title: Allow limited Business Memory in Google-grounded Channel advice.
  - Body: I allow this organization’s Channel recommendations to send a small labeled subset of Business Memory to Google’s generative model together with Google Search grounding. Only entries marked public or internal, marked qualified for reuse, and free of customer details, contact data, and money amounts are eligible, at most 8 entries. Confidential and customer content never shares. Google processes this subset under our Google agreement and its retention rules, which are outside our 90-day erasure. Past shared calls cannot be recalled from Google. Future sharing stops when I revoke or when our Google qualification expires. History of what was shared stays auditable.
  - Confirm control: separate checkbox plus typed organization name, owner or admin role, recorded as consent version grounded-share-v1 with actor and time.
  - Revocation note shown at grant and at revoke: Revoking stops future sharing. It does not delete what Google already processed.

## Open questions for approval

- Resolved 2026-09-11: share subset stays 8 entries and 4096 bytes for the first canary.
- Resolved 2026-09-11: owner or admin may grant, owner or admin may revoke.
- Remaining: is the money-amount block too strict for outcome sharing, or should validated non-confidential metric labels be eligible in a later version.
