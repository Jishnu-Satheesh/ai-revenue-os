# ADR 0076: Server provenance for agent action cards

## Status

Accepted, scoped to the user-authorized Universal Agent finish on 2026-10-04. Implements the Task B4 repair recorded in `docs/superpowers/plans/2026-09-27-agent-task-b-autonomy.md`.

## Problem

Legacy watch and campaign cards existed only in route responses and process memory. Answer submission trusted a client-echoed spec and classified its encoded form values again. A classifier failure could lose the action, and a caller could alter the echoed campaign options. Persisting an unsigned system note would not establish provenance: the existing authenticated message RPC accepts the system-note role.

## Decision

- Persist the bounded strict Questionnaire spec, original source message ID, intent, organization, thread, and issue time as an internal system-note envelope through the existing fenced message RPC. Include no context pack, credentials, or raw source documents.
- Sign the canonical envelope with HMAC-SHA256 under the existing server-only `SUPABASE_SERVICE_ROLE_KEY`, domain-separated as `lunes:agent-questionnaire:v1`. This signs provenance only; it creates no service-role database client and grants no execution authority.
- Split the client-safe parser from the server signature module. Server verification uses a fixed-length signature and timing-safe comparison, checks exact organization/thread/source/spec binding, refuses future timestamps and cards aged 24 hours or more, and requires the source message in the bounded thread history. A new ordinary user message or a newer server card invalidates the prior action card.
- Bind card age to the stored source message timestamp, the returned resume key to the exact source message, and the answer append key to the exact card. An unchanged evidence digest cannot make an older card authorize a newer question. Repeated delivery, including changed client retry tokens, reuses one answer row; changed answers conflict. Card generation has a deterministic key and signature.
- Each generated answer also persists a strict signed `answerReceipt` containing its exact saved message ID and body digest. Replay and source-question reconstruction skip a user row only when a valid same-tenant/thread receipt binds that exact row and digest in the bounded history. An ordinary message beginning `[answers ...]` remains a new user question and invalidates older cards. Receipt notes never act as selectable or pending cards. Historical answers without a signed receipt fail closed on replay and do not inherit authority from their text prefix; send a fresh request after release.
- Continue validated watch and campaign picks deterministically with freshly derived grants. Encoded answers do not become new classifier requests or new research. Campaign window clarification retains its validated campaign intent; final draft admission and source approval/publish fences remain authoritative.
- A watch whose scope remains incomplete persists a new message-bound missing-fields card. Its signed `continuationAnswers` can retain only previously validated cadence, branch, research area, competitor name, stop date, and an explicitly requested question, with strict field-specific bounds. Other intents and unknown keys are rejected. This internal carry never appears as new submitted answers and contains no context packs or source documents. Confirmation is never carried: the replacement card requires fresh `confirm_watch` consent, verifies current grants, and uses the same per-card replay fence. Explicit branch names resolve against tenant-owned live rows; ambiguous scope prompts instead of selecting a branch.
- Reopening restores an unresolved card; the internal envelope stays hidden. Existing report turn `pendingChallenge` handling remains separate.

## Operational effects and rollback

No schema, migration, environment addition, model selection, permission, or provider-write boundary changes. A missing signing key disables new action cards; key rotation invalidates existing cards and requires a fresh user request. Unsigned historical cards are refused rather than silently trusted. History reads are bounded to 500 messages and fail closed beyond that limit. Removing future card production leaves source records and their existing approval requirements intact.

The saved answer and its signed receipt use separate existing keyed message writes. If the receipt write fails after the answer is saved, no source action has been authorized yet, and retry fails closed because the answer has no verified receipt. The user must send a fresh request; this availability limitation does not transfer authority to the unsigned row. The answers route also rejects a top-level resume key that differs from the signed card key before any write, and the campaign handoff derives its retry identity from that card key.

## Verification

Regression tests cover real SDK schema disposal for campaign ideas, signature, receipt-digest and retained-input tampering, wrong tenant/thread/source, expiration, missing/rotated secret, stale card replacement, forged answers prefixes, source lineage beyond the first history page, encoded watch continuation, retained cadence/stop date through missing-scope cards, viewer refusal, confirmation decline, replay, one assistant row, and drawer restoration. Authenticated live source receipts and deployed-worker acceptance remain distinct release checks.
