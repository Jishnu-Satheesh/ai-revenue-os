-- Variant generation needs a durable run record of its own.
--
-- `campaign_generation_runs` already owns the claim, lease, attempt and
-- cancellation lifecycle that every campaign worker needs. Variant generation
-- is another worker with the same needs, so it joins that table rather than
-- growing a parallel one — a second lifecycle would be a second place for a
-- lease to be got wrong.
--
-- The only thing in the way was the kind enum, which predates variants.

alter table public.campaign_generation_runs
  drop constraint campaign_generation_runs_kind_check;

alter table public.campaign_generation_runs
  add constraint campaign_generation_runs_kind_check
    check (kind in ('generate', 'revise', 'variants'));

-- How many variants per direction the run was asked for.
--
-- Stored on the run rather than passed in the task payload, so a retry asks for
-- the same size as the attempt it replaces. A payload-carried number would let
-- a redelivery quietly produce a different amount of creative.
alter table public.campaign_generation_runs
  add column variants_per_direction integer
    check (variants_per_direction is null or variants_per_direction between 1 and 50);

-- Present exactly when the run is a variant run, absent otherwise. A generate
-- run carrying a variant count would mean nobody knows which number is real.
alter table public.campaign_generation_runs
  add constraint campaign_generation_runs_variant_count_matches_kind
    check ((kind = 'variants') = (variants_per_direction is not null));

comment on column public.campaign_generation_runs.variants_per_direction is
  'Variants requested per direction. Set only for kind = variants, so a retry reproduces the size it replaced.';
