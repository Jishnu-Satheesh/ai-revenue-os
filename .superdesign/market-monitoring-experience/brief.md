# Market Watch and New research — visual review candidate

This continues the existing Growth Intelligence design. It is a fictional design preview, not application implementation. Product basis: `docs/verification/growth-intelligence/2026-09-13-market-monitoring-workflow-audit.md`. The design and implementation plan were approved 2026-09-14 per `docs/superpowers/specs/2026-09-14-market-monitoring-report-experience.md` (Tier 3 authorization granted; visual direction approved).

## Settled requirements

- Keep Growth Intelligence's four tabs: Overview, Recommendations, Your actions, Insights & market.
- Multiple independent research projects can coexist at one location. An event project does not replace routine competitor monitoring.
- Each project accepts a freely described business question, location/research area, competitors and an optional event date.
- The user chooses one-time or recurring research.
- Background research produces a concise report and draft advice for review. Advice is not added to the feeds automatically.
- The first version uses simple English, confirmed by the user.
- The platform routes accepted selected items by type: actions to Recommendations, findings to Insights.
- Reports may contain clearly identified speculative competitor financial ranges with an explanation of the speculation. They must never read as recorded competitor results.
- Business Memory, business facts and channel evidence inform the advice within their permitted scope.
- The report opens as a readable custom brief in a dialog, with PDF download. The user confirmed this while the visual draft was being prepared.

## Scope of this visual iteration

Refine the active four-tab design in place. Preserve the other three tab views and their interactions. Open the design on Insights & market. Show the new Market Watch workspace and its New research dialog. Include the now-confirmed readable report dialog and a PDF export of the same fictional report content. No completed live research is claimed by this preview.

Keep Manrope, Lucide icons, the neutral/emerald palette, the floating organization sidebar and the existing breadcrumb/header. The source logo is the Waypoints icon in a dark rounded tile with AI Revenue OS text; reproduce that source mark faithfully. The Campaign reference contributes readable report/proposal rows; the Channels reference contributes restrained spacing and grouped content. Neither screenshot's sample metrics, navigation mistakes or prototype-only controls are product requirements.

Display one unobtrusive, persistent “Design preview · Fictional examples” label in the shell. Use Example Kitchen and fictional projects. Avoid photographic decoration, hero graphics, metric tiles, invented business returns and decorative charts.

## Market Watch composition

- Page heading and four line tabs stay native. The old global Market monitoring settings action becomes New research, and targets the new dialog. Avoid duplicate equally prominent New research buttons.
- Under Insights & market, place Market Watch in the primary full-width area. One short introduction: “Research your market. Review what matters for your business.”
- Add an explicit location selector, project search and compact status filters. These filter the project list and featured report consistently.
- Feature one ready report with its project question, location, report date, one-time/recurring setting, short takeaway and Review report action. Use the fictional topic “Prepare for National Day”; the sample takeaway should be qualitative, such as “Compare family offers and check delivery capacity before choosing a promotion.” Show “Draft advice for review” as the next action, not a claimed business result.
- Below, show compact project rows: Competitor monitoring / Downtown / recurring / researching; Weekend delivery opportunity / Marina / one-time / queued; Local customer feedback / Downtown / monitoring paused with a prior report still available. Use plain state text and dates rather than fake progress percentages or promised completion times.
- A running project can show its real stage and open progress. Pausing its schedule and stopping its current update are distinct actions. A failed update must retain a link to its previous report.
- Project history remains available without placing every attempt on the main page. Details identify the exact report and brief revision.
- Business insights stays a separate clearly named section below the research projects. Use two compact qualitative examples with a named evidence period and an Inspect evidence affordance. Missing business inputs have one grouped “Improve the next report” area with a specific next action.
- Treat the new report list as a proposed capability. Do not retain the old wall of equally weighted evidence cards as the primary story.

## New research dialog

Use one spacious modal, around 800–860px wide on desktop, with a stable title/close control, scrolling body and persistent footer. Mobile fills the available screen, with stacked fields and reachable actions. Use native accessible form controls or equivalent keyboard support; show focus and restore it when closing.

A compact three-step indicator is proposed: Brief → Scope → Review. The first step leads with “What would you like to achieve?” and a generous textarea, plus optional project title and event date. The next step shows the chosen location and research area, editable competitor identity rows, and an expandable “Business context” summary with a named channel-evidence period and relevant saved goals. Do not display provider/worker jargon in this client flow.

Competitor rows support adding, editing and removing a name, website and location hint. Suggestions must be labelled as suggestions, not verified competitors. No arbitrary current-code limit is promoted into a new product rule. The client need not provide competitors to describe a useful research question.

The final step includes One-time / Keep monitoring controls. Recurring mode reveals cadence, local time/timezone and an optional end date. These are sample form selections, not approved numeric operating policy. Starting requires choosing the frequency; do not silently enable a schedule.

Before Start research, show the exact brief, location, competitors, investigation areas, evidence periods and frequency in a concise reviewed summary with Edit links. Investigation areas cover local demand, competitor presence, offers, reviews and observable performance. Clearly state: “You’ll receive a report and draft advice to review.” There is no execute, publish or campaign-spend action.

Validate a missing business question and location inline, preserving all other input. Closing with edits should offer Keep editing or Discard draft, without clearing existing projects. Starting in this preview adds a separate simulated queued project and labels the result as a preview. Closing after that does not cancel it.

## Source changes since the saved draft

The current source still has the same route, workspace root and shared shell. Insights & market now renders business insights/data gaps in one column and branch research/Market Watch in another. The monitoring dialog remains branch-scoped, narrow and topic-based. This iteration intentionally changes that target section to project/report management. It must not spread changes into Campaign, Business Memory or the other Growth Intelligence tab designs.

The attached current source describes implemented behavior; this brief describes the proposed redesign. Follow the proposal where the two conflict. Keep the source design tokens and shared components.

## Still open

Measured research cost/duration allowance. None is silently approved by this preview.

## Confirmed reader extension

Lead with a short summary and what it means for this location. A compact section index opens Summary, Competitors, Local opportunity, Draft advice and Sources. Show qualitative findings with citations and coverage gaps. Keep any speculative financial range clearly labelled beside the number, with assumptions and a scenario calculation. The draft-advice section supports selection and review without executing or publishing anything. After acceptance, the platform routes action items to Recommendations and informational findings to Insights, as confirmed by the user. Both keep exact report links and avoid duplicate additions. PDF export contains the same report identity, date, scope, findings, assumptions, advice and source list.
