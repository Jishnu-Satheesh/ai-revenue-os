import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";

import Capabilities from "./capabilities";
import ClosingCta from "./closing-cta";
import Governance from "./governance";
import { Hero } from "./hero";
import HowItWorks from "./how-it-works";

export function LandingPage() {
  return (
    <div className="marketing min-h-screen bg-background text-foreground antialiased">
      <MarketingNav />
      <main>
        <Hero />
        <Capabilities />
        <HowItWorks />
        <Governance />
        <ClosingCta />
      </main>
      <MarketingFooter />
    </div>
  );
}
