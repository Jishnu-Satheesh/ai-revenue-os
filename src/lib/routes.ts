const organizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The pathname is the only source of active organization scope. Nothing in the
 * shell stores a selected organization, so every reader derives it here and a
 * route that carries no valid identifier has no scope at all. Sibling routes
 * such as `/organizations/new` deliberately fail this check.
 */
export function organizationIdFromPathname(pathname: string): string | null {
  const [collection, organizationId] = pathname.split("/").filter(Boolean);
  return collection === "organizations" && organizationIdPattern.test(organizationId ?? "")
    ? (organizationId as string)
    : null;
}

export function isOrganizationPath(pathname: string): boolean {
  return organizationIdFromPathname(pathname) !== null;
}

/** The organization's landing surface, and the target of every scope change. */
export function overviewPath(organizationId: string): string {
  return `/organizations/${organizationId}/overview`;
}
