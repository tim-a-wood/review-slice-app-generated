import { builtinModules } from "node:module";
import { defineConfig, type UserConfig } from "vite";

const external = ["electron", ...new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])];

function electronBuild(
  entry: "electron/main.ts" | "electron/preload.ts",
  format: "es" | "cjs",
  fileName: "main.js" | "preload.cjs",
  emptyOutDir: boolean,
): UserConfig {
  return {
    build: {
      ssr: entry,
      outDir: "dist-electron",
      emptyOutDir,
      sourcemap: true,
      minify: false,
      rollupOptions: {
        external,
        output: { format, entryFileNames: fileName },
      },
    },
  };
}

export default defineConfig(({ mode }): UserConfig => {
  if (mode === "electron-main") return electronBuild("electron/main.ts", "es", "main.js", true);
  if (mode === "electron-preload") return electronBuild("electron/preload.ts", "cjs", "preload.cjs", false);
  if (mode === "module-tests") return {
    build: {
      ssr: true,
      outDir: ".test-out",
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        external,
        input: {
          "artifact-processing.test": "capabilities/modules/mod.artifact-processing/tests/artifact-processing.test.ts",
          "evidence-export.test": "capabilities/modules/mod.evidence-export/src/evidence-export.test.ts",
          "experience-contract.test": "capabilities/modules/mod.experience-first/tests/owner-contract.test.ts",
          "experience-view-model.test": "capabilities/modules/mod.experience-first/tests/view-model.test.ts",
          "findings.test": "capabilities/modules/mod.findings/tests/findings-store.test.ts",
          "review-workflow.test": "capabilities/modules/mod.review-workflow/tests/review-workflow.test.ts",
        },
        output: { format: "es", entryFileNames: "[name].js" },
      },
    },
  };
  return {
    base: "./",
    build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  };
});
