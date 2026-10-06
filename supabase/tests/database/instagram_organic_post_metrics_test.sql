begin;

create extension if not exists pgtap with schema extensions;

select extensions.no_plan();

-- Covers `20260915180000_instagram_organic_post_metrics.sql` (Task 13, ADR 0019).
--
-- These definitions exist because the paid vocabulary does not describe an
-- organic post. What the tests care about is that the registry keeps its own
-- promises: every key is shared core vocabulary, every one aggregates as
-- `last` because the provider only ever returns a lifetime total, and the keys
-- Meta documents as unusable or paid-contaminated are absent rather than
-- quietly registered.

select extensions.is(
  (
    select count(*)::int
    from public.metric_definitions
    where key like 'instagram.post_%'
      and organization_id is null
  ),
  9,
  'nine organic post metrics are registered as shared vocabulary'
);

-- `last` is the whole reason these can be registered at all. A lifetime counter
-- summed across readings would multiply one post's reach by how often it was
-- collected.
select extensions.is(
  (
    select count(*)::int
    from public.metric_definitions
    where key like 'instagram.post_%'
      and aggregation <> 'last'
  ),
  0,
  'every organic post metric is re-read rather than combined'
);

select extensions.is(
  (
    select count(*)::int
    from public.metric_definitions
    where key like 'instagram.post_%'
      and (owner_scope <> 'core' or value_kind <> 'count' or is_active is not true)
  ),
  0,
  'every organic post metric is an active core count'
);

select extensions.ok(
  exists (
    select 1 from public.metric_definitions
    where key = 'instagram.post_reach' and organization_id is null
  ),
  'reach is registrable once it is a lifetime total rather than a daily figure'
);

-- Meta deprecated impressions for media created after 2024-07-02, and `views`
-- is a reel metric. Registering either would put a name people trust over a
-- number this platform can never collect for a feed image.
select extensions.is(
  (
    select count(*)::int
    from public.metric_definitions
    where key in ('instagram.post_impressions', 'instagram.post_views')
  ),
  0,
  'no key is registered for a metric Meta will not return for a feed image'
);

-- `total_likes` and `total_comments` fold in promoted and boosted engagement.
-- An organic post must not report a number inflated by advertising nobody
-- bought.
select extensions.is(
  (
    select count(*)::int
    from public.metric_definitions
    where key in ('instagram.post_total_likes', 'instagram.post_total_comments')
  ),
  0,
  'no key mixes paid engagement into an organic post figure'
);

-- The labels are what a person reads beside the number. Every one has to say
-- that it is a running total, or a lifetime figure reads as today's.
select extensions.is(
  (
    select count(*)::int
    from public.metric_definitions
    where key like 'instagram.post_%'
      and label not like '%(lifetime)%'
  ),
  0,
  'every organic post metric says on its face that it is a lifetime total'
);

-- The paid vocabulary is untouched. Organic reporting must not have quietly
-- redefined what an ad's impressions mean.
select extensions.is(
  (
    select aggregation from public.metric_definitions
    where key = 'delivery.impressions' and organization_id is null
  ),
  'sum',
  'the paid delivery vocabulary is left exactly as it was'
);

rollback;
