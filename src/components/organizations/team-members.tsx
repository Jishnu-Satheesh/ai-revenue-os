"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Ban,
  Copy,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  organizationInvitationsKey,
  organizationTeamKey,
  reissueOrganizationInvitation,
  removeTeamMember,
  revokeOrganizationInvitation,
  updateTeamMemberRole,
  useOrganizationSession,
  usePendingOrganizationInvitations,
  useTeamMembers,
} from "@/components/organizations/organization-session";
import { AddMemberDialog } from "@/components/organizations/add-member-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type {
  OrganizationTeamMember,
  PendingOrganizationInvitation,
} from "@/domain/access/invitations";
import type { OrganizationRole } from "@/domain/organizations/types";

const roleOptions: readonly { value: OrganizationRole; label: string; hint: string }[] = [
  { value: "viewer", label: "Viewer", hint: "Read only. Cannot see confidential memory." },
  { value: "operator", label: "Operator", hint: "Day-to-day work. Cannot approve or spend." },
  { value: "admin", label: "Admin", hint: "Settings, integrations, approvals, budgets." },
  { value: "owner", label: "Owner", hint: "Everything, including archiving the client." },
];

const roleLabelByValue: Readonly<Record<OrganizationRole, string>> = {
  viewer: "Viewer",
  operator: "Operator",
  admin: "Admin",
  owner: "Owner",
};

function roleHint(role: OrganizationRole): string {
  return roleOptions.find((option) => option.value === role)?.hint ?? "";
}

/**
 * The Team Members table: every explicit grant on this client, plus pending
 * invitations with their own chip and actions.
 *
 * Server and trigger re-check every write, so the controls here only offer
 * what the caller's role allows -- and every refusal still arrives as words,
 * because a silent no-op on a role change would look like success.
 */
