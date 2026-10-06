"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  organizationInvitationsKey,
  postOrganizationInvitation,
} from "@/components/organizations/organization-session";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrganizationRole } from "@/domain/organizations/types";

const roleOptions: readonly { value: OrganizationRole; label: string; hint: string }[] = [
  { value: "viewer", label: "Viewer", hint: "Read only. Cannot see confidential memory." },
  { value: "operator", label: "Operator", hint: "Day-to-day work. Cannot approve or spend." },
  { value: "admin", label: "Admin", hint: "Settings, integrations, approvals, budgets." },
  { value: "owner", label: "Owner", hint: "Everything, including archiving the client." },
];

/**
 * Inviting someone into this client organization.
 *
 * One role, because it answers one question: what this person may do inside
 * this client. No agency membership is created or needed. The invitation is
 * emailed when a sender is configured, and the copy-link is always offered
 * alongside it; the dialog reports which of those actually happened.
 */
export function AddMemberDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("viewer");
  const [issued, setIssued] = useState<{ url: string; emailSent: boolean; to: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: organizationInvitationsKey(organizationId) });

  const create = useMutation({
    mutationFn: () => postOrganizationInvitation(organizationId, { email, role }),
    onSuccess: async (invitation) => {
      setIssued({ url: invitation.acceptUrl, emailSent: invitation.emailSent, to: invitation.email });
      setError(null);
      await invalidate();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "Could not invite.");
    },
  });

  function close() {
    setOpen(false);
    setEmail("");
    setRole("viewer");
    setIssued(null);
    setError(null);
    create.reset();
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.url);
    toast.success("Invitation link copied.");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="add-member-entry">
          <UserPlus />
          Add member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a member</DialogTitle>
          <DialogDescription>
            They join this client only -- never the agency -- once they accept the invitation.
          </DialogDescription>
        </DialogHeader>
        {issued ? (
          <div className="space-y-4">
            <Alert className="border-success/30 bg-success/5">
              <AlertTitle>Invitation ready for {issued.to}</AlertTitle>
              <AlertDescription>
                {issued.emailSent
                  ? "We emailed the invitation."
                  : "No email sender is configured, so send them this link yourself."}
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2">
              <Input readOnly value={issued.url} className="font-mono text-xs" aria-label="Invitation link" />
              <Button type="button" variant="outline" size="sm" onClick={copy}>
                <Copy />
                Copy
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="member-email">Email address</FieldLabel>
                <Input
                  id="member-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="client@example.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="member-role">Role in this client</FieldLabel>
                <Select value={role} onValueChange={(value) => setRole(value as OrganizationRole)}>
                  <SelectTrigger id="member-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label} — {option.hint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>Could not invite</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
            </FieldGroup>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={create.isPending}>
                <UserPlus />
                {create.isPending ? "Sending…" : "Send invitation"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
