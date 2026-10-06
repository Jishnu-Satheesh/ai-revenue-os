import { DomainError } from "@/lib/errors";
import type { BrandGuidelines } from "@/domain/brand/guidelines";
import type { BrandLogoSelection } from "@/domain/brand/logo";

/**
 * Reading and writing an organization's brand identity.
 *
 * Thin on purpose: the shapes are validated in the domain, the tenancy is
 * enforced in Postgres by forced RLS and a composite foreign key, and the
 * permission is checked by the policy. What is left here is the one rule
 * neither of those can express — that a logo may only point at an image whose
 * bytes this server has actually validated.
 */

export type BrandIdentity = {
  guidelines: BrandGuidelines;
  logos: BrandLogoSelection[];
};

export type BrandIdentityPorts = {
  readGuidelines(): Promise<BrandGuidelines>;
  writeGuidelines(guidelines: BrandGuidelines): Promise<void>;
  readLogos(): Promise<BrandLogoSelection[]>;
  setLogo(selection: BrandLogoSelection): Promise<void>;
  /** Whether the server has decoded, re-encoded and hashed this version. */
  isVersionUsable(brandAssetVersionId: string): Promise<boolean>;
};

/**
 * Both halves in one read.
 *
 * The panel shows the logo beside the rules, and two round trips would let it
 * render a mark from one moment next to rules from another.
 */
export async function readBrandIdentity(ports: BrandIdentityPorts): Promise<BrandIdentity> {
  const [guidelines, logos] = await Promise.all([ports.readGuidelines(), ports.readLogos()]);
  return { guidelines, logos };
}

export async function saveBrandGuidelines(
  guidelines: BrandGuidelines,
  ports: BrandIdentityPorts,
): Promise<void> {
  await ports.writeGuidelines(guidelines);
}

/**
 * Points the brand mark at an image.
 *
 * The usability check is not a formality and it has to happen first. A version
 * is unusable until the server has decoded, re-encoded and hashed its bytes;
 * pointing the logo at one would put bytes nobody validated in front of every
 * viewer of the platform and into every generation request the organization
 * makes.
 */
export async function saveBrandLogo(
  selection: BrandLogoSelection,
  ports: BrandIdentityPorts,
): Promise<void> {
  if (!(await ports.isVersionUsable(selection.brandAssetVersionId))) {
    throw new DomainError("DOMAIN_ERROR", "That image is not available to use as a logo yet.");
  }
  await ports.setLogo(selection);
}
