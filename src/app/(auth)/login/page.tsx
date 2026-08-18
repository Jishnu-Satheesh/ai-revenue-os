"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/browser";
import { authCallbackUrl } from "@/lib/public-env";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: authCallbackUrl() },
    });
    setIsSubmitting(false);
    if (authError) setError("We could not send the sign-in link. Check the email and try again.");
    else setMessage("Check your inbox for a secure sign-in link.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-10">
          <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
            <ArrowRight />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Revenue Intelligence
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sign in to AI Revenue OS</h1>
          <p className="mt-3 text-muted-foreground">
            Use your workspace email. We’ll send a passwordless sign-in link.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Sign in securely with a one-time link.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">Work email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                  />
                  <FieldDescription>We never share your workspace email.</FieldDescription>
                </Field>
                <Button disabled={isSubmitting} type="submit" className="w-full">
                  {isSubmitting ? "Sending…" : "Send sign-in link"}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </FieldGroup>
            </form>
            {message && (
              <Alert className="mt-4 border-success/30 bg-success/5">
                <ShieldCheck />
                <AlertTitle>Link sent</AlertTitle>
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Sign-in unavailable</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        {/* <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck />
          Authentication is handled by Supabase Auth.
        </p> */}
      </div>
    </main>
  );
}
