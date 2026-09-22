# Independent design and contract review

2026-09-21. Reviewer independent of spec/contract/prototype authors. Documentation/source review only; no database mutation or provider call. Final browser assessment is separate in browser-review.md.

## Verdict

No remaining critical/high finding in the revised design/technical/implementation documents reviewed below. This is readiness for user design/plan review, not implementation approval, provider qualification, pixel-fidelity acceptance or production completion. The original sketch is unavailable; either its later comparison or explicit approval of this prototype as replacement remains required.

## Findings raised and corrected

- P1: Conflicting UI routes and absent saved-document route. Spec §3, technical §5 and plan Task 7 now consistently use campaigns/studio and campaigns/studio/[documentId], with static-segment tests.
- P1: Preset registry, export derivatives and selected bytes were inconsistent. Technical §§2–5 now define measured studio_exports, explicit conversion acceptance and selected export/hash identity; plan Tasks 2/3/6/9 cover them. Padding/crop cannot silently attach native pixels before acceptance.
- P1: Exact design could not identify an uploaded primary reference. Technical §2 now uses manifest reference identity, explicitly admitting upload-only Exact design without fabricating a library version.
- P1: Channel-logo substitution and primary-reference choices were absent from immutable request contracts. They now have typed identities, range validation and digest coverage.
- P1: Blank New Idea conflicted with minimum prompt length; suggestions lacked durable result retrieval. Operation-specific validation, typed run result and a scoped suggestion endpoint now support reload without another paid request.
- P1: Studio-to-Creative-History reuse was unspecified. Technical §8 and plan Task 11A now define explicit filing, immutable native/export identity, source resolution and Unreviewed status without inherited approval.
- P1: Campaign setup resolution was deferred to an unidentified future seam. Technical §7 and plan Task 10 now identify generateCampaignBundle → publisher → createCampaignVersionWriter.createVersion → create_campaign_bundle_version and durable resolution/recovery. Source existence verified at generate-bundle.ts:598, repository.ts:345/368 and trigger/campaigns.ts:349/407.
- P1: Plan rejected final output when a provider omitted previews, contrary to the spec. Task 5 now saves valid final output while recording missing_progressive_preview; this never satisfies progressive acceptance.
- P2: Missing sketch made the plan block even after an explicitly accepted replacement. Task 0 now permits only an explicitly user-approved replacement and records its hashes.

## Boundaries checked

- Standalone campaign-free generation/history remains core scope.
- Full AI poster with exact submitted copy is explicitly scoped as a new architectural exception; existing deterministic compositor/digest compatibility is preserved.
- Real decoded partial images and same-model original-context edits are qualification and final browser gates. Simulation is never accepted as provider evidence.
- createCampaignService.create enqueues generation (service.ts:152). The new draft+link operation explicitly avoids reusing it unchanged.
- Exact selected bytes require fresh Campaign review; no approval, publishing permission or hidden generation is inherited.
- Tenant-scoped rows/objects, continuation secrecy, lease fencing, unknown paid outcomes and explicit bounded policy are addressed at contract level. They still require implementation and staging verification.
- Per-task independent spec/code/browser review and fix/re-review loops, immutable visual references and final human-like real generation remain mandatory in the plan.

## Reviewed files

- docs/superpowers/specs/2026-09-20-independent-creative-studio-design.md
- docs/design/creative-studio-independent/technical-contract.md
- docs/design/creative-studio-independent/current-studio-audit.md
- docs/design/creative-studio-independent/provider-and-assets-audit.md
- docs/superpowers/plans/2026-09-20-independent-creative-studio.md

Provider research was reviewed as supplied evidence; this reviewer made no additional live provider documentation or account qualification claim. No production tests run in this design review.
