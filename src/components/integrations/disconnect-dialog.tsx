"use client";

import { useState } from "react";
import { Unplug } from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

type Connection = IntegrationHubSnapshot["connections"][number];

/**
 * Disconnect is destructive and asynchronous: capabilities are disabled at once
 * while credential cleanup is queued. The dialog states both, names what is
 * retained, and requires the account label verbatim before it will submit.
 */
export function DisconnectDialog({
  connection,
  providerName,
  isPending,
  onConfirm,
}: Readonly<{
  connection: Connection;
  providerName: string;
  isPending: boolean;
  onConfirm: (confirmation: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const matches = confirmation === connection.external_account_label;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmation("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="destructive" disabled={isPending}>
          <Unplug data-icon="inline-start" />
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Disconnect {providerName} — {connection.external_account_label}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-left">
              <p>
                {connection.capabilities.length === 0
                  ? "No capability grants are currently derived for this connection."
                  : `${connection.capabilities.length} capability grant(s) are disabled immediately.`}
              </p>
              <p>
                Connection, run, health, and audit history is retained. Imported records already
                accepted are not deleted.
              </p>
              <p>
                Credential cleanup is queued as background work. Until it reports success the
                connection stays visible with a cleanup warning.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor={`disconnect-${connection.id}`}>
            Type the account name to confirm
          </FieldLabel>
          <FieldDescription>{connection.external_account_label}</FieldDescription>
          <Input
            id={`disconnect-${connection.id}`}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep connection</AlertDialogCancel>
          <AlertDialogAction
            disabled={!matches || isPending}
            onClick={(event) => {
              // Radix closes on action by default; the request owns the close so
              // a rejected disconnect can keep the dialog and its message open.
              event.preventDefault();
              onConfirm(confirmation);
              setOpen(false);
            }}
          >
            {isPending ? <Spinner /> : null}
            Disconnect integration
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
