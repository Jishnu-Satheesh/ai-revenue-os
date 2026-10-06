import type { ResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";

/** A fresh check belongs immediately before each queued source side effect. */
export async function runWithCurrentActorAuthority<T>(
  assertAuthority: () => Promise<void>,
  operation: () => PromiseLike<T>,
): Promise<T> {
  await assertAuthority();
  return operation();
}

export function createActorAuthorizedWatchRepository(
  repository: ResearchProjectRepository,
  assertAuthority: () => Promise<void>,
): ResearchProjectRepository {
  return {
    ...repository,
    createProject: (input, options) => runWithCurrentActorAuthority(assertAuthority,
      () => repository.createProject(input, options)),
    saveBriefRevision: (input, options) => runWithCurrentActorAuthority(assertAuthority,
      () => repository.saveBriefRevision(input, options)),
    updateProjectSchedule: (input, options) => runWithCurrentActorAuthority(assertAuthority,
      () => repository.updateProjectSchedule(input, options)),
  };
}
