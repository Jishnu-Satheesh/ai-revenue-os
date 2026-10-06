# ADR 0070: Independent full-poster Studio supersedes the plate-only rule for the new workflow only

## Status

Accepted (scoped). Approved 2026-09-25 as part of the explicit Tier 3 user approval
("implement this plan") of `docs/superpowers/plans/2026-09-20-independent-creative-studio.md`.
This ADR decides nothing beyond the boundary stated below. It does not mark any existing
proposed ADR or spec accepted by inference.

## Context

ADR 0042 ("The model draws and the platform writes") and `specs/020-campaign-creative-studio.md`
require campaign posters to be built as a model-generated textless plate plus deterministic
platform-composited text layers. That boundary is load-bearing for existing campaign output:
render digests, pinned fonts, version/patch immutability, and exact-output review all assume it.

The Independent Creative Studio feature needs a different product: a standalone,
organization-owned workspace where the image model renders the complete poster, including the
user-supplied Text Copy verbatim, with visible progressive preview frames and same-model
contextual marker edits. The existing campaign Studio cannot provide this by hiding a picker:
its persistence, manifests, renders, and deliverables all require campaign identity
(`docs/design/creative-studio-independent/current-studio-audit.md`).

## Decision

1. For the new standalone Studio workflow only (new `studio_*` tables, new
   `/campaigns/studio` routes, new `src/domain/creative-studio/` and
   `src/modules/creative-studio/` code, new Trigger task), the model renders the complete
   poster including supplied Text Copy. ADR 0042 and Spec 020's no-model-text/plate-only rule
   are superseded within exactly this boundary.
2. Everything else keeps the old guarantee: the existing campaign compositor, plate renderer,
   pinned fonts, render digests, approval/publication gates, and legacy regression fixtures
   are unchanged. Exact design means close reference adherence, never a pixel, typeface, or
   logo-fidelity guarantee. Full-size human spelling/layout review stays mandatory; OCR is a
   fallible aid only.
3. The rejected-reference fence stands: rejected or unreviewed Creative History bytes never
   reach the final image provider boundary (ADR 0049). Fresh uploads are current-use operator
   references with explicit rights attestation, not approved history.

## Scoped reconciliation of stale delivery prose (status notes only, no acceptance inferred)

- Spec 019 (`specs/019-organization-asset-library.md`): its 2026-09-12 status sentence stating
  that no Creative History application, repository, API, or UI files exist is stale delivery
  evidence — those files now exist. The binding product separation (Creative History /
  Products & Subjects / Brand Kit) and human-review verdict rules are unchanged and remain
  relevant to the new Studio's reference picker.
- Spec 020 (`specs/020-campaign-creative-studio.md`): delivery status is as written; the only
  new statement is boundary (1) above. Its compositor, masking, font, and approval rules are
  otherwise untouched.
- ADR 0049: unchanged and binding. Its September-12 prose noting the final provider path still
  accepted `avoid` is reconciled by the already-completed cutover: current
  `CampaignImageGenerationInput.references` is `FinalImageReference[]` with no `avoid` member.
  Preserve the corrected runtime boundary; do not reintroduce the member.
- ADR 0057 and Spec 025 remain Proposed. Their content is referenced, not approved, by this ADR.

## Consequences

Implementation proceeds under the approved plan with per-task review gates, including the hard
provider-qualification gate: real independently decodable pre-final preview frames and
same-model continuation after reload, or the workflow does not ship. Rollback hides new
admissions/navigation behind the organization allowlist and leaves additive tables in place;
legacy Studio read access and all existing reviews, bytes, and digests are retained.
