/**
 * Grant standing report-structure admissions for approvals a client already gave.
 *
 * See ADR 0046 (`adrs/0046-a-standing-admission-is-the-unit-of-report-reuse.md`) and
 * `.superpowers/sdd/2026-09-02-governed-report-reuse-phase-1/task-12-brief.md` /
 * `task-12-addendum.md`.
 *
 * The old schema fingerprint hashed the worksheet name, so a provider that renames its
 * tab every month (Talabat: "Jan-2026", then "Feb-2026", ...) never reused a mapping —
 * the same four governance questions were answered once per file. `structure_fingerprint`
 * (added by Task 1/2 of this plan) excludes the worksheet name, so uploads that are
 * structurally identical collapse to one identity. This script finds every report
 * structure an organization has ALREADY governed twice over (an approved, still-active
 * contract binding AND an approved, still-active projection binding) and grants the
 * standing admission that lets every future upload of that structure skip approval.
 *
 * Default mode reports what it would grant and writes nothing. `--apply` grants for real.
 *
 *   node scripts/backfill-report-structure-admissions.mjs           # report only
 *   node scripts/backfill-report-structure-admissions.mjs --apply   # grant for real
 *
 * ---------------------------------------------------------------------------------
 * Why this file compiles src/domain/reports/document-digest.ts instead of importing it
 * ---------------------------------------------------------------------------------
 * The brief requires importing the REAL `createReportStructureFingerprint` rather than
 * reimplementing the hash: a drifted copy would grant admissions keyed on an identity
 * nothing else computes, and uploads would silently stop matching.
 *
 * No script in this repository imports `@/...` TypeScript today, so there was no
 * existing convention to follow. `node --import tsx/esm` (tsx 4.23.10, Node 22.18.0)
 * was tried first and fails with `ERR_REQUIRE_CYCLE_MODULE` the moment `zod` (a
 * dependency of the sibling `contracts.ts`, reached only through a `import type`) is
 * pulled into the graph — a real incompatibility between tsx's CJS/ESM interop shim and
 * Node 22.12+'s `require(esm)`, not something this script can route around.
 *
 * `document-digest.ts` itself has zero runtime imports beyond `node:crypto` (its two
 * `@/domain/reports/...` imports are both `import type`, which TypeScript's transpiler
 * always elides regardless of `isolatedModules`), so it does not need the module graph
 * that trips the bug. This loader reads that one file's actual source, runs it through
 * the TypeScript compiler API (already a project dependency; `pnpm typecheck` uses the
 * same compiler) with `module: commonjs`, and executes the result as a CommonJS module.
 * That is "import the compiled module" from the addendum's list of acceptable paths --
 * the executed code is the real file's current text, not a hand-copied reimplementation,
 * so a future fix to the hash is picked up automatically the next time this runs.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";
import postgres from "postgres";
import ts from "typescript";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(REPO_ROOT, ".env.local"), quiet: true });

const APPLY = process.argv.includes("--apply");

function redact(message) {
  return String(message).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]");
}

/**
 * Compiles src/domain/reports/document-digest.ts on the fly and returns its exports.
 * See the file-level comment above for why this exists instead of a normal import.
 */
function loadDocumentDigestModule() {
  const sourcePath = path.join(REPO_ROOT, "src/domain/reports/document-digest.ts");
  const source = readFileSync(sourcePath, "utf8");
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: sourcePath,
    reportDiagnostics: true,
  });
  if (diagnostics && diagnostics.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => REPO_ROOT,
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    });
    throw new Error(`document-digest.ts failed to transpile:\n${formatted}`);
  }
  const compiled = new Module(sourcePath, undefined);
  compiled.filename = sourcePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  compiled._compile(outputText, sourcePath);
  return compiled.exports;
}

const { createReportStructureFingerprint } = loadDocumentDigestModule();
if (typeof createReportStructureFingerprint !== "function") {
  throw new Error("createReportStructureFingerprint did not load from document-digest.ts");
}

const databaseUrl = (process.env.DATABASE_URL ?? "").replace(":6543", ":5432");
if (!databaseUrl) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}
const sql = postgres(databaseUrl, { prepare: false, onnotice: () => {}, max: 4 });

