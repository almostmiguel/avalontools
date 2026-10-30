import Eleventy from "@11ty/eleventy";
import { lstat, rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "_site");
if (relative(root, output) !== "_site") throw new Error("Unexpected build output directory.");
const existing = await lstat(output).catch(error => { if (error.code !== "ENOENT") throw error; });
if (existing?.isSymbolicLink()) throw new Error("The build output must be a regular directory.");
// Start from a clean output so removed or renamed articles cannot be published again.
await rm(output, { recursive: true, force: true });
const site = new Eleventy("content", "_site");
await site.write();
