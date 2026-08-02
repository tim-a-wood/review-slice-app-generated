import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const children = new Set();

function start(args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = start(args);
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${args.join(" ")} exited with code ${code ?? 1}.`)));
  });
}

function stop() {
  for (const child of children) child.kill();
}

async function waitForApplication() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await access("dist-electron/main.js");
      await access("dist-electron/preload.cjs");
      const response = await fetch("http://127.0.0.1:5173");
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("The local development application did not start.");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await run(["vite", "build", "--mode", "electron-main"]);
  await run(["vite", "build", "--mode", "electron-preload"]);
  const renderer = start(["vite", "--host", "127.0.0.1", "--port", "5173"]);
  await waitForApplication();
  const electron = start(["electron", "."], {
    env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:5173" },
  });
  electron.once("exit", (code) => {
    renderer.kill();
    process.exitCode = code ?? 1;
  });
} catch (cause) {
  stop();
  console.error(cause);
  process.exitCode = 1;
}
