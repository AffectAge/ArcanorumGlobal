import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

const root = resolve(process.cwd(), "apps/server");
const sourcePath = resolve(root, "data/adm1.geojson");
const outRoot = resolve(root, "data/tiles/adm1");
const zMin = 0;
const zMax = 5;

if (!existsSync(sourcePath)) {
  throw new Error(`Source geojson not found: ${sourcePath}`);
}

const geojson = JSON.parse(readFileSync(sourcePath, "utf-8"));
const index = geojsonvt(geojson, {
  maxZoom: zMax,
  tolerance: 3,
  extent: 4096,
  buffer: 64,
});

if (existsSync(outRoot)) {
  rmSync(outRoot, { recursive: true, force: true });
}
mkdirSync(outRoot, { recursive: true });

let written = 0;
for (let z = zMin; z <= zMax; z += 1) {
  const max = 1 << z;
  for (let x = 0; x < max; x += 1) {
    for (let y = 0; y < max; y += 1) {
      const tile = index.getTile(z, x, y);
      if (!tile) {
        continue;
      }
      const buff = vtpbf.fromGeojsonVt({ adm1: tile }, { version: 2 });
      const filePath = join(outRoot, String(z), String(x), `${y}.mvt`);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, Buffer.from(buff));
      written += 1;
    }
  }
}

console.log(`Generated ${written} tiles at ${outRoot}`);
