-- PostgreSQL CHECK constraints accept UNKNOWN. Make the registered
-- implementation requirement explicit so NULL cannot pass for the two
-- deterministic artifact kinds.

alter table public.artifact_versions
  drop constraint artifact_versions_implementation_key_registered;

alter table public.artifact_versions
  add constraint artifact_versions_implementation_key_registered check (
    (
      artifact_key = 'ranking_weights'
      and implementation_key is not null
      and implementation_key = 'decision.ranking.evidence_value_time_v1'
    )
    or (
      artifact_key = 'confidence_calibration'
      and implementation_key is not null
      and implementation_key = 'decision.confidence.computed_baseline_v1'
    )
    or (
      artifact_key not in ('ranking_weights', 'confidence_calibration')
      and implementation_key is null
    )
  );
