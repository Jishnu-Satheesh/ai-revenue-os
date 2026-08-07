"use client";

import { FormEvent, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Building2, Check, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function NewOrganizationPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [industry, setIndustry] = useState("restaurant");
  const [industryPackSlug, setIndustryPackSlug] = useState("restaurant");
  const [countryCode, setCountryCode] = useState("AE");
  const [currency, setCurrency] = useState("AED");
  const [timezone, setTimezone] = useState("Asia/Dubai");
  const [hasBranch, setHasBranch] = useState(true);
  const [branchName, setBranchName] = useState("");
  const [branchSlug, setBranchSlug] = useState("");
  const [branchKind, setBranchKind] = useState<"physical" | "virtual">("physical");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const progress = useMemo(() => Math.round((step / 3) * 100), [step]);

  function moveToIdentity() {
    setSlug((current) => current || slugify(name));
    setStep(2);
  }

  function moveToBranch() {
    setBranchSlug((current) => current || slugify(branchName));
    setStep(3);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const response = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        slug,
        industry,
        industryPackSlug,
        countryCode,
        currency,
        timezone,
        firstBranch: hasBranch
          ? { name: branchName, slug: branchSlug, kind: branchKind, timezone, currency }
          : null,
      }),
    });
    const payload = await response.json().catch(() => null);
    setIsSubmitting(false);
    if (!response.ok) {
      setError(payload?.error?.message ?? "Organization could not be created.");
      return;
    }
    router.push(`/organizations/${payload.organization.id}/onboarding`);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex items-center justify-between gap-6">
        <div>
          <Button asChild variant="link" className="h-auto p-0 text-muted-foreground">
            <Link href="/overview">
              <ArrowLeft data-icon="inline-start" />
              Back to overview
            </Link>
          </Button>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight">Create organization</h2>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Start with the minimum trusted context. You can save unknowns and complete the Digital
            Twin later.
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-xs font-medium text-muted-foreground">Step {step} of 3</p>
          <p className="mt-1 text-sm font-semibold">{progress}% ready</p>
        </div>
      </div>
      <Progress value={progress} aria-label={`Onboarding progress: ${progress}%`} />
      <form onSubmit={submit}>
        <Card>
          {step === 1 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <Building2 />
                  </span>
                  Business identity
                </CardTitle>
                <CardDescription>
                  The stable context used across every downstream decision.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="organization-name">Organization name</FieldLabel>
                    <Input
                      id="organization-name"
                      required
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      onBlur={() => setSlug((current) => current || slugify(name))}
                      placeholder="Al Noor Kitchen"
                    />
                  </Field>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="organization-slug">Slug</FieldLabel>
                      <Input
                        id="organization-slug"
                        required
                        value={slug}
                        onChange={(event) => setSlug(slugify(event.target.value))}
                        placeholder="al-noor-kitchen"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="organization-industry">Industry</FieldLabel>
                      <Input
                        id="organization-industry"
                        required
                        value={industry}
                        onChange={(event) => setIndustry(event.target.value)}
                        placeholder="restaurant"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="country-code">Country code</FieldLabel>
                      <Input
                        id="country-code"
                        required
                        maxLength={2}
                        value={countryCode}
                        onChange={(event) => setCountryCode(event.target.value.toUpperCase())}
                        className="uppercase"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="base-currency">Base currency</FieldLabel>
                      <Input
                        id="base-currency"
                        required
                        maxLength={3}
                        value={currency}
                        onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                        className="uppercase"
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="default-timezone">Default timezone</FieldLabel>
                    <Input
                      id="default-timezone"
                      required
                      value={timezone}
                      onChange={(event) => setTimezone(event.target.value)}
                      placeholder="Asia/Dubai"
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={moveToIdentity}
                      disabled={!name || !slug || !industry}
                    >
                      Continue
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </div>
                </FieldGroup>
              </CardContent>
            </>
          )}
          {step === 2 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <Check />
                  </span>
                  Industry pack
                </CardTitle>
                <CardDescription>
                  Keep industry-specific behavior installable and outside the platform core.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="industry-pack">Installed pack</FieldLabel>
                    <Select value={industryPackSlug} onValueChange={setIndustryPackSlug}>
                      <SelectTrigger id="industry-pack" className="w-full">
                        <SelectValue placeholder="Select an industry pack" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="restaurant">Restaurant</SelectItem>
                        <SelectItem value="core">Core only</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <FieldDescription className="rounded-lg border border-border bg-muted/30 p-4">
                    The restaurant pack adds menu, branch, and delivery concepts later. It does not
                    change the industry-neutral organization model.
                  </FieldDescription>
                  <div className="flex justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setStep(1)}>
                      <ArrowLeft data-icon="inline-start" />
                      Back
                    </Button>
                    <Button type="button" onClick={moveToBranch}>
                      Continue
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </div>
                </FieldGroup>
              </CardContent>
            </>
          )}
          {step === 3 && (
            <>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                    <MapPin />
                  </span>
                  First branch
                </CardTitle>
                <CardDescription>
                  Add a location now, or keep this organization branchless until later.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field orientation="horizontal" className="rounded-lg border border-border p-4">
                    <Checkbox
                      id="has-branch"
                      checked={hasBranch}
                      onCheckedChange={(checked) => setHasBranch(checked === true)}
                    />
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="has-branch">
                        This organization has a branch to add now
                      </FieldLabel>
                      <FieldDescription>
                        Physical restaurant organizations need an active physical branch before
                        activation.
                      </FieldDescription>
                    </div>
                  </Field>
                  {hasBranch && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field className="sm:col-span-2">
                        <FieldLabel htmlFor="branch-name">Branch name</FieldLabel>
                        <Input
                          id="branch-name"
                          required={hasBranch}
                          value={branchName}
                          onChange={(event) => setBranchName(event.target.value)}
                          onBlur={() => setBranchSlug((current) => current || slugify(branchName))}
                          placeholder="Jumeirah branch"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="branch-slug">Branch slug</FieldLabel>
                        <Input
                          id="branch-slug"
                          required={hasBranch}
                          value={branchSlug}
                          onChange={(event) => setBranchSlug(slugify(event.target.value))}
                          placeholder="jumeirah"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="branch-kind">Branch kind</FieldLabel>
                        <Select
                          value={branchKind}
                          onValueChange={(value) => setBranchKind(value as "physical" | "virtual")}
                        >
                          <SelectTrigger id="branch-kind" className="w-full">
                            <SelectValue placeholder="Select a branch kind" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="physical">Physical</SelectItem>
                            <SelectItem value="virtual">Virtual</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setStep(2)}>
                      <ArrowLeft data-icon="inline-start" />
                      Back
                    </Button>
                    <Button
                      disabled={isSubmitting || (hasBranch && (!branchName || !branchSlug))}
                      type="submit"
                    >
                      {isSubmitting ? "Creating…" : "Create organization"}
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </div>
                  {error && (
                    <Alert variant="destructive">
                      <AlertCircle />
                      <AlertTitle>Organization could not be created</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}
                </FieldGroup>
              </CardContent>
            </>
          )}
        </Card>
      </form>
    </div>
  );
}
