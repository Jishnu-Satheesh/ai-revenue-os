import { brandGuidelinesSchema, type BrandGuidelines } from "@/domain/brand/guidelines";
import { brandVoiceOptions } from "@/domain/onboarding/vocabularies";

/**
 * Turning finished onboarding answers into the canonical business record.
 *
 * Onboarding stores every section's answers against the session. That is the
 * record of what was asked and answered, and it is not what the rest of the
 * platform reads. A section is only actually *in force* once it has been
 * promoted to the canonical tables — `organizations`, `business_profiles` —
 * which is where campaign generation, the Decision Engine and reporting look.
 *
 * Brand assets was collected but never promoted, so `brand_context ->> 'voice'`
 * stayed null no matter how carefully the section was filled in, and every
 * campaign reported `brand_voice` missing. These are the rules for that
 * promotion, kept pure so they can be tested without a database.
 */

const brandVoiceLabels = new Map<string, string>(
  brandVoiceOptions.map((option) => [option.value, option.label]),
);

/**
 * The brand context a completed brand assets section puts in force.
 *
 * Returns null when the section supplies nothing, so the caller writes nothing
 * rather than writing a blank. A missing voice must stay a named gap at
 * generation — an operator can act on that. An invented one produces confident
 * creative nobody approved.
 */
export function brandContextFromBrandAssets(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const voice = readVoice(payload.brandVoice);
  return voice ? { voice } : null;
}

/**
 * The traits as one readable line.
 *
 * `load_campaign_creation_facts` reads this key with `->>`, as text, and passes
 * it to the model as a stated fact about the brand. It is prose by the time
 * anything consumes it, so it is stored as prose. An unrecognised value is kept
 * verbatim rather than dropped: the vocabulary may grow, and an answer already
 * given must not disappear because this map has not caught up.
 */
function readVoice(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const traits = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => brandVoiceLabels.get(entry) ?? entry);
  return traits.length > 0 ? traits.join(", ") : null;
}

/**
 * Folds a patch into the brand context already on record.
 *
 * Sections are completed in any order and each promotes its own keys. A write
 * that replaced the whole object made the last section to be saved the only one
 * that counted: saving business identity erased a voice brand assets had
 * already promoted, which is why re-filling the voice appeared to do nothing.
 *
 * Anything that is not a plain object — null, a string, an array — is treated
 * as empty. It cannot be merged into, and refusing to promote because a stored
 * value is malformed would strand the organization on bad data it cannot see.
 */
export function mergeBrandContext(
  existing: unknown,
  patch: Record<string, unknown> | null,
): Record<string, unknown> {
  const base =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  return patch ? { ...base, ...patch } : { ...base };
}

/**
 * The brand guidelines a completed brand assets section puts in force.
 *
 * Same discipline as the voice above, for the same reason: `hardConstraints`,
 * `softConventions` and `restrictedTerms` have been read by
 * `load_campaign_creation_facts`, rendered into the image prompt and checked by
 * the content policy since generation was written, and nothing ever wrote them.
 * This is one of the two producers.
 *
 * Returns null in two cases, and both matter:
 *
 * - **Nothing was supplied.** Writing `{}` / `[]` / `[]` would replace rules an
 *   operator set in the Asset Library tab with empty lists, removing
 *   constraints nobody asked to remove.
 * - **What was supplied does not parse.** The whole record is refused rather
 *   than promoting the valid half. A partial promotion reports a successful
 *   save for answers that were in fact discarded, and the one answer most
 *   likely to be malformed — a rule with no strength — is exactly the one whose
 *   loss changes what the platform will publish.
 */
export function guidelinesFromBrandAssets(
  payload: Record<string, unknown>,
): BrandGuidelines | null {
  const parsed = brandGuidelinesSchema.safeParse({
    palette: payload.palette ?? {},
    rules: payload.brandRules ?? [],
    restrictedTerms: payload.restrictedTerms ?? [],
  });
  if (!parsed.success) return null;

  const { palette, rules, restrictedTerms } = parsed.data;
  const supplied =
    Object.keys(palette).length > 0 || rules.length > 0 || restrictedTerms.length > 0;
  return supplied ? parsed.data : null;
}
