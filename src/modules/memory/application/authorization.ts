import { memoryError } from "@/domain/memory/errors";
import { hasMemoryPermission, type MemoryPermission } from "@/domain/memory/permissions";
import { sensitivityCeilingFor } from "@/domain/memory/purposes";
import type { Sensitivity } from "@/domain/memory/types";
import type { OrganizationRole } from "@/domain/organizations/types";

export type MemoryActor = {
  userId: string;
  role: OrganizationRole;
};

export function assertMemoryPermission(actor: MemoryActor, permission: MemoryPermission): void {
  if (!hasMemoryPermission(actor.role, permission)) {
    throw memoryError("AUTHORIZATION_ERROR", { permission });
  }
}

/**
 * The ceiling a human operator may read at. It comes from their role, never
 * from the request, so a client cannot widen its own allowance by asking.
 */
export function operatorCeiling(actor: MemoryActor): Sensitivity {
  return sensitivityCeilingFor({ purpose: "operator_search", role: actor.role });
}

/**
 * Classifying sensitivity is deterministic and role-checked. A caller may not
 * assign a class they could not then read back, which would let an operator
 * write memory into a space only an admin can see.
 */
export function assertCanAssignSensitivity(actor: MemoryActor, sensitivity: Sensitivity): void {
  const ceiling = operatorCeiling(actor);
  const order: readonly Sensitivity[] = ["public", "internal", "confidential", "customer_content"];
  if (order.indexOf(sensitivity) > order.indexOf(ceiling)) {
    throw memoryError("AUTHORIZATION_ERROR", { sensitivity });
  }
}
