import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, DomUtils } from "htmlparser2";
import { htmlContentBlocks, htmlText as text, foldHtmlReference as fold } from "./html-content.mjs";

const origin = "https://2e.aonprd.com/";
const cache = new URL("../.cache/pc1-companions/", import.meta.url);
async function cachedPage(path, file, refresh) {
  const target = new URL(file, cache);
  if (!refresh) { try { return await readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const html = await response.text(); await mkdir(new URL("./", target), { recursive: true }); await writeFile(target, html); return html;
}

function contentDocument(html) {
  const start = html.search(/<h1\b[^>]*class="title"/);
  if (start < 0) throw new Error("Missing companion content heading.");
  const end = html.indexOf('<div class="clear">', start);
  // Nethys's PFS icon has mismatched closing tags that otherwise end the h1 early.
  return parseDocument(html.slice(start, end < 0 ? undefined : end).replace(/<a\b[^>]*href\s*=\s*["']PFS\.aspx["'][^>]*>\s*<span\b[^>]*>\s*<img\b[^>]*>\s*<\/a>\s*<\/span>/gi, ""));
}

function nativeBlocks(nodes, references) {
  const headings = DomUtils.findAll(node => /^h[2-6]$/.test(node.name || ""), nodes);
  const titles = new Map(headings.map(heading => {
    const action = DomUtils.findOne(node => /(?:^|\s)action(?:\s|$)/.test(node.attribs?.class || ""), heading.children || []);
    const title = text(heading);
    const symbol = action && ({ "[one-action]": "1", "[two-actions]": "2", "[three-actions]": "3", "[reaction]": "r", "[free-action]": "f" })[text(action)];
    return [title, symbol ? `${title.replace(text(action), "").trim()} {@as ${symbol}}` : title];
  }));
  for (const source of DomUtils.findAll(node => ["b", "strong"].includes(node.name) && text(node) === "Source", nodes)) {
    const siblings = nodes.includes(source) ? nodes : source.parent.children, start = siblings.indexOf(source);
    let end = start + 1;
    while (end < siblings.length && !["br", "hr"].includes(siblings[end].name)) end++;
    siblings.splice(start, end - start + (siblings[end]?.name === "br" ? 1 : 0));
  }
  const blocks = htmlContentBlocks(nodes, references);
  for (const block of blocks) if (block?.type === "h3" && titles.has(block.name)) block.name = titles.get(block.name);
  return blocks;
}

export function parseCompanionPage(html, selection, references) {
  const document = contentDocument(html);
  const heading = document.children.find(node => node.name === "h1");
  if (!heading || text(heading) !== selection.name) throw new Error(`Wrong companion page: ${selection.name}`);
  const nodes = document.children.slice(document.children.indexOf(heading) + 1);
  const source = nodes.findIndex(node => node.name === "b" && text(node) === "Source");
  const sourceEnd = nodes.findIndex((node, index) => index > source && node.name === "br");
  const citation = /Player Core pg\. (\d+)/.exec(nodes.slice(source + 1, sourceEnd).map(text).join(" "));
  if (!citation) throw new Error(`Missing PC1 citation: ${selection.name}`);
  const traits = nodes.slice(0, source).filter(node => /^trait/.test(node.attribs?.class || "")).map(node => text(node).toLowerCase());
  const body = nodes.slice(sourceEnd + 1);
  const sizeIndex = body.findIndex(node => node.name === "b" && text(node) === "Size");
  const sizeEnd = body.findIndex((node, index) => index > sizeIndex && node.name === "br");
  if (sizeIndex < 0 || sizeEnd < 0) throw new Error(`Missing companion size: ${selection.name}`);
  const size = body.slice(sizeIndex + 1, sizeEnd).map(text).join(" ").trim();
  body.splice(sizeIndex, sizeEnd - sizeIndex + 1);
  const entries = nativeBlocks(body, references);
  const support = entries.findIndex(entry => typeof entry === "string" && entry.startsWith("{@b Support Benefit}"));
  if (support >= 0) entries.splice(support, 0, { type: "hr" });
  return { name: selection.name, source: "PC1", page: Number(citation[1]), category: traits.includes("plant") ? "Plant" : "Animal", size, traits, entries, reference: origin + selection.path };
}

export function parseFamiliarAbilityPage(html, selection, references) {
  const document = contentDocument(html);
  const heading = document.children.find(node => node.name === "h1");
  if (!heading || text(heading) !== selection.name) throw new Error(`Wrong familiar ability page: ${selection.name}`);
  const nodes = document.children.slice(document.children.indexOf(heading) + 1);
  const source = nodes.findIndex(node => node.name === "b" && text(node) === "Source");
  const sourceEnd = nodes.findIndex((node, index) => index > source && node.name === "br");
  const citation = /Player Core pg\. (\d+)/.exec(nodes.slice(source + 1, sourceEnd).map(text).join(" "));
  if (!citation) throw new Error(`Missing PC1 familiar citation: ${selection.name}`);
  const type = nodes.findIndex(node => node.name === "b" && text(node) === "Ability Type");
  const typeEnd = nodes.findIndex((node, index) => index > type && node.name === "br");
  const category = nodes.slice(type + 1, typeEnd).map(text).join(" ").trim();
  if (type < 0 || !["Familiar", "Master"].includes(category)) throw new Error(`Missing familiar ability type: ${selection.name}`);
  return { name: selection.name, source: "PC1", page: Number(citation[1]), kind: "familiar", category, entries: nativeBlocks(nodes.slice(typeEnd + 1), references), reference: origin + selection.path };
}

export async function importPC1Companions({ refresh = false } = {}) {
  const document = parseDocument(await cachedPage("Sources.aspx?ID=216", "source.html", refresh));
  const selections = DomUtils.findAll(node => node.name === "a" && /^Companions\.aspx\?ID=\d+$/.test(node.attribs.href || ""), document.children).map(node => ({ name: text(node), path: node.attribs.href }));
  if (selections.length !== 16 || new Set(selections.map(item => item.name)).size !== 16) throw new Error(`Expected 16 PC1 companions, found ${selections.length}. Review the index.`);
  const abilities = DomUtils.findAll(node => node.name === "a" && /^Familiars\.aspx\?ID=\d+$/.test(node.attribs.href || ""), document.children).map(node => ({ name: text(node).replace(/\s+\((?:master|familiar)\)$/, ""), path: node.attribs.href }));
  if (abilities.length !== 41 || new Set(abilities.map(item => item.name)).size !== 41) throw new Error(`Expected 41 PC1 familiar abilities, found ${abilities.length}. Review the index.`);
  const references = { externalFallback: true };
  references.companion = { names: [...selections, ...abilities].map(item => item.name).sort((a, b) => b.length - a.length), byName: new Map([...selections, ...abilities].map(item => [fold(item.name), item.name])), byPath: new Map([...selections, ...abilities].map(item => [item.path, item.name])), sourceByPath: new Map([...selections, ...abilities].map(item => [item.path, "PC1"])) };
  for (const [kind, collection] of [["action", "actions"], ["condition", "conditions"], ["skill", "skills"], ["trait", "traits"], ["spell", "spells"], ["equipment", "equipment"]]) {
    const payload = JSON.parse(await readFile(new URL(`../data/${collection}.json`, import.meta.url), "utf8"));
    const names = payload[collection].map(record => record.name).sort((a, b) => b.length - a.length);
    references[kind] = { names, byName: new Map(names.map(name => [fold(name), name])), byPath: new Map() };
  }
  const companions = []; let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < selections.length) {
      const selection = selections[next++];
      companions.push(parseCompanionPage(await cachedPage(selection.path + "&NoRedirect=1", `pages/companion-${new URL(selection.path, origin).searchParams.get("ID")}.html`, refresh), selection, references));
    }
  }));
  const familiarAbilities = []; next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < abilities.length) {
      const selection = abilities[next++];
      familiarAbilities.push(parseFamiliarAbilityPage(await cachedPage(selection.path + "&NoRedirect=1", `pages/familiar-${new URL(selection.path, origin).searchParams.get("ID")}.html`, refresh), selection, references));
    }
  }));
  const rulesDocument = contentDocument(await cachedPage("Rules.aspx?ID=2113", "rules.html", refresh));
  const heading = rulesDocument.children.find(node => node.name === "h1");
  const nodes = rulesDocument.children.slice(rulesDocument.children.indexOf(heading) + 1);
  if (!/Player Core pg\. 206/.test(nodes.slice(0, 6).map(text).join(" "))) throw new Error("Missing PC1 companion rules citation.");
  const entries = nativeBlocks(nodes, references).filter(entry => typeof entry !== "string" || !/^A list of available animal companions/.test(entry));
  // The source page repeats Riding Animal Companions at the end of the chapter.
  const riding = entries.map((entry, index) => entry?.type === "h3" && entry.name === "Riding Animal Companions" ? index : -1).filter(index => index >= 0);
  if (riding.length > 1) entries.splice(riding[1]);
  companions.sort((a, b) => a.name.localeCompare(b.name, "en"));
  familiarAbilities.sort((a, b) => a.name.localeCompare(b.name, "en"));
  await writeFile(new URL("../data/companions.json", import.meta.url), JSON.stringify({
    _meta: { content: "All 16 Player Core companions and 41 familiar/master abilities, with support benefits, advanced maneuvers, and the PC1 companion rules including mature, nimble, savage and all six specializations. English content from Archives of Nethys; excludes other books and legacy options.", references: [origin + "Sources.aspx?ID=216", origin + "Rules.aspx?ID=2113"], license: "Pathfinder Player Core © 2023 Paizo Inc. Game-content licence and attribution notices: https://2e.aonprd.com/Licenses.aspx" },
    sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], companions, familiarAbilities,
    rules: { name: "Animal Companions", source: "PC1", page: 206, entries },
  }, null, 2) + "\n");
  console.log(`companions: ${companions.length} PC1 companions, ${familiarAbilities.length} familiar/master abilities, with shared rules and advancement`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importPC1Companions({ refresh: process.argv.includes("--refresh") });
