import { governance } from "@/components/marketing/content";

import { ApprovalReceipt } from "./approval-receipt";

function Governance() {
  return (
    <section className="px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-20">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Governance
            </p>
            <h2 className="mt-4 max-w-xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
              {governance.heading}
            </h2>
          </div>
          <div>
            <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
              {governance.subheading}
            </p>
            <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {governance.items.map((item) => (
                <div key={item.title}>
                  <dt className="text-sm font-medium tracking-tight">{item.title}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <div className="mt-16">
          <ApprovalReceipt />
        </div>
      </div>
    </section>
  );
}

export default Governance;
