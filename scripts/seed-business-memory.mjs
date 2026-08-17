/**
 * Seeds a realistic Business Memory corpus for the Dubai restaurant pilot.
 *
 * The point is not volume for its own sake. An empty or near-empty table makes
 * Postgres sequential-scan regardless of what indexes exist, so retrieval
 * quality and the query plan cannot be judged. This builds a corpus with the
 * shape real usage would produce: mostly episodes from reviews and marketplace
 * syncs, a smaller body of lessons and outcomes, a few documents and notes, and
 * a realistic tail of superseded, expired, and proposed items.
 *
 * Content is grounded in industry-packs/restaurant/dubai-pilot.md and
 * playbooks.md rather than invented, so relevance can actually be assessed by
 * reading the results.
 *
 *   node scripts/seed-business-memory.mjs [--items 1200] [--no-embed] [--reset]
 */

import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const ITEM_TARGET = Number(flag("--items", "1200"));
const EMBED = !args.includes("--no-embed");
const RESET = args.includes("--reset");

const ORGANIZATION_SLUG = flag("--org", "al-noor-kitchen");
const EMBEDDING_MODEL = process.env.MEMORY_EMBEDDING_MODEL ?? "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

const url = (process.env.DATABASE_URL ?? "").replace(":6543", ":5432");
if (!url) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}
const sql = postgres(url, { prepare: false, onnotice: () => {}, max: 4 });