export function TeamMembers({ organizationId }: { organizationId: string }) {
  const { data: session } = useOrganizationSession(organizationId);
  const role = session?.role;
  const sessionKnown = role !== undefined;

  const canInvite = role ? hasOrganizationPermission(role, "organization.member.invite") : false;
  const canManageRole = role
    ? hasOrganizationPermission(role, "organization.member.manage_role")
    : false;
  const canRemove = role ? hasOrganizationPermission(role, "organization.member.remove") : false;
  const canSeeTeam = canInvite || canManageRole || canRemove;

  const teamQuery = useTeamMembers(organizationId, sessionKnown && canSeeTeam);
  const invitationsQuery = usePendingOrganizationInvitations(
    organizationId,
    sessionKnown && canInvite,
  );

  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationTeamKey(organizationId) }),
      queryClient.invalidateQueries({ queryKey: organizationInvitationsKey(organizationId) }),
    ]);

  // Without a team permission there is no honest empty state to show: the
  // table would look unmanaged rather than unauthorized.
  if (sessionKnown && !canSeeTeam) {
    return (
      <Alert>
        <AlertTitle>Team management is limited</AlertTitle>
        <AlertDescription>
          Only client owners and admins can see and manage team members.
        </AlertDescription>
      </Alert>
    );
  }

  const loadError =
    teamQuery.error ?? (canInvite ? invitationsQuery.error : null);
  if (loadError instanceof Error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load the team</AlertTitle>
        <AlertDescription>{loadError.message}</AlertDescription>
      </Alert>
    );
  }

  if (teamQuery.isPending || (canInvite && invitationsQuery.isPending)) {
    return <p className="text-sm text-muted-foreground">Loading team…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {canInvite ? <AddMemberDialog organizationId={organizationId} /> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email address</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(teamQuery.data ?? []).map((member) => (
              <MemberRow
                key={member.userId}
                organizationId={organizationId}
                member={member}
                canManageRole={canManageRole}
                canRemove={canRemove}
                onChanged={invalidate}
              />
            ))}
            {(canInvite ? (invitationsQuery.data ?? []) : []).map((invitation) => (
              <PendingRow
                key={invitation.id}
                organizationId={organizationId}
                invitation={invitation}
                onChanged={invalidate}
              />
            ))}
            {(teamQuery.data ?? []).length === 0 &&
            (!canInvite || (invitationsQuery.data ?? []).length === 0) ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No members yet. Invite the first one above.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MemberRow({
  organizationId,
  member,
  canManageRole,
  canRemove,
  onChanged,
}: {
  organizationId: string;
  member: OrganizationTeamMember;
  canManageRole: boolean;
  canRemove: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<OrganizationRole>(member.role);
  const [removing, setRemoving] = useState(false);

  const changeRole = useMutation({
    mutationFn: (role: OrganizationRole) =>
      updateTeamMemberRole(organizationId, member.userId, role),
    onSuccess: async () => {
      toast.success(`${displayName(member)} is now ${roleLabelByValue[roleDraft]}.`);
      setEditing(false);
      await onChanged();
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Could not change.");
    },
  });

  const remove = useMutation({
    mutationFn: () => removeTeamMember(organizationId, member.userId),
    onSuccess: async () => {
      toast.success(`${displayName(member)} was removed.`);
      setRemoving(false);
      await onChanged();
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Could not remove.");
    },
  });

  async function copyEmail() {
    if (!member.email) return;
    await navigator.clipboard.writeText(member.email);
    toast.success("Email address copied.");
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{member.displayName ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground">{member.email ?? "—"}</TableCell>
      <TableCell>
        {canManageRole ? (
          <Select
            value={member.role}
            disabled={changeRole.isPending}
            onValueChange={(value) => {
              const next = value as OrganizationRole;
              setRoleDraft(next);
              changeRole.mutate(next);
            }}
            aria-label={`Role for ${displayName(member)}`}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm">{roleLabelByValue[member.role]}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {canManageRole ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${displayName(member)}`}
              onClick={() => {
                setRoleDraft(member.role);
                setEditing(true);
              }}
            >
              <Pencil />
            </Button>
          ) : null}
          {canRemove ? (
            <AlertDialog
              open={removing}
              onOpenChange={setRemoving}
            >
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={`Remove ${displayName(member)}`}>
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {displayName(member)}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    They lose access to this client immediately. This cannot be undone except by
                    inviting them again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(event) => {
                      event.preventDefault();
                      remove.mutate();
                    }}
                  >
                    {remove.isPending ? "Removing…" : "Remove"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`More actions for ${displayName(member)}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copyEmail}>
                <Copy />
                Copy email address
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
                Member details
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Dialog
          open={editing}
          onOpenChange={setEditing}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit {displayName(member)}</DialogTitle>
              <DialogDescription>
                Choose the role deliberately: it decides what they may do in this client.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Select
                value={roleDraft}
                onValueChange={(value) => setRoleDraft(value as OrganizationRole)}
              >
                <SelectTrigger aria-label="Role">
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
              <p className="text-sm text-muted-foreground">{roleHint(roleDraft)}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button disabled={changeRole.isPending} onClick={() => changeRole.mutate(roleDraft)}>
                {changeRole.isPending ? "Saving…" : "Save role"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{displayName(member)}</DialogTitle>
              <DialogDescription>This client&apos;s explicit grant for this person.</DialogDescription>
            </DialogHeader>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{member.email ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Role</dt>
                <dd>
                  {roleLabelByValue[member.role]} — {roleHint(member.role)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Member since</dt>
                <dd>{new Date(member.createdAt).toLocaleDateString("en-GB")}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              Agency-level access may grant more on top -- this table shows only what this client
              granted directly.
            </p>
          </DialogContent>
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

function PendingRow({
  organizationId,
  invitation,
  onChanged,
}: {
  organizationId: string;
  invitation: PendingOrganizationInvitation;
  onChanged: () => Promise<unknown>;
}) {
  const [revoking, setRevoking] = useState(false);

  const resend = useMutation({
    mutationFn: () => reissueOrganizationInvitation(organizationId, invitation.id),
    onSuccess: async (issued) => {
      try {
        await navigator.clipboard.writeText(issued.acceptUrl);
      } catch {
        // Clipboard needs a secure context; the toast below still tells the
        // inviter what happened, and the pending list stays the source of truth.
      }
      toast.success(
        issued.emailSent
          ? `Invitation re-sent to ${invitation.email}.`
          : "No email sender is configured -- the new link is on your clipboard.",
      );
      await onChanged();
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Could not resend.");
    },
  });

  const revoke = useMutation({
    mutationFn: () => revokeOrganizationInvitation(organizationId, invitation.id),
    onSuccess: async () => {
      toast.success(`Invitation to ${invitation.email} was revoked.`);
      setRevoking(false);
      await onChanged();
    },
    onError: (mutationError) => {
      toast.error(mutationError instanceof Error ? mutationError.message : "Could not revoke.");
    },
  });

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">—</TableCell>
      <TableCell>
        <span>{invitation.email}</span>
        <div className="mt-1">
          <Badge variant="secondary">Invitation pending</Badge>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {roleLabelByValue[invitation.role]}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Resend invitation to ${invitation.email}`}
            disabled={resend.isPending}
            onClick={() => resend.mutate()}
          >
            <RotateCw />
          </Button>
          <AlertDialog open={revoking} onOpenChange={setRevoking}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Revoke invitation to ${invitation.email}`}
              >
                <Ban />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
                <AlertDialogDescription>
                  {invitation.email} will not be able to join with this link. You can invite them
                  again afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(event) => {
                    event.preventDefault();
                    revoke.mutate();
                  }}
                >
                  {revoke.isPending ? "Revoking…" : "Revoke"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

function displayName(member: OrganizationTeamMember): string {
  return member.displayName ?? member.email ?? "This member";
}
