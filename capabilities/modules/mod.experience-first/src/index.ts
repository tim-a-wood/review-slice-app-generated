import "./styles.css";

export { mountUserWorkspace, PRESENTATION_OWNER_MARKER, REQUIRED_OPERATION_IDS } from "./UserWorkspaceApp.ts";
export { createUserWorkspaceServices } from "./provider-services.ts";
export type { CreateUserWorkspaceServicesOptions } from "./provider-services.ts";
export {
  activeSlice,
  addFinding,
  applyRevision,
  compareLines,
  completion,
  decide,
  formatDate,
  label,
  metrics,
  openFindings,
  projectProgress,
  reviewedCount,
  select,
  sourceLabel,
  touch,
  visibleSlices,
} from "./view-model.ts";
export type {
  AppState,
  AsyncState,
  ComparisonState,
  Finding,
  FindingDraft,
  ImportDraft,
  ImportMode,
  ImportPhase,
  ProjectRow,
  ReviewState,
  RevisionMapping,
  RevisionResult,
  RevisionState,
  RevisionSummary,
  SelectedSource,
  Slice,
  SliceSource,
  UserWorkspace,
  UserWorkspaceMountOptions,
  UserWorkspaceOptions,
  WorkspaceDialog,
  WorkspacePage,
  WorkspaceServices,
  WorkspaceView,
} from "./contracts.ts";
