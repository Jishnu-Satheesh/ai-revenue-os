-- Nightly revenue workers read item decisions directly as service_role when
-- composing the shared snapshot: the per-item latest decision names each
-- row's standing. RLS bypass alone is not enough (service_role bypasses RLS
-- but still needs table GRANTs for direct reads), and the decisions table was
-- missed when worker reads were granted, so any organization with decided
-- items fails its nightly read with 42501. Grant SELECT-only: writes stay
-- fenced behind the decide RPC, which keeps its own role check. The
-- per-viewer preference/feedback tables stay ungranted: the worker passes an
-- empty actor and never reads them.
grant select on table public.growth_intelligence_item_decisions to service_role;
