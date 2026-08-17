"use client";

import { FormEvent, useState } from "react";
import { Archive, CheckCircle2, Plus, Save, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card as UiCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field as UiField, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";

type Props = {
  organizationId: string;
  snapshot: DigitalTwinSnapshot;
  canManagePolicies: boolean;
  canManageLifecycle: boolean;
};

async function parseResponse(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "The change could not be saved.");
  return payload;
}

export function OverviewEditor({
  organizationId,
  snapshot,
  canManagePolicies,
  canManageLifecycle,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const profile = snapshot.profile;

  async function submit(path: string, body: unknown, method = "POST") {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await parseResponse(
        await fetch(`/api/organizations/${organizationId}/${path}`, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setMessage("Saved. The Digital Twin and audit timeline are up to date.");
      router.refresh();
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function activate() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      await parseResponse(
        await fetch(`/api/organizations/${organizationId}/activate`, { method: "POST" }),
      );
      setMessage("Organization activated. Future decisions can now use this Digital Twin.");
      router.refresh();
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "The organization could not be activated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await parseResponse(
        await fetch(`/api/organizations/${organizationId}`, { method: "DELETE" }),
      );
      // The archived draft now fails the resolver's non-archived filter, so the
      // root sends them to their next organization, or to the create wizard when
      // this was their only one.
      router.push("/");
    } catch (archiveError) {
      setError(
        archiveError instanceof Error
          ? archiveError.message
          : "The organization could not be archived.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {(message || error) && (
        <Alert
          variant={error ? "destructive" : "default"}
          className={error ? undefined : "border-success/30 bg-success/5"}
        >
          <ShieldCheck />
          <AlertTitle>{error ? "Change could not be saved" : "Digital Twin updated"}</AlertTitle>
          <AlertDescription>{error ?? message}</AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="profile">
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label="Organization management sections">
            <TabsTrigger value="profile">Business profile</TabsTrigger>
            <TabsTrigger value="branches">Branches</TabsTrigger>
            <TabsTrigger value="facts">Facts</TabsTrigger>
            <TabsTrigger value="goals">Goals</TabsTrigger>
            <TabsTrigger value="constraints">Constraints</TabsTrigger>
            {canManagePolicies ? <TabsTrigger value="policies">Policies</TabsTrigger> : null}
          </TabsList>
        </div>
        <TabsContent value="profile">
          <ProfileForm
            profile={profile}
            busy={busy}
            onSubmit={(body) => submit("profile", body, "PATCH")}
          />
        </TabsContent>
        <TabsContent value="branches">
          <BranchForm busy={busy} onSubmit={(body) => submit("branches", body)} />
        </TabsContent>
        <TabsContent value="facts">
          <FactForm busy={busy} onSubmit={(body) => submit("facts", body)} />
        </TabsContent>
        <TabsContent value="goals">
          <GoalForm
            branches={snapshot.branches}
            busy={busy}
            onSubmit={(body) => submit("goals", body)}
          />
        </TabsContent>
        <TabsContent value="constraints">
          <ConstraintForm busy={busy} onSubmit={(body) => submit("constraints", body)} />
        </TabsContent>
        {canManagePolicies ? (
          <TabsContent value="policies">
            <PolicyForm
              organizationCurrency={snapshot.organization.base_currency}
              busy={busy}
              onSubmit={(body) => submit("policies", body)}
            />
          </TabsContent>
        ) : null}
      </Tabs>
      {canManageLifecycle ? (
        <UiCard>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-accent" />
                <h3 className="font-semibold">Lifecycle controls</h3>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Activation checks the access policy and physical branch rule. Draft deletion is a
                soft archive.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy || snapshot.organization.status !== "draft_onboarding"}
                onClick={() => setArchiveOpen(true)}
                type="button"
                variant="outline"
              >
                <Archive data-icon="inline-start" />
                Archive draft
              </Button>
              <Button
                disabled={busy || snapshot.organization.status !== "draft_onboarding"}
                onClick={() => void activate()}
                type="button"
              >
                <CheckCircle2 data-icon="inline-start" />
                Activate
              </Button>
            </div>
          </CardContent>
        </UiCard>
      ) : null}
      {canManageLifecycle ? (
        <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this draft organization?</AlertDialogTitle>
              <AlertDialogDescription>
                This is a soft archive and is reversible only through a documented recovery process.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void archive()}>Archive draft</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

function TwinCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <UiCard>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </UiCard>
  );
}

function TwinField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <UiField className={className}>
      <FieldLabel>{label}</FieldLabel>
      {children}
    </UiField>
  );
}

function ProfileForm({
  profile,
  busy,
  onSubmit,
}: {
  profile: DigitalTwinSnapshot["profile"];
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [businessModel, setBusinessModel] = useState(profile?.business_model ?? "");
  const [valueProposition, setValueProposition] = useState(profile?.value_proposition ?? "");
  return (
    <TwinCard
      title="Business profile"
      description="The operating context behind every recommendation."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit({
            businessModel,
            valueProposition,
            customerSegments: profile?.customer_segments ?? [],
            brandContext: profile?.brand_context ?? {},
            languages: profile?.languages ?? [],
            operatingModel: profile?.operating_model ?? {},
            source: "user",
          });
        }}
      >
        <TwinField label="Business model">
          <Textarea
            value={businessModel}
            onChange={(event) => setBusinessModel(event.target.value)}
            placeholder="How the business makes money"
          />
        </TwinField>
        <TwinField label="Value proposition">
          <Textarea
            value={valueProposition}
            onChange={(event) => setValueProposition(event.target.value)}
            placeholder="Why customers choose this business"
          />
        </TwinField>
        <Button disabled={busy} type="submit">
          <Save data-icon="inline-start" />
          Save profile
        </Button>
      </form>
    </TwinCard>
  );
}

function BranchForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState("physical");
  const [timezone, setTimezone] = useState("Asia/Dubai");
  const [currency, setCurrency] = useState("AED");
  return (
    <TwinCard
      title="Branches"
      description="Locations, service areas, capacity, and operating context."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit({ name, slug, kind, timezone, currency });
          setName("");
          setSlug("");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TwinField label="Branch name">
            <Input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Jumeirah"
            />
          </TwinField>
          <TwinField label="Slug">
            <Input
              required
              value={slug}
              onChange={(event) =>
                setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
              placeholder="jumeirah"
            />
          </TwinField>
          <TwinField label="Kind">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="physical">Physical</SelectItem>
                <SelectItem value="virtual">Virtual</SelectItem>
              </SelectContent>
            </Select>
          </TwinField>
          <TwinField label="Currency">
            <Input
              required
              maxLength={3}
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            />
          </TwinField>
          <TwinField label="Timezone" className="sm:col-span-2">
            <Input
              required
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </TwinField>
        </div>
        <Button disabled={busy} type="submit" variant="outline">
          <Plus data-icon="inline-start" />
          Add branch
        </Button>
      </form>
    </TwinCard>
  );
}

function FactForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [factKey, setFactKey] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState("user");
  const [status, setStatus] = useState("verified");
  return (
    <TwinCard
      title="Business facts"
      description="Source-aware facts with explicit verification state."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit({ factKey, value, source, status });
          setFactKey("");
          setValue("");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TwinField label="Fact key">
            <Input
              required
              value={factKey}
              onChange={(event) =>
                setFactKey(event.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "_"))
              }
              placeholder="average_order_value"
            />
          </TwinField>
          <TwinField label="Source">
            <Input
              required
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="owner interview"
            />
          </TwinField>
        </div>
        <TwinField label="Value">
          <Input
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="85"
          />
        </TwinField>
        <TwinField label="Verification state">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="imported">Imported</SelectItem>
              <SelectItem value="inferred">Inferred</SelectItem>
              <SelectItem value="stale">Stale</SelectItem>
            </SelectContent>
          </Select>
        </TwinField>
        <Button disabled={busy} type="submit">
          <Save data-icon="inline-start" />
          Save fact
        </Button>
      </form>
    </TwinCard>
  );
}

