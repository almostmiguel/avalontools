import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseDocument, DomUtils } from "htmlparser2";

export const origin = "https://2e.aonprd.com/";
const cache = new URL("../.cache/pc2/", import.meta.url);
export async function page(path) {
  const target = new URL(path.replace(/[^a-z0-9]/gi, "_") + ".html", cache);
  try { return await readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(cache, { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(origin + path + (path.includes("?") ? "&" : "?") + "NoRedirect=1", { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const html = await response.text();
      if (!html.includes('class="title"')) throw new Error(`Missing content: ${path}`);
      await writeFile(target, html);
      return html;
    } catch (error) { if (attempt >= 2) throw error; }
  }
}
export async function selections() {
  const doc = parseDocument(await page("Sources.aspx?ID=227"));
  const groups = {};
  for (const heading of DomUtils.findAll(node => node.name === "h2", doc.children)) {
    const label = DomUtils.textContent(heading).match(/^(.*?) \[(\d+)\]$/);
    if (!label) continue;
    const links = [];
    for (let node = heading.next; node && node.name !== "h2"; node = node.next) {
      links.push(...DomUtils.findAll(child => child.name === "a" && /\.aspx\?ID=/.test(child.attribs?.href || ""), [node]).map(child => ({ name: DomUtils.textContent(child).trim(), path: child.attribs.href })));
    }
    if (links.length !== Number(label[2])) throw new Error(`Incomplete index: ${label[1]}`);
    groups[label[1]] = links;
  }
  return groups;
}
if (process.argv[1]?.endsWith("cache-pc2.mjs")) {
  const groups = await selections();
  const paths = [...new Set(Object.values(groups).flat().map(item => item.path))];
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < paths.length) {
      await page(paths[next++]);
      if (++done % 100 === 0) console.log(`${done}/${paths.length} PC2 pages cached`);
    }
  }));
  console.log(`Cached ${done} pages.`, Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.length])));
}
