# Studio provider qualification — Task 1 harness

Status: harness complete and green offline. **Live qualification is BLOCKED and open**: no cost
authorization exists ($0 default cap per `qualification-plan.md` §1), so zero real provider calls
were made and none are possible from this task. Everything below that is not marked BLOCKED was
proven against the deterministic fake provider.

## 1. Harness design

- Library: `src/modules/creative-studio/infrastructure/provider-qualification.ts` (+ 16-test suite).
  Provisional local types only — Task 2 canonicalizes `src/domain/creative-studio/`, Task 5
  reconciles. No `server-only` import: the same module runs under the `tsx` CLI.
- Port mirrors technical-contract §2: `generate`/`edit` async-iterables of
  `preview` / `completed` / safe refusal-or-failure events. Internal provider text is never
  forwarded; only safe IDs, hashes, timings, and codes enter logs or evidence.
- Frame recorder: each independently decoded preview and final records timestamp, type, index,
  SHA-256, dimensions, MIME, and byte length. Decoding reads the bytes' own leading signature
  (PNG IHDR, JPEG SOF); the declared MIME is a claim, never evidence. Garbage bytes are
  `malformed_frame` even when the sender claims `image/*`; only a recognizable but undecodable
  container (RIFF/WebP) earns `unsupported_format`. Intake intersection enforced: 200–8000 px
  per edge, 15 MiB default frame ceiling (configurable; probes use a 1 KiB ceiling).
- Matrix runner: 4:5, 1:1, 9:16 with copy/product/design/logo fixtures plus typographic and
  multilingual fixtures; per-run time-to-first-preview, preview count, usage, and cost
  (fake: measured 0 spend; paid unknowns would be null, never zero). Fresh-process reload
  rehydrates by safe continuation ID in a new provider instance, then two contextual marker
  edits including a branch from the older revision. A final-only run is saved honestly with
  `missingProgressivePreview` and does NOT pass progressive acceptance.
- Failure probes (7): definite refusal vs unknown timeout (distinct codes AND certainty —
  timeout hangs until abort, so completion is genuinely unknown), malformed/oversized frames,
  interruption, expired continuation, unavailable pinned model.
- Ceilings: boundary probing at limit−1 / limit / limit+1 for serialized bytes and image
  count, plus measured native dimensions per ratio (fake: 1024×1280, 1024×1024, 1152×2048 —
  the audit's OpenAI-first candidate targets, measured not assumed).
- Retention disclosure captured from the profile (fake: stores nothing; live values BLOCKED).
- Viewer: `renderEvidenceViewerHtml` renders recorded frame fixtures with FIXTURE labels for
  the browser verifier — it proves the viewer only. App seam deferred to Task 8. Never claim
  production streaming.

## 2. BLOCKED live matrix (exact commands once a cap is authorized)

Prerequisites (all currently absent): explicit authorized budget recorded in
`qualification-plan.md` §1 as `STUDIO_QUALIFICATION_AUTHORIZED_BUDGET_MINOR` (nonzero integer,
minor units) plus currency/date; provider credentials as `STUDIO_QUALIFICATION_PROVIDER_API_KEY`;
a Task-1-follow-up live adapter implementing the §2 port (Task 1 ships none — the live entry
refuses even with cap + credentials, covered by test).

```sh
# 1. Fixture rehearsal first (always $0, always allowed):
rtk pnpm tsx scripts/creative-studio/qualify-provider.ts fake --out /tmp/studio-qualification
# 2. Attempt the live entry (refuses until cap + credentials + adapter exist):
rtk pnpm tsx scripts/creative-studio/qualify-provider.ts live
# 3. Open the local evidence viewer (FIXTURE frames only):
open /tmp/studio-qualification/evidence-viewer.html
```

Live PASS requires, per the plan: ≥1 real independently decoded pre-final frame on generation
AND on edit, continuity after reload, same-model contextual edit with older-version branch,
measured costs within the authorized cap. A final-only fast response is recorded with
`missing_progressive_preview` and fails progressive acceptance; repeated absence disables the
profile. If no provider passes, record a blocked capability — never downgrade the requirement.

## 3. Evidence schema

`sanitizeEvidence` returns versioned JSON (`schemaVersion: 1`, validated by Zod): profile,
per-ratio results (fixture id, reference kinds, start time, time-to-first-preview, preview
count, frame records, event log of timestamps/types only, safe continuation/revision IDs,
`missingProgressivePreview`, usage, nullable cost), and generation timestamp. It carries no
bytes, prompts, copy, tokens, or URLs — enforced by a test that scans serialized evidence for
caller-known secret markers, and by `QualificationFrameError` messages that never interpolate
payloads. Fixture rehearsal output (2026-09-25): 3 ratios, previews 2/1/3, 2 edits with older
branch OK, 0 failed probes, ceilings verified, spend 0 minor units, evidence digest
`8eafbad1b3570fec`.

## 4. Open items for later tasks

- Live adapter + credentials + authorized cap (BLOCKED, see §2).
- WebP independent decoding (live-qualification scope; currently `unsupported_format`).
- `src/domain/creative-studio/*` canonicalization (Task 2) and harness reconciliation (Task 5).
