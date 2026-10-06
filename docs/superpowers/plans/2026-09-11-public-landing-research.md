# Public landing — research and decisions

Research date: 2026-09-11. Repository inspected at `b139ba0`, with unrelated work already dirty. This is a planning record, not a claim that the redesigned page has been implemented.

## Reference study

| Reference                           | Useful principle                                                                             | RIO translation                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Linear](https://linear.app/)       | Editorial hierarchy, substantial product demonstrations, chapters arranged around a workflow | Let owners follow a business decision; make the product example the visual centerpiece |
| [Attio](https://attio.com/)         | Business context and AI connected through concrete product situations                        | Show reports, goals and constraints feeding a supported recommendation                 |
| [Raycast](https://www.raycast.com/) | Focused product demonstrations and immediate utility                                         | Every RIO interaction exposes a useful state; controls respond directly                |
| [Ramp](https://ramp.com/)           | Business outcomes and cost-related workflows lead the story                                  | Explain why sales alone are insufficient; show arithmetic and its limits               |

These are inspirations, not templates. No competitor copy, logo, artwork, interface screenshot or animation source is to be shipped in RIO. RIO is also not a CRM, launcher or finance platform: don't borrow those products' capability claims.

## Linear section map

Observed from its current public page and browser DOM; the resulting RIO architecture is original.

| Linear section or role | Decision for RIO                                |
| ---------------------- | ----------------------------------------------- |
| Navigation             | Small anchor navigation with Sign in            |
| Hero and interface     | Owner-focused headline and inspectable example  |
| Customer proof         | Omit unsupported logos; show product principles |
| Product philosophy     | Three concise principles                        |
| Intake                 | Business-context chapter                        |
| Planning               | Recommendation chapter                          |
| Agents                 | Explain reasoning through the example           |
| Build/review           | Human-control chapter                           |
| Changelog              | Omit; no public editorial feed exists           |
| Testimonials           | Omit; no approved customer evidence supplied    |
| Closing CTA            | One working next step                           |
| Footer                 | Only implemented destinations                   |

The useful lesson is the sequence: a clear promise, visible product behavior, deeper explanation, then confidence to act. Repeating identical feature cards would lose that pacing.

## Current RIO audit

| Finding                                                                        | Visitor impact                                            | Planned correction                                                       |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Long headline emphasizes “client revenue” and “operating cockpit”              | An owner must translate agency/software language          | Short outcome headline; plain category sentence                          |
| Large top gap and long introduction                                            | Product value arrives late                                | Bounded hero spacing and visible start of example                        |
| Decorative dates, ranges and sidebar icons look actionable                     | Visitors cannot explore what appears to be an application | A smaller demonstration with explicit, working tabs                      |
| Separate dashboard, ranked list, timeline and receipt invent different stories | It is hard to follow cause and effect                     | One coherent fictional two-channel comparison                            |
| “Settled”, “Executed”, confidence and uplift claims                            | Product availability and measurement can be misunderstood | Evidence + limitations + review-required state                           |
| Current examples use the pilot's name                                          | Public illustration resembles a customer disclosure       | “Example business” with a persistent fictional-data caption              |
| Footer and CTAs reuse an unconfirmed mailto                                    | Interested visitors may reach an unverified inbox         | User-selected dialog and Resend delivery to configured service inbox     |
| Emerald implementation vs indigo spec                                          | A weaker agent has conflicting instructions               | Explicit approved public token map; amend Spec 021 during implementation |

## Evidence quality and limits

- Public text fetched directly from all four reference sites. Search was used for discovery; secondary “best website” articles are not authority for the design or performance claims.
- Browser inspected Linear's loaded hero and interactive-element snapshot, including its product demonstration and section headings. A middle-page capture was also taken. Attio and Raycast were opened in Chromium; Attio's early screenshot caught incomplete visual loading, so exact Attio layout or animation timings are not claimed. Ramp's browser capture did not expose its page content; only direct web text was usable.
- The current RIO route was opened signed out at `http://localhost:3011/`. Browser snapshot showed its sections and CTA links; its screenshot confirmed the desktop hero composition. Browser error collection was empty. This is inspection of the existing page, not acceptance of the proposed redesign.
- User subsequently confirmed Book a walkthrough must open an email/phone/industry dialog and email customer service through Resend. That requirement replaces the initial anchor-CTA assumption.
- Session screenshots were saved under `/tmp/rio-landing-research/` for this review. They are temporary, not handoff dependencies. The durable instructions are the visual contract and execution plan.
- No live database, provider capability, customer result, booking inbox or authenticated-browser session was inspected. Repository evidence constrains the public copy; it is not production qualification.

## Implementation implications

- Keep RIO's Manrope typography and repository primitives. New visual identity comes from proportions, hierarchy and coherent demonstrations, not a dependency change.
- Use a warm dark page with readable muted text. Don't reproduce Linear's assets, project-management terminology, exact section titles or geometry.
- Favor click/touch/keyboard state changes over scroll choreography. The page should still be understandable when motion and JavaScript are unavailable.
- A future case study can replace some introductory proof only after approved facts and permissions exist. It is not part of this plan and no empty slot should be rendered for it.
