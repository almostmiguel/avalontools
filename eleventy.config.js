import { readdir } from "node:fs/promises";
import { loadWiki } from "./scripts/wiki-build.mjs";

export default async function (eleventyConfig) {
  eleventyConfig.addGlobalData("atlas", () => loadWiki());
  for (const directory of ["css", "js", "data", "img", "fonts"]) eleventyConfig.addPassthroughCopy(directory);
  for (const file of await readdir(".")) if (file.endsWith(".html") && file !== "setting.html") eleventyConfig.addPassthroughCopy(file);
  eleventyConfig.addWatchTarget("content/setting/");
  eleventyConfig.addWatchTarget("scripts/wiki-build.mjs");
  eleventyConfig.addWatchTarget("index.html");
  eleventyConfig.setServerOptions({ port: 8080 });
  return { dir: { input: "content", output: "_site" }, templateFormats: ["11ty.js"] };
}
