// Seeds a disposable verification user + variant + allocation events so the
// campaign studio can be verified in a real browser. Safe to re-run: the RPCs
// no-op on duplicates and the user create is skipped if present.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

const EMAIL = "frontend-verify@example.com";
const PASSWORD = "FrontendVerify!2026";
const ORG = "9f566f3d-61bd-497f-b77e-76a74f9d07c1";
const CAMPAIGN = "783ab4e1-279d-4fba-8dc1-1a33cd3df2e5";
const VERSION = "d5946300-3dbe-4190-9021-eb85ab98b263";
const DIRECTION = "d18f1a23-42e7-4b82-9f33-7d8b5a190003";
const ASSET = "ab97973b-1c5a-4b98-9673-7f2e8bf3fd9b";

const supabase = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function createUser() {
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const body = await res.json();
  if (res.ok && body.id) return body.id;

  if (body.code === "email_exists" || body.error_code === "email_exists") {
    const list = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    }).then((r) => r.json());
    const found = list.users?.find((user) => user.email === EMAIL);
    if (found) return found.id;
  }
  throw new Error(`user create failed: ${JSON.stringify(body)}`);
}

async function signIn() {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign in failed: ${JSON.stringify(body)}`);
  return body;
}

const sql = postgres(DATABASE_URL, { onnotice: () => {} });

try {
  const userId = await createUser();
  console.log("USER:", userId ?? "exists");

  await sql`
    insert into public.organization_memberships (organization_id, user_id, role)
    values (${ORG}, ${userId}, 'operator')
    on conflict (organization_id, user_id) do nothing
  `;

  const existing = await sql`select id from public.campaign_creative_variants
    where organization_id = ${ORG} and campaign_id = ${CAMPAIGN} limit 1`;
  let variantId = existing[0]?.id;
  if (!variantId) {
    const { data: appended, error } = await supabase.rpc("append_campaign_creative_variant", {
      target_organization_id: ORG,
      input_variant: {
        organization_id: ORG,
        bundle_version_id: VERSION,
        direction_key: DIRECTION,
        asset_id: ASSET,
        channel: "instagram",
        placement: "feed_image",
        hook: "Two courses, one price",
        caption: "Lunch that pays for itself, booked in seconds.",
        call_to_action: "Book a table",
        hashtags: ["#lunchdeal"],
        content_hash: "a".repeat(64),
        provenance: {
          kind: "generated",
          modelId: "verify-model-v1",
          promptVersionId: "verify-prompt-v1",
          generationRunId: "00000000-0000-4000-8000-000000000000",
        },
      },
    });
    if (error) throw new Error(`variant append failed: ${error.message}`);
    variantId = appended;
    console.log("VARIANT:", variantId);
  }

  const events = [
    {
      organization_id: ORG,
      campaign_id: CAMPAIGN,
      cycle_id: "a0000000-0000-4000-8000-0000000000a1",
      variant_id: variantId,
      rule_key: "diagnostic.spend_ceiling",
      rule_version: "v1",
      observed_value: 12500,
      threshold: 10000,
      resolved_margin_minor: null,
      resolved_margin_grade: null,
      action: "pause",
      reason_code: "spend_ceiling_exceeded",
      actor: "agent",
      at: "2026-08-19T10:00:00+00",
    },
    {
      organization_id: ORG,
      campaign_id: CAMPAIGN,
      cycle_id: "a0000000-0000-4000-8000-0000000000a1",
      variant_id: variantId,
      rule_key: "diagnostic.ctr_floor",
      rule_version: "v1",
      observed_value: null,
      threshold: null,
      resolved_margin_minor: null,
      resolved_margin_grade: null,
      action: "no_action",
      reason_code: "below_minimum_exposure",
      actor: "agent",
      at: "2026-08-19T10:00:00+00",
    },
    {
      organization_id: ORG,
      campaign_id: CAMPAIGN,
      cycle_id: "a0000000-0000-4000-8000-0000000000a1",
      variant_id: variantId,
      rule_key: "margin.contribution_floor",
      rule_version: "v1",
      observed_value: 4200,
      threshold: 5000,
      resolved_margin_minor: 4200,
      resolved_margin_grade: "measured",
      action: "pause",
      reason_code: "margin_below_floor",
      actor: "agent",
      at: "2026-08-19T10:00:00+00",
    },
  ];

  const existingEvents = await sql`select count(*)::int as n
    from public.campaign_allocation_events
    where organization_id = ${ORG} and cycle_id = 'a0000000-0000-4000-8000-0000000000a1'`;
  if (existingEvents[0].n === 0) {
    for (const event of events) {
      const { error } = await supabase.rpc("append_campaign_allocation_event", {
        target_organization_id: ORG,
        input_event: event,
      });
      if (error) throw new Error(`event append failed: ${error.message}`);
    }
    console.log("EVENTS: appended 3");
  } else {
    console.log("EVENTS: already present");
  }

  // --- Outcome seeding (Task 21) -------------------------------------------------
  // A settled outcome so the Result section renders. This needs a confirmed
  // exposure far enough in the past for the preregistered window and settlement
  // delay to have passed, then a single call to the evidence loop's write RPC.
  const plan = await sql`
    select v.digest, p.primary_metric_key, p.attribution_method,
           p.outcome_window_days, p.settlement_delay_days,
           p.baseline_source, p.baseline_lookback_days
    from public.campaign_bundle_versions v
    join public.campaign_measurement_plans p on p.bundle_version_id = v.id
    where v.organization_id = ${ORG} and v.id = ${VERSION}`;
  if (plan.length === 0) throw new Error("verification campaign has no measurement plan");
  const {
    digest,
    primary_metric_key: primaryMetricKey,
    attribution_method: attributionMethod,
    outcome_window_days: outcomeWindowDays,
    settlement_delay_days: settlementDelayDays,
    baseline_source: baselineSource,
    baseline_lookback_days: baselineLookbackDays,
  } = plan[0];

  const planned = await sql`
    select count(*)::bigint as n from public.campaign_channel_actions
    where organization_id = ${ORG} and bundle_version_id = ${VERSION}`;

  const actionRunId = "b0000000-0000-4000-8000-0000000000c1";
  const actionKey = "c0000000-0000-4000-8000-0000000000aa";
  const publishedAt = new Date(
    Date.now() - (outcomeWindowDays + settlementDelayDays + 4) * 86_400_000,
  ).toISOString();

  await sql`
    insert into public.campaign_action_runs (
      id, organization_id, campaign_id, bundle_version_id, action_key, scheduled_for, status
    ) values (
      ${actionRunId}, ${ORG}, ${CAMPAIGN}, ${VERSION}, ${actionKey}, ${publishedAt}, 'confirmed'
    )
    on conflict (id) do nothing`;

  await sql`
    insert into public.campaign_exposures (
      organization_id, campaign_id, bundle_version_id, action_run_id,
      external_reference, provider_status, published_at, metrics_eligible_at
    ) values (
      ${ORG}, ${CAMPAIGN}, ${VERSION}, ${actionRunId}, 'verify-post-1', 'published',
      ${publishedAt}, ${publishedAt}
    )
    on conflict (organization_id, action_run_id) do nothing`;

  const { error: settleError, data: settled } = await supabase.rpc("settle_campaign_outcome", {
    target_organization_id: ORG,
    input_outcome: {
      organization_id: ORG,
      campaign_id: CAMPAIGN,
      bundle_version_id: VERSION,
      plan_digest: digest,
      verdict: "inconclusive",
      attribution_method: attributionMethod,
      primary_metric_key: primaryMetricKey,
      outcome_window_days: outcomeWindowDays,
      settlement_delay_days: settlementDelayDays,
      planned_exposure_count: Number(planned[0]?.n ?? 0),
      realized_exposure_count: 1,
      guardrail_state: "unmeasured",
      realized_spend_minor: null,
      spend_ceiling_minor: null,
      spend_currency: null,
      estimate_minor: null,
      estimate_low_minor: null,
      estimate_high_minor: null,
      estimate_currency: null,
      evidence_tier: null,
      truncation_causes: [
        {
          variant_id: variantId,
          cause: "guardrail",
          rule_key: "diagnostic.spend_ceiling",
          at: "2026-08-19T10:00:00+00",
        },
      ],
      limitations: [
        `No numeric baseline is recorded (baseline described by source only: ${baselineSource}).`,
        "The preregistered evidence bar was not met.",
      ],
      baseline_source: baselineSource,
      baseline_lookback_days: baselineLookbackDays,
    },
  });
  if (settleError) throw new Error(`outcome settle failed: ${settleError.message}`);
  console.log("OUTCOME:", settled?.outcome ?? "present");

  const session = await signIn();
  console.log("SESSION_OK:", Boolean(session.access_token));
  process.stdout.write(JSON.stringify({ userId, variantId, session }));
  await sql.end();
} catch (error) {
  console.error("SEED_ERROR:", error.message);
  await sql.end().catch(() => {});
  process.exit(1);
}
