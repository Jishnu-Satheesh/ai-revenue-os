import { DomainError } from "@/lib/errors";

export type BrandAssetPersistenceFailure = { code?: string; message?: string };

export function throwBrandAssetMutationError(error: BrandAssetPersistenceFailure): never {
  const databaseMessage = error.message ?? "";

  if (databaseMessage.includes("organization_mismatch")) {
    throw new DomainError("TENANT_SCOPE_ERROR", "That asset is not available.", error);
  }
  if (databaseMessage.includes("_not_found") || databaseMessage.includes("_subject_not_found")) {
    throw new DomainError("TENANT_SCOPE_ERROR", "That asset is not available.", error);
  }
  if (databaseMessage.includes("_forbidden") || error.code === "42501") {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to change this asset.",
      error,
    );
  }
  if (databaseMessage.includes("brand_asset_tags_duplicate")) {
    throw new DomainError("VALIDATION_ERROR", "Asset tags must be unique.", error);
  }
  if (databaseMessage.includes("brand_asset_classification_required")) {
    throw new DomainError("VALIDATION_ERROR", "Choose at least one role for this asset.", error);
  }
  if (databaseMessage.includes("brand_asset_existing_classification_forbidden")) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Update classification on the asset, not on one of its versions.",
      error,
    );
  }
  if (databaseMessage.includes("creative_review_reason_not_found")) {
    throw new DomainError("VALIDATION_ERROR", "Choose a governed review reason.", error);
  }
  if (
    error.code === "22P02" ||
    error.code === "23503" ||
    error.code === "23514" ||
    databaseMessage.includes("_invalid")
  ) {
    throw new DomainError("VALIDATION_ERROR", "Please check the asset metadata.", error);
  }

  throw new DomainError("DOMAIN_ERROR", "The asset could not be changed.", error);
}
