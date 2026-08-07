"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";

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
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setIsSubmitting(false);
    if (authError) setError("We could not send the sign-in link. Check the email and try again.");
    else setMessage("Check your inbox for a secure sign-in link.");
  }

  return <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12"><div className="w-full max-w-md"><div className="mb-10"><div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-foreground text-background"><ArrowRight size={22} /></div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Revenue Intelligence</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Sign in to AI Revenue OS</h1><p className="mt-3 text-muted-foreground">Use your workspace email. We’ll send a passwordless sign-in link.</p></div><form onSubmit={submit} className="rounded-xl border border-border bg-surface p-6"><label htmlFor="email" className="text-sm font-medium">Work email</label><input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none ring-accent focus:ring-2" placeholder="you@company.com" /><button disabled={isSubmitting} className="mt-4 w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background disabled:opacity-50" type="submit">{isSubmitting ? "Sending…" : "Send sign-in link"}</button>{message && <p className="mt-4 text-sm text-success">{message}</p>}{error && <p className="mt-4 text-sm text-danger">{error}</p>}</form><p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={14} />Authentication is handled by Supabase Auth.</p></div></main>;
}
