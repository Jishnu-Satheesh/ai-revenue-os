"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Replace } from "lucide-react";
import { toast } from "sonner";

import {
  invalidateMemoryQueries,
  memoryBasePath,
  memoryRequest,
  useIdempotencyKey,
} from "@/components/memory/query-options";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { supersedeMemoryItemSchema } from "@/modules/memory/application/api-schemas";
import { sensitivities, type Sensitivity } from "@/domain/memory/types";

const sensitivityLabels: Readonly<Record<Sensitivity, string>> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  customer_content: "Customer content",
};

/**
 * Superseding is a correction, not a deletion: the original stays readable and
 * keeps its provenance, and the replacement records why it took over. The form
 * gathers the correction, then an `AlertDialog` states exactly what will change
 * and what is kept before anything is posted.
 */
export function SupersedeDialog({
  organizationId,
  itemId,
  itemTitle,
  ceiling,
}: {
  organizationId: string;
  itemId: string;
  itemTitle: string;
  ceiling: Sensitivity;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Held across retries of the same replacement so a resend replays instead of
  // creating a second one, and re-minted when the replacement itself changes.
  const idempotency = useIdempotencyKey();
  const queryClient = useQueryClient();

  const allowed = sensitivities.slice(0, sensitivities.indexOf(ceiling) + 1);

  const form = useForm({
    defaultValues: { title: "", body: "", sensitivity: "internal" as Sensitivity, reason: "" },
    // Enter inside a field submits the form, so the same validation that guards
    // the button must guard this path; otherwise a destructive confirmation can
    // open for a replacement that could only ever be rejected.
    onSubmit: async () => {
      validateBeforeConfirm();
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const values = form.state.values;
      const draft = {
        title: values.title.trim(),
        ...(values.body.trim() ? { body: values.body.trim() } : {}),
        sensitivity: values.sensitivity,
        reason: values.reason.trim(),
      };
      const parsed = supersedeMemoryItemSchema.safeParse({
        ...draft,
        idempotencyKey: idempotency.keyFor({ itemId, ...draft }),
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Check the replacement details.");
      }
      return memoryRequest<{ replacementId: string; supersededId: string }>(
        `${memoryBasePath(organizationId)}/items/${itemId}/supersede`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
    },
    onSuccess: async () => {
      // Only after the server confirmed: nothing on screen changed before this.
      await invalidateMemoryQueries(queryClient, organizationId);
      toast.success("Memory superseded. The original is retained with its provenance.");
      setConfirming(false);
      setOpen(false);
      idempotency.reset();
      form.reset();
    },
    onError: (error) => {
      setConfirming(false);
      const message = error instanceof Error ? error.message : "The memory could not be superseded.";
      setErrors([message]);
      toast.error(message);
    },
  });

  function validateBeforeConfirm() {
    const values = form.state.values;
    const problems: string[] = [];
    if (values.title.trim().length === 0) problems.push("Give the replacement a title.");
    if (values.reason.trim().length === 0) problems.push("Say why this memory is being replaced.");
    setErrors(problems);
    if (problems.length === 0) setConfirming(true);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setErrors([]);
            form.reset();
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Replace data-icon="inline-start" aria-hidden="true" />
            Supersede
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Supersede this memory</DialogTitle>
            <DialogDescription>
              The original stays readable and keeps its audit history. The replacement becomes the
              current version and records your reason.
            </DialogDescription>
          </DialogHeader>

          {errors.length > 0 ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertTitle>The replacement was not saved</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.Field name="title">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="supersede-title">Replacement title</FieldLabel>
                    <Input
                      id="supersede-title"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      maxLength={300}
                    />
                  </Field>
                )}
              </form.Field>
              <form.Field name="body">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="supersede-body">Replacement detail</FieldLabel>
                    <Textarea
                      id="supersede-body"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      maxLength={8000}
                      rows={3}
                    />
                    <FieldDescription>Optional.</FieldDescription>
                  </Field>
                )}
              </form.Field>
              <form.Field name="sensitivity">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="supersede-sensitivity">Sensitivity</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value as Sensitivity)}
                    >
                      <SelectTrigger id="supersede-sensitivity" aria-label="Sensitivity">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allowed.map((value) => (
                          <SelectItem key={value} value={value}>
                            {sensitivityLabels[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      You may not classify memory above what your role can read back.
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>
              <form.Field name="reason">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="supersede-reason">Reason</FieldLabel>
                    <Textarea
                      id="supersede-reason"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      maxLength={500}
                      rows={2}
                    />
                    <FieldDescription>Stored with the supersession record.</FieldDescription>
                  </Field>
                )}
              </form.Field>
            </FieldGroup>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={validateBeforeConfirm}>
                Review and supersede
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This records a correction. It does not delete anything.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Original</dt>
              <dd className="font-medium">{itemTitle}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Replacement</dt>
              <dd className="font-medium">{form.state.values.title}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Reason</dt>
              <dd>{form.state.values.reason}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            The original stays queryable through the supersession chain; its provenance and audit
            history are retained.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Keep as is</AlertDialogCancel>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner className="size-3" /> : null}
              Supersede memory
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
