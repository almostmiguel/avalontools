import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, DomUtils } from "htmlparser2";
import { renderHtmlInline as inline, htmlContentBlocks as spellHtmlBlocks, htmlText as text, foldHtmlReference as fold } from "./html-content.mjs";

const cache = new URL("../.cache/pc1-spells/", import.meta.url);
const origin = "https://2e.aonprd.com/";

async function cachedPage(path, filename, refresh) {
  const target = new URL(filename, cache);
  if (!refresh) {
    try { return await readFile(target, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const html = await response.text();
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, html);
  return html;
}


export function parseSpellPage(html, expectedName, references, { source = "PC1", sourceName = "Player Core" } = {}) {
  const start = html.search(/<h1\b[^>]*class="title"/);
  if (start < 0) throw new Error(`Missing title: ${expectedName}`);
  const end = html.indexOf('<div class="clear">', start);
  // Nethys' PFS icon has mismatched anchor/span tags. Remove that decorative icon before parsing.
  const fragment = html.slice(start, end < 0 ? undefined : end)
    .replace(/<a\b[^>]*href\s*=\s*["']PFS\.aspx["'][^>]*>[\s\S]*?<\/a>\s*<\/span>/gi, "");
  const document = parseDocument(fragment);
  const nodes = document.children;
  const heading = nodes.find(node => node.name === "h1");
  const rank = heading && DomUtils.findOne(node => /margin-left:\s*auto/.test(node.attribs?.style || ""), heading.children || []);
  const classification = rank && /^(Spell|Cantrip|Focus)\s+(\d+)$/.exec(text(rank));
  if (!classification || !fold(text(heading)).startsWith(fold(expectedName) + " ")) throw new Error(`Unexpected spell title: ${expectedName}`);
  const boundary = nodes.findIndex(node => node.name === "hr");
  if (boundary < 0) throw new Error(`Missing spell text: ${expectedName}`);
  const metadata = nodes.slice(nodes.indexOf(heading) + 1, boundary);
  const fields = new Map();
  let field;
  for (const node of metadata) {
    if (["b", "strong"].includes(node.name)) { field = text(node).replace(/:$/, ""); fields.set(field, []); }
    else if (field) fields.get(field).push(node);
  }
  const value = key => inline(fields.get(key) || [], references).replace(/;\s*$/, "").trim();
  const citation = new RegExp(`${sourceName} pg\\. (\\d+)`).exec((fields.get("Source") || []).map(text).join(" "));
  if (!citation) throw new Error(`Not a Player Core spell: ${expectedName}`);
  const traits = metadata.filter(node => /^trait/.test(node.attribs?.class || "")).map(node => text(node).toLowerCase());
  const actions = DomUtils.findAll(node => (node.attribs?.class || "").split(/\s+/).includes("action"), heading.children || []);
  const cast = value("Cast") || actions.map(node => inline([node], references)).join(" to ");
  if (!cast) throw new Error(`Missing casting time: ${expectedName}`);
  const spell = { name: expectedName, source, page: Number(citation[1]), level: Number(classification[2]), spellType: classification[1].toLowerCase(), traits,
    traditions: (value("Traditions").match(/arcane|divine|occult|primal/g) || []), cast };
  for (const key of ["Cost", "Trigger", "Requirements", "Range", "Area", "Targets", "Defense", "Duration"]) if (value(key)) spell[key.toLowerCase()] = value(key);
  const domains = value("Domain") || value("Domains");
  if (domains) spell.domain = domains;
  const body = [], heightened = [];
  let active = body, excludedSection = false;
  for (const node of nodes.slice(boundary + 1)) {
    if (node.name === "h3" && node.attribs.class === "framing") {
      excludedSection = text(node) !== sourceName;
      if (!excludedSection) active = body;
      continue;
    }
    // Nethys appends non-PC1 dragon tables; they are not part of the spell's book text.
    if (expectedName === "Dragon Form" && node.name === "h3" && text(node) === "Monster Core Dragons") break;
    if (node.name === "h2" && text(node) === expectedName) { active = body; continue; }
    const label = ["b", "strong"].includes(node.name) && /^Heightened\s*\(([^)]+)\)/.exec(text(node));
    if (label) { excludedSection = false; const group = { level: label[1], nodes: [] }; heightened.push(group); active = group.nodes; }
    else if (!excludedSection) active.push(node);
  }
  spell.entries = spellHtmlBlocks(body, references);
  if (heightened.length) spell.heightened = heightened.map(({ level, nodes }) => ({ level, entries: spellHtmlBlocks(nodes, references) }));
  if (!spell.entries.length) throw new Error(`Empty spell description: ${expectedName}`);
  return spell;
}

export async function importPC1Spells({ refresh = false } = {}) {
  const index = parseDocument(await cachedPage("Sources.aspx?ID=216", "source.html", refresh));
  const links = DomUtils.findAll(node => node.name === "a" && /^Spells\.aspx\?ID=\d+$/.test(node.attribs.href || ""), index.children);
  const spells = [...new Map(links.map(link => [link.attribs.href, { path: link.attribs.href, name: text(link) }])).values()];
  if (spells.length !== 472) throw new Error(`Expected 472 PC1 spells, found ${spells.length}. Review changes in the source index.`);
  const references = {};
  for (const [kind, collection] of [["action", "actions"], ["condition", "conditions"], ["skill", "skills"], ["trait", "traits"]]) {
    const data = JSON.parse(await readFile(new URL(`../data/${collection}.json`, import.meta.url), "utf8"));
    const names = data[collection].map(record => record.name).sort((a, b) => b.length - a.length);
    const byPath = new Map(DomUtils.findAll(node => node.name === "a" && node.attribs.href?.startsWith(({ action: "Actions", condition: "Conditions", skill: "Skills", trait: "Traits" })[kind] + ".aspx?ID="), index.children).map(link => [link.attribs.href, text(link).replace(/\s+\([^)]*\)$/, "")]));
    references[kind] = { byPath, byName: new Map(names.map(name => [fold(name), name])), names };
  }
  references.spell = { byPath: new Map(spells.map(spell => [spell.path, spell.name])), byName: new Map(spells.map(spell => [fold(spell.name), spell.name])), names: spells.map(spell => spell.name).sort((a, b) => b.length - a.length) };
  const records = [];
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < spells.length) {
      const spell = spells[next++];
      const html = await cachedPage(spell.path, `pages/${spell.path.split("=")[1]}.html`, refresh);
      records.push(parseSpellPage(html, spell.name, references));
    }
  }));
  records.sort((a, b) => a.name.localeCompare(b.name, "en"));
  await writeFile(new URL("../data/spells.json", import.meta.url), JSON.stringify({
    _meta: { content: "All 472 Player Core spells, including cantrips and focus spells. English spell text, casting details and heightened effects from Archives of Nethys; excludes non-PC1 access options from other books.",
      reference: origin + "Sources.aspx?ID=216", license: "See data/spells.README.md for content attribution and licence references." },
    sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], spells: records,
  }, null, 2) + "\n");
  console.log(`spells: ${records.length} PC1 entries`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importPC1Spells({ refresh: process.argv.includes("--refresh") });
