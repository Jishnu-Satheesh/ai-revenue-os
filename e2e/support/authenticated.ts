import { createClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

/**
 * Authenticated Integration Hub environment.
 *
 * Production sign-in is passwordless, so a browser test cannot type its way in.
 * The fixture instead exchanges seeded credentials for a session through the
 * Supabase Auth API and installs the same cookie `@supabase/ssr` would have
 * written, then lets the real middleware, RLS, and rollout gate do their work.
 *
 * Required environment (all must be present or the authenticated specs skip):
 *
 * - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
 * - `E2E_INTEGRATION_ORGANIZATION_ID` — an organization inside
 *   `INTEGRATION_HUB_V1_ORGANIZATION_IDS` for the server under test
 * - `E2E_OTHER_ORGANIZATION_ID` — an organization the accounts do NOT belong to
 * - `E2E_OPERATOR_EMAIL` / `E2E_OPERATOR_PASSWORD`
 * - `E2E_VIEWER_EMAIL` / `E2E_VIEWER_PASSWORD`
 */
export type IntegrationHubRole = "operator" | "viewer";

export type IntegrationHubEnvironment = {
  supabaseUrl: string;
  publishableKey: string;
  organizationId: string;
  otherOrganizationId: string;
  accounts: Record<IntegrationHubRole, { email: string; password: string }>;
};

function required(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export function readIntegrationHubEnvironment(): IntegrationHubEnvironment | null {
  const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  const organizationId = required("E2E_INTEGRATION_ORGANIZATION_ID");
  const otherOrganizationId = required("E2E_OTHER_ORGANIZATION_ID");
  const operatorEmail = required("E2E_OPERATOR_EMAIL");
  const operatorPassword = required("E2E_OPERATOR_PASSWORD");
  const viewerEmail = required("E2E_VIEWER_EMAIL");
  const viewerPassword = required("E2E_VIEWER_PASSWORD");

  if (
    !supabaseUrl ||
    !publishableKey ||
    !organizationId ||
    !otherOrganizationId ||
    !operatorEmail ||
    !operatorPassword ||
    !viewerEmail ||
    !viewerPassword
  ) {
    return null;
  }

  return {
    supabaseUrl,
    publishableKey,
    organizationId,
    otherOrganizationId,
    accounts: {
      operator: { email: operatorEmail, password: operatorPassword },
      viewer: { email: viewerEmail, password: viewerPassword },
    },
  };
}

export function missingEnvironmentReason(): string {
  return [
    "Authenticated Integration Hub E2E requires a seeded Supabase project.",
    "Set E2E_INTEGRATION_ORGANIZATION_ID, E2E_OTHER_ORGANIZATION_ID, and the",
    "E2E_OPERATOR_*/E2E_VIEWER_* credentials, and add the organization to",
    "INTEGRATION_HUB_V1_ORGANIZATION_IDS for the server under test.",
  ].join(" ");
}

/** `@supabase/ssr` splits an oversized cookie at this width; keep them aligned. */
const MAX_COOKIE_CHUNK = 3180;

function cookieChunks(name: string, value: string): Array<{ name: string; value: string }> {
  if (encodeURIComponent(value).length <= MAX_COOKIE_CHUNK) return [{ name, value }];
  const chunks: Array<{ name: string; value: string }> = [];
  // Chunk on the encoded length so each cookie stays inside the browser limit.
  let remaining = value;
  let index = 0;
  while (remaining.length > 0) {
    let take = remaining.length;
    while (encodeURIComponent(remaining.slice(0, take)).length > MAX_COOKIE_CHUNK) take -= 1;
    chunks.push({ name: `${name}.${index}`, value: remaining.slice(0, take) });
    remaining = remaining.slice(take);
    index += 1;
  }
  return chunks;
}

function storageKey(supabaseUrl: string): string {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

export async function signIn(
  context: BrowserContext,
  environment: IntegrationHubEnvironment,
  role: IntegrationHubRole,
  baseURL: string,
): Promise<void> {
  const supabase = createClient(environment.supabaseUrl, environment.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword(environment.accounts[role]);
  if (error || !data.session) {
    throw new Error(
      `The seeded ${role} account could not sign in: ${error?.message ?? "no session"}`,
    );
  }

  const encoded = `base64-${Buffer.from(JSON.stringify(data.session), "utf8").toString("base64")}`;
  const { hostname } = new URL(baseURL);
  await context.addCookies(
    cookieChunks(storageKey(environment.supabaseUrl), encoded).map((chunk) => ({
      ...chunk,
      domain: hostname,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
}

export function integrationsPath(organizationId: string): string {
  return `/organizations/${organizationId}/integrations`;
}
