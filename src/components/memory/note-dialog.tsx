"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  invalidateMemoryQueries,
  memoryBasePath,
  memoryRequest,
  useIdempotencyKey,
} from "@/components/memory/query-options";
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
import { sensitivities, type Sensitivity } from "@/domain/memory/types";
import { createMemoryItemSchema } from "@/modules/memory/application/api-schemas";
import type { MemoryItemView } from "@/modules/memory/application/service";

const sensitivityLabels: Readonly<Record<Sensitivity, string>> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  customer_content: "Customer content",
};

/**
 * Recording memory by hand. The write is deliberately narrow: only a note or a
 * document, only at or below the reader's own ceiling, and always under an
 * idempotency key so a resend replays instead of writing twice.
 */
export function NoteDialog({
  organizationId,
  ceiling,
}: {
  organizationId: string;
  ceiling: Sensitivity;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const idempotency = useIdempotencyKey();
  const queryClient = useQueryClient();
  const allowed = sensitivities.slice(0, sensitivities.indexOf(ceiling) + 1);

  const form = useForm({
    defaultValues: {
      memoryType: "note" as "note" | "document",
      title: "",
      body: "",
      sensitivity: "internal" as Sensitivity,
    },
    onSubmit: async ({ value }) => {
      const problems: string[] = [];
      if (value.title.trim().length === 0) problems.push("Give this memory a title.");
      setErrors(problems);
      if (problems.length > 0) return;
      await mutation.mutateAsync(value);
    },
  });

  const mutation = useMutation({
    mutationFn: async (value: {
      memoryType: "note" | "document";
      title: string;
      body: string;
      sensitivity: Sensitivity;
    }) => {
      const draft = {
        memoryType: value.memoryType,
        title: value.title.trim(),
        ...(value.body.trim() ? { body: value.body.trim() } : {}),
        sensitivity: value.sensitivity,
        markVerified: true,
      };
      const parsed = createMemoryItemSchema.safeParse({
        ...draft,
        idempotencyKey: idempotency.keyFor(draft),
      });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Check the note details.");
      }
      return memoryRequest<{ item: MemoryItemView }>(`${memoryBasePath(organizationId)}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
    },
    onSuccess: async () => {
      await invalidateMemoryQueries(queryClient, organizationId);
      toast.success("Memory recorded.");
      setOpen(false);
      idempotency.reset();
      form.reset();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "The memory could not be saved.";
      setErrors([message]);
      toast.error(message);
    },
  });

  return (
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
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add note
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to business memory</DialogTitle>
          <DialogDescription>
            Recorded as entered by a person, which is the highest trust tier. It stays editable and
            auditable.
          </DialogDescription>
        </DialogHeader>

        {errors.length > 0 ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertTitle>The memory was not saved</AlertTitle>
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
            <form.Field name="memoryType">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="note-type">Type</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value as "note" | "document")}
                  >
                    <SelectTrigger id="note-type" aria-label="Type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="note">Note</SelectItem>
                      <SelectItem value="document">Document</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="title">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="note-title">Title</FieldLabel>
                  <Input
                    id="note-title"
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
                  <FieldLabel htmlFor="note-body">Detail</FieldLabel>
                  <Textarea
                    id="note-body"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    maxLength={8000}
                    rows={4}
                  />
                  <FieldDescription>Optional.</FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Field name="sensitivity">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="note-sensitivity">Sensitivity</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value as Sensitivity)}
                  >
                    <SelectTrigger id="note-sensitivity" aria-label="Sensitivity">
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
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Spinner className="size-3" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
