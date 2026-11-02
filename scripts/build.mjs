import Eleventy from "@11ty/eleventy";
import { lstat, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWiki } from "./wiki-build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "_site");
if (relative(root, output) !== "_site") throw new Error("Unexpected build output directory.");
const existing = await lstat(output).catch(error => { if (error.code !== "ENOENT") throw error; });
if (existing?.isSymbolicLink()) throw new Error("The build output must be a regular directory.");
// Validate authored content before removing the last working build.
const wiki = await loadWiki();
if (wiki.missingReferences.length) console.warn(`[wiki] Artigos por escrever: ${[...new Set(wiki.missingReferences.map(reference => reference.name))].join(", ")}`);
// Start from a clean output so removed or renamed articles cannot be published again.
await rm(output, { recursive: true, force: true });
const site = new Eleventy("content", "_site");
await site.write();
