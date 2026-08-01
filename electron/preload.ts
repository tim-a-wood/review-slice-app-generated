import { contextBridge, ipcRenderer } from "electron";
import type { AppState } from "../src/types.ts";

contextBridge.exposeInMainWorld("reviewSlice", {
  load: (): Promise<AppState> => ipcRenderer.invoke("review:load"),
  save: (state: AppState): Promise<void> => ipcRenderer.invoke("review:save", state),
  importArtifact: (): Promise<AppState | undefined> => ipcRenderer.invoke("review:import"),
  exportEvidence: (state: AppState): Promise<string> => ipcRenderer.invoke("review:export", state),
  dataPath: (): Promise<string> => ipcRenderer.invoke("review:data-path"),
});
