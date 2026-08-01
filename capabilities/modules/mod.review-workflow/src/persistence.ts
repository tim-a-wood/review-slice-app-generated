import { ProjectStore, ReviewProject } from "./contracts";

export class PersistenceCoordinator {
  private pending = Promise.resolve();

  public constructor(private readonly store: ProjectStore) {}

  public save(project: ReviewProject): Promise<void> {
    const snapshot = cloneProject(project);
    const work = async (): Promise<void> => {
      await this.store.savePrimary(snapshot);
      await this.store.saveBackup(snapshot);
    };
    const result = this.pending.then(work, work);
    this.pending = result.catch(() => undefined);
    return result;
  }

  public async resume(projectId: string): Promise<{ project?: ReviewProject; recovered: boolean }> {
    const primary = await this.store.loadPrimary(projectId);
    if (primary) return { project: cloneProject(primary), recovered: false };
    const backup = await this.store.loadBackup(projectId);
    if (!backup) return { recovered: false };
    const project = cloneProject(backup);
    await this.save(project);
    return { project, recovered: true };
  }
}

export function cloneProject(project: ReviewProject): ReviewProject {
  return {
    ...project,
    slices: project.slices.map((slice) => ({ ...slice, source: { ...slice.source }, notes: [...slice.notes] })),
    history: project.history.map((entry) => ({ ...entry })),
  };
}
