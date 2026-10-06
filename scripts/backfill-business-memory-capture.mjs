/**
 * Backfill Business Memory capture events from live source tables.
 *
 * Spec 023 §16: backfill starts from live source tables with provenance, never
 * from old memory seed content. Default window is 90 days plus all currently
 * active plans (here: the latest completed analysis per channel/branch even
 * when it predates the window, and every triage decision in the window).
 * Bounded to 100 source identities per organization per kind per pass.
 *
 * The ONLY write path is the same revision allocator the live capture uses:
 * the public `reconcile_memory_channel_*` RPCs, which call the private enqueue
 * helpers inside the source transaction. The script never inserts into
 * `memory_capture_events` directly, never invents past transitions for mutable
 * objects (one current snapshot per source identity via the allocator's
 * digest-gated revision), and never forces rights-blocked work: quarantined
 * events are reported with their safe codes and left alone.
 *
 * Live-capture-first ordering: enable live capture for the organization BEFORE
 * running with --apply. New completions keep flowing through the owning
 * transactions while this script runs; the reconcile RPCs are idempotent
 * (digest-gated revisions plus per-revision existence checks), so a live
 * arrival racing the backfill produces no duplicate. The script processes
 * oldest-first and persists a cutoff/cursor per organization and kind, so a
 * crash or restart resumes where it stopped instead of re-scanning.
 *
 * Default mode is a dry run: it reports eligible/already-enqueued/missing
 * counts and writes nothing (not even the state file). --apply enqueues.
 *
 *   node scripts/backfill-business-memory-capture.mjs [--org <uuid>...]
 *     [--source-kind channel_finding|channel_recommendation|channel_decision]
 *     [--since <ISO date>] [--limit <1..100>] [--apply] [--state <path>]
 *
 * Growth (market_claim, growth_item, growth_decision) and Campaign
 * (campaign_state, campaign_outcome, campaign_lesson) kinds are reported as
 * skipped until their adapter slices land their enqueue RPCs; requesting one
 * explicitly is an error, not a silent no-op.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import postgres from "postgres";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });

const CHANNEL_KINDS = ["channel_finding", "channel_recommendation", "channel_decision"];
const FUTURE_KINDS = [
  "market_claim",
  "growth_item",
  "growth_decision",
  "campaign_state",
  "campaign_outcome",
  "campaign_lesson",
];
const DEFAULT_SINCE_DAYS = 90;
const MAX_BATCH = 100;

function fail(message) {
  console.error(`backfill-business-memory-capture: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    orgs: [],
    kinds: [],
    since: null,
    limit: MAX_BATCH,
    apply: false,
    statePath: path.join(REPO_ROOT, ".backfill-business-memory-capture.state.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--org") args.orgs.push(argv[(i += 1)]);
    else if (flag === "--source-kind") args.kinds.push(argv[(i += 1)]);
    else if (flag === "--since") args.since = argv[(i += 1)];
    else if (flag === "--limit") args.limit = Number(argv[(i += 1)]);
    else if (flag === "--apply") args.apply = true;
    else if (flag === "--state") args.statePath = argv[(i += 1)];
    else if (flag === "--help") {
      console.log(
        "Usage: node scripts/backfill-business-memory-capture.mjs [--org <uuid>...] " +
          "[--source-kind <kind>...] [--since <ISO date>] [--limit <1..100>] [--apply] [--state <path>]",
      );
      process.exit(0);
    } else fail(`unknown argument: ${flag}`);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const org of args.orgs) if (!uuid.test(org)) fail(`--org is not a UUID: ${org}`);
  if (args.kinds.length === 0) args.kinds = [...CHANNEL_KINDS];
  for (const kind of args.kinds) {
    if (FUTURE_KINDS.includes(kind))
      fail(
        `--source-kind ${kind} has no enqueue RPC yet (adapter slice not landed). ` +
          `Re-run without it; nothing was written.`,
      );
    if (!CHANNEL_KINDS.includes(kind)) fail(`unknown --source-kind: ${kind}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_BATCH)
    fail(`--limit must be an integer between 1 and ${MAX_BATCH}`);
  const since = args.since ? new Date(args.since) : new Date(Date.now() - DEFAULT_SINCE_DAYS * 864e5);
  if (Number.isNaN(since.getTime())) fail(`--since is not a valid date: ${args.since}`);
  args.sinceIso = since.toISOString();
  return args;
}

function redact(message) {
  return String(message).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]");
}

function loadState(statePath) {
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.cursors && typeof parsed.cursors === "object")
      return parsed;
    return { version: 1, cursors: {} };
  } catch {
    return { version: 1, cursors: {} };
  }
}

function cursorFor(state, orgId, kind) {
  return state.cursors?.[orgId]?.[kind] ?? null;
}

function afterCursor(rows, cursor) {
  if (!cursor) return rows;
  return rows.filter(
    (row) =>
      row.completed_at > cursor.completedAt ||
      (row.completed_at === cursor.completedAt && row.id > cursor.lastId),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = (process.env.DATABASE_URL ?? "").replace(":6543", ":5432");
  if (!databaseUrl) fail("DATABASE_URL is not set in .env.local");
  const sql = postgres(databaseUrl, { prepare: false, onnotice: () => {}, max: 4 });

  try {
    // Probe: the reconcile RPCs are the only write path. If the adapter or
    // cursor migrations have not been pushed, --apply cannot run; a dry run
    // still reports table counts where readable.
    const rpcs = await sql`
      select proname from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and proname in (
          'reconcile_memory_channel_findings',
          'reconcile_memory_channel_recommendations',
          'reconcile_memory_channel_decision'
        )
    `;
    const available = new Set(rpcs.map((row) => row.proname));
    const missing = [
      "reconcile_memory_channel_findings",
      "reconcile_memory_channel_recommendations",
      "reconcile_memory_channel_decision",
    ].filter((name) => !available.has(name));
    if (missing.length > 0) {
      console.log(
        JSON.stringify(
          {
            mode: args.apply ? "apply-refused" : "dry-run",
            reason: `reconcile RPCs not present on this database: ${missing.join(", ")}. ` +
              `Push the capture/cursor migrations first; nothing was written.`,
          },
          null,
          2,
        ),
      );
      process.exit(args.apply ? 1 : 0);
    }

    const settingsRows =
      args.orgs.length > 0
        ? await sql`
            select organization_id, capture_enabled from public.memory_integration_settings
            where organization_id = any(${args.orgs}::uuid[])`
        : await sql`select organization_id, capture_enabled from public.memory_integration_settings`;
    const settingsByOrg = new Map(
      settingsRows.map((row) => [row.organization_id, row.capture_enabled]),
    );
    // An explicitly requested org without a settings row is capture-disabled
    // by definition (defaults are disabled): report it, never enable it.
    const orgIds =
      args.orgs.length > 0 ? args.orgs : [...settingsByOrg.keys()].map(String);

    const state = loadState(args.statePath);
    const report = { mode: args.apply ? "apply" : "dry-run", since: args.sinceIso, orgs: [] };
    let wroteState = false;

    for (const orgId of orgIds) {
      const captureEnabled = settingsByOrg.get(orgId) ?? false;
      const orgReport = { organizationId: orgId, captureEnabled, kinds: {} };

      // Eligible completed analysis runs: everything in the window, plus the
      // latest completed run per channel/branch even when older (currently
      // active state stays covered). Oldest-first: live capture owns the new
      // arrivals; the backfill works backwards from what live capture missed.
      const runs = await sql`
        with ranked as (
          select r.id, r.completed_at, r.channel_id, r.branch_id,
            row_number() over (
              partition by r.channel_id, r.branch_id order by r.completed_at desc, r.id desc
            ) as scope_rank
          from public.channel_analysis_runs r
          where r.organization_id = ${orgId}::uuid
            and r.status = 'completed'
            and r.completed_at is not null
        )
        select id, completed_at::text as completed_at from ranked
        where completed_at >= ${args.sinceIso}::timestamptz or scope_rank = 1
        order by completed_at asc, id asc`;
      const decisions = await sql`
        select d.id, d.created_at::text as completed_at
        from public.channel_recommendation_decisions d
        where d.organization_id = ${orgId}::uuid
          and d.created_at >= ${args.sinceIso}::timestamptz
        order by d.created_at asc, d.id asc`;

      // Already-enqueued identities, per kind and status, for reconciliation
      // against eligible source versions (not total historical rows).
      const existing = await sql`
        select e.source_kind, e.status, e.safe_failure_code,
          coalesce(e.channel_finding_id::text, e.channel_recommendation_id::text,
            e.channel_decision_id::text) as source_id,
          coalesce(f.analysis_run_id::text, r.analysis_run_id::text, d.id::text) as run_id
        from public.memory_capture_events e
        left join public.channel_findings f
          on f.organization_id = e.organization_id and f.id = e.channel_finding_id
        left join public.channel_recommendations r
          on r.organization_id = e.organization_id and r.id = e.channel_recommendation_id
        left join public.channel_recommendation_decisions d
          on d.organization_id = e.organization_id and d.id = e.channel_decision_id
        where e.organization_id = ${orgId}::uuid`;
      const enqueuedRunIds = (kind) =>
        new Set(
          existing
            .filter((row) => row.source_kind === kind && row.run_id)
            .map((row) => row.run_id),
        );
      // Decisions are keyed by decision id, not by run: the same
      // already-enqueued set doubles as the resume filter so a re-run only
      // reconciles decisions the queue has never seen.
      const coveredDecisionIds = new Set(
        existing
          .filter((row) => row.source_kind === "channel_decision" && row.source_id)
          .map((row) => row.source_id),
      );
      const rightsBlocked = existing.filter((row) => row.status === "quarantined");

      for (const kind of args.kinds) {
        const cursor = cursorFor(state, orgId, kind);
        let identities;
        if (kind === "channel_decision") {
          // Same resume shape as runs: oldest-first past the persisted
          // cursor, skipping decisions the queue already holds, bounded to
          // one batch. The reconcile RPC is idempotent, but re-calling it
          // for covered decisions would still waste a pass and inflate the
          // enqueued count, so the filter lives here, not in the database.
          identities = afterCursor(decisions, cursor)
            .filter((row) => !coveredDecisionIds.has(row.id))
            .slice(0, args.limit)
            .map((row) => ({ id: row.id, completed_at: row.completed_at }));
        } else {
          const covered = enqueuedRunIds(kind);
          identities = afterCursor(runs, cursor)
            .filter((run) => !covered.has(run.id))
            .slice(0, args.limit)
            .map((run) => ({ id: run.id, completed_at: run.completed_at }));
        }
        const kindReport = {
          eligible: kind === "channel_decision" ? decisions.length : runs.length,
          alreadyEnqueued:
            kind === "channel_decision" ? coveredDecisionIds.size : enqueuedRunIds(kind).size,
          missing: identities.length,
          enqueued: 0,
          bypassed: 0,
          resumedFrom: cursor,
        };

        if (args.apply) {
          if (!captureEnabled) {
            kindReport.applyRefused =
              "live capture is disabled for this organization; enable it first so new arrivals flow through the owning transactions, then re-run.";
          } else {
            for (const identity of identities) {
              if (kind === "channel_finding") {
                kindReport.enqueued += await sql`
                  select public.reconcile_memory_channel_findings(
                    ${orgId}::uuid, ${identity.id}::uuid) as enqueued`.then(
                  (rows) => Number(rows[0].enqueued),
                );
              } else if (kind === "channel_recommendation") {
                kindReport.enqueued += await sql`
                  select public.reconcile_memory_channel_recommendations(
                    ${orgId}::uuid, ${identity.id}::uuid) as enqueued`.then(
                  (rows) => Number(rows[0].enqueued),
                );
              } else {
                // Returns the event id, or null when capture is bypassed
                // (for example a decision whose recommendation row is gone).
                // Nulls count as bypassed, never as enqueued, and the cursor
                // below still advances past them so the next pass resumes
                // instead of retrying a row that can never enqueue.
                const rows = await sql`select public.reconcile_memory_channel_decision(
                  ${orgId}::uuid, ${identity.id}::uuid) as event_id`;
                if (rows[0].event_id) kindReport.enqueued += 1;
                else kindReport.bypassed += 1;
              }
            }
            const last = identities[identities.length - 1];
            if (last) {
              state.cursors[orgId] = state.cursors[orgId] ?? {};
              state.cursors[orgId][kind] = { lastId: last.id, completedAt: last.completed_at };
              wroteState = true;
            }
          }
        }
        orgReport.kinds[kind] = kindReport;
      }

      orgReport.rightsBlocked = rightsBlocked.map((row) => ({
        sourceKind: row.source_kind,
        safeCode: row.safe_failure_code,
      }));
      orgReport.rightsBlockedNote =
        "Quarantined captures are reported, never forced: re-projection of rights-blocked work happens only through the governed retry path, not this tool.";
      report.orgs.push(orgReport);
    }

    if (args.apply && wroteState) {
      state.version = 1;
      state.since = args.sinceIso;
      state.updatedAt = new Date().toISOString();
      writeFileSync(args.statePath, `${JSON.stringify(state, null, 2)}\n`);
      report.statePath = args.statePath;
    }
    if (!args.apply)
      report.note =
        "Dry run: counts only, nothing was written (no events, no cursor file). Re-run with --apply to enqueue.";

    console.log(JSON.stringify(report, null, 2));
    await sql.end();
  } catch (error) {
    console.error(`backfill-business-memory-capture: ${redact(error?.message ?? error)}`);
    try {
      await sql.end();
    } catch {}
    process.exit(1);
  }
}

await main();
