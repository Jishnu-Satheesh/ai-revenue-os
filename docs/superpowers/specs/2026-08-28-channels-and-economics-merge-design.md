# Channels and Channel Economics Merge Design

**Date:** 2026-08-28

**Status:** Approved design; awaiting written-spec review

**Routes:** `/organizations/[organizationId]/channels`, `/organizations/[organizationId]/channels/[channelId]`

**Supersedes in navigation:** `/organizations/[organizationId]/economics` and
`/organizations/[organizationId]/economics/channels/[channelId]`

## 1. Purpose

Merge the `Channels` and `Channel economics` destinations into one, named **Channels**, so that a
channel is one thing an operator looks after rather than two places they visit.

Four drivers, all confirmed by the user:

1. The split confuses people — configuring a channel and reading its money are separate places.
2. The analysis is buried two levels down under a heading that does not describe it.
3. The sidebar carries ten entries, two of them for one concept.
4. More channels, categories and per-channel actions are coming, and the split gets worse with each.

The strongest evidence for the merge is that the seam already leaks: the per-channel analysis
workspace lives at `/economics/channels/[channelId]`, so a channel is *added* under Channels and
*read* under Channel economics, with the deep dive filed as a child of economics.

## 2. Scope and tier

Tier 3. It moves a route boundary, changes navigation other surfaces link to, merges two page
surfaces with different data-loading shapes, and adds a composed multi-channel read model. It adds
no table, column, RLS policy, RPC or database type.

Included:

- The merged `/channels` destination: an analysis-derived roll-up above the channel list.
- `/channels/[channelId]`: one channel, one page, with **Analysis** and **Setup** tabs.
- Retirement of the `/economics` route and the `Channel economics` sidebar entry.
- Redirects from both old routes.
- Two new read-only ports and one new read-model builder.
- Extraction of the earned/lost/potential computation into one shared function.

Excluded, deliberately:

- **The fate of the economics subsystem.** The cost model, `channel_economics_entries`, the
  `economics.recompute-ledger` Trigger task, and the Overview's economics card are untouched. The
  user chose to take economics off this page now and decide the subsystem's future separately, so
  that a subsystem deletion does not ride along inside an information-architecture change where it
  would be hard to review.
- Contribution margin and margin rate. They are deferred today
  (`read-model.ts`, `MONEY_DEFERRED_REASON`) and stay deferred. The merge introduces no costing claim.
- Any change to detectors, the narration prompt, or the analysis workflow.

## 3. Naming

The merged destination is called **Channels**, not **Marketplace**.

`marketplace` is one of five values in `channelCategorySchema` — `marketplace`, `owned_digital`,
`physical`, `reseller`, `other` (`src/domain/channels/types.ts`). All four of the pilot
organization's channels are marketplaces today (Talabat, Noon, Deliveroo, Keeta), so the name would
fit now and mislead the day an owned website or a dine-in channel is added. Naming a surface after
one of its categories also cuts against the standing rule that platform core stays
industry-neutral.

`Channels` is the word the domain, the database and the codebase already use, and it holds all five
categories without lying. It also means the primary route does not move.

## 4. Routes

| Route | Disposition |
| --- | --- |
| `/channels` | The merged destination. Roll-up, then the channel list. |
| `/channels/[channelId]` | New. One channel: **Analysis** and **Setup** tabs. |
| `/economics` | Retired. Redirects to `/channels`. |
| `/economics/channels/[channelId]` | Redirects to `/channels/[channelId]`. |

Redirects rather than removals, because existing links and bookmarks point at both. The Overview's
economics briefing link is the on-page fragment `#channel-economics`
(`channel-economics-overview.tsx`), not a link to the retired route, so the Overview is unaffected.

The sidebar drops `Channel economics`, going from ten entries to nine.

## 5. The roll-up

### 5.1 One clock

The old economics roll-up read `channel_economics_entries` over a rolling 7/30/90-day preset
anchored to today. The channel figures come from `channel_analysis_runs`, whose windows are declared
by the uploaded report packages. On staging on 2026-08-28 these do not overlap at all: the ledger
holds 31 May – 8 Aug 2026, while every analysis covers 1 Jan – 28 Feb 2026. The default 30-day
preset would have shown a sliver of ledger data above channel rows quoting figures from six months
earlier, under a single window control implying they shared a timeframe.

The repository already documents why:

> Derived from what the organization actually imported rather than counted back from today: evidence
> arrives as uploaded reports covering past periods, so a window measured from now reaches it only
> by coincidence.
> — `src/modules/analysis/application/ports.ts`

The merged page therefore has **one clock**. The roll-up derives from analysis runs, and the window
control offers the declared evidence windows that exist, deduplicated by start, end and grain.

The page opens on the most recent window that has at least one completed analysis, so the default
view is never empty when any evidence exists. Where no window has a completed analysis, the page
opens on the most recent declared window and the roll-up states that nothing has been analysed for
it — an honest empty rather than a blank control. The selection is carried in the query string, as
the economics page carried its preset, so a window is linkable.

### 5.2 No new arithmetic

