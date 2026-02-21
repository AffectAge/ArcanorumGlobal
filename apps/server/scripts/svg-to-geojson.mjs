import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { svgPathProperties } from "svg-path-properties";

const root = resolve(process.cwd(), "apps/server");
const svgPath = resolve(root, "data/adm1.svg");
const outPath = resolve(root, "data/adm1.geojson");

const svg = readFileSync(svgPath, "utf-8");
const vbMatch = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
if (!vbMatch) {
  throw new Error("SVG viewBox not found");
}

const [minX, minY, vbWidth, vbHeight] = vbMatch[1].trim().split(/\s+/).map(Number);
if (![minX, minY, vbWidth, vbHeight].every(Number.isFinite)) {
  throw new Error(`Invalid viewBox: ${vbMatch[1]}`);
}

function getAttr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\b\\s*=\\s*"([^"]*)"`, "i"));
  return m ? m[1] : null;
}

function toLonLat(x, y) {
  const lon = ((x - minX) / vbWidth) * 360 - 180;
  const lat = 90 - ((y - minY) / vbHeight) * 180;
  return [Number(lon.toFixed(6)), Number(lat.toFixed(6))];
}

const pathTags = svg.match(/<path\b[^>]*>/gi) || [];
const features = [];
let skipped = 0;

for (let i = 0; i < pathTags.length; i += 1) {
  const tag = pathTags[i];
  const id = getAttr(tag, "id") || `path-${i}`;
  const fill = (getAttr(tag, "fill") || "").toLowerCase();
  const d = getAttr(tag, "d");

  if (!d) {
    skipped += 1;
    continue;
  }

  if (id === "World" || id === "Ocean") {
    skipped += 1;
    continue;
  }

  if (fill === "none") {
    skipped += 1;
    continue;
  }

  try {
    const props = new svgPathProperties(d);
    const total = props.getTotalLength();
    if (!Number.isFinite(total) || total < 1) {
      skipped += 1;
      continue;
    }

    const samples = Math.max(24, Math.min(700, Math.round(total / 2.2)));
    const ring = [];
    for (let s = 0; s <= samples; s += 1) {
      const p = props.getPointAtLength((s / samples) * total);
      ring.push(toLonLat(p.x, p.y));
    }

    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || last[0] !== first[0] || last[1] !== first[1]) {
      ring.push(first);
    }

    if (ring.length < 4) {
      skipped += 1;
      continue;
    }

    features.push({
      type: "Feature",
      properties: {
        id,
        svg_id: id,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    });
  } catch {
    skipped += 1;
  }
}

const geojson = {
  type: "FeatureCollection",
  name: "adm1_from_svg",
  features,
};

writeFileSync(outPath, JSON.stringify(geojson));
console.log(`SVG paths: ${pathTags.length}`);
console.log(`GeoJSON features: ${features.length}`);
console.log(`Skipped: ${skipped}`);
console.log(`Saved: ${outPath}`);

