import type { FindingsPersistence, SourceNavigator } from "./contracts.ts";
import { FindingsStore } from "./findings-store.ts";

export * from "./contracts.ts";
export { FindingsStore } from "./findings-store.ts";

export interface FindingsModuleOptions {
  persistence: FindingsPersistence;
  navigator: SourceNavigator;
  now?: () => string;
  nextId?: () => string;
}

export const createFindingsModule = (options: FindingsModuleOptions): FindingsStore => {
  let sequence = 0;
  return new FindingsStore(
    options.persistence,
    options.navigator,
    options.now ?? (() => new Date().toISOString()),
    options.nextId ?? (() => `FND-${Date.now()}-${++sequence}`),
  );
};
