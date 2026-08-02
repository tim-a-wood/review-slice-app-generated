import { FindingsManagement } from "./findings-store.ts";
import type { FindingsManagementOptions } from "./contracts.ts";

export * from "./contracts.ts";
export { FindingsManagement } from "./findings-store.ts";

export async function createFindingsManagement(options: FindingsManagementOptions): Promise<FindingsManagement> {
  return FindingsManagement.open(options);
}
