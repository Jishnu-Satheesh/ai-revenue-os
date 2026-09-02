import assert from "node:assert/strict";

import { config } from "dotenv";
import postgres from "postgres";

import { resolvePgTapDatabaseUrl } from "./pgtap-suites.mjs";

config({ path: ".env.local", quiet: true });

const databaseUrl = resolvePgTapDatabaseUrl(process.env.DATABASE_URL);
const admin = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const first = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
const second = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

const ids = {
  user: "a7600000-0000-4000-8000-000000000001",
  account: "a7600000-0000-4000-8000-000000000101",
  organization: "a7600000-0000-4000-8000-000000000201",
  branch: "a7600000-0000-4000-8000-000000000301",
};
const idempotencyKey = "profile-concurrency-ai-0001";
const proposalContext = {
  source: "ai",
  modelProvider: "google",
  modelName: "gemini-profile",
  modelVersion: "market-profile-proposal@1",
  modelInputDigest: "b".repeat(64),
};

function profileDocument(name) {
  return {
    schemaVersion: 1,
    publicIdentity: {
      approvedName: name,
      domains: ["example.com"],
      publicUrls: ["https://example.com/menu"],
    },
    nicheDescriptors: ["Kerala cuisine", "Restaurant"],
    geographies: [
      {
        layer: "city",
        locationRef: "ae:du",
        name: "Dubai",
        countryCode: "AE",
      },
      {
        layer: "country",
        locationRef: "ae",
        name: "United Arab Emirates",
        countryCode: "AE",
      },
      {
        layer: "trade_area",
        locationRef: "ae:du:dubai-marina",
        name: "Dubai Marina delivery area",
        branchId: ids.branch,
        radiusKm: 8,
      },
    ],
    competitors: [],
    topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
    sourcePolicy: {
      excludedDomains: [],
      excludedPublishers: [],
      excludedCompetitorKeys: [],
      allowBoundedQuotes: false,
      maxQuotationCharacters: 0,
    },
    cadence: {
      timeZone: "Asia/Dubai",
      dailyLocalTime: "06:30",
      weeklyDay: "monday",
      weeklyLocalTime: "07:00",
    },
  };
}

async function cleanupFixture() {
  await admin.begin(async (sql) => {
    await sql`set local session_replication_role = replica`;
    await sql`delete from private.growth_intelligence_write_operations where organization_id = ${ids.organization}::uuid`;
    await sql`delete from public.growth_intelligence_requests where organization_id = ${ids.organization}::uuid`;
    await sql`delete from public.organization_market_profile_decisions where organization_id = ${ids.organization}::uuid`;
    await sql`delete from public.organization_market_profile_versions where organization_id = ${ids.organization}::uuid`;
    await sql`delete from public.organization_market_profiles where organization_id = ${ids.organization}::uuid`;
    await sql`delete from public.audit_events where organization_id = ${ids.organization}::uuid`;
    await sql`delete from public.branches where id = ${ids.branch}::uuid`;
    await sql`delete from public.organizations where id = ${ids.organization}::uuid`;
    await sql`delete from public.account_memberships where account_id = ${ids.account}::uuid and user_id = ${ids.user}::uuid`;
    await sql`delete from public.accounts where id = ${ids.account}::uuid`;
    await sql`delete from auth.users where id = ${ids.user}::uuid`;
  });
}

async function createFixture() {
  await cleanupFixture();
  await admin.begin(async (sql) => {
    await sql`insert into auth.users (id) values (${ids.user}::uuid)`;
    await sql`
      insert into public.accounts (id, name, slug, created_by)
      values (${ids.account}::uuid, 'Growth concurrency account', 'growth-concurrency-account', ${ids.user}::uuid)
    `;
    await sql`
      insert into public.organizations (
        id, account_id, name, slug, industry, country_code, base_currency,
        default_timezone, created_by
      ) values (
        ${ids.organization}::uuid, ${ids.account}::uuid, 'Growth concurrency organization',
        'growth-concurrency-organization', 'testing', 'AE', 'AED', 'Asia/Dubai', ${ids.user}::uuid
      )
    `;
    await sql`
      insert into public.account_memberships (
        account_id, user_id, account_role, default_organization_role
      ) values (${ids.account}::uuid, ${ids.user}::uuid, 'owner', 'owner')
    `;
    await sql`
      insert into public.branches (id, organization_id, name, slug, kind, timezone, currency)
      values (
        ${ids.branch}::uuid, ${ids.organization}::uuid, 'Dubai Marina', 'dubai-marina',
        'physical', 'Asia/Dubai', 'AED'
      )
    `;
  });
}

