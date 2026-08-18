"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, CircleAlert, Mail, ShieldCheck, UserCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/browser";
import { authCallbackUrl } from "@/lib/public-env";
import type { InvitationPreview } from "@/domain/access/invitations";
import type { AccountRole, OrganizationRole } from "@/domain/organizations/types";

const accountRoleLabels: Readonly<Record<AccountRole, string>> = {
  owner: "Owner — full control of the agency",
  admin: "Admin — can invite people and add clients",
  member: "Member — a seat in the agency",
};

const organizationRoleLabels: Readonly<Record<OrganizationRole, string>> = {
  owner: "Owner in every client",
  admin: "Admin in every client — settings, integrations, approvals",
  operator: "Operator in every client — day-to-day work, no approvals",
  viewer: "Viewer in every client — read only",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
            <UserCheck />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Revenue Intelligence
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Four states, and the page never guesses between them.
 *
 * The one that matters most is the mismatch: an invitation is bound to an email
 * address, so a link forwarded to the wrong person must say so plainly rather
 * than quietly admitting whoever clicked it.
 */
export function AcceptInvitation({
  token,
  preview,
}: {
  token: string;
  preview: InvitationPreview;
}) {
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  const join = useCallback(async () => {
    setIsJoining(true);
    setError(null);
    const response = await fetch(`/api/invitations/${token}/accept`, { method: "POST" });
    if (!response.ok) {
      setIsJoining(false);
      setError("This invitation link is no longer valid.");
      return;
    }
    // The landing resolver decides where they belong; this page does not.
    // `isJoining` stays true through the redirect so the button cannot be
    // pressed twice while the navigation is in flight.
    router.push("/");
    router.refresh();
  }, [router, token]);

  /**
   * Proving control of the invited address is the whole of the check.
   *
   * Someone who followed a sign-in link sent to that address, and is now
   * authenticated as it, has already satisfied every condition acceptance
   * imposes -- the server checks exactly the same thing again. A button here
   * would add a click and no safety, and would mean a person who just read their
   * email is asked to confirm something they already confirmed.
   *
   * It runs from the browser rather than the callback route on purpose. A link
   * scanner that fetches the magic link cannot get this far: completing the
   * exchange needs the PKCE verifier cookie from the browser that asked for the
   * link, and this accept is a POST issued by real JavaScript afterwards.
   */
  useEffect(() => {
    // All three, not just the match: `matchesCaller` is false for a signed-out
    // visitor, but requiring a session explicitly means a future change to how
    // that flag is computed cannot turn this into an accept with no identity.
    if (preview.state !== "valid") return;
    if (!preview.signedInEmail || !preview.matchesCaller) return;
    if (attempted.current) return;
    attempted.current = true;
    void join();
  }, [join, preview.matchesCaller, preview.signedInEmail, preview.state]);

  async function sendSignInLink() {
    if (!preview.invitedEmail) return;
    setIsSending(true);
    setError(null);
    const supabase = createClient();
    // Through the callback, never straight back here: the callback is what turns
    // the code into a session. Pointing the link at this page directly is how it
    // used to arrive still signed out, asking for a second trip to the inbox.
    const { error: authError } = await supabase.auth.signInWithOtp({
      email: preview.invitedEmail,
      options: { emailRedirectTo: authCallbackUrl(`/invitations/${token}`) },
    });
    setIsSending(false);
    if (authError) setError("We could not send the sign-in link. Try again.");
    else setSent(true);
  }

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
  }

  if (preview.state === "already_accepted") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>
              You have already joined
            </CardTitle>
            <CardDescription>This invitation has been used.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button className="w-full" onClick={() => router.push("/")}>
              Go to your workspace
              <ArrowRight data-icon="inline-end" />
            </Button>
          </CardFooter>
        </Card>
      </Shell>
    );
  }

  if (preview.state === "invalid") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>
              This link is no longer valid
            </CardTitle>
            <CardDescription>
              It may have expired, been withdrawn, or already been used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <CircleAlert />
              <AlertTitle>What to do next</AlertTitle>
              <AlertDescription>
                Ask the person who invited you to send a new invitation link.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const roleSummary = [
    preview.accountRole ? accountRoleLabels[preview.accountRole] : null,
    preview.defaultOrganizationRole
      ? organizationRoleLabels[preview.defaultOrganizationRole]
      : "No access to clients until someone grants it",
  ].filter(Boolean);

  // Signed out: offer sign-in to the invited address, and only that address.
  if (!preview.signedInEmail) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>
              Join {preview.accountName}
            </CardTitle>
            <CardDescription>
              {preview.inviterName ?? "Someone"} invited{" "}
              <span className="font-medium text-foreground">{preview.invitedEmail}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2 text-sm text-muted-foreground">
              {roleSummary.map((line) => (
                <li key={line} className="flex gap-2">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            {sent ? (
              <Alert className="border-success/30 bg-success/5">
                <Mail />
                <AlertTitle>Check your inbox</AlertTitle>
                <AlertDescription>
                  We sent a sign-in link to {preview.invitedEmail}. Open it on this device to finish
                  joining.
                </AlertDescription>
              </Alert>
            ) : (
              <Button className="w-full" disabled={isSending} onClick={sendSignInLink}>
                {isSending ? <Spinner /> : null}
                {isSending ? "Sending…" : "Email me a sign-in link"}
                {!isSending ? <ArrowRight data-icon="inline-end" /> : null}
              </Button>
            )}
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Something went wrong</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  // Signed in as someone else. Never accept on their behalf.
  if (!preview.matchesCaller) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>
              This invitation is for someone else
            </CardTitle>
            <CardDescription>
              It was sent to{" "}
              <span className="font-medium text-foreground">{preview.invitedEmail}</span>, but you
              are signed in as{" "}
              <span className="font-medium text-foreground">{preview.signedInEmail}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <CircleAlert />
              <AlertTitle>Sign in as the invited address</AlertTitle>
              <AlertDescription>
                An invitation only works for the address it was sent to.
              </AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={signOut}>
              Sign out and switch account
            </Button>
          </CardFooter>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={1}>
            {error ? `Join ${preview.accountName}` : `Joining ${preview.accountName}…`}
          </CardTitle>
          <CardDescription>
            {error
              ? `${preview.inviterName ?? "Someone"} invited you as ${preview.signedInEmail}.`
              : `Your address is confirmed, so there is nothing more to do. Taking you in as ${preview.signedInEmail}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3">
            <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-sm">
              {roleSummary.map((line) => (
                <p key={line} className="text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not join</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        {/* Joining is automatic; this is the retry when it could not complete,
            so the person is never stranded on a page with nothing to press. */}
        <CardFooter>
          {error ? (
            <Button className="w-full" disabled={isJoining} onClick={join}>
              {isJoining ? <Spinner /> : null}
              {isJoining ? "Joining…" : `Try again`}
              {!isJoining ? <ArrowRight data-icon="inline-end" /> : null}
            </Button>
          ) : (
            <div
              className="flex w-full items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner />
              One moment…
            </div>
          )}
        </CardFooter>
      </Card>
    </Shell>
  );
}
