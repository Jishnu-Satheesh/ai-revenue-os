-- Seed the core poster templates.
--
-- `campaign_poster_templates` has existed since 20260826090000 with no rows in
-- it, which meant the render worker was complete and could never produce a
-- poster: every request resolved no template and declined. This is the missing
-- half of that migration's "seed `core` rows only".
--
-- Design constraints these layouts answer to, all of them enforced elsewhere and
-- repeated here so the next person editing a number knows why it is that number:
--
--   * Only `caption` and `footer` may be `required`. `caption` binds to the
--     manifest's hook and `footer` to its call to action, and both always exist
--     on an approved version. `body` has no governed source today -- there is no
--     approved short offer line in the manifest -- so a template requiring it
--     would be permanently unavailable. `extra` is operator-authored and
--     optional by definition.
--   * Every box sits inside the safe area, which the domain schema enforces and
--     a platform would otherwise crop.
--   * Story safe areas keep 250px clear top and bottom. That is where Instagram
--     draws its own chrome -- the profile row and the reply bar -- and text
--     under it is unreadable on a real phone rather than merely tight.
--   * Alignment is `start` or `center`, never left or right. In Arabic, start is
--     the right-hand edge; a template saying `left` would mis-align every Arabic
--     poster while looking entirely deliberate.
--   * `logoSlot` is null on all four. The compositor draws text over a plate and
--     nothing else; declaring a slot nothing draws would describe a capability
--     this release does not have.
--
-- Two templates per placement is the Release 1 number from the approved plan: a
-- real choice for the operator without pretending to a design system.
--
-- Idempotent on `(key, version)`, which is the table's uniqueness rule. A
-- template version is immutable, so a changed layout is a new version and the
-- posters already rendered keep the version that produced them.

insert into public.campaign_poster_templates
  (key, version, placement, canvas_width_px, canvas_height_px, owner_scope, pack_slug, organization_id, state, layout)
values
  ('core_feed_headline', 1, 'feed_image', 1080, 1080, 'core', null, null, 'active', '{"safeArea":{"topPx":64,"rightPx":64,"bottomPx":64,"leftPx":64},"logoSlot":null,"plateCropFocus":"center","textBoxes":[{"slot":"caption","xPx":64,"yPx":96,"widthPx":952,"heightPx":380,"maxLines":3,"minFontSizePx":36,"maxFontSizePx":96,"fontSizeStepPx":4,"lineHeightRatio":1.2,"alignment":"start","required":true},{"slot":"extra","xPx":64,"yPx":500,"widthPx":952,"heightPx":90,"maxLines":1,"minFontSizePx":20,"maxFontSizePx":36,"fontSizeStepPx":2,"lineHeightRatio":1.25,"alignment":"start","required":false},{"slot":"footer","xPx":64,"yPx":830,"widthPx":952,"heightPx":150,"maxLines":2,"minFontSizePx":24,"maxFontSizePx":44,"fontSizeStepPx":2,"lineHeightRatio":1.3,"alignment":"start","required":true}]}'::jsonb)
on conflict (key, version) do nothing;

insert into public.campaign_poster_templates
  (key, version, placement, canvas_width_px, canvas_height_px, owner_scope, pack_slug, organization_id, state, layout)
values
  ('core_feed_centred', 1, 'feed_image', 1080, 1080, 'core', null, null, 'active', '{"safeArea":{"topPx":64,"rightPx":64,"bottomPx":64,"leftPx":64},"logoSlot":null,"plateCropFocus":"center","textBoxes":[{"slot":"caption","xPx":64,"yPx":360,"widthPx":952,"heightPx":300,"maxLines":3,"minFontSizePx":36,"maxFontSizePx":88,"fontSizeStepPx":4,"lineHeightRatio":1.2,"alignment":"center","required":true},{"slot":"footer","xPx":64,"yPx":830,"widthPx":952,"heightPx":150,"maxLines":2,"minFontSizePx":24,"maxFontSizePx":40,"fontSizeStepPx":2,"lineHeightRatio":1.3,"alignment":"center","required":true}]}'::jsonb)
on conflict (key, version) do nothing;

insert into public.campaign_poster_templates
  (key, version, placement, canvas_width_px, canvas_height_px, owner_scope, pack_slug, organization_id, state, layout)
values
  ('core_story_lower', 1, 'image_story', 1080, 1920, 'core', null, null, 'active', '{"safeArea":{"topPx":250,"rightPx":64,"bottomPx":250,"leftPx":64},"logoSlot":null,"plateCropFocus":"center","textBoxes":[{"slot":"extra","xPx":64,"yPx":1010,"widthPx":952,"heightPx":90,"maxLines":1,"minFontSizePx":22,"maxFontSizePx":36,"fontSizeStepPx":2,"lineHeightRatio":1.25,"alignment":"start","required":false},{"slot":"caption","xPx":64,"yPx":1150,"widthPx":952,"heightPx":340,"maxLines":3,"minFontSizePx":40,"maxFontSizePx":96,"fontSizeStepPx":4,"lineHeightRatio":1.2,"alignment":"start","required":true},{"slot":"footer","xPx":64,"yPx":1510,"widthPx":952,"heightPx":150,"maxLines":2,"minFontSizePx":26,"maxFontSizePx":44,"fontSizeStepPx":2,"lineHeightRatio":1.3,"alignment":"start","required":true}]}'::jsonb)
on conflict (key, version) do nothing;

insert into public.campaign_poster_templates
  (key, version, placement, canvas_width_px, canvas_height_px, owner_scope, pack_slug, organization_id, state, layout)
values
  ('core_story_upper', 1, 'image_story', 1080, 1920, 'core', null, null, 'active', '{"safeArea":{"topPx":250,"rightPx":64,"bottomPx":250,"leftPx":64},"logoSlot":null,"plateCropFocus":"center","textBoxes":[{"slot":"caption","xPx":64,"yPx":300,"widthPx":952,"heightPx":340,"maxLines":3,"minFontSizePx":40,"maxFontSizePx":96,"fontSizeStepPx":4,"lineHeightRatio":1.2,"alignment":"start","required":true},{"slot":"footer","xPx":64,"yPx":660,"widthPx":952,"heightPx":150,"maxLines":2,"minFontSizePx":26,"maxFontSizePx":44,"fontSizeStepPx":2,"lineHeightRatio":1.3,"alignment":"start","required":true}]}'::jsonb)
on conflict (key, version) do nothing;
