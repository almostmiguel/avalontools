import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeClassContent } from "./import-pc1-classes.mjs";
import { createFeatCatalog } from "../js/feat-library.js";

export function importPC1Characters() {
  const revision = execFileSync("git", ["rev-parse", "2ef469c253^"], { encoding: "utf8" }).trim();
  const readOld = path => JSON.parse(execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8", maxBuffer: 10_000_000 }));
  const feats = createFeatCatalog(JSON.parse(readFileSync(new URL("../data/feats.json", import.meta.url), "utf8")));
  const backgrounds = readOld("data/backgrounds/backgrounds-pc1.json").background.filter(entry => entry.source === "PC1");
  const archetypes = readOld("data/archetypes.json").archetype.filter(entry => entry.source === "PC1");
  const assignments = new Map(archetypes.map(entry => [entry.name, []]));
  for (const feat of feats.records.filter(record => record.traits.includes("archetype"))) {
    const owners = feat.entry.featType?.archetype || archetypes.filter(entry => entry.page === feat.page).map(entry => entry.name);
    if (owners.length !== 1 || !assignments.has(owners[0])) throw new Error(`Cannot assign PC1 archetype feat: ${feat.name}`);
    assignments.get(owners[0]).push(feat.id);
  }
  const title = text => text.charAt(0).toUpperCase() + text.slice(1);
  const convert = entry => normalizeClassContent({ ...entry, entries: entry.entries.map((item, index) => index === 0 && typeof item === "string" ? { type: "flavor", entries: [item] } : item) });
  const payload = (collection, entries) => ({
    _meta: { importedFrom: "https://github.com/almostmiguel/avalontools", revision, content: "Player Core only; English text from the historical repository, converted to native rich-content blocks." },
    sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], [collection]: entries,
  });
  return {
    backgrounds: payload("backgrounds", backgrounds.map(entry => convert({ ...entry, categories: entry.boosts.filter(boost => boost !== "free").map(title), category: entry.boosts.filter(boost => boost !== "free").map(title).join(" / ") }))),
    archetypes: payload("archetypes", archetypes.map(entry => convert({ ...entry, image: `img/archetypes/${entry.name.toLowerCase()}.webp`, category: "Multiclass", feats: assignments.get(entry.name) }))),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [collection, payload] of Object.entries(importPC1Characters())) {
    writeFileSync(new URL(`../data/${collection}.json`, import.meta.url), JSON.stringify(payload, null, 2) + "\n");
    console.log(`${collection}: ${payload[collection].length} PC1 entries`);
  }
}
