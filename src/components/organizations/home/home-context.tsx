"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  Cable,
  MapPin,
  Sparkles,
  Target,
  Waypoints,
} from "lucide-react";

import { Button } from "@/components/ui/button";import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  HomeDestination,
  HomeGoal,
} from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

const DESTINATION_ICONS = {
  channels: Waypoints,
  growth: Sparkles,
  memory: BrainCircuit,
  integrations: Cable,
} as const;

function formatInstant(value: string, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value));
  // en-GB abbreviates September as "Sept"; the reference writes "Sep". The
  // org timezone name always trails the time, separated exactly as shown.
  return `${formatted.replace("Sept", "Sep").replace(",", " ·")}, ${timeZone}`;
}

/**
 * Read-only locations dialog shared with the header context row. Lists saved
 * names and kinds only; operating hours and contact metadata stay out.
 */
export function LocationsControl({
  locations,
  branchlessConfirmed,
}: Readonly<{
  locations: readonly { id: string; name: string; kind: string }[];
  branchlessConfirmed: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  if (locations.length === 0) {
    return (
      <span className={styles.contextItem}>
        <MapPin aria-hidden="true" className="size-3.5" />
        {branchlessConfirmed ? "Branchless organization" : "No locations on file"}
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <MapPin aria-hidden="true" data-icon="inline-start" />
        {locations.length === 1 ? "1 active location" : `${locations.length} active locations`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={styles.dialogContent}>
          <DialogHeader>
            <DialogTitle id={titleId}>Locations</DialogTitle>
            <DialogDescription>Saved locations for this organization.</DialogDescription>
          </DialogHeader>
          <ul className={styles.activityList}>
            {locations.map((location) => (
              <li key={location.id} className={styles.activityRow}>
                <span dir="auto" className={styles.activityLabel}>
                  {location.name}
                </span>
                <span className={styles.activityTitle}>{location.kind}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Focus goal plus the read-only dialog listing every saved goal with its
 * scope. Targets render exactly as stored ("500 orders" style); there is no
 * progress bar, percentage or timeline anywhere on this surface.
 */
export function HomeGoals({
  goals,
  focusGoalId,
  timeZone,
  canManageCore,
}: Readonly<{
  goals: readonly HomeGoal[];
  focusGoalId: string | null;
  timeZone: string;
  canManageCore: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const focus = goals.find((goal) => goal.id === focusGoalId) ?? null;

  return (
    <section id="home-goals" aria-label="Your focus" className={styles.goals}>
      <div className={styles.sectionHead}>
        <h2 className={styles.railTitle}>Your focus</h2>
        {goals.length > 1 ? (
          <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)}>
            View goals
          </Button>
        ) : null}
      </div>

      {focus === null ? (
        <div>
          <p dir="auto" className={styles.attentionTitle}>
            <Target aria-hidden="true" className="mr-1.5 inline size-4" />
            What are you working towards?
          </p>
          <p className={styles.emptyNote}>
            {canManageCore ? (
              <>
                Add a goal in{" "}
                <Link href="#organization-management" className={styles.inlineLink}>
                  your organization details
                </Link>
                .
              </>
            ) : (
              "No goals on file yet."
            )}
          </p>
        </div>
      ) : (
        <Card className={styles.goalCard}>
          <CardContent className="flex flex-col gap-1 pt-4">
            <p dir="auto" className={styles.attentionTitle}>
              <Target aria-hidden="true" className="mr-1.5 inline size-4" />
              {focus.name}
            </p>
            <p className={styles.goalTarget}>{focus.target}</p>
            <p className={styles.meta}>
              {focus.scopeLabel}
              {focus.deadline !== null
                ? ` · By ${formatInstant(focus.deadline, timeZone)}`
                : ""}
            </p>
            {goals.length > 1 ? (
              <p className={styles.meta}>
                Plus {goals.length - 1} more —{" "}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => setOpen(true)}
                >
                  view all goals
                </Button>
                .
              </p>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={styles.dialogContent}>
          <DialogHeader>
            <DialogTitle>Goals</DialogTitle>
            <DialogDescription>
              Every saved goal with the scope it was set for.
            </DialogDescription>
          </DialogHeader>
          <ul className={styles.activityList}>
            {goals.map((goalItem) => (
              <li key={goalItem.id} className={styles.activityRow}>
                <span dir="auto" className={styles.activityLabel}>
                  {goalItem.name}
                </span>
                <span className={styles.activityTitle}>
                  {goalItem.target} · {goalItem.scopeLabel}
                  {goalItem.deadline !== null
                    ? ` · By ${formatInstant(goalItem.deadline, timeZone)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * Authorized destinations only: hidden gates reflow the grid and leave no
 * placeholder cells. Every entry is a real navigation link with the icon,
 * title and description it was composed with — no counts, dots or claims.
 */
export function HomeDestinations({
  destinations,
}: Readonly<{ destinations: readonly HomeDestination[] }>) {
  if (destinations.length === 0) return null;

  return (
    <section id="home-destinations" aria-label="Around your business" className={styles.destinations}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Around your business</h2>
      </div>
      <div className={styles.destGrid}>
        {destinations.map((destination) => {
          const Icon = DESTINATION_ICONS[destination.key];
          return (
            <Link key={destination.key} href={destination.href} className={styles.destLink}>
              <span aria-hidden="true" className={styles.destIcon}>
                <Icon className="size-4" />
              </span>
              <span className={styles.destText}>
                <span className={styles.destLabel}>{destination.label}</span>
                <span className={styles.destDescription}>{destination.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