/**
 * Builds the structure-fingerprint input for one package from its sheet manifests,
 * exactly as the addendum's recipe specifies: sheets sorted by position, each header
 * candidate reduced to {rowPosition, fieldCount, digest}, sorted by rowPosition. The
 * worksheet name, report type, and declared currency never enter this input -- that
 * exclusion is the whole point of `structure_fingerprint` over the older
 * `schema_fingerprint`.
 */
function computeStructureFingerprint(pkg, manifests) {
  const sheets = manifests
    .slice()
    .sort((left, right) => left.sheet_position - right.sheet_position)
    .map((manifest) => ({
      position: manifest.sheet_position,
      hasFormula: manifest.has_formula,
      hasMergedCells: manifest.has_merged_cells,
      hasRepeatedHeader: manifest.has_repeated_header,
      headerCandidateDigests: (manifest.header_candidate_digests ?? [])
        .map((candidate) => ({
          rowPosition: candidate.rowPosition,
          fieldCount: candidate.fieldCount,
          digest: candidate.digest,
        }))
        .sort((left, right) => left.rowPosition - right.rowPosition),
    }));
  return createReportStructureFingerprint({
    structureVersion: pkg.structure_version,
    outletGrain: "branch",
    parserVersion: pkg.parser_version,
    sheets,
  });
}

/**
 * Every package that is genuinely, doubly approved: an approved contract proposal
 * whose binding is still active, AND an approved projection proposal (against that
 * exact contract version) whose binding is still active. Package status is not
 * consulted -- the addendum is explicit that `awaiting_validation` and
 * `projection_failed` are not disqualifying, only the bindings are. Every join is
 * additionally scoped by organization_id, even though ids are globally unique, so a
 * future change to any one of these tables cannot silently cross a tenant boundary
 * here.
 */
async function fetchQualifyingPackages() {
  return sql`
    select
      p.id as package_id, p.organization_id, p.channel_id, p.report_type,
      p.declared_currency, p.status, p.structure_version, p.parser_version,
      p.original_filename, p.structure_fingerprint as stored_structure_fingerprint,
      cv.id as contract_version_id, cv.provider_definition_key as contract_family_key,
      cd.created_at as contract_decided_at,
      pv.id as projection_version_id, pv.provider_definition_key as projection_family_key,
      pd.created_at as projection_decided_at
    from public.integration_report_packages p
    join public.report_contract_versions cv
      on cv.organization_id = p.organization_id and cv.report_package_id = p.id
    join public.report_contract_bindings cb
      on cb.organization_id = p.organization_id
      and cb.report_contract_version_id = cv.id
      and cb.active
    join public.report_contract_decisions cd
      on cd.organization_id = p.organization_id
      and cd.report_contract_version_id = cv.id
      and cd.decision = 'approved'
    join public.report_projection_versions pv
      on pv.organization_id = p.organization_id
      and pv.report_contract_version_id = cv.id
    join public.report_projection_bindings pb
      on pb.organization_id = p.organization_id
      and pb.report_projection_version_id = pv.id
      and pb.active
    join public.report_projection_decisions pd
      on pd.organization_id = p.organization_id
      and pd.report_projection_version_id = pv.id
      and pd.decision = 'approved'
    order by p.organization_id, p.channel_id, p.created_at
  `;
}

async function fetchManifestsByPackageId(packageIds) {
  if (packageIds.length === 0) return new Map();
  const rows = await sql`
    select report_package_id, sheet_position, has_formula, has_merged_cells,
      has_repeated_header, header_candidate_digests
    from public.integration_report_sheet_manifests
    where report_package_id = any(${packageIds}::uuid[])
    order by report_package_id, sheet_position
  `;
  const byPackage = new Map();
  for (const row of rows) {
    const list = byPackage.get(row.report_package_id) ?? [];
    list.push(row);
    byPackage.set(row.report_package_id, list);
  }
  return byPackage;
}

/**
 * A stable label for a group: organization + channel + structure + currency, which is
 * exactly the tuple `report_structure_admissions`'s active-uniqueness index enforces
 * (`outlet_grain` is always 'branch' today, so it is not needed as a discriminator).
 */
function groupKey(row) {
  return `${row.organization_id}|${row.channel_id}|${row.structureFingerprint}|${row.declared_currency}`;
}

/**
 * Deterministic per-structure idempotency key. Self-describing rather than hashed, so
 * the ledger row it produces (`private.report_structure_admission_write_operations`)
 * is legible by inspection. A re-run with the same qualifying data reproduces the same
 * key, so the RPC's own idempotency check (backed further by the pre-check in
 * `applyGrants` below) makes a second run of this script a no-op.
 */
