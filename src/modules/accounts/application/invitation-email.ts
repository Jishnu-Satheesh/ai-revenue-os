import "server-only";

/**
 * The invitation message.
 *
 * Written as a string rather than a component: it is one transactional email
 * whose whole job is a sentence and a button, and pulling a rendering library in
 * for that would be more machinery than the message is worth.
 *
 * Email clients strip most CSS, so every style is inline and the layout is a
 * single centred column. The plain-text alternative is not an afterthought --
 * some clients show it, and spam filters read it.
 */

export type InvitationEmailInput = {
  accountName: string;
  inviterName: string | null;
  accountRoleLabel: string;
  organizationRoleLabel: string;
  actionUrl: string;
  /** True when the link signs them in as well, which changes what we promise. */
  isOneClick: boolean;
  expiresAt: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function expiryLabel(expiresAt: string): string {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? "in 7 days"
    : `on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
}

export function invitationEmailSubject(accountName: string): string {
  return `Join ${accountName} on Lunes AI`;
}

/**
 * The invite sender, derived from the inviting account so the recipient sees
 * who it is from. The local part keeps only plain ASCII letters and digits
 * because anything else is rejected or mangled by mail servers; a name with
 * nothing usable in it (for example, a non-Latin script) falls back to the
 * configured default sender instead of producing an invalid address.
 */
const INVITATION_SENDER_DOMAIN = "lunes.in";

export function invitationSenderFrom(accountName: string, fallback: string): string {
  const local = accountName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 64);
  if (!local) return fallback;
  const display = accountName
    .replace(/[<>"\r\n,;]+/g, "")
    .trim()
    .slice(0, 78);
  return `${display || "Lunes AI"} <${local}@${INVITATION_SENDER_DOMAIN}>`;
}

export function invitationEmailHtml(input: InvitationEmailInput): string {
  const inviter = input.inviterName ? escapeHtml(input.inviterName) : "Someone";
  const account = escapeHtml(input.accountName);
  const cta = input.isOneClick ? "Join and sign in" : "Open the invitation";

  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f6f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
    <tr><td style="padding:32px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#71717a;">The Revenue Intelligence</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;">Join ${account}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
        ${inviter} invited you to ${account} on Lunes AI.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;">
        <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#3f3f46;">
          <strong style="color:#18181b;">In the agency:</strong> ${escapeHtml(input.accountRoleLabel)}<br />
          <strong style="color:#18181b;">In each client:</strong> ${escapeHtml(input.organizationRoleLabel)}
        </td></tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#18181b;">
        <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">${cta}</a>
      </td></tr></table>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">
        This invitation is for this email address only and expires ${expiryLabel(input.expiresAt)}.
        If you were not expecting it, you can ignore this message.
      </p>
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#a1a1aa;text-align:center;">
    If the button does not work, paste this into your browser:<br />
    <span style="word-break:break-all;">${escapeHtml(input.actionUrl)}</span>
  </p>
</body></html>`;
}

/**
 * The organization variant: one client, one role, and an invitee who may never
 * have heard of the agency. The agency is deliberately unnamed -- the client
 * is who they are joining, and the sender address already says Lunes AI.
 */
export type OrganizationInvitationEmailInput = {
  organizationName: string;
  inviterName: string | null;
  roleLabel: string;
  actionUrl: string;
  /** True when the link signs them in as well, which changes what we promise. */
  isOneClick: boolean;
  expiresAt: string;
};

export function organizationInvitationEmailSubject(organizationName: string): string {
  return `Join ${organizationName} on Lunes AI`;
}

export function organizationInvitationEmailHtml(input: OrganizationInvitationEmailInput): string {
  const inviter = input.inviterName ? escapeHtml(input.inviterName) : "Someone";
  const organization = escapeHtml(input.organizationName);
  const cta = input.isOneClick ? "Join and sign in" : "Open the invitation";

  return `<!doctype html>
<html lang="en"><body style="margin:0;padding:24px;background:#f6f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
    <tr><td style="padding:32px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#71717a;">The Revenue Intelligence</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;">Join ${organization}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
        ${inviter} invited you to ${organization} on Lunes AI.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;">
        <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;color:#3f3f46;">
          <strong style="color:#18181b;">Your role:</strong> ${escapeHtml(input.roleLabel)}
        </td></tr>
      </table>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#18181b;">
        <a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:500;color:#ffffff;text-decoration:none;">${cta}</a>
      </td></tr></table>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a;">
        This invitation is for this email address only and expires ${expiryLabel(input.expiresAt)}.
        If you were not expecting it, you can ignore this message.
      </p>
    </td></tr>
  </table>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.6;color:#a1a1aa;text-align:center;">
    If the button does not work, paste this into your browser:<br />
    <span style="word-break:break-all;">${escapeHtml(input.actionUrl)}</span>
  </p>
</body></html>`;
}

export function organizationInvitationEmailText(input: OrganizationInvitationEmailInput): string {
  const inviter = input.inviterName ?? "Someone";
  return [
    `${inviter} invited you to ${input.organizationName} on Lunes AI.`,
    "",
    `Your role: ${input.roleLabel}`,
    "",
    input.isOneClick ? "Join and sign in:" : "Open the invitation:",
    input.actionUrl,
    "",
    `This invitation is for this email address only and expires ${expiryLabel(input.expiresAt)}.`,
    "If you were not expecting it, you can ignore this message.",
  ].join("\n");
}

export function invitationEmailText(input: InvitationEmailInput): string {
  const inviter = input.inviterName ?? "Someone";
  return [
    `${inviter} invited you to ${input.accountName} on Lunes AI.`,
    "",
    `In the agency: ${input.accountRoleLabel}`,
    `In each client: ${input.organizationRoleLabel}`,
    "",
    input.isOneClick ? "Join and sign in:" : "Open the invitation:",
    input.actionUrl,
    "",
    `This invitation is for this email address only and expires ${expiryLabel(input.expiresAt)}.`,
    "If you were not expecting it, you can ignore this message.",
  ].join("\n");
}
