/**
 * The campaign mutations the Studio can perform, as plain functions.
 *
 * None of them throws. Every one returns either the server's answer or the
 * message the operator should read, because each of these failures is
 * something a person has to act on — reload a stale tab, ask for a role, fix a
 * prompt — rather than an exception to bubble into an error boundary.
 *
 * Every call names the exact version and digest it was written against. That
 * is what stops an operator working in a tab left open since yesterday from
 * revising or approving a version they never actually read.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export type RevisionScope =
  | { kind: "bundle" }
  | { kind: "direction"; directionId: string }
  | { kind: "copy"; directionId: string }
  | { kind: "hashtags"; directionId: string }
  | { kind: "schedule" }
  | { kind: "generation_profile" };

const GENERIC_FAILURE =
  "That did not go through. Try again, or reload if the campaign has moved on.";

async function post<T>(url: string, body: unknown): Promise<ActionResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "The request could not be sent. Check your connection." };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A body that is not JSON is not something to show a person verbatim.
  }

  if (!response.ok) {
    const message = (payload as { error?: { message?: string } } | null)?.error?.message;
    return { ok: false, message: message ?? GENERIC_FAILURE };
  }

  return { ok: true, data: payload as T };
}

/** A fresh key per attempt, so a retry after a failure is a new request. */
export function idempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function requestRevision(input: {
  organizationId: string;
  campaignId: string;
  baseVersionId: string;
  baseDigest: string;
  prompt: string;
  scope: RevisionScope;
  idempotencyKey: string;
}): Promise<ActionResult<{ runId: string; replayed: boolean }>> {
  const { organizationId, campaignId, ...body } = input;
  return post(`/api/organizations/${organizationId}/campaigns/${campaignId}/revisions`, body);
}

/**
 * Saves an operator's own words directly, with no model involved.
 *
 * Separate from `requestRevision` because the outcomes differ: this returns a
 * version that now exists, while a revision returns a run that may produce one.
 */
export function saveOperatorEdit(input: {
  organizationId: string;
  campaignId: string;
  baseVersionId: string;
  baseDigest: string;
  edit: {
    directionId: string;
    copyIndex: number;
    hook: string;
    caption: string;
    callToAction: string;
    timingRationale: string;
    hashtagSetIndex: number | null;
    tags: readonly string[] | null;
  };
}): Promise<ActionResult<{ bundleVersionId: string; version: number; digest: string }>> {
  const { organizationId, campaignId, edit, ...rest } = input;
  return post(`/api/organizations/${organizationId}/campaigns/${campaignId}/edits`, {
    ...rest,
    edit: { ...edit, tags: edit.tags === null ? null : [...edit.tags] },
  });
}

export function attestVersion(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  bundleDigest: string;
  statement: string;
}): Promise<ActionResult<{ attestationId: string }>> {
  const { organizationId, campaignId, ...body } = input;
  return post(`/api/organizations/${organizationId}/campaigns/${campaignId}/attest`, body);
}

export function approveVersion(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  bundleDigest: string;
  attestationId: string;
  expiresAt: string;
  actionKeys: readonly string[];
}): Promise<ActionResult<{ approvalId: string }>> {
  const { organizationId, campaignId, ...body } = input;
  return post(`/api/organizations/${organizationId}/campaigns/${campaignId}/approve`, {
    ...body,
    actionKeys: [...body.actionKeys],
  });
}

/**
 * Attestation then approval, in that order, as two separate records.
 *
 * They are not merged into one call because they are two different claims: a
 * person states the artwork is truthful, and then a person authorizes
 * execution. Keeping them separate means the attestation survives as its own
 * evidence even if approval is later revoked.
 *
 * If attestation fails, approval is never attempted — approving without one
 * would be exactly the shortcut the attestation exists to prevent.
 */
export async function attestAndApprove(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  bundleDigest: string;
  statement: string;
  expiresAt: string;
  actionKeys: readonly string[];
}): Promise<ActionResult<{ approvalId: string }>> {
  // Each request carries only its own fields. Both endpoints validate against
  // a strict schema, so forwarding this whole object would send `expiresAt`
  // and `actionKeys` to the attestation endpoint and be refused for unknown
  // keys — a rejection that reads like a digest problem and is not one.
  const attestation = await attestVersion({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    bundleVersionId: input.bundleVersionId,
    bundleDigest: input.bundleDigest,
    statement: input.statement,
  });
  if (!attestation.ok) return attestation;

  return approveVersion({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    bundleVersionId: input.bundleVersionId,
    bundleDigest: input.bundleDigest,
    attestationId: attestation.data.attestationId,
    expiresAt: input.expiresAt,
    actionKeys: input.actionKeys,
  });
}
