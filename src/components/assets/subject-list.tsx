"use client";

import { UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The dishes this organization has described, and which of them may be drawn.
 *
 * A draft description is never used for generation. That is not a technicality
 * to hide — it is the whole reason the subject exists, so a draft says out loud
 * that it will not be drawn yet rather than looking like a finished row.
 *
 * Confirming is separately permissioned: `subject.manage` writes drafts, and
 * only an owner or admin approves one. Where the caller cannot confirm, the
 * button is absent and the reason is stated. Rendering a button that returns
 * 403 teaches an operator that the product is broken, when it is working
 * exactly as designed.
 */

export type SubjectRow = {
  id: string;
  name: string;
  description: string | null;
  namesByScript: Readonly<Record<string, string>>;
  tags: readonly string[];
  state: "draft" | "confirmed";
  archivedAt: string | null;
};

type SubjectListProps = {
  subjects: readonly SubjectRow[];
  /** Whether this member's role may perform the privileged act. */
  canConfirm: boolean;
  onConfirm: (subjectId: string) => void;
  emptyAction?: ReactNode;
  pending?: boolean;
};

export function SubjectList({
  subjects,
  canConfirm,
  onConfirm,
  emptyAction,
  pending = false,
}: SubjectListProps) {
  if (subjects.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <UtensilsCrossed />
          </span>
          <h3 className="text-lg font-semibold">No dishes described yet</h3>
          <p className="max-w-md text-sm text-muted-foreground">
            Describe one dish you sell. Until something here is confirmed, the platform has nothing
            it is allowed to draw.
          </p>
          {emptyAction}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {subjects.map((subject) => (
        <Card key={subject.id}>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <span dir="auto" className="text-base font-semibold leading-tight">
                {subject.name}
              </span>
              <Badge variant={subject.state === "confirmed" ? "default" : "outline"}>
                {subject.state === "confirmed" ? "Confirmed" : "Draft"}
              </Badge>
            </div>

            {subject.description === null ? null : (
              <p dir="auto" className="text-sm text-muted-foreground">
                {subject.description}
              </p>
            )}

            {Object.keys(subject.namesByScript).length === 0 ? null : (
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {Object.entries(subject.namesByScript).map(([script, name]) => (
                  <div key={script} className="flex items-baseline gap-1.5">
                    <dt className="text-xs uppercase text-muted-foreground">{script}</dt>
                    <dd dir="auto">{name}</dd>
                  </div>
                ))}
              </dl>
            )}

            {subject.tags.length === 0 ? null : (
              <div className="flex flex-wrap gap-1.5">
                {subject.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="font-normal">
                    <span dir="auto">{tag}</span>
                  </Badge>
                ))}
              </div>
            )}

            {subject.state === "draft" ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-muted-foreground">
                  A draft is not used for generation until it is confirmed.
                </p>
                {canConfirm ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onConfirm(subject.id)}
                    disabled={pending}
                  >
                    Confirm
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Confirming is reserved for an owner or admin.
                  </p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
