-- A submission's digest identifies the submission, not its rows.
--
-- `channel_recommendations` arrived with `unique (analysis_run_id, result_digest)`,
-- read as "one run cannot record two different answers under the same
-- identity". But the narrator files up to six recommendation rows per accepted
-- submission (spec 018 section 11.3, ADR 0037), every one of them carrying the
-- same submission digest -- so the constraint refused the second row of any
-- multi-item filing, and the first honest two-answer submission would have
-- crashed mid-write. The identity the column protects is enforced by the
-- fenced completion RPC instead: an identical replay is answered from what is
-- already stored, and a second, different submission over one analysis run is
-- refused outright. The database keeps a plain index for those digest lookups.

alter table public.channel_recommendations
  drop constraint channel_recommendations_analysis_run_id_result_digest_key;

create index channel_recommendations_submission_digest_idx
  on public.channel_recommendations (analysis_run_id, result_digest);
