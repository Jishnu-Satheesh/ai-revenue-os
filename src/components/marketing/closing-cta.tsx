import { closingCta, WALKTHROUGH_MAILTO } from "@/components/marketing/content";
import { Button } from "@/components/ui/button";

function ClosingCta() {
  return (
    <section className="relative overflow-hidden px-6 py-32 sm:py-40">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[420px]"
        style={{
          background:
            "radial-gradient(ellipse 45% 60% at 50% 100%, var(--primary) 0%, transparent 70%)",
          opacity: 0.3,
        }}
      />
      <div className="relative mx-auto max-w-2xl text-center">
        <h2 className="bg-gradient-to-b from-foreground to-foreground/75 bg-clip-text text-balance text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
          {closingCta.headline}
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{closingCta.body}</p>
        <div className="mt-9">
          <Button size="lg" asChild>
            <a href={WALKTHROUGH_MAILTO}>{closingCta.ctaLabel}</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

export default ClosingCta;
