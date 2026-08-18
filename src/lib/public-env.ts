/**
 * Public configuration the browser is allowed to read.
 *
 * Deliberately not `@/lib/env`, which is `server-only`. Next.js inlines
 * `process.env.NEXT_PUBLIC_*` into the client bundle at build time, so the
 * expression below must stay written out literally -- a dynamic lookup would
 * compile to `undefined` in the browser.
 */

/**
 * Where this deployment lives, as configured rather than as observed.
 *
 * Every environment points at the same hosted Supabase project, and Supabase
 * checks each `emailRedirectTo` against one allowlist. `window.location.origin`
 * is whatever host the browser happens to be on, which is not always an origin
 * that allowlist knows: `next dev` also serves on the machine's LAN address, so
 * opening the app from a phone yields `http://192.168.1.11:3000` and a sign-in
 * link that cannot come back.
 *
 * Reading it from configuration makes the destination a property of the
 * environment -- localhost in development, the staging domain on staging --
 * instead of a property of how someone happened to open the page.
 *
 * The fallback to the current origin only covers a missing variable, and is
 * chosen over a hardcoded localhost so a misconfigured deployment degrades to
 * today's behavior rather than mailing everyone a link to their own machine.
 */
export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

/**
 * The one destination every magic link must carry.
 *
 * `/auth/callback` is where the code becomes a session; a link pointing anywhere
 * else arrives signed out. `next` is where the caller should land afterwards,
 * and the callback refuses anything that is not a same-origin path.
 */
export function authCallbackUrl(next?: string): string {
  const base = `${appOrigin()}/auth/callback`;
  return next ? `${base}?next=${encodeURIComponent(next)}` : base;
}
