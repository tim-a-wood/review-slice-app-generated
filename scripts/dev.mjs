import { spawn } from "node:child_process";

const vite = spawn("npx", ["vite"], { stdio: "inherit", shell: process.platform === "win32" });
const timer = setInterval(async () => {
  try {
    const response = await fetch("http://127.0.0.1:5173");
    if (!response.ok) return;
    clearInterval(timer);
    const electron = spawn("npx", ["electron", "."], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:5173" } });
    electron.on("exit", () => vite.kill());
  } catch { }
}, 250);
vite.on("exit", () => process.exit());
