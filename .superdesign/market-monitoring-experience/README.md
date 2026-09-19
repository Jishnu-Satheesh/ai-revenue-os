# Market Monitoring — workflow review draft

Open the [interactive preview](https://p.superdesign.dev/draft/5e38b367-f8e0-4707-ba46-5b5be3d65822), the [Superdesign canvas](https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/99074e63-8b31-43b3-b3bf-d29ae0583535?node=draft-variant-5e38b367-f8e0-4707-ba46-5b5be3d65822), or the local [prototype.html](prototype.html). The saved canvas is version 3, **Growth Intelligence — Market Watch and reports**. Its refetched HTML matches the local prototype byte for byte.

It starts in Growth Intelligence → Insights & market. The data is fictional and all changes are held in browser memory. Reload resets the demonstration. The existing font, icon and Tailwind CDNs need network access.

## Confirmed product choices

- Several independent research projects can coexist at a location.
- The client chooses one-time or recurring research.
- Research produces a report and draft items for review before anything enters the feeds.
- Reports open as readable briefs in a dialog and offer a PDF download.
- The first version uses simple English.
- Speculative competitor financial ranges are allowed when clearly labelled and explained, including when competitor financial figures are unavailable.
- After explicit acceptance, the platform routes action items to Recommendations and informational findings to Insights.

The visual layout is a review candidate. No application implementation, staging migration, live research, provider activation or deployment is included.

## Walk through it

1. Filter the project list by location, status or search. The ready report is filtered with the other projects.
2. Open **New research**. Enter the question, choose the location, add competitors and review the brief. Choose one-time or recurring research explicitly. Starting adds an independent simulated queued project.
3. Open **Competitor monitoring**. **Pause monitoring** affects its future schedule; the current update continues. **Stop this research** affects only that update. Other projects keep their state.
4. Open **Review report**. Read the summary, inspect sources, compare competitors and inspect the assumptions behind the speculative estimate.
5. Download the PDF. It uses the same report data, including scope, date, brief version, evidence gaps, estimate assumptions, advice and sources.
6. Select a finding in Summary and advice in Draft advice. Review the proposed destinations and accept the selection. Find the action items in Recommendations and the finding in Business insights. Follow the source-report link back to the exact report.
7. Accept the same selection again. The preview keeps existing items and reports that they were already accepted.

## Screens

| View                         | Preview                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Market Watch                 | [Desktop](01-market-watch-desktop.png) · [Phone](11-market-watch-mobile.png) |
| New research                 | [Desktop](02-new-research-desktop.png) · [Phone](12-new-research-mobile.png) |
| Location and competitors     | [Research scope](03-research-scope-desktop.png)                              |
| Frequency and reviewed brief | [Review before starting](04-review-brief-desktop.png)                        |
| Background work              | [Research progress](05-research-progress-desktop.png)                        |
| Readable report              | [Desktop](06-report-summary-desktop.png) · [Phone](13-report-mobile.png)     |
| Speculative estimate         | [Range and assumptions](07-report-estimate-desktop.png)                      |
| Draft advice                 | [Selection](08-draft-advice-desktop.png)                                     |
| Acceptance                   | [Destinations by item type](09-accept-items-desktop.png)                     |
| Recommendations              | [Accepted items and report links](10-recommendations-handoff-desktop.png)    |
| PDF                          | [Sample research report](sample-research-report.pdf)                         |

## Verification and limits

[verification.json](verification.json) records **45 passed browser checks and no JavaScript errors**. They cover the standalone design: filtering, input validation, non-Latin competitor names, literal text rendering, independent starts, schedule pause versus run cancellation, retained reports, readable report identity, citations, speculative labels, actual PDF download, routing, duplicate acceptance, source-report links, unsaved edits, focus restoration and narrow-screen overflow. They do not verify application authorization, RLS, database persistence or a live provider flow.

The 13 screenshots above show a clean fictional walkthrough. Desktop and phone views were visually inspected. The downloaded PDF was checked with `pdfinfo` and text extraction: three A4 pages retain the organization, location, report date, brief version, findings, assumptions, advice and all four source records. [Page-one preview](pdf-page-1.png) and [extracted text](sample-research-report.txt) are included for review.

The shared preview was also opened in Chromium: it returned HTTP 200, opened the report, downloaded `Prepare-for-National-Day.pdf` and produced no JavaScript errors.

The PDF writer is a small deterministic exporter for these English demonstration fixtures. It produces a real text PDF; it is not the production renderer and does not establish tagged-PDF accessibility or report retention. Production export still needs a qualified renderer, authorization, storage, download policy and accessibility verification.

Duplicate protection in the preview covers repeated acceptance and exact matching item identity within a location. A production rule for materially similar recommendations needs a separate reviewed contract. No semantic matching engine or deployed scheduler is implied.

The other Growth Intelligence tabs retain the earlier fictional design. Their sample metrics and historic dates are not evidence of current application behavior. New accepted recommendations preserve the September report date and direct report links.

## Files and continuation

- [Workflow audit](../../docs/verification/growth-intelligence/2026-09-13-market-monitoring-workflow-audit.md) records 50 source-backed gaps and the proposed workflow.
- [brief.md](brief.md) records the confirmed choices and proposed composition.
- `workspace-fragment.html`, `workspace.css`, `workspace.js`, `report.css` and `report.js` are design-only source fragments. `assemble.py` combines them with the previous four-tab design into the portable HTML document.
- `context-files.json`, `context-fingerprints.json` and `reference-assets.json` preserve the source context and selected visual references.
- `verify.cjs` checks the interactions; `capture.cjs` captures a clean fictional walkthrough after verification.
- `generation.log` records the Superdesign generation refusal: the account had no credits. This draft was authored locally and successfully saved through the documented no-credit import path. `prompt.txt` preserves the earlier generation request; `brief.md` carries the final confirmed choices.
- `import-result.json` records the actual canvas URLs and version. `artifact-verification.json` records the matching local/remote HTML hashes and saved artifact checks. The Growth Intelligence entry in `../resume.json` points to this draft with refreshed context fingerprints.

The next implementation step is an approved specification and execution plan. The current production worker still needs live retrieval/extraction wiring, project-scoped lifecycle contracts, context assembly, report persistence and acceptance wiring; the source-backed audit enumerates those gaps. Research cost and duration need a measured provider canary before changing allowances or promising a completion time.