function idempotencyKeyFor(row) {
  return `backfill-admission:${row.organization_id}:${row.channel_id}:${row.structureFingerprint}:${row.declared_currency}`;
}

function groupPackages(rows) {
  // A package whose *stored* structure_fingerprint is already non-null but
  // disagrees with what its own manifests honestly hash to is not safe ground
  // to grant from: `grant_governed_report_structure_admission` reads
  // `package_row.structure_fingerprint` from the table, not a value this
  // script passes in, so granting from such a package would mint an admission
  // keyed on whatever stale or synthetic value happens to be sitting in that
  // column -- exactly the "drifted copy" identity mismatch the brief warns
  // about, just arrived at a different way. (Caught in practice: a leftover
  // fixture package carried a hand-inserted placeholder fingerprint that was
  // valid hex but corresponded to nothing real; see task-12-report.md.)
  for (const row of rows) {
    row.fingerprintMismatch =
      row.stored_structure_fingerprint !== null &&
      row.stored_structure_fingerprint !== row.structureFingerprint;
  }

  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row);
    const group = groups.get(key);
    if (group) {
      group.members.push(row);
    } else {
      groups.set(key, { members: [row] });
    }
  }
  for (const group of groups.values()) {
    const trustworthy = group.members.filter((member) => !member.fingerprintMismatch);
    group.blocked = trustworthy.length === 0;
    const candidates = group.blocked ? group.members : trustworthy;
    // "Most recently approved" per the brief: the member whose contract decision
    // landed last, with the projection decision as a tiebreaker. In every real
    // group observed so far these agree (the projection for a package is always
    // decided shortly after its contract), but the brief calls out both, so both
    // are compared. Never chosen from a mismatched package unless every member
    // of the group is mismatched, in which case the group is blocked outright
    // (see printReport / applyGrants) and the winner is only ever used for
    // display.
    group.winner = candidates.reduce((latest, candidate) => {
      if (!latest) return candidate;
      if (candidate.contract_decided_at > latest.contract_decided_at) return candidate;
      if (candidate.contract_decided_at < latest.contract_decided_at) return latest;
      return candidate.projection_decided_at > latest.projection_decided_at ? candidate : latest;
    }, null);
    const winner = group.winner;
    group.reportFamilyKey =
      winner.contract_family_key !== null && winner.contract_family_key === winner.projection_family_key
        ? winner.contract_family_key
        : null;
  }
  return [...groups.values()].sort((left, right) => {
    const l = left.winner;
    const r = right.winner;
    return (
      l.organization_id.localeCompare(r.organization_id) ||
      l.channel_id.localeCompare(r.channel_id) ||
      l.structureFingerprint.localeCompare(r.structureFingerprint) ||
      l.declared_currency.localeCompare(r.declared_currency)
    );
  });
}

async function fetchDisplayNames(organizationIds, channelIds) {
  const [organizations, channels] = await Promise.all([
    organizationIds.length
      ? sql`select id, name, slug from public.organizations where id = any(${organizationIds}::uuid[])`
      : Promise.resolve([]),
    channelIds.length
      ? sql`select id, organization_id, display_name from public.organization_channels where id = any(${channelIds}::uuid[])`
      : Promise.resolve([]),
  ]);
  const organizationById = new Map(organizations.map((o) => [o.id, o]));
  const channelById = new Map(channels.map((c) => [c.id, c]));
  return { organizationById, channelById };
}

