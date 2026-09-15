-- Task 13: record what Instagram actually reports about an organic post.
--
-- The campaign metric vocabulary was written for paid delivery — impressions,
-- clicks, spend — and none of the three survives contact with an organic post.
-- Meta deprecated `impressions` for media created after 2024-07-02, so every
-- post this platform publishes falls on the deprecated side, and clicks and
-- spend simply do not exist for something nobody paid for.
--
-- The decision taken here is to report what Meta reports rather than force its
-- answers into keys that meant something else. A figure shown under a name the
-- provider does not use is worse than no figure.
--
-- Every metric below is a **lifetime running total for one post**. The insights
-- endpoint fixes this: its own reference says the period "is automatically set
-- to `lifetime` in the request and cannot be changed". That is what makes these
-- registrable at all. `20260819110000` deliberately left reach out of the
-- shared vocabulary because unique-people counts cannot be summed across days
-- and the registry had no way to say "do not combine this" — but a lifetime
-- counter is not summed, it is re-read, and `last` says exactly that. Each
-- collection supersedes the previous reading rather than adding to it.
--
-- Diagnostics under ADR 0019, never outcomes. None of these figures is evidence
-- of incremental gross profit, and none may be presented as one.

insert into public.metric_definitions (key, label, owner_scope, value_kind, unit, aggregation)
values
  -- Named for what Meta calls them, so a person reading the platform and a
  -- person reading Instagram see the same word for the same number.
  ('instagram.post_reach', 'Instagram reach (lifetime)', 'core', 'count', null, 'last'),
  ('instagram.post_likes', 'Instagram likes (lifetime)', 'core', 'count', null, 'last'),
  ('instagram.post_comments', 'Instagram comments (lifetime)', 'core', 'count', null, 'last'),
  ('instagram.post_saved', 'Instagram saves (lifetime)', 'core', 'count', null, 'last'),
  ('instagram.post_shares', 'Instagram shares (lifetime)', 'core', 'count', null, 'last'),
  (
    'instagram.post_total_interactions',
    'Instagram total interactions (lifetime)',
    'core', 'count', null, 'last'
  ),
  (
    'instagram.post_profile_visits',
    'Instagram profile visits from this post (lifetime)',
    'core', 'count', null, 'last'
  ),
  (
    'instagram.post_profile_activity',
    'Instagram profile actions from this post (lifetime)',
    'core', 'count', null, 'last'
  ),
  ('instagram.post_reposts', 'Instagram reposts (lifetime)', 'core', 'count', null, 'last')
on conflict do nothing;

-- Deliberately absent, so the next person does not read the gaps as oversights:
--
-- `impressions`  Meta deprecated it for media created after 2024-07-02. Every
--                post this platform publishes is newer than that.
-- `views`        Documented for reels and video, not for a feed image.
-- `total_likes`, `total_comments`
--                Meta's own reference says these "include engagement from
--                promoted/boosted/ad media", while `likes` and `comments` are
--                "organic interaction metrics only". An organic post reports
--                the organic figure; the totals would quietly fold in paid
--                engagement this platform did not buy.
