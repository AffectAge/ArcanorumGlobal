import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const serverRoot = resolve(scriptsDir, "..");
const entrypoint = resolve(serverRoot, "dist/index.js");

const restartDelayMs = Math.max(250, Number(process.env.SERVER_RESTART_DELAY_MS ?? 2000) || 2000);
const maxRestarts = Math.max(0, Number(process.env.SERVER_MAX_RESTARTS ?? 0) || 0);
let restartCount = 0;
let shuttingDown = false;
let child = null;

function shutdown(code = 0) {
  shuttingDown = true;
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function startChild() {
  child = spawn(process.execPath, [entrypoint], {
    cwd: serverRoot,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const cleanExit = code === 0 && !signal;
    if (cleanExit) {
      process.exit(0);
      return;
    }

    restartCount += 1;
    if (maxRestarts > 0 && restartCount > maxRestarts) {
      console.error(
        `[supervisor] Server stopped after ${restartCount - 1} restarts (limit=${maxRestarts}). Last exit: code=${code}, signal=${signal}.`,
      );
      process.exit(code ?? 1);
      return;
    }

    const limitLabel = maxRestarts > 0 ? `/${maxRestarts}` : "";
    console.error(
      `[supervisor] Server crashed (code=${code}, signal=${signal}). Restarting in ${restartDelayMs}ms (${restartCount}${limitLabel})...`,
    );
    setTimeout(() => {
      startChild();
    }, restartDelayMs);
  });

  child.on("error", (error) => {
    if (shuttingDown) return;
    console.error("[supervisor] Failed to spawn server process:", error);
    process.exit(1);
  });
}

startChild();
