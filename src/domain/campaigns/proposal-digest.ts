import { createHash } from "node:crypto";

import {
  canonicalProposalJson,
  type CampaignProposalDocument,
} from "@/domain/campaigns/proposal";

/**
 * The value a decision is bound to.
 *
 * Same construction as the bundle digest, over the same canonical JSON, so the
 * two cannot drift. Change any word of the proposal and its digest changes,
 * which means an approval recorded against the old digest no longer matches and
 * can no longer authorize preparation.
 *
 * Lives apart from `proposal.ts` on purpose. That module is imported by client
 * components (through the proposal read model into Growth Intelligence), and a
 * top-level `node:crypto` import fails a browser build whether or not anything
 * on the page ever hashes — it took down the whole Growth Intelligence page.
 * The schemas and the pure projection stay where the UI can reach them; the
 * hashing stays here, with the server code that writes versions.
 */
export function proposalDigest(document: CampaignProposalDocument): string {
  return createHash("sha256").update(canonicalProposalJson(document), "utf8").digest("hex");
}
