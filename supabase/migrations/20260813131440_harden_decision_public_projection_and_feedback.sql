-- Forward-only trust-boundary correction for the authenticated opportunity
-- feed and direct RPC feedback inputs.

revoke select on table public.opportunities from authenticated;
grant select (
  id,
  organization_id,
  decision_record_id,
  playbook_version_id,
  title,
  summary,
  evidence_tier,
  impact_low_minor,
  impact_high_minor,
  execution_cost_minor,
  expected_contribution_minor,
  currency,
  time_to_impact_days,
  status,
  expires_at
) on table public.opportunities to authenticated;

create function private.decision_feedback_diff_is_valid(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when value is null then true
    when jsonb_typeof(value) <> 'object' then false
    else
      private.decision_json_has_only(value, array['title', 'summary', 'assumptions'])
      and (
        not (value ? 'title')
        or (
          jsonb_typeof(value -> 'title') = 'string'
          and char_length(value ->> 'title') <= 240
        )
      )
      and (
        not (value ? 'summary')
        or (
          jsonb_typeof(value -> 'summary') = 'string'
          and char_length(value ->> 'summary') <= 4000
        )
      )
      and (
        not (value ? 'assumptions')
        or (
          jsonb_typeof(value -> 'assumptions') = 'array'
          and jsonb_array_length(value -> 'assumptions') <= 50
          and not exists (
            select 1
            from jsonb_array_elements(value -> 'assumptions') assumption
            where jsonb_typeof(assumption) <> 'string'
              or char_length(assumption #>> '{}') > 500
          )
        )
      )
  end;
$$;

revoke all on function private.decision_feedback_diff_is_valid(jsonb) from public, anon, authenticated;

alter table public.decision_feedback
  drop constraint decision_feedback_diff_shape;

alter table public.decision_feedback
  add constraint decision_feedback_diff_shape
  check (private.decision_feedback_diff_is_valid(edit_diff));
