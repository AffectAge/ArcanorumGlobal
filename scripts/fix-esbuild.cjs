const { existsSync, copyFileSync, readFileSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();
const viteEsbuildPkg = join(root, "node_modules", "vite", "node_modules", "esbuild", "package.json");
const viteExe = join(root, "node_modules", "vite", "node_modules", "@esbuild", "win32-x64", "esbuild.exe");
const topExe = join(root, "node_modules", "@esbuild", "win32-x64", "esbuild.exe");

function getVersion(path) {
  if (!existsSync(path)) return null;
  const out = spawnSync(path, ["--version"], { encoding: "utf-8" });
  if (out.status !== 0) return null;
  return out.stdout.trim();
}

if (process.platform === "win32") {
  if (!existsSync(viteEsbuildPkg)) process.exit(0);

  const expected = JSON.parse(readFileSync(viteEsbuildPkg, "utf-8")).version;
  const viteVersion = getVersion(viteExe);

  if (viteVersion === expected) process.exit(0);

  const topVersion = getVersion(topExe);
  if (topVersion === expected) {
    mkdirSync(dirname(viteExe), { recursive: true });
    copyFileSync(topExe, viteExe);
    const patched = getVersion(viteExe);
    if (patched === expected) {
      console.log(`[fix-esbuild] patched nested binary to ${expected}`);
    } else {
      console.warn("[fix-esbuild] patch attempt failed");
    }
  } else {
    console.warn(`[fix-esbuild] no matching source binary for expected ${expected}`);
  }
}
