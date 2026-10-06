/**
 * The browser is the only caller this module constrains. A cross-origin form
 * POST always carries an Origin header, so an allowlisted echo plus Vary is
 * the whole contract: the preflight passes for the Coming Soon site and fails
 * closed for every other page. Non-browser callers send no Origin and are
 * handled by the route, not here.
 */

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry.length > 0);
}

/** Exact match only — a substring check would admit evil-lunes.in. */
export function resolveAllowedOrigin(
  requestOrigin: string | null,
  allowed: readonly string[],
): string | null {
  if (!requestOrigin) return null;
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

export function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}
