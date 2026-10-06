-- Member read for memory integration settings.
--
-- The settings row was write-only from the application's perspective: members
-- change it through update_memory_integration_settings, and only workers read
-- it. The organization Settings page shows the current switches to the team,
-- so members need to read their own organization's row. Writes still travel
-- exclusively through the RPC: this grants SELECT and nothing else, and the
-- USING predicate keeps every tenant's row inside its own membership, the
-- same shape as "members read context manifests".

create policy "members read integration settings"
on public.memory_integration_settings for select to authenticated
using (private.is_organization_member(organization_id));

grant select on table public.memory_integration_settings to authenticated;