function printReport(groups, organizationById, channelById) {
  console.log(`\n${groups.length} candidate structure(s) qualify for a standing admission.\n`);
  for (const group of groups) {
    const w = group.winner;
    const organization = organizationById.get(w.organization_id);
    const channel = channelById.get(w.channel_id);
    console.log("----------------------------------------------------------------------");
    console.log(`organization: ${organization?.name ?? "(unknown)"} (${w.organization_id})`);
    console.log(`channel:      ${channel?.display_name ?? "(unknown)"} (${w.channel_id})`);
    console.log(`report type:  ${w.report_type}`);
    console.log(`family:       ${group.reportFamilyKey ?? "(none -- hand-built mapping)"}`);
    console.log(`fingerprint:  ${w.structureFingerprint.slice(0, 12)}... (${w.structureFingerprint})`);
    console.log(`currency:     ${w.declared_currency}`);
    console.log(`packages sharing this structure: ${group.members.length}`);
    for (const member of group.members) {
      const marker = !group.blocked && member === w ? "-> grant from this one" : "";
      const fpState = member.fingerprintMismatch
        ? `fingerprint MISMATCH: stored=${member.stored_structure_fingerprint.slice(0, 12)}... does not match computed=${member.structureFingerprint.slice(0, 12)}...`
        : member.stored_structure_fingerprint
          ? "fingerprint stored, matches computed"
          : "fingerprint NULL, needs backfill";
      console.log(
        `  - ${member.original_filename} (${member.package_id}) status=${member.status} ` +
          `contract_decided=${member.contract_decided_at.toISOString()} [${fpState}] ${marker}`,
      );
    }
    if (group.blocked) {
      console.log(
        "BLOCKED: every package sharing this structure has a stored structure_fingerprint that " +
          "disagrees with what its own manifests hash to. Granting from any of them would key the " +
          "admission on whatever is actually in that column, not the identity this report computed, " +
          "so this group will not be granted until that data is investigated.",
      );
    } else {
      console.log(`idempotency key: ${idempotencyKeyFor(w)}`);
    }
  }
  console.log("----------------------------------------------------------------------\n");
  if (!APPLY) {
    console.log("Nothing was written. Re-run with --apply to grant these admissions.\n");
  }
}

/**
 * Resolves a real owner-or-admin actor for an organization, reusing the same
 * resolution `private.effective_organization_role` already performs in production
 * (organization membership, then account membership) rather than reimplementing role
 * precedence here. Returns null if nobody with `report.contract_approve` exists, which
 * the caller must treat as "cannot grant for this organization" rather than a reason
 * to invent one.
 */
async function resolveActor(organizationId) {
  const candidates = await sql`
    with candidate as (
      select user_id from public.organization_memberships where organization_id = ${organizationId}::uuid
      union
      select am.user_id
      from public.account_memberships am
      join public.organizations o on o.account_id = am.account_id
      where o.id = ${organizationId}::uuid
    )
    select c.user_id, private.effective_organization_role(${organizationId}::uuid, c.user_id) as role
    from candidate c
  `;
  const byRank = { owner: 0, admin: 1 };
  const eligible = candidates
    .filter((row) => row.role === "owner" || row.role === "admin")
    .sort((left, right) => byRank[left.role] - byRank[right.role]);
  return eligible[0]?.user_id ?? null;
}

async function findExistingActiveAdmission(row) {
  const [existing] = await sql`
    select id, report_contract_version_id, report_projection_version_id
    from public.report_structure_admissions
    where organization_id = ${row.organization_id}::uuid
      and channel_id = ${row.channel_id}::uuid
      and structure_fingerprint = ${row.structureFingerprint}
      and declared_currency = ${row.declared_currency}
      and outlet_grain = 'branch'
      and active
  `;
  return existing ?? null;
}

/**
 * Grants one admission, backfilling the winning package's `structure_fingerprint`
 * first if it predates Task 1/2's column (see the file-level notes in this script and
 * `.superpowers/sdd/2026-09-02-governed-report-reuse-phase-1/progress.md`'s "NOTE for
 * Task 12": every one of Nostaza's five existing packages was profiled before that
 * migration and carries a NULL `structure_fingerprint`, and
 * `grant_governed_report_structure_admission` reads that column from the package row
 * -- it does not accept a computed value as a parameter. Without this, `--apply` could
 * never succeed against the exact data this task exists to fix.
 *
 * The backfill only ever moves a NULL column to the value this script itself just
 * recomputed from that package's own stored sheet manifests (never invented, never
 * touched if already set), and happens in the same transaction as the grant so the two
 * either both land or neither does. It is scoped to the one package the RPC will read
 * (`p_report_package_id`), not every sibling package in the group: that is the minimum
 * write needed to make the RPC succeed, and it leaves every other governed field on
 * that row (status, decisions, bindings) exactly as the real human approval left it.
 */
