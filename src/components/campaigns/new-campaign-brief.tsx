"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { idempotencyKey, type ActionResult } from "@/components/campaigns/campaign-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

/**
 * The manual entry into the campaign pipeline.
 *
 * A brief is intent, not content. It says what the campaign is for and who it
 * is for; it does not carry captions, artwork or a schedule. Those are
 * generated and then reviewed, which is the whole point of the pipeline — a
 * form that let an operator type the caption directly would skip every check
 * that stands between an idea and a published post.
 */

const PROFILES = [
  {
    value: "brand_restricted",
    label: "Brand restricted",
    hint: "Stays inside the approved palette, type and layout rules.",
  },
  {
    value: "brand_guided",
    label: "Brand guided",
    hint: "May vary soft composition while keeping the brand recognisable.",
  },
  {
    value: "full_visual_freedom",
    label: "Full visual freedom",
    hint: "May depart from soft brand rules. Factual, legal and offer constraints never move.",
  },
] as const;

const CHANNELS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
] as const;

export function NewCampaignBrief({ organizationId }: Readonly<{ organizationId: string }>) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [offer, setOffer] = useState("");
  const [channels, setChannels] = useState<string[]>(["instagram"]);
  const [profile, setProfile] = useState<string>("brand_guided");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete =
    title.trim().length > 0 && objective.trim().length > 0 && audience.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!complete) return;

    setPending(true);
    setError(null);

    let result: ActionResult<{ campaignId: string }>;
    try {
      const response = await fetch(`/api/organizations/${organizationId}/campaigns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: { kind: "manual_brief" },
          title: title.trim(),
          brief: {
            objective: objective.trim(),
            audience: audience.trim(),
            // An empty offer is "no offer", which is different from a blank one.
            offer: offer.trim().length > 0 ? offer.trim() : null,
            requestedChannels: channels,
          },
          generationProfile: profile,
          idempotencyKey: idempotencyKey(),
        }),
      });
      const payload = await response.json();
      result = response.ok
        ? { ok: true, data: payload }
        : { ok: false, message: payload?.error?.message ?? "The campaign could not be created." };
    } catch {
      result = { ok: false, message: "The request could not be sent. Check your connection." };
    }

    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    toast.success("Campaign created", {
      description: "Generation has been queued. The first proposal will appear when it finishes.",
    });
    router.push(`/organizations/${organizationId}/campaigns/${result.data.campaignId}`);
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>What is this campaign for?</CardTitle>
          <CardDescription>
            Describe the intent. The creative, timing and spend are proposed for you to review.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Campaign name</Label>
            <Input
              id="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Weekday evening demand lift"
              maxLength={240}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="objective">Objective</Label>
            <Textarea
              id="objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Raise incremental gross profit on low-occupancy weekday evenings."
              rows={3}
              maxLength={600}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="audience">Audience</Label>
            <Textarea
              id="audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              placeholder="Families within a 15-minute drive who have visited at a weekend."
              rows={2}
              maxLength={600}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="offer">Offer (optional)</Label>
            <Input
              id="offer"
              value={offer}
              onChange={(event) => setOffer(event.target.value)}
              placeholder="Leave empty if this campaign carries no offer"
              maxLength={600}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How much may the visuals vary?</CardTitle>
          <CardDescription>
            This controls the artwork only. Factual claims, offers, legal and safety constraints,
            provider limits and approved spend never move.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="profile">Generation profile</Label>
            <Select value={profile} onValueChange={setProfile}>
              <SelectTrigger id="profile">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFILES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {PROFILES.find((option) => option.value === profile)?.hint}
            </p>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Requested channels</legend>
            <div className="flex flex-wrap gap-4">
              {CHANNELS.map((channel) => (
                <Label key={channel.value} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={channels.includes(channel.value)}
                    onCheckedChange={(checked) =>
                      setChannels((current) =>
                        checked === true
                          ? [...current, channel.value]
                          : current.filter((entry) => entry !== channel.value),
                      )
                    }
                  />
                  {channel.label}
                </Label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              A request, not a guarantee. Whether a channel can run is decided at approval.
            </p>
          </fieldset>
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Campaign not created</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={!complete || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          Create and generate
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
