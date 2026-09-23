"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Building2, CircleAlert, Mail, ShieldCheck } from "lucide-react";

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
import type { OrganizationInvitationPreview } from "@/domain/access/invitations";
import type { OrganizationRole } from "@/domain/organizations/types";

const organizationRoleLabels: Readonly<Record<OrganizationRole, string>> = {
  owner: "Owner — everything, including archiving the client",
  admin: "Admin — settings, integrations, approvals",
  operator: "Operator — day-to-day work, no approvals",
  viewer: "Viewer — read only",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8">
          <div className="mb-6 flex size-11 items-center justify-center overflow-hidden rounded-xl">
            <Image
              src="/assets/logo/logo.png"
              alt="Lunes AI"
              width={44}
              height={44}
              className="size-11 object-contain"
            />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            The Revenue Intelligence
          </p>
        </div>
        {children}
      </div>
    </main>
  );
}

/**
 * Accepting an invitation into one client organization.
 *
 * A parallel of the agency accept flow, not a reuse: the preview shape, the
 * role summary, and the endpoints differ, and sharing the component would let
 * a change to one flow silently reshape the other. The security behavior is
 * identical -- auto-accept only for the matching signed-in address, opaque
 * refusal otherwise, sign-in through the callback so link scanners stall.
 */
export function AcceptOrganizationInvitation({
  token,
  preview,
}: {
  token: string;
  preview: OrganizationInvitationPreview;
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
    const response = await fetch(`/api/organization-invitations/${token}/accept`, {
      method: "POST",
    });
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
      options: { emailRedirectTo: authCallbackUrl(`/organization-invitations/${token}`) },
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

  const roleSummary = preview.role
    ? [`In ${preview.organizationName ?? "this client"}: ${organizationRoleLabels[preview.role]}`]
    : ["The inviter will confirm your access after you join."];

  // Signed out: offer sign-in to the invited address, and only that address.
  if (!preview.signedInEmail) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>
              Join {preview.organizationName}
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
            {error ? `Join ${preview.organizationName}` : `Joining ${preview.organizationName}…`}
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
          ) : null}
        </CardFooter>
      </Card>
    </Shell>
  );
}
