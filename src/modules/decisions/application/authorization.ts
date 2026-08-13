import type { OrganizationRole } from "@/domain/organizations/types";

export const decisionPermissions = ["decision.read", "decision.feedback"] as const;
export type DecisionPermission = (typeof decisionPermissions)[number];

const permissionsByRole: Readonly<Record<OrganizationRole, readonly DecisionPermission[]>> = {
  owner: decisionPermissions,
  admin: decisionPermissions,
  operator: decisionPermissions,
  viewer: ["decision.read"],
};

export function hasDecisionPermission(role: OrganizationRole, permission: DecisionPermission): boolean {
  return permissionsByRole[role].includes(permission);
}
