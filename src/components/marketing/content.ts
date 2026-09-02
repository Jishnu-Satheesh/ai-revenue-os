export const WALKTHROUGH_MAILTO = "mailto:walkthroughs@airevenueos.com";

export const nav = {
  productName: "RIO",
  signInLabel: "Sign in",
  signInHref: "/login",
  ctaLabel: "Book a walkthrough",
};

export const hero = {
  eyebrow: "Revenue intelligence for client businesses",
  headline: "The operating cockpit for measurable client revenue.",
  subhead:
    "RIO builds a living twin of every business you serve, surfaces the safest high-value action each day, and measures what actually moved gross profit — with a human approving every consequential step.",
  primaryCta: "Book a walkthrough",
};

export const illustrativeOpportunity = {
  caption: "Illustrative example of how an opportunity appears in the product.",
  category: "Menu engineering",
  title: "Weekend family bundle push",
  channel: "Meta Ads · Dubai branch",
  impactLabel: "Estimated incremental gross profit",
  impact: "AED 3,200–4,600 / month",
  confidence: "82% confidence",
  evidence: ["Weekend footfall trending up", "Combo margin verified", "Budget within policy"],
  status: "Needs your approval",
};

export const announcement = {
  badge: "New",
  text: "Governed Channel Intelligence",
};

export const capabilitiesIntro =
  "Every recommendation carries its evidence, its estimated impact and its cost — so acting on the list is a decision you can see, not a black box.";

export const capabilities = [
  {
    fig: "FIG 01",
    title: "See every business clearly",
    description:
      "A living Digital Twin holds each organization's goals, branches, constraints and facts — with every fact carrying its source and confidence.",
    artifact: {
      kind: "facts" as const,
      rows: [
        { label: "Weekend footfall", value: "Trending up", source: "GBP · verified" },
        { label: "Combo margin", value: "AED 18 est. / order", source: "Menu data" },
        { label: "Ad budget policy", value: "AED 150 / day cap", source: "Policy" },
      ],
    },
  },
  {
    fig: "FIG 02",
    title: "Act on ranked opportunities",
    description:
      "The Decision Engine ranks actions by expected value, cost, confidence and risk, and shows the evidence behind every ranking before anything runs.",
    artifact: {
      kind: "ranked" as const,
      rows: [
        { title: "Weekend family bundle", score: 92, impact: "AED 3,200–4,600 / mo est." },
        { title: "Google Business posts", score: 76, impact: "AED 900–1,400 / mo est." },
        { title: "Repeat-visit winback", score: 61, impact: "AED 600–950 / mo est." },
      ],
    },
  },
  {
    fig: "FIG 03",
    title: "Prove what worked",
    description:
      "Executed actions settle against explicit baselines, so results compound into incremental gross profit instead of vanity metrics.",
    artifact: {
      kind: "outcome" as const,
      action: "Weekend Google Business posts",
      baseline: "AED 3,100 / wk",
      measured: "AED 3,900 / wk",
      delta: "+AED 800 est.",
      status: "Settled",
    },
  },
];

export const howItWorksIntro =
  "Four stages, one loop: the twin learns the business, opportunities surface with evidence, consequential actions wait for a person, and outcomes settle against baselines.";

export const howItWorks = [
  {
    step: "01",
    title: "Twin",
    description:
      "Guided onboarding builds a structured twin of the business — goals, constraints, policies and branches in one place.",
  },
  {
    step: "02",
    title: "Opportunities",
    description:
      "Data sources connect at any pace. Ranked opportunities surface with evidence, cost, expected profit and risk attached.",
  },
  {
    step: "03",
    title: "Approval",
    description:
      "Low-risk actions run inside policy. Consequential ones wait for a recorded human decision.",
  },
  {
    step: "04",
    title: "Measurement",
    description:
      "Outcomes are measured against baselines. What worked feeds the playbook library; what did not is learned too.",
  },
];

export const timeline = {
  weeks: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"],
  phases: [
    { label: "Twin", start: 0, span: 2, state: "done" as const },
    { label: "Opportunities", start: 1, span: 3, state: "done" as const },
    { label: "Approval", start: 3, span: 2, state: "active" as const },
    { label: "Measurement", start: 5, span: 3, state: "upcoming" as const },
  ],
};

export const receipt = {
  id: "DEC-2041",
  title: "Weekend family bundle push",
  caption: "Illustrative audit trail — every decision stays explainable after the fact.",
  steps: [
    {
      label: "Proposed",
      detail: "Evidence attached · 3 sources",
      time: "Fri 09:12",
    },
    {
      label: "Approved",
      detail: "Amira · owner",
      time: "Fri 09:31",
    },
    {
      label: "Executed",
      detail: "Budget applied within policy",
      time: "Fri 09:31",
    },
    {
      label: "Measured",
      detail: "+AED 800 est. first week",
      time: "W1 settled",
    },
  ],
};

export const governance = {
  heading: "Advise freely, execute narrowly",
  subheading:
    "The system recommends with evidence and executes only inside the boundaries you set.",
  items: [
    {
      title: "Human approval gates",
      description:
        "Consequential actions wait for a person. Nothing touches budgets or the brand on its own.",
    },
    {
      title: "Complete audit trail",
      description:
        "Every recommendation, decision and execution stays recorded and explainable afterwards.",
    },
    {
      title: "Tenant isolation",
      description:
        "Each client organization's data is isolated at the database layer and verified by tests.",
    },
    {
      title: "Policy-bounded execution",
      description:
        "Spending, pricing and public-facing changes stay inside the policies you configure.",
    },
  ],
};

export const closingCta = {
  headline: "Know exactly what to do next.",
  body: "See how RIO turns fragmented client data into measured, approved revenue actions.",
  ctaLabel: "Book a walkthrough",
};

export const footer = {
  tagline: "A trustworthy operating cockpit for measurable revenue growth.",
  signInLabel: "Sign in",
  signInHref: "/login",
  contactLabel: "Book a walkthrough",
  copyright: `© ${new Date().getFullYear()} RIO`,
};

export const dashboardMock = {
  caption: "Illustrative interface preview — how decisions appear across the cockpit.",
  orgName: "Al Noor Kitchen",
  branch: "Dubai · 3 branches",
  ranges: ["7d", "30d", "90d"],
  activeRange: "30d",
  kpis: [
    {
      label: "Est. incremental gross profit",
      value: "AED 12,480",
      delta: "+8.2% vs baseline",
    },
    {
      label: "Direct orders",
      value: "1,284",
      delta: "+12.0%",
    },
    {
      label: "Repeat purchase rate",
      value: "31%",
      delta: "+3.1 pt",
    },
  ],
  chartTitle: "Measured vs baseline gross profit",
  legendMeasured: "Measured",
  legendBaseline: "Baseline",
  feedTitle: "Opportunity feed",
  feed: [
    {
      title: "Weekend family bundle push",
      meta: "Menu engineering · Meta Ads",
      status: "Needs approval",
      pending: true,
    },
    {
      title: "Weekend Google Business posts",
      meta: "Local discovery · GBP",
      status: "Executed",
      pending: false,
    },
  ],
  feedNote: "Consequential actions wait for a recorded human decision.",
  floatApproval: "Approval recorded · audit trail updated",
  floatImpact: "AED 4,600 / mo est.",
};