The per-channel money band already exists in `buildChannelWorkspaceView`: `potential` is the
channel's gross revenue from the `revenue.window_gross` detector, `lost` is the provider's own
rejection loss from `orders.cancellation_loss`, and `earned` is potential minus lost. It refuses
unless both figures share a currency and potential is at least lost.

That computation is extracted to one shared pure function. The workspace calls it for one channel;
the roll-up calls it per channel and sums the results. There is one implementation, so "the roll-up
uses the same figures as the channel page" is enforced by construction rather than by discipline.

For the pilot organization over 1 Jan – 28 Feb: potential AED 553.00, lost AED 357.00, earned
AED 196.00 — talabat only.

### 5.3 Coverage is stated, never implied

A partial sum presented as a total is the failure the old page had. The roll-up always states how
many channels it covers and names the ones it does not:

> **AED 196.00 earned** · 1 Jan – 28 Feb
> Across 1 of 4 channels. Noon, Deliveroo and Keeta have no analysis for this window.

Naming the excluded channels turns the gap into an action.

### 5.4 Refusals

- **Mixed currency** — if the assessed channels do not share one currency, the band refuses and says
  so rather than adding across currencies. This mirrors the detectors' own `singleCurrency` rule.
- **No analysis in the window** — the band renders the em-dash-with-a-reason house style, never a
  zero. A zero reads as "you earned nothing"; the truth is "nothing was measured".

## 6. The channel page

`/channels/[channelId]`, two tabs.

**Analysis** — the existing `ChannelWorkspace`, unchanged, and the default tab.

**Setup** — what currently hides inside dialogs on the register page: channel identity (display
name, key, category, template hint), branch mappings, source labels and aliases, and archive.

Mappings and labels stop being modals. They are modals today because a card in a grid had nowhere
to put them; once a channel has a page, they are sections. Mapping a branch is the fiddliest task in
the app and is better done with the data visible than in a dialog over a list.

Permissions are unchanged: `channel.manage` gates identity edits and archive, `channel.map_branch`
gates mappings. Without them Setup renders read-only rather than disappearing, matching today, where
mapping counts are visible to every member.

Degradations:

- Governed channel analysis off for the organization → the page opens on Setup and offers no
  Analysis tab.
- Archived channel → Setup only, matching today, where the workspace link is hidden for archived
  channels.

`Add channel` stays on the list page; it belongs to no channel.

## 7. Data flow

Two new read-only port methods, both through the caller's session so RLS decides visibility:

- `loadEvidenceWindowsForOrganization({ organizationId, limit })` — the existing
  `loadEvidenceWindows` requires a `channelId`, and the list page needs windows across all channels.
  Without this the page fans out one call per channel, which is tolerable at four and poor at forty.
- `loadChannelBandsForWindow({ organizationId, windowStart, windowEnd, grain })` — the latest
  completed run per channel for that window, carrying only the two findings the band needs.

One new pure read-model builder, `buildChannelsOverviewView`, taking the channel management
snapshot, the bands and the window list, and returning the roll-up and the list rows including the
coverage sentence. Being pure, every honesty rule in section 5 is unit-testable without a database.

Page composition for `/channels`: the existing management snapshot, plus the two new reads. The
governed-analysis flag is checked before the band reads run, so an organization the slice is off for
pays for nothing and has nothing to leak through a hand-typed URL.

`channels-management.tsx` is 776 lines doing three jobs — the register, the per-channel cards, and
the configuration dialogs. The split gives it two homes with one job each: a list page and a setup
tab. This is tidy-up on code the change already moves, not separate refactoring.

## 8. Testing

No migration, no schema change, no `database.types.ts` change.

- **Read-model unit tests** on `buildChannelsOverviewView`: a partial sum states its coverage; the
  excluded channels are named; mixed currencies refuse rather than summing; a window with no
  analysis renders the reason, not a zero; the shared band function returns identical figures for
  the workspace and the roll-up.
- **Tenant isolation**, as the workspace already verifies it: reads go through the caller's session
  and the queries are organization-scoped. No service-role client enters this path.
- **Component tests**: list page (roll-up, coverage sentence, degraded register when the flag is
  off); channel page (default tab, read-only Setup without permission, no Analysis tab when the flag
  is off); both redirects.
- **Sidebar test** for nine entries and the removed label.
- **Browser verification** at both widths is required before this is called done. The Chrome
  DevTools MCP is failing to connect in the session that wrote this design; if it is still
  unavailable at implementation time, that gate must be reported as outstanding rather than skipped.

## 9. Risks and rollback

- **Old links.** Mitigated by redirects on both retired routes rather than removals.
- **An empty-looking page.** If the organization has few analyses, the roll-up will honestly say so.
  This is intended: the coverage sentence names what to run next. It will nonetheless look emptier
  than the old economics page, which showed ledger data that had nothing to do with the analyses
  beneath it.
- **The parked decision.** Economics keeps accruing data and running its Trigger task while having
  no page of its own. That is an accepted interim state, not an oversight, and it should not be left
  indefinitely — a subsystem nothing user-facing reads tends to rot quietly.
- **Rollback** is restoring the sidebar entry and the `/economics` page; nothing in the database
  changes, so there is no data to migrate back.
