-- Growth Intelligence is readable by every organization member, while
-- confirming market scope and triaging intelligence requires the existing
-- operator boundary. Campaign creation and approval remain separate grants.

insert into public.permissions (key, description, scope) values
  ('growth_intelligence.read', 'Read governed business and market intelligence.', 'organization'),
  ('growth_intelligence.manage', 'Confirm market scope and triage governed intelligence for this organization.', 'organization');

insert into public.organization_role_permissions (organization_role, permission_key) values
  ('viewer', 'growth_intelligence.read'),
  ('operator', 'growth_intelligence.read'),
  ('operator', 'growth_intelligence.manage'),
  ('admin', 'growth_intelligence.read'),
  ('admin', 'growth_intelligence.manage'),
  ('owner', 'growth_intelligence.read'),
  ('owner', 'growth_intelligence.manage');
