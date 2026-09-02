-- Governed channel records are client-facing configuration and mapping data.
-- The shared safe audit function records only operation/status metadata; raw
-- aliases and other potentially sensitive customer content never enter audit.

create trigger organization_channels_audit
after insert or update on public.organization_channels
for each row execute function private.audit_organization_change();

create trigger organization_channel_branches_audit
after insert or update on public.organization_channel_branches
for each row execute function private.audit_organization_change();

create trigger channel_source_aliases_audit
after insert or update on public.channel_source_aliases
for each row execute function private.audit_organization_change();