// Deterministic so re-running produces the same corpus and comparisons hold.
let randomState = 20260809;
function random() {
  randomState = (randomState * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return randomState / 4_294_967_296;
}
const pick = (values) => values[Math.floor(random() * values.length)];
const chance = (probability) => random() < probability;

// Filled from the target organization's real branches, topped up to three so
// branch-scoped retrieval and holdout comparisons have something to compare.
let branches = [];
const additionalBranches = [
  { name: "Al Barsha", slug: "al-barsha" },
  { name: "Deira", slug: "deira" },
];

const dishes = [
  "Hyderabadi dum biryani",
  "butter chicken",
  "Malabar parotta",
  "Kerala fish curry",
  "chicken 65",
  "paneer tikka",
  "masala dosa",
  "mutton rogan josh",
  "prawn moilee",
  "gobi manchurian",
  "chicken mandi",
  "ghee roast dosa",
  "haleem",
  "falafel mezze",
  "shawarma platter",
];

const channels = ["Talabat", "noon Food", "Deliveroo", "Careem Quik", "dine-in", "WhatsApp direct"];
const dayparts = ["lunch", "late lunch", "dinner", "post-midnight", "Friday brunch", "iftar"];
const segments = [
  "office workers in JLT",
  "families in Al Barsha",
  "night-shift workers near Deira",
  "students on a budget",
  "Malayali expatriate households",
  "weekend group diners",
];

const positiveReviews = [
  (dish, branch) => `The ${dish} at ${branch} tasted like home. Portion was generous and the packaging held the heat.`,
  (dish, branch) => `Best ${dish} I have had in Dubai. ${branch} staff were patient when we changed the order twice.`,
  (dish, branch) => `Ordered ${dish} for a family of six from ${branch}. Everything arrived hot and correctly labelled.`,
  (dish, branch) => `${branch} nailed the spice level on the ${dish}. Will order again for the office.`,
];

const negativeReviews = [
  (dish, branch) => `${dish} arrived cold from ${branch}. The delivery took fifty minutes for a ten minute distance.`,
  (dish, branch) => `Gravy leaked through the container. The ${dish} was fine but the packaging from ${branch} needs work.`,
  (dish, branch) => `Portion size for the ${dish} has shrunk at ${branch} while the price went up.`,
  (dish, branch) => `Waited forty minutes at ${branch} for a table even with a booking. The ${dish} was good but the wait was not.`,
  (dish, branch) => `Parking near ${branch} is impossible in the evening. We nearly cancelled before collecting the ${dish}.`,
];

const neutralReviews = [
  (dish, branch) => `${dish} was decent. ${branch} is convenient for a quick weekday lunch.`,
  (dish, branch) => `Standard quality at ${branch}. The ${dish} is reliable but not memorable.`,
];

const lessons = [
  (dish, channel) => `Discounting ${dish} below AED 32 on ${channel} pushes contribution margin under the policy floor once commission and packaging are counted. Orders rise but gross profit falls.`,
  (dish, channel) => `Arabic-language creative outperformed English for ${channel} campaigns targeting Deira. The reverse held in JLT.`,
  (channel) => `Late-night discounts on ${channel} were rejected by the client because kitchen staffing after midnight cannot absorb the volume.`,
  (dish) => `Updating the ${dish} photograph improved marketplace listing conversion, but only after about seven days of impressions accumulated.`,
  (channel) => `${channel} commission plus promotion funding makes any offer deeper than fifteen percent unprofitable on mid-priced mains.`,
  (dish) => `Customers who first ordered ${dish} showed materially higher repeat rates than those who first ordered a discounted combo.`,
];

const decisions = [
  (dish, channel, branch) => `Approved a controlled listing refresh for ${dish} on ${channel} at ${branch}: new photography, rewritten description, and corrected category placement. Holdout kept on the other two branches.`,
  (channel, branch) => `Declined a marketplace-funded discount campaign on ${channel} for ${branch}. Projected contribution margin was below the agreed floor even at optimistic volume.`,
  (dish, branch) => `Approved raising the ${dish} price at ${branch} by AED 3 after cost verification, with a four-week measurement window.`,
];

const outcomeTemplates = [
  (dish, channel) => ({
    title: `Listing refresh outcome for ${dish} on ${channel}`,
    body: `Measured over a 28 day attribution window against the pre-change baseline. Item-level orders and contribution margin both moved; the holdout branches did not.`,
  }),
  (dish, channel) => ({
    title: `Win-back campaign outcome for lapsed ${channel} customers`,
    body: `Consented lapsed customers segmented by recency and margin, measured over a 30 day window against a randomised holdout.`,
  }),
];

const notes = [
  (branch) => `Client owner prefers to approve anything touching pricing at ${branch} personally, by WhatsApp, before it goes live.`,
  () => `The client will not run any campaign that implies a health or medical claim. Confirmed twice with the owner.`,
  (branch) => `Kitchen at ${branch} closes hot preparation thirty minutes before the listed closing time. Marketplace hours should reflect that.`,
  () => `Owner asked that we never use the word "cheap" in any Arabic or English creative. Prefers "value".`,
  (segment) => `The owner believes ${segment} are the most valuable segment. We have not yet confirmed this against order data.`,
];

const documents = [
  () => ({
    title: "Brand tone and prohibited claims",
    body: `Warm, family-oriented, never boastful. Prohibited: health claims, medical claims, "authentic" without provenance, and any comparison naming a competitor. Arabic copy is reviewed by the client before publication.`,
  }),
  () => ({
    title: "Allergen and dietary labelling policy",
    body: `Every listing must declare nuts, dairy, gluten, and shellfish. Vegetarian and vegan flags are set per item and verified against the kitchen sheet each menu version.`,
  }),
  () => ({
    title: "Packaging specification for delivery channels",
    body: `Gravy items use sealed containers with a leak collar. Parotta and dosa ship in vented boxes. Packaging cost is counted in contribution margin for every delivery order.`,
  }),
];

const factProposalKeys = [
  ["google_business_profile.location.hours", { friday: "13:00-01:00" }],
  ["google_business_profile.location.primary_category", { category: "Indian restaurant" }],
  ["google_business_profile.location.phone", { phone: "+971 4 000 0000" }],
];

const businessFacts = [
  ["menu.biryani.contribution_margin_pct", { value: 41.2, currency: "AED" }, "verified", "user"],
  ["menu.butter_chicken.contribution_margin_pct", { value: 38.6, currency: "AED" }, "verified", "user"],
  ["menu.parotta.food_cost_aed", { value: 2.4, currency: "AED" }, "imported", "pos_export"],
  ["operations.kitchen.capacity_orders_per_hour", { dinner: 46, lunch: 32 }, "verified", "user"],
  ["operations.hours.al_barsha", { weekday: "11:00-23:30", weekend: "11:00-01:00" }, "verified", "user"],
  ["operations.hours.deira", { weekday: "12:00-00:00", weekend: "12:00-02:00" }, "imported", "google_business_profile"],
  ["marketplace.talabat.commission_pct", { value: 25 }, "imported", "marketplace_export"],
  ["marketplace.noon.commission_pct", { value: 22 }, "imported", "marketplace_export"],
  ["policy.minimum_contribution_margin_pct", { value: 30 }, "verified", "user"],
  ["delivery.radius_km.jlt", { value: 6 }, "imported", "marketplace_export"],
  ["customers.repeat_rate_pct", { value: 18.4 }, "inferred", "model"],
  ["customers.average_order_value_aed", { value: 74.5, currency: "AED" }, "imported", "pos_export"],
  ["marketing.tracked_conversions_available", { value: false }, "verified", "user"],
  ["menu.spice_level_default", { level: "medium" }, "stale", "user"],
];


/**
 * A deterministic hashed bag-of-words embedding, used only when no embedding
 * provider is configured.
 *
 * This is NOT a semantic model. Shared vocabulary produces genuine cosine
 * similarity, which is enough to exercise the HNSW index, verify the query
 * plan, and sanity-check the hybrid merge. It is not enough to judge semantic
 * retrieval quality, and rows written this way are labelled with a model name
 * that makes that obvious.
 */
const LOCAL_EMBEDDING_MODEL = "local-hashed-bow-v1";

function localEmbedding(text) {
  const vector = new Float64Array(EMBEDDING_DIMENSIONS);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

  for (const token of tokens) {
    // Two independent hashes per token spread the signal and reduce collisions.
    let hashA = 2_166_136_261;
    let hashB = 5_381;
    for (let index = 0; index < token.length; index += 1) {
      hashA = Math.imul(hashA ^ token.charCodeAt(index), 16_777_619) >>> 0;
      hashB = ((hashB << 5) + hashB + token.charCodeAt(index)) >>> 0;
    }
    vector[hashA % EMBEDDING_DIMENSIONS] += 1;
    vector[hashB % EMBEDDING_DIMENSIONS] += 0.5;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vector, (value) => Number((value / norm).toFixed(6)));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function buildCorpus(target) {
  const items = [];
  const push = (item) => items.push(item);

  for (const [key, value, status, source] of businessFacts) {
    // Facts are seeded separately; kept here only to keep the two in one place.
    void key;
    void value;
    void status;
    void source;
  }

  // Documents and operator notes: small, high-trust body of context.
  for (const build of documents) {
    const document = build();
    push({
      memory_type: "document",
      title: document.title,
      body: document.body,
      origin: "system_generated",
      verification_state: "verified",
      sensitivity: "internal",
      observed_at: isoDaysAgo(120),
    });
  }

  for (let index = 0; index < 24; index += 1) {
    const branch = pick(branches);
    const build = pick(notes);
    push({
      memory_type: "note",
      title: `Client preference note (${branch.name})`,
      body: build(branch.name, pick(segments)),
      branch_id: branch.id,
      origin: "user_verified",
      verification_state: chance(0.8) ? "verified" : "unverified",
      sensitivity: chance(0.15) ? "confidential" : "internal",
      observed_at: isoDaysAgo(Math.floor(random() * 180)),
    });
  }

  // Lessons: the agency's compounding knowledge. Mixed verification, because
  // some are confirmed with the client and some are still the model's read.
  for (let index = 0; index < 90; index += 1) {
    const build = pick(lessons);
    const dish = pick(dishes);
    const channel = pick(channels);
    const modelAuthored = chance(0.45);
    push({
      memory_type: "lesson",
      title: `Lesson: ${dish} on ${channel}`,
      body: build(dish, channel),
      origin: modelAuthored ? "outcome_learned" : "user_verified",
      verification_state: modelAuthored ? (chance(0.5) ? "unverified" : "verified") : "verified",
      confidence: modelAuthored ? Number((0.5 + random() * 0.45).toFixed(2)) : null,
      sensitivity: "internal",
      observed_at: isoDaysAgo(Math.floor(random() * 240)),
      review_due_at: chance(0.25) ? isoDaysAgo(Math.floor(random() * 30) - 15) : null,
    });
  }

  // Decisions and their measured outcomes.
  for (let index = 0; index < 60; index += 1) {
    const branch = pick(branches);
    const dish = pick(dishes);
    const channel = pick(channels);
    const build = pick(decisions);
    push({
      memory_type: "decision",
      title: `Decision: ${dish} on ${channel} (${branch.name})`,
      body: build(dish, channel, branch.name),
      branch_id: branch.id,
      origin: "user_verified",
      verification_state: "verified",
      sensitivity: "internal",
      observed_at: isoDaysAgo(Math.floor(random() * 200)),
    });
  }

  for (let index = 0; index < 45; index += 1) {
    const dish = pick(dishes);
    const channel = pick(channels);
    const branch = pick(branches);
    const outcome = pick(outcomeTemplates)(dish, channel);
    const baseline = Math.round(80 + random() * 200);
    const measured = Math.round(baseline * (0.85 + random() * 0.5));
    push({
      memory_type: "outcome",
      title: outcome.title,
      body: outcome.body,
      branch_id: branch.id,
      origin: "outcome_learned",
      verification_state: chance(0.6) ? "verified" : "unverified",
      confidence: Number((0.55 + random() * 0.4).toFixed(2)),
      sensitivity: "internal",
      // AGENTS.md forbids claiming impact without baseline, method, and window.
      structured_value: {
        baseline,
        measured,
        unit: "orders",
        currency: "AED",
        attributionWindowDays: 28,
        method: "pre/post against untouched branch holdout",
      },
      observed_at: isoDaysAgo(Math.floor(random() * 150)),
    });
  }

  // Episodes are the bulk, as they would be in real use: review records and
  // marketplace sync observations.
  let sequence = 0;
  while (items.length < target) {
    const branch = pick(branches);
    const dish = pick(dishes);
    const channel = pick(channels);
    const roll = random();

    if (roll < 0.55) {
      const sentiment = roll < 0.28 ? "positive" : roll < 0.45 ? "negative" : "neutral";
      const build =
        sentiment === "positive"
          ? pick(positiveReviews)
          : sentiment === "negative"
            ? pick(negativeReviews)
            : pick(neutralReviews);
      sequence += 1;
      push({
        memory_type: "episode",
        title: `Google review (${branch.name}, ${sentiment})`,
        body: build(dish, branch.name),
        branch_id: branch.id,
        origin: "provider_imported",
        verification_state: "unverified",
        // Reviewer identity is stripped; only the opaque record id remains.
        sensitivity: "customer_content",
        source_system: "google_business_profile",
        source_record_id: `reviews/seed-${branch.slug}-${sequence}`,
        observed_at: isoDaysAgo(Math.floor(random() * 210)),
        review_due_at: chance(0.3) ? isoDaysAgo(Math.floor(random() * 40) - 20) : null,
      });
    } else if (roll < 0.8) {
      sequence += 1;
      push({
        memory_type: "episode",
        title: `${channel} listing snapshot for ${dish} (${branch.name})`,
        body: `Observed ${dish} listed on ${channel} at ${branch.name} during ${pick(dayparts)}. Availability, price, and category placement recorded for the listing conversion audit.`,
        branch_id: branch.id,
        origin: "provider_imported",
        verification_state: "unverified",
        sensitivity: "internal",
        source_system: "marketplace_export",
        source_record_id: `listing/seed-${branch.slug}-${sequence}`,
        observed_at: isoDaysAgo(Math.floor(random() * 210)),
      });
    } else if (roll < 0.9) {
      sequence += 1;
      push({
        memory_type: "episode",
        title: `Daypart demand observation (${branch.name}, ${pick(dayparts)})`,
        body: `Order volume for ${dish} concentrated around ${pick(dayparts)} at ${branch.name}, drawn mainly from ${pick(segments)}.`,
        branch_id: branch.id,
        origin: "system_generated",
        verification_state: "unverified",
        sensitivity: "internal",
        source_system: "pos_export",
        source_record_id: `daypart/seed-${branch.slug}-${sequence}`,
        observed_at: isoDaysAgo(Math.floor(random() * 210)),
      });
    } else {
      // Proposals awaiting review, plus a few model-proposed lessons.
      const [factKey, factValue] = pick(factProposalKeys);
      if (chance(0.5)) {
        push({
          memory_type: "fact_proposal",
          title: `Proposed change to ${factKey}`,
          body: `Google Business Profile reports a value for ${branch.name} that differs from the digital twin. Awaiting operator confirmation.`,
          branch_id: branch.id,
          origin: "provider_imported",
          verification_state: "proposed",
          sensitivity: "internal",
          proposed_fact_key: factKey,
          proposed_fact_value: factValue,
          proposed_branch_id: branch.id,
          observed_at: isoDaysAgo(Math.floor(random() * 20)),
        });
      } else {
        push({
          memory_type: "lesson",
          title: `Proposed lesson: ${dish} demand on ${channel}`,
          body: `${dish} appears to convert better on ${channel} during ${pick(dayparts)} among ${pick(segments)}. Not yet confirmed against order data.`,
          origin: "ai_proposed",
          verification_state: "proposed",
          confidence: Number((0.4 + random() * 0.4).toFixed(2)),
          sensitivity: "internal",
          observed_at: isoDaysAgo(Math.floor(random() * 20)),
        });
      }
    }
  }

  // A realistic tail: some knowledge has lapsed, some has been corrected.
  for (let index = 0; index < 30; index += 1) {
    const dish = pick(dishes);
    push({
      memory_type: "note",
      title: `Expired seasonal note: ${dish} Ramadan iftar set`,
      body: `The ${dish} iftar set was listed for Ramadan only. Pricing and availability no longer apply.`,
      origin: "user_verified",
      verification_state: "verified",
      sensitivity: "internal",
      observed_at: isoDaysAgo(300),
      expires_at: isoDaysAgo(60),
    });
  }

  return items;
}

async function main() {
  const started = Date.now();

  const [organization] = await sql`
    select id, name from public.organizations where slug = ${ORGANIZATION_SLUG}
  `;
  if (!organization) {
    throw new Error(`no organization with slug "${ORGANIZATION_SLUG}"`);
  }
  const ORGANIZATION_ID = organization.id;

  const [owner] = await sql`
    select user_id from public.organization_memberships
    where organization_id = ${ORGANIZATION_ID}::uuid and role = 'owner'
    limit 1
  `;
  const ACTOR_ID = owner?.user_id ?? null;
  console.log(`seeding into "${organization.name}" (${ORGANIZATION_ID})`);

  branches = await sql`
    select id, name, slug from public.branches
    where organization_id = ${ORGANIZATION_ID}::uuid order by created_at
  `;
  for (const candidate of additionalBranches) {
    if (branches.length >= 3) break;
    if (branches.some((branch) => branch.slug === candidate.slug)) continue;
    const [created] = await sql`
      insert into public.branches (organization_id, name, slug, timezone, currency)
      values (${ORGANIZATION_ID}::uuid, ${candidate.name}, ${candidate.slug}, 'Asia/Dubai', 'AED')
      returning id, name, slug
    `;
    branches = [...branches, created];
  }
  console.log(`branches: ${branches.map((branch) => branch.name).join(", ")}`);

  if (RESET) {
    await sql`delete from public.memory_links where organization_id = ${ORGANIZATION_ID}::uuid`;
    await sql`delete from public.memory_retrieval_log where organization_id = ${ORGANIZATION_ID}::uuid`;
    // Both columns must clear together: the schema enforces that a supersession
    // pointer and its timestamp are either both present or both absent.
    await sql`
      update public.memory_items
      set superseded_by_id = null, superseded_at = null, supersession_reason = null
      where organization_id = ${ORGANIZATION_ID}::uuid
    `;
    await sql`delete from public.memory_items where organization_id = ${ORGANIZATION_ID}::uuid`;
    await sql`delete from public.business_facts where organization_id = ${ORGANIZATION_ID}::uuid`;
    console.log("reset existing corpus");
  }

  for (const [factKey, value, status, source] of businessFacts) {
    await sql`
      insert into public.business_facts (
        organization_id, fact_key, value, source, status, confidence, last_verified_at
      )
      values (
        ${ORGANIZATION_ID}::uuid, ${factKey}, ${sql.json(value)}, ${source}, ${status},
        ${status === "inferred" ? 0.62 : null},
        ${status === "verified" ? new Date().toISOString() : null}
      )
      on conflict do nothing
    `;
  }
  console.log(`seeded ${businessFacts.length} business facts`);

  const corpus = buildCorpus(ITEM_TARGET);
  const inserted = [];
  const batchSize = 200;

  for (let offset = 0; offset < corpus.length; offset += batchSize) {
    const batch = corpus.slice(offset, offset + batchSize);
    const rows = await sql`
      insert into public.memory_items ${sql(
        batch.map((item) => ({
          organization_id: ORGANIZATION_ID,
          branch_id: item.branch_id ?? null,
          memory_type: item.memory_type,
          title: item.title,
          body: item.body ?? null,
          structured_value: item.structured_value ? sql.json(item.structured_value) : null,
          origin: item.origin,
          verification_state: item.verification_state,
          confidence: item.confidence ?? null,
          sensitivity: item.sensitivity,
          observed_at: item.observed_at ?? null,
          review_due_at: item.review_due_at ?? null,
          expires_at: item.expires_at ?? null,
          source_system: item.source_system ?? null,
          source_record_id: item.source_record_id ?? null,
          proposed_fact_key: item.proposed_fact_key ?? null,
          proposed_fact_value: item.proposed_fact_value
            ? sql.json(item.proposed_fact_value)
            : null,
          proposed_branch_id: item.proposed_branch_id ?? null,
          verified_by: item.verification_state === "verified" ? ACTOR_ID : null,
          verified_at: item.verification_state === "verified" ? new Date().toISOString() : null,
        })),
      )}
      returning id, title, body, memory_type
    `;
    inserted.push(...rows);
    process.stdout.write(`\rinserted ${inserted.length}/${corpus.length}`);
  }
  console.log(`\ninserted ${inserted.length} memory items`);

  // A correction chain, so superseded exclusion has something real to exclude.
  const supersedable = inserted.filter((row) => row.memory_type === "lesson").slice(0, 12);
  for (let index = 0; index + 1 < supersedable.length; index += 2) {
    await sql`
      update public.memory_items
      set superseded_by_id = ${supersedable[index + 1].id}::uuid,
          superseded_at = now(),
          supersession_reason = 'Corrected after margin verification against the POS export.',
          embedding_status = 'skipped'
      where organization_id = ${ORGANIZATION_ID}::uuid and id = ${supersedable[index].id}::uuid
    `;
  }
  console.log(`superseded ${Math.floor(supersedable.length / 2)} lessons`);

  if (EMBED) {
    const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey) {
      const pending = await sql`
        select id, title, body
        from public.memory_items
        where organization_id = ${ORGANIZATION_ID}::uuid and embedding_status = 'pending'
      `;
      console.log(
        `OPENAI_API_KEY is not set; writing ${pending.length} local hashed embeddings instead.`,
      );
      console.log("These exercise the vector index but say nothing about semantic quality.");
      const localBatch = 250;
      for (let offset = 0; offset < pending.length; offset += localBatch) {
        const batch = pending.slice(offset, offset + localBatch);
        const ids = batch.map((row) => row.id);
        const vectors = batch.map((row) =>
          `[${localEmbedding([row.title, row.body ?? ""].join(" ")).join(",")}]`,
        );
        await sql`
          update public.memory_items as item
          set embedding = source.embedding::extensions.vector(1536),
              embedding_model = ${LOCAL_EMBEDDING_MODEL},
              embedding_status = 'ready',
              embedding_updated_at = now()
          from (
            select unnest(${ids}::uuid[]) as id, unnest(${vectors}::text[]) as embedding
          ) as source
          where item.organization_id = ${ORGANIZATION_ID}::uuid and item.id = source.id
        `;
        process.stdout.write(`\rembedded ${Math.min(offset + localBatch, pending.length)}/${pending.length}`);
      }
      console.log("");
    } else {
      const pending = await sql`
        select id, title, body
        from public.memory_items
        where organization_id = ${ORGANIZATION_ID}::uuid
          and embedding_status = 'pending'
      `;
      console.log(`embedding ${pending.length} items with ${EMBEDDING_MODEL}`);
      const embedBatch = 128;
      let done = 0;
      for (let offset = 0; offset < pending.length; offset += embedBatch) {
        const batch = pending.slice(offset, offset + embedBatch);
        const texts = batch.map((row) =>
          [row.title, row.body ?? ""].join("\n\n").slice(0, 8_000).trim(),
        );
        const response = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: texts,
            dimensions: EMBEDDING_DIMENSIONS,
          }),
        });
        if (!response.ok) {
          console.error(`\nembedding request failed with status ${response.status}`);
          break;
        }
        const payload = await response.json();
        const ordered = [...payload.data].sort((left, right) => left.index - right.index);
        const ids = [];
        const vectors = [];
        for (let index = 0; index < batch.length; index += 1) {
          const vector = ordered[index].embedding;
          if (vector.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(`unexpected embedding width ${vector.length}`);
          }
          ids.push(batch[index].id);
          vectors.push(`[${vector.join(",")}]`);
        }
        // One statement per batch. A round trip per row would dominate the run.
        await sql`
          update public.memory_items as item
          set embedding = source.embedding::extensions.vector(1536),
              embedding_model = ${EMBEDDING_MODEL},
              embedding_status = 'ready',
              embedding_updated_at = now()
          from (
            select unnest(${ids}::uuid[]) as id, unnest(${vectors}::text[]) as embedding
          ) as source
          where item.organization_id = ${ORGANIZATION_ID}::uuid and item.id = source.id
        `;
        done += batch.length;
        process.stdout.write(`\rembedded ${done}/${pending.length}`);
      }
      console.log("");
    }
  }

  await sql`analyze public.memory_items`;

  const [summary] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where embedding_status = 'ready')::int as embedded,
      count(*) filter (where verification_state = 'proposed')::int as proposed,
      count(*) filter (where superseded_by_id is not null)::int as superseded,
      count(*) filter (where expires_at < now())::int as expired,
      count(*) filter (where sensitivity = 'customer_content')::int as customer_content
    from public.memory_items
    where organization_id = ${ORGANIZATION_ID}::uuid
  `;

  console.log("\ncorpus:", summary);
  console.log(`organization: ${ORGANIZATION_ID}`);
  console.log(`took ${Math.round((Date.now() - started) / 1000)}s`);

  await sql.end();
}

main().catch(async (error) => {
  console.error("seed failed:", String(error.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, "[redacted]"));
  await sql.end();
  process.exit(1);
});
