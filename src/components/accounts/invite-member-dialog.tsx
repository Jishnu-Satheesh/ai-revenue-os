"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Copy, Link2, Lock, RotateCw, Send, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  accountInvitationsKey,
  hasPermission,
  postInvitation,
  reissueInvitation,
  revokeInvitation,
  useAccountSession,
  usePendingInvitations,
} from "@/components/accounts/account-session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import type { AccountRole, OrganizationRole } from "@/domain/organizations/types";

const accountRoleOptions: readonly { value: AccountRole; label: string; hint: string }[] = [
  { value: "member", label: "Member", hint: "Works in the clients. No agency administration." },
  { value: "admin", label: "Admin", hint: "Can invite people and add new clients." },
  { value: "owner", label: "Owner", hint: "Full control, including billing and ownership." },
];

const organizationRoleOptions: readonly {
  value: OrganizationRole;
  label: string;
  hint: string;
}[] = [
  { value: "viewer", label: "Viewer", hint: "Read only. Cannot see confidential memory." },
  { value: "operator", label: "Operator", hint: "Day-to-day work. Cannot approve or spend." },
  { value: "admin", label: "Admin", hint: "Settings, integrations, approvals, budgets." },
  { value: "owner", label: "Owner", hint: "Everything, including archiving the client." },
];

function CopyLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Invitation link copied.");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={url} className="font-mono text-xs" aria-label="Invitation link" />
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/**
 * Inviting a teammate into the agency.
 *
 * Two roles are assigned, because they are two different questions: what this
 * person is in the agency, and what they can do inside each client. Every option
 * carries its consequence in one line, so authority is chosen deliberately
 * rather than by accepting a default nobody read.
 *
 * The invitation is emailed when a sender is configured, and the copy-link is
 * always offered alongside it. The panel reports which of those actually
 * happened rather than assuming, because that decides whether the inviter
 * still has something to do.
 */
export function InviteMemberDialog() {
  const { data: session } = useAccountSession();
  const canInvite = hasPermission(session, "member.invite");

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [accountRole, setAccountRole] = useState<AccountRole>("member");
  const [organizationRole, setOrganizationRole] = useState<OrganizationRole>("operator");
  const [issued, setIssued] = useState<{ url: string; emailSent: boolean; to: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: invitations, isPending: invitationsPending } = usePendingInvitations(
    open && canInvite,
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: accountInvitationsKey });

  const create = useMutation({
    mutationFn: postInvitation,
    onSuccess: async (invitation) => {
      setIssued({
        url: invitation.acceptUrl,
        emailSent: invitation.emailSent,
        to: invitation.email,
      });
      setEmail("");
      setError(null);
      await invalidate();
      toast.success(invitation.emailSent ? "Invitation sent." : "Invitation created.");
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const reissue = useMutation({
    mutationFn: reissueInvitation,
    onSuccess: async (invitation) => {
      setIssued({
        url: invitation.acceptUrl,
        emailSent: invitation.emailSent,
        to: invitation.email,
      });
      await invalidate();
      toast.success(
        invitation.emailSent
          ? "New invitation sent. The previous link no longer works."
          : "New link created. The previous one no longer works.",
      );
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const revoke = useMutation({
    mutationFn: revokeInvitation,
    onSuccess: async () => {
      await invalidate();
      toast.success("Invitation withdrawn.");
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  // A control that can never become enabled is noise, so the entry is absent
  // rather than disabled for someone who cannot invite.
  if (!canInvite) return null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setIssued(null);
    create.mutate({
      email: email.trim(),
      accountRole,
      defaultOrganizationRole: organizationRole,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setIssued(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <SidebarMenuButton tooltip="Invite member" data-testid="invite-member-entry">
          <UserPlus />
          <span>Invite member</span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They join {session?.account.name ?? "your agency"} and can work across its clients.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
              <Input
                id="invite-email"
                type="email"
                required
                autoComplete="off"
                placeholder="teammate@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <FieldDescription>
                The invitation only works for this address. Forwarding the link does not transfer
                it.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-account-role">Role in the agency</FieldLabel>
              <Select
                value={accountRole}
                onValueChange={(value) => setAccountRole(value as AccountRole)}
              >
                <SelectTrigger id="invite-account-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label} — {option.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-scope">Client access</FieldLabel>
              <div
                id="invite-scope"
                className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
              >
                <Lock className="size-3.5 shrink-0" />
                All clients, including ones added later
              </div>
              <FieldDescription>
                Choosing specific clients is coming later. For now a member reaches every client in
                the agency.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-organization-role">Role inside each client</FieldLabel>
              <Select
                value={organizationRole}
                onValueChange={(value) => setOrganizationRole(value as OrganizationRole)}
              >
                <SelectTrigger id="invite-organization-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {organizationRoleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label} — {option.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Could not create the invitation</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" disabled={create.isPending || email.trim().length === 0}>
              {create.isPending ? <Spinner /> : <Send />}
              {create.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </FieldGroup>
        </form>

        {issued ? (
          <Alert className="border-success/30 bg-success/5">
            {issued.emailSent ? <Send /> : <Link2 />}
            <AlertTitle>
              {issued.emailSent ? `Invitation sent to ${issued.to}` : "Share this link"}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              {/* Never claim a send that did not happen: the difference decides
                  whether the inviter has to do anything else. */}
              <p>
                {issued.emailSent
                  ? "They can join from the email in one click. The same link is here if you would rather send it yourself."
                  : "No email was sent. Copy the link and send it yourself."}{" "}
                It is shown once — if you lose it, reissue below.
              </p>
              <CopyLinkRow url={issued.url} />
            </AlertDescription>
          </Alert>
        ) : null}

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Pending invitations</h3>
          {invitationsPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : invitations && invitations.length > 0 ? (
            <ul className="space-y-2">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{invitation.email}</span>
                  <Badge variant="secondary" className="text-[10px] uppercase">
                    {invitation.accountRole}
                  </Badge>
                  {invitation.isExpired ? (
                    <Badge variant="destructive" className="text-[10px] uppercase">
                      Expired
                    </Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={reissue.isPending}
                    onClick={() => reissue.mutate(invitation.id)}
                  >
                    <RotateCw />
                    Reissue
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invitation.id)}
                  >
                    <Trash2 />
                    Withdraw
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nobody is waiting on an invitation. Ones you create appear here until they are used or
              withdrawn.
            </p>
          )}
        </section>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
