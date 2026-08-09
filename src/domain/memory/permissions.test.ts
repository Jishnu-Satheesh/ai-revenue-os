import { describe, expect, it } from "vitest";

import { hasMemoryPermission, memoryPermissions } from "@/domain/memory/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";

const roles: readonly OrganizationRole[] = ["owner", "admin", "operator", "viewer"];

describe("hasMemoryPermission", () => {
  it("lets every member read non-sensitive memory", () => {
    for (const role of roles) {
      expect(hasMemoryPermission(role, "memory.read")).toBe(true);
    }
  });

  it("restricts confidential and customer content to owners and admins", () => {
    expect(hasMemoryPermission("owner", "memory.read_sensitive")).toBe(true);
    expect(hasMemoryPermission("admin", "memory.read_sensitive")).toBe(true);
    expect(hasMemoryPermission("operator", "memory.read_sensitive")).toBe(false);
    expect(hasMemoryPermission("viewer", "memory.read_sensitive")).toBe(false);
  });

  it("gives a viewer no permission beyond reading", () => {
    for (const permission of memoryPermissions) {
      expect(hasMemoryPermission("viewer", permission)).toBe(permission === "memory.read");
    }
  });

  it("lets an operator write, verify, supersede, and promote", () => {
    expect(hasMemoryPermission("operator", "memory.write")).toBe(true);
    expect(hasMemoryPermission("operator", "memory.verify")).toBe(true);
    expect(hasMemoryPermission("operator", "memory.supersede")).toBe(true);
    expect(hasMemoryPermission("operator", "memory.promote_fact")).toBe(true);
  });

  it("gives owners and admins every permission", () => {
    for (const permission of memoryPermissions) {
      expect(hasMemoryPermission("owner", permission)).toBe(true);
      expect(hasMemoryPermission("admin", permission)).toBe(true);
    }
  });

  it("refuses an unrecognized role rather than defaulting to allowed", () => {
    expect(hasMemoryPermission("not-a-role" as never, "memory.read")).toBe(false);
  });
});
