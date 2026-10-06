import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import type { ResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";
import { createActorAuthorizedWatchRepository, runWithCurrentActorAuthority } from "./worker-watch-authority";

function fixture() {
  let permitted = true;
  let readFailed = false;
  const writes: string[] = [];
  const source = {
    createProject: async () => { writes.push("create"); return { projectId: "project", lifecycle: "active", replayed: false }; },
    saveBriefRevision: async () => { writes.push("brief"); return { revisionId: "revision", revisionNumber: 1, replayed: false }; },
    updateProjectSchedule: async () => { writes.push("update"); return { projectId: "project", revisionNumber: null, replayed: false }; },
  } as unknown as ResearchProjectRepository;
  const repository = createActorAuthorizedWatchRepository(source, async () => {
    if (readFailed) throw new DomainError("INTEGRATION_ERROR", "Current authority could not be read.");
    if (!permitted) throw new DomainError("AUTHORIZATION_ERROR", "Current authority was revoked.");
  });
  return { repository, writes, revoke: () => { permitted = false; },
    restore: () => { permitted = true; }, failRead: () => { readFailed = true; } };
}

describe("queued watch current actor authority", () => {
  it.each(["enqueue", "reserve", "dispatch"] as const)(
    "stops research before %s when authority is revoked between queued steps", async (revokedAt) => {
      let permitted = true;
      const completed: string[] = [];
      const assertAuthority = async () => {
        if (!permitted) throw new DomainError("AUTHORIZATION_ERROR", "Current authority was revoked.");
      };
      let refused = false;
      for (const stage of ["enqueue", "reserve", "dispatch"]) {
        if (stage === revokedAt) permitted = false;
        try {
          await runWithCurrentActorAuthority(assertAuthority, async () => { completed.push(stage); });
        } catch (error) {
          expect(error).toMatchObject({ code: "AUTHORIZATION_ERROR" });
          refused = true;
          break;
        }
      }
      expect(refused).toBe(true);
      expect(completed).toEqual(revokedAt === "enqueue" ? [] : revokedAt === "reserve" ? ["enqueue"] : ["enqueue", "reserve"]);
    },
  );

  it("refuses queued creation after the actor's current grant was revoked", async () => {
    const f = fixture();
    f.revoke();
    await expect(f.repository.createProject({} as never)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(f.writes).toEqual([]);
  });

  it("rechecks immediately before saving the initial brief after project creation", async () => {
    const f = fixture();
    await f.repository.createProject({} as never);
    // Revocation can occur while source reads run between these two writes.
    f.revoke();
    await expect(f.repository.saveBriefRevision({} as never)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(f.writes).toEqual(["create"]);
    f.restore();
    await f.repository.saveBriefRevision({} as never);
    expect(f.writes).toEqual(["create", "brief"]);
  });

  it("refuses an update after authority was revoked during source reads", async () => {
    const f = fixture();
    f.revoke();
    await expect(f.repository.updateProjectSchedule({} as never)).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    expect(f.writes).toEqual([]);
  });

  it("does not mutate when the current authority read fails", async () => {
    const f = fixture();
    f.failRead();
    for (const mutate of [f.repository.createProject, f.repository.saveBriefRevision, f.repository.updateProjectSchedule]) {
      await expect(mutate({} as never)).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    }
    expect(f.writes).toEqual([]);
  });
});