async function grantOne(row, group, actorId) {
  if (row.fingerprintMismatch) {
    // Defense in depth: applyGrants already refuses to reach this point for a
    // blocked group, but this function must never grant from a mismatched
    // package even if a future caller stops checking that first.
    throw new Error(
      `refusing to grant from package ${row.package_id}: its stored structure_fingerprint ` +
        `does not match what its own manifests hash to`,
    );
  }
  const idempotencyKey = idempotencyKeyFor(row);
  const correlationId = randomUUID();
  return sql.begin(async (tx) => {
    const [backfilled] = await tx`
      update public.integration_report_packages
      set structure_fingerprint = ${row.structureFingerprint}
      where organization_id = ${row.organization_id}::uuid
        and id = ${row.package_id}::uuid
        and structure_fingerprint is null
      returning id
    `;
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claim.sub', ${actorId}, true)`;
    const [result] = await tx`
      select public.grant_governed_report_structure_admission(
        ${row.organization_id}::uuid,
        ${actorId}::uuid,
        ${row.package_id}::uuid,
        ${row.contract_version_id}::uuid,
        ${row.projection_version_id}::uuid,
        ${group.reportFamilyKey},
        ${idempotencyKey},
        ${correlationId}::uuid
      ) as admission
    `;
    return { admission: result.admission, backfilledFingerprint: Boolean(backfilled) };
  });
}

async function applyGrants(groups) {
  console.log("Applying grants...\n");
  let granted = 0;
  let alreadyActive = 0;
  let blocked = 0;
  let mismatched = 0;
  for (const group of groups) {
    const w = group.winner;
    const label = `${w.organization_id}/${w.channel_id}/${w.structureFingerprint.slice(0, 12)}`;
    if (group.blocked) {
      console.log(
        `[mismatch] ${label}: every package sharing this structure has a stored ` +
          "structure_fingerprint that disagrees with what its manifests hash to. Not granting.",
      );
      mismatched += 1;
      continue;
    }
    const existing = await findExistingActiveAdmission(w);
    if (
      existing &&
      existing.report_contract_version_id === w.contract_version_id &&
      existing.report_projection_version_id === w.projection_version_id
    ) {
      console.log(`[skip] ${label}: already granted as admission ${existing.id} -- no-op.`);
      alreadyActive += 1;
      continue;
    }
    if (existing) {
      console.log(
        `[note] ${label}: an active admission ${existing.id} already exists for this tuple with a ` +
          "different contract/projection version. Granting will supersede it.",
      );
    }
    const actorId = await resolveActor(w.organization_id);
    if (!actorId) {
      console.log(
        `[blocked] ${label}: no owner or admin membership found for organization ${w.organization_id}; ` +
          "cannot grant without a real actor. Skipping.",
      );
      blocked += 1;
      continue;
    }
    try {
      const { admission, backfilledFingerprint } = await grantOne(w, group, actorId);
      console.log(
        `[granted] ${label}: admission ${admission.id} granted by ${actorId} ` +
          `(package ${w.package_id}${backfilledFingerprint ? ", backfilled its structure_fingerprint" : ""}).`,
      );
      granted += 1;
    } catch (error) {
      console.error(`[error] ${label}: ${redact(error.message ?? error)}`);
      blocked += 1;
    }
  }
  console.log(
    `\nDone: ${granted} granted, ${alreadyActive} already active (no-op), ${blocked} blocked/failed, ` +
      `${mismatched} skipped for a fingerprint mismatch.\n`,
  );
  return blocked === 0 && mismatched === 0;
}

async function main() {
  const qualifying = await fetchQualifyingPackages();
  const packageIds = qualifying.map((row) => row.package_id);
  const manifestsByPackage = await fetchManifestsByPackageId(packageIds);

  const enriched = qualifying.map((row) => ({
    ...row,
    structureFingerprint: computeStructureFingerprint(row, manifestsByPackage.get(row.package_id) ?? []),
  }));

  const groups = groupPackages(enriched);

  const organizationIds = [...new Set(groups.map((g) => g.winner.organization_id))];
  const channelIds = [...new Set(groups.map((g) => g.winner.channel_id))];
  const { organizationById, channelById } = await fetchDisplayNames(organizationIds, channelIds);

  printReport(groups, organizationById, channelById);

  let ok = true;
  if (APPLY) {
    ok = await applyGrants(groups);
  }

  await sql.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (error) => {
  console.error("FAILED:", redact(error.stack ?? error.message ?? error));
  await sql.end({ timeout: 5 });
  process.exit(1);
});
