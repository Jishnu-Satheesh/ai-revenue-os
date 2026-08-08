-- create_organization_with_owner_v2 inserts the organization row with `returning *`
-- before the owner's membership row exists. Postgres enforces the table's SELECT
-- policy on rows returned via RETURNING, so the creator must be allowed to read
-- their own not-yet-membered organization or the insert fails with
-- "new row violates row-level security policy for table organizations".
drop policy if exists "members can read organizations" on public.organizations;
create policy "members can read organizations"
on public.organizations for select to authenticated
using (
  private.is_organization_member(id)
  or created_by = (select auth.uid())
);
