"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="flex min-h-screen items-center justify-center p-8"><div className="max-w-md text-center"><h1 className="text-2xl font-semibold">Something went wrong</h1><p className="mt-2 text-muted-foreground">The issue was recorded. You can safely try again.</p><button type="button" onClick={reset} className="mt-6 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background">Try again</button></div></main>;
}
