import { DomainError } from "@/lib/errors";

/**
 * Turning a database refusal into something a person can act on.
 *
 * Every governed writer raises a named exception rather than returning a
 * status, so the mapping is on the name, not on the text. Two rules matter:
 * a refusal never echoes the database message back to the browser (it can
 * carry row contents), and "you may not" and "it is not there" both come back
 * as the same unavailability, so nobody can probe another tenant's library by
 * watching which answer they get.
 */

export type CreativeHistoryPersistenceFailure = { code?: string; message?: string };

export function throwCreativeHistoryMutationError(
  error: CreativeHistoryPersistenceFailure,
): never {
  const databaseMessage = error.message ?? "";

  if (databaseMessage.includes("creative_folder_cycle")) {
    throw new DomainError("VALIDATION_ERROR", "A folder cannot be inside itself.", error);
  }
  if (databaseMessage.includes("creative_folder_depth_exceeded")) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Folders can be one level deep. Choose a top-level folder.",
      error,
    );
  }
  if (databaseMessage.includes("creative_item_review_reason_not_found")) {
    throw new DomainError("VALIDATION_ERROR", "Choose a governed rejection reason.", error);
  }
  if (databaseMessage.includes("creative_item_review_version_not_finalized")) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "This design cannot be reviewed until its file has finished uploading.",
      error,
    );
  }
  if (databaseMessage.includes("_not_found_or_archived")) {
    throw new DomainError("TENANT_SCOPE_ERROR", "That design is not available.", error);
  }
  if (databaseMessage.includes("_not_found_or_finalized")) {
    throw new DomainError("TENANT_SCOPE_ERROR", "That upload is not available.", error);
  }
  if (databaseMessage.includes("_forbidden") || error.code === "42501") {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission to change this design library.",
      error,
    );
  }
  if (
    databaseMessage.includes("_invalid") ||
    error.code === "22023" ||
    error.code === "22P02" ||
    error.code === "23503" ||
    error.code === "23514"
  ) {
    throw new DomainError("VALIDATION_ERROR", "Please check the design details.", error);
  }

  throw new DomainError("DOMAIN_ERROR", "The design library could not be changed.", error);
}
