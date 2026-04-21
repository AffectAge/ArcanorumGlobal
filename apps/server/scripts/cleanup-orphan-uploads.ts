import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverRoot = resolve(__dirname, "..");
dotenv.config({ path: resolve(serverRoot, ".env") });
if (!process.env.DATABASE_URL) {
  const fallbackDbPath = resolve(serverRoot, "prisma/dev.db").replace(/\\/g, "/");
  process.env.DATABASE_URL = `file:${fallbackDbPath}`;
}
const uploadsRoot = resolve(serverRoot, "uploads");
const statePath = resolve(serverRoot, "data/game-state.json");
const prisma = new PrismaClient();

function extractUploadRelativePathFromUrl(url?: string | null): string | null {
  if (!url) return null;
  const withoutHash = String(url).split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (!withoutQuery.startsWith("/uploads/")) return null;
  return withoutQuery.replace(/^\/uploads\//, "").replace(/\\/g, "/");
}

function collectStateUrls(input: unknown, sink: Set<string>): void {
  if (!input || typeof input !== "object") return;
  if (Array.isArray(input)) {
    for (const item of input) collectStateUrls(item, sink);
    return;
  }
  const row = input as Record<string, unknown>;
  for (const value of Object.values(row)) {
    if (typeof value === "string") {
      const rel = extractUploadRelativePathFromUrl(value);
      if (rel) sink.add(rel);
      continue;
    }
    collectStateUrls(value, sink);
  }
}

function listUploadFiles(root: string): string[] {
  const result: string[] = [];
  const walk = (base: string, relBase = "") => {
    const entries = readdirSync(base, { withFileTypes: true });
    for (const entry of entries) {
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const abs = resolve(base, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        result.push(rel.replace(/\\/g, "/"));
      }
    }
  };
  walk(root);
  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const referenced = new Set<string>();
  const hasState = existsSync(statePath);

  if (hasState) {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    collectStateUrls(parsed, referenced);
  }

  const countries = await prisma.country.findMany({
    select: { flagUrl: true, crestUrl: true },
  });
  for (const country of countries) {
    const flagRel = extractUploadRelativePathFromUrl(country.flagUrl);
    if (flagRel) referenced.add(flagRel);
    const crestRel = extractUploadRelativePathFromUrl(country.crestUrl);
    if (crestRel) referenced.add(crestRel);
  }

  if (!existsSync(uploadsRoot)) {
    console.log("[cleanup-orphan-uploads] uploads directory not found, nothing to do.");
    return;
  }

  const files = listUploadFiles(uploadsRoot);
  const orphan = files.filter((rel) => !referenced.has(rel));
  if (apply && !hasState) {
    throw new Error("game-state.json not found; refusing to apply cleanup without state references");
  }

  let reclaimedBytes = 0;
  if (apply) {
    for (const rel of orphan) {
      const abs = resolve(uploadsRoot, rel);
      try {
        const size = statSync(abs).size;
        unlinkSync(abs);
        reclaimedBytes += size;
      } catch {
        // ignore per-file delete errors
      }
    }
  }

  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);
  console.log(`[cleanup-orphan-uploads] mode=${apply ? "apply" : "dry-run"}`);
  console.log(`[cleanup-orphan-uploads] referenced=${referenced.size}`);
  console.log(`[cleanup-orphan-uploads] files=${files.length}`);
  console.log(`[cleanup-orphan-uploads] orphan=${orphan.length}`);
  if (orphan.length > 0) {
    const preview = orphan.slice(0, 20);
    console.log("[cleanup-orphan-uploads] sample:", preview);
  }
  if (apply) {
    console.log(`[cleanup-orphan-uploads] reclaimed=${mb(reclaimedBytes)} MB`);
  }
}

main()
  .catch((error) => {
    console.error("[cleanup-orphan-uploads] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
