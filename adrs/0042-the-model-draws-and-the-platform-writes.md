# ADR 0042: The model draws and the platform writes

## Status

Accepted. Implements `specs/020-campaign-creative-studio.md`, approved 2026-08-24. Depends on
ADR 0041, which anchors what is depicted; this decides what the picture says.

Amends the reasoning behind the text prohibition in `model-router.ts:245` without weakening it.

## Context

Of four campaign assets examined on 2026-08-24, exactly one attempted text. It rendered *"Explore
Our Mezza"* — misspelled — above *"'The Joy of Sharing'"* with a stray leading apostrophe, over
shapes resembling Arabic without being Arabic.

That is not a prompting failure with a prompting fix. Image models draw letterforms as shapes. Latin
emerges *nearly* right often enough to be dangerous; Arabic emerges as ornament; Malayalam, with
conjunct consonants, reordering vowel signs and far less training data, emerges worse still.

The platform's answer had been to forbid text outright. That instruction was written to stop a model
inventing a discount, and it succeeded. It also removed the only thing a promotional flyer exists to
say — campaign `783ab4e1` went out as three scheduled posts carrying a photograph and `offer: null`.

The pilot client sells Kerala food in Dubai and needs Malayalam, English and Arabic. There is no
locale, script, bidi or font handling anywhere in the repository, no compositor, and no verification
of any generated image beyond a byte sniff in `asset-intake.ts`.

So the choice was never "better prompts" versus "no text". It was: who writes the words.

## Decision

### The model draws; the platform writes

An image model draws food convincingly and spells badly. A layout engine spells perfectly and cannot
draw food. Each was being asked to do the other's job.

A generated image is now a **plate** — the photograph or drawing from ADR 0041, carrying no text at
all. Every visible word is a **layer**, composited by deterministic code from a value the manifest
already approved. The two together are a **poster**.

The prohibition on rendered text therefore becomes *stronger* and moves: absolute on the plate, in
any script, rather than limited to price, discount and claim text. And the offer becomes renderable,
because it is now quoted from a governed figure rather than recalled by a generator. The concern
behind the original rule is fully answered by the model no longer writing any text at all.

### A render is a pure function of its pinned inputs

Plate bytes, template version, text values and font versions determine the output bytes. The same
inputs render identically today and next month, and the render digest proves it.

This is what makes ADR 0017's approval binding meaningful for imagery. What was approved is what
publishes, and any change to any input is a new version rather than a quiet substitution.

**Fonts are inputs, not ambient facts about a machine.** They are vendored, pinned by version and
content hash, and asserted at worker start. A container's font configuration is not something anybody
approved, and a font that silently updates changes what a client publishes.

### Refuse rather than approximate

A codepoint the registered font cannot cover refuses **before** rendering, naming the codepoint. This
is deterministic and exact, where inspecting the image afterwards would be probabilistic — and it is
what makes an empty box on a customer's screen impossible rather than unlikely.

Text that will not fit is shrunk within declared bounds and then refused. Nothing is truncated,
ellipsised or overflowed. A script declared with no text refuses that render rather than falling back
to English, because a silent language fallback is the failure nobody notices.

### In a masked edit, the platform decides which pixels changed

An edit is a set of annotated regions submitted together. The model's output is composited back
inside the **union of those regions only**, feathered at the edges, so every pixel outside is
byte-identical to the parent plate.

This is a property of the code rather than a promise from the model. It also means a wholly
successful prompt injection in an operator's edit instruction still cannot alter a pixel outside the
marked area — the boundary is computed by the platform, not requested of the generator.

Nothing is edited in place. An edit produces a new plate version, and because the bundle digest
changes, an edit after approval invalidates approval under ADR 0017. That is intended.

### A model may report what it sees; it may never decide whether it passes

The verification pass blocks on three checks: glyph coverage, text present on the plate, and
identifiable faces. A model may perform the detection — that is the extraction role `AGENTS.md`
permits. The pass or refusal is deterministic code reading the report, consistent with spec 016's
rule that no model chooses a verdict.

A checker that cannot run records `verification_unavailable` and blocks. Unknown is not a pass.

A fourth check — does this still look like the declared dish — is advisory and never blocks, because
a model judging another model's output is weak evidence and should not be able to stop work.

## Consequences

A restaurant can publish a flyer whose price is the price they approved, in the script they chose,
without a designer and without correcting it. The half of the original complaint that ADR 0041
deliberately left open is closed.

`campaign_visual_attestations` is unaffected. It records a human stating they looked at an exact
digest, and remains an approval instrument rather than a verification pass.

The cost is a genuine new dependency: a text renderer with real shaping, and vendored fonts. This is
the substantive risk of the decision and is not hidden — spec 020 §18 requires a spike proving
Malayalam conjuncts, Arabic joining and mixed bidi render correctly **before any other task begins**.
If no available renderer shapes Malayalam correctly, the scope reduces to Latin and Arabic and the
client is told plainly rather than shipped boxes.

A second cost is that templates constrain design. An operator cannot place type freely, and some
posters they can imagine will not be expressible. That is the price of text being exact by
construction, and it is the right trade for a platform whose value rests on what it can prove.

The risk accepted is that reproducibility depends on a native library's shaping behaviour staying
stable. Golden-image tests per script exist so that an upgrade which changes shaping is caught by
the suite rather than discovered on a client's feed.
