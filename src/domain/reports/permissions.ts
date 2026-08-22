import type { OrganizationRole } from "@/domain/organizations/types";

export type ReportPermission =
  | "report.read"
  | "report.upload"
  | "report.retry"
  | "report.contract_approve";

const permissions: Readonly<Record<OrganizationRole, readonly ReportPermission[]>> = {
  viewer: ["report.read"],
  operator: ["report.read", "report.upload", "report.retry"],
  admin: ["report.read", "report.upload", "report.retry", "report.contract_approve"],
  owner: ["report.read", "report.upload", "report.retry", "report.contract_approve"],
};

export function hasReportPermission(role: OrganizationRole, permission: ReportPermission): boolean {
  return permissions[role].includes(permission);
}