function GoalForm({
  branches,
  busy,
  onSubmit,
}: {
  branches: DigitalTwinSnapshot["branches"];
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("");
  const [baselineStatus, setBaselineStatus] = useState("unknown");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("count");
  const [scopeBranchId, setScopeBranchId] = useState("organization");
  return (
    <TwinCard title="Goals" description="Measurable targets with baseline status and scope.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit({
            name,
            metric,
            baselineStatus,
            targetValue: Number(targetValue),
            unit,
            scopeKind: scopeBranchId === "organization" ? "organization" : "branch",
            scopeBranchId: scopeBranchId === "organization" ? null : scopeBranchId,
            priority: 3,
          });
          setName("");
          setMetric("");
          setTargetValue("");
        }}
      >
        <TwinField label="Goal">
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Increase direct inquiries"
          />
        </TwinField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TwinField label="Metric">
            <Input
              required
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
              placeholder="qualified_inquiries"
            />
          </TwinField>
          <TwinField label="Target">
            <Input
              required
              type="number"
              value={targetValue}
              onChange={(event) => setTargetValue(event.target.value)}
              placeholder="100"
            />
          </TwinField>
          <TwinField label="Baseline">
            <Select value={baselineStatus} onValueChange={setBaselineStatus}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="known">Known</SelectItem>
                <SelectItem value="estimated">Estimated</SelectItem>
              </SelectContent>
            </Select>
          </TwinField>
          <TwinField label="Unit">
            <Input required value={unit} onChange={(event) => setUnit(event.target.value)} />
          </TwinField>
        </div>
        <TwinField label="Scope (optional branch)">
          <Select value={scopeBranchId} onValueChange={setScopeBranchId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Organization-wide" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Organization-wide</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TwinField>
        <Button disabled={busy} type="submit">
          <Plus data-icon="inline-start" />
          Add goal
        </Button>
      </form>
    </TwinCard>
  );
}

function ConstraintForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [constraintType, setConstraintType] = useState("budget");
  const [value, setValue] = useState("");
  return (
    <TwinCard
      title="Constraints"
      description="Hard and soft limits the Decision Engine must respect."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit({
            name,
            constraintType,
            value,
            severity: "hard",
            source: "user",
            isActive: true,
          });
          setName("");
          setValue("");
        }}
      >
        <TwinField label="Constraint">
          <Input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Monthly marketing budget"
          />
        </TwinField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TwinField label="Type">
            <Input
              required
              value={constraintType}
              onChange={(event) => setConstraintType(event.target.value)}
            />
          </TwinField>
          <TwinField label="Value">
            <Input
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="5000 AED"
            />
          </TwinField>
        </div>
        <Button disabled={busy} type="submit" variant="outline">
          <Plus data-icon="inline-start" />
          Add constraint
        </Button>
      </form>
    </TwinCard>
  );
}

function PolicyForm({
  organizationCurrency,
  busy,
  onSubmit,
}: {
  organizationCurrency: string;
  busy: boolean;
  onSubmit: (body: unknown) => Promise<void>;
}) {
  const [policyType, setPolicyType] = useState("spend");
  const [name, setName] = useState("Spend and budget policy");
  const [mode, setMode] = useState("approval_required");
  const [budget, setBudget] = useState("");
  return (
    <TwinCard
      title="Policies and budget"
      description="Versioned governance for approvals and bounded autonomy."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onSubmit({
            policyType,
            name,
            mode,
            configuration: {},
            monthlyBudgetMinor: budget ? Number(budget) : null,
            budgetCurrency: organizationCurrency,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TwinField label="Policy type">
            <Input
              required
              value={policyType}
              onChange={(event) => setPolicyType(event.target.value)}
            />
          </TwinField>
          <TwinField label="Name">
            <Input required value={name} onChange={(event) => setName(event.target.value)} />
          </TwinField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TwinField label="Action mode">
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recommendation_only">Recommendation only</SelectItem>
                <SelectItem value="approval_required">Approval required</SelectItem>
                <SelectItem value="bounded_auto_execution">Bounded auto-execution</SelectItem>
              </SelectContent>
            </Select>
          </TwinField>
          <TwinField label={`Monthly budget (${organizationCurrency}, minor units)`}>
            <Input
              type="number"
              min={0}
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              placeholder="500000"
            />
          </TwinField>
        </div>
        <Button disabled={busy} type="submit">
          <ShieldCheck data-icon="inline-start" />
          Save policy version
        </Button>
      </form>
    </TwinCard>
  );
}