async function beginAuthenticated(sql, applicationName) {
  await sql`select pg_catalog.set_config('application_name', ${applicationName}, false)`;
  await sql.unsafe("begin");
  await sql.unsafe("set local role authenticated");
  await sql`select pg_catalog.set_config('request.jwt.claim.sub', ${ids.user}, true)`;
}

async function digest(document) {
  const [row] = await admin`
    select private.create_market_profile_digest(${admin.json(document)}::jsonb) as digest
  `;
  return row.digest;
}

async function propose(sql, document, documentDigest, correlationId) {
  const [row] = await sql`
    select public.propose_market_profile_version(
      ${ids.organization}::uuid,
      ${ids.user}::uuid,
      ${sql.json(document)}::jsonb,
      ${documentDigest},
      ${sql.json(proposalContext)}::jsonb,
      ${idempotencyKey},
      ${correlationId}::uuid
    ) as outcome
  `;
  return row.outcome;
}

async function waitForSecondWriterToBlock(settled) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (settled())
      throw new Error(
        "The second proposal completed before the first transaction released its lock.",
      );
    const [activity] = await admin`
      select exists (
        select 1 from pg_catalog.pg_stat_activity
        where application_name = 'growth-profile-concurrency-second'
          and state = 'active'
          and wait_event_type = 'Lock'
      ) as blocked
    `;
    if (activity.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The second proposal did not demonstrate an overlapping lock wait.");
}

let firstTransactionOpen = false;
let secondTransactionOpen = false;

try {
  await createFixture();
  const firstDocument = profileDocument("First concurrent candidate");
  const secondDocument = profileDocument("Divergent concurrent candidate");
  const [firstDigest, secondDigest] = await Promise.all([
    digest(firstDocument),
    digest(secondDocument),
  ]);

  await beginAuthenticated(first, "growth-profile-concurrency-first");
  firstTransactionOpen = true;
  const firstOutcome = await propose(
    first,
    firstDocument,
    firstDigest,
    "a7600000-0000-4000-8000-000000000701",
  );

  await beginAuthenticated(second, "growth-profile-concurrency-second");
  secondTransactionOpen = true;
  let secondSettled = false;
  const secondProposal = propose(
    second,
    secondDocument,
    secondDigest,
    "a7600000-0000-4000-8000-000000000702",
  ).finally(() => {
    secondSettled = true;
  });

  await waitForSecondWriterToBlock(() => secondSettled);
  await first.unsafe("commit");
  firstTransactionOpen = false;
  const secondOutcome = await secondProposal;
  await second.unsafe("commit");
  secondTransactionOpen = false;

  assert.equal(firstOutcome.replayed, false);
  assert.equal(secondOutcome.replayed, true);
  assert.equal(secondOutcome.profileVersionId, firstOutcome.profileVersionId);
  assert.equal(secondOutcome.profileDigest, firstOutcome.profileDigest);

  const [counts] = await admin`
    select
      (select pg_catalog.count(*)::integer from public.organization_market_profile_versions
        where organization_id = ${ids.organization}::uuid) as version_count,
      (select pg_catalog.count(*)::integer from private.growth_intelligence_write_operations
        where organization_id = ${ids.organization}::uuid
          and operation_kind = 'propose_profile'
          and idempotency_key = ${idempotencyKey}) as operation_count
  `;
  assert.deepEqual(counts, { version_count: 1, operation_count: 1 });

  console.log("PASS: overlapping AI proposal retries converged on one immutable profile version.");
} catch (error) {
  process.exitCode = 1;
  console.error(
    "FAIL:",
    String(error instanceof Error ? error.message : error).replace(
      /postgres(ql)?:\/\/\S+/g,
      "[redacted]",
    ),
  );
} finally {
  if (firstTransactionOpen) await first.unsafe("rollback").catch(() => undefined);
  if (secondTransactionOpen) await second.unsafe("rollback").catch(() => undefined);
  await cleanupFixture().catch((error) => {
    process.exitCode = 1;
    console.error(
      "FAIL: exact concurrency fixture cleanup failed:",
      error instanceof Error ? error.message : error,
    );
  });
  await Promise.all([admin.end(), first.end(), second.end()]);
}
