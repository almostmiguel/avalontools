import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, DomUtils } from "htmlparser2";
import { htmlContentBlocks, renderHtmlInline, htmlText as text, foldHtmlReference as fold } from "./html-content.mjs";

const cache = new URL("../.cache/pc1-equipment/", import.meta.url);
const origin = "https://2e.aonprd.com/";
const normalizeName = value => fold(value).replace(/wheel chair/g, "wheelchair");

async function cachedPage(path, file, refresh) {
  const target = new URL(file, cache);
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

function headingInfo(heading) {
  const rank = DomUtils.findOne(node => /margin-left:\s*auto/.test(node.attribs?.style || ""), heading.children || []);
  const name = (heading.children || []).filter(node => node !== rank).map(text).join(" ").trim();
  const level = rank && /^Item\s+(\d+)/.exec(text(rank));
  return { name, level: level ? Number(level[1]) : 0 };
}

function fieldsAndBody(nodes, references) {
  const fields = new Map(), body = [], traits = [], sidebars = [];
  let field, description = false;
  for (const node of nodes) {
    if (/^h[12]$/.test(node.name || "") && node.attribs?.class?.includes("title")) break;
    if (node.name === "hr") { description = true; field = null; continue; }
    if (description) { body.push(node); continue; }
    if (/^trait/.test(node.attribs?.class || "")) { traits.push(text(node)); continue; }
    if (["div", "aside"].includes(node.name) && /sidebar/.test(node.attribs?.class || "")) { sidebars.push(node); continue; }
    if (["b", "strong"].includes(node.name)) { field = text(node).replace(/:$/, ""); fields.set(field, []); continue; }
    if (node.name === "br") { field = null; continue; }
    if (field) { fields.get(field).push(node); continue; }
    if (!text(node)) continue;
    description = true; body.push(node);
  }
  return { fields: Object.fromEntries([...fields].map(([key, nodes]) => [key, renderHtmlInline(nodes, references).replace(/[;,]\s*$/, "").trim()])), body, traits, sidebars };
}

export function parseEquipmentPage(html, selections, references, gearCategories = new Map(), { source = "PC1", sourceName = "Player Core" } = {}) {
  const start = html.search(/<h1\b[^>]*class="title"/);
  if (start < 0) throw new Error(`Missing equipment title: ${selections[0]?.path}`);
  const end = html.indexOf('<div class="clear">', start);
  const fragment = html.slice(start, end < 0 ? undefined : end)
    .replace(/<u><a\b[^>]*href=["']PFS\.aspx["'][^>]*><b><i>PFS Note[\s\S]*?<\/i>/gi, "")
    .replace(/<a\b[^>]*href\s*=\s*["']PFS\.aspx["'][^>]*>\s*<span\b[^>]*>\s*<img\b[^>]*>\s*<\/a>\s*<\/span>/gi, "");
  const nodes = parseDocument(fragment).children;
  const heading = nodes.find(node => node.name === "h1");
  const family = headingInfo(heading);
  const variants = nodes.filter(node => node.name === "h2" && node.attribs?.class === "title" && DomUtils.findOne(child => /margin-left:\s*auto/.test(child.attribs?.style || ""), node.children || []));
  const firstVariant = variants[0] ? nodes.indexOf(variants[0]) : nodes.length;
  const common = fieldsAndBody(nodes.slice(nodes.indexOf(heading) + 1, firstVariant), references);
  const kind = selections[0].path.split(".")[0];
  const traitNames = references.trait.names;
  return selections.map(selection => {
    const variant = variants.find(node => normalizeName(headingInfo(node).name) === normalizeName(selection.name));
    if (variants.length && !variant && normalizeName(selection.name) !== normalizeName(family.name)) throw new Error(`Missing variant: ${selection.name} (${selection.path}). Available: ${variants.map(node => headingInfo(node).name).join(", ")}`);
    const section = variant ? fieldsAndBody(nodes.slice(nodes.indexOf(variant) + 1), references) : common;
    const fields = { ...common.fields, ...section.fields };
    const citation = new RegExp(`${sourceName} pg\\. (\\d+)`).exec(fields.Source || "");
    if (!citation) throw new Error(`Not a PC1 item: ${selection.name}`);
    const labels = [...new Set([...common.traits, ...(variant ? section.traits : [])])];
    const traits = [], traitLabels = {};
    for (const label of labels) {
      const canonical = traitNames.find(name => normalizeName(label) === normalizeName(name) || normalizeName(label).startsWith(normalizeName(name) + " ")) || label;
      const key = canonical.toLowerCase();
      if (!traits.includes(key)) traits.push(key);
      if (label.toLowerCase() !== key) traitLabels[key] = label;
    }
    const category = kind === "Weapons" ? fields.Category === "Ammunition" ? "Ammunition" : "Weapon" : kind === "Armor" ? "Armor" : kind === "Shields" ? "Shield"
      : family.name === "Barding" ? "Barding" : ["Spellcasting", "Lodging", "Meals", "Transportation"].includes(family.name) ? "Service" : gearCategories.get(normalizeName(family.name)) || "Adventuring Gear";
    const entry = { name: selection.name, source, page: Number(citation[1]), category, level: variant ? headingInfo(variant).level : family.level, traits,
      ...(Object.keys(traitLabels).length ? { traitLabels } : {}) };
    for (const field of ["Price", "Bulk", "Hands", "Usage"]) if (fields[field]) entry[field.toLowerCase()] = fields[field];
    if (fields.Category) entry.subcategory = fields.Category;
    if (fields.Group && fields.Group !== "—") entry.group = fields.Group;
    const omitted = new Set(["Source", "Price", "Bulk", "Hands", "Usage", "Category", "Group", "Favored Weapon"]);
    const stats = Object.fromEntries(Object.entries(fields).filter(([key, value]) => !omitted.has(key) && value));
    if (Object.keys(stats).length) entry.stats = stats;
    entry.entries = [...htmlContentBlocks(common.body, references), ...(variant ? htmlContentBlocks(section.body, references) : [])]
      .filter(block => typeof block !== "string" || !block.includes("Nethys Note:"));
    if (variants.length && !variant) entry.entries.push({ type: "list", items: selections.filter(item => item.name !== selection.name).map(item => `{@equipment ${item.name}|${source}}`) });
    for (const sidebar of common.sidebars) entry.entries.push({ type: "box", entries: htmlContentBlocks(sidebar.children || [], references) });
    return entry;
  });
}

export function parseEquipmentTrait(html, name, references) {
  const document = parseDocument(html);
  const heading = DomUtils.findOne(node => node.name === "h1" && node.attribs?.class === "title", document.children);
  const content = heading.parent.children.slice(heading.parent.children.indexOf(heading) + 1);
  const source = content.findIndex(node => ["b", "strong"].includes(node.name) && text(node) === "Source");
  const end = content.findIndex((node, index) => index > source && node.name === "br");
  const citation = /Player Core pg\. (\d+)/.exec(content.slice(source + 1, end).map(text).join(" "));
  if (!citation) throw new Error(`Missing PC1 trait citation: ${name}`);
  const stop = content.findIndex(node => node.name === "nethys-search");
  const body = content.slice(end + 1, stop < 0 ? undefined : stop);
  const category = ["bulwark", "comfort", "flexible", "noisy"].includes(name) ? "Armor" : "Weapon";
  return { name: text(heading), source: "PC1", page: Number(citation[1]), category, categories: [category], entries: htmlContentBlocks(body, references) };
}

export async function importPC1Equipment({ refresh = false } = {}) {
  const index = parseDocument(await cachedPage("Sources.aspx?ID=216", "source.html", refresh));
  const links = DomUtils.findAll(node => node.name === "a" && /^(Equipment|Weapons|Armor|Shields)\.aspx\?ID=\d+$/.test(node.attribs.href || ""), index.children).map(node => ({ path: node.attribs.href, name: text(node) }));
  if (links.length !== 262 || new Set(links.map(link => link.name)).size !== links.length) throw new Error(`Expected 262 unique PC1 equipment entries, found ${links.length}. Review the source index.`);
  const references = {};
  for (const [kind, collection] of [["action", "actions"], ["condition", "conditions"], ["skill", "skills"], ["trait", "traits"], ["spell", "spells"]]) {
    const data = JSON.parse(await readFile(new URL(`../data/${collection}.json`, import.meta.url), "utf8"));
    let names = data[collection].map(record => record.name);
    if (kind === "trait") names = [...new Set([...names, ...DomUtils.findAll(node => node.name === "a" && /^Traits\.aspx\?ID=\d+$/.test(node.attribs.href || ""), index.children).map(node => text(node).replace(/\s+\([^)]*\)$/, ""))])];
    references[kind] = { names: names.sort((a, b) => b.length - a.length), byName: new Map(names.map(name => [fold(name), name])), byPath: new Map() };
  }
  references.equipment = { names: links.map(link => link.name).sort((a, b) => b.length - a.length), byName: new Map(links.map(link => [fold(link.name), link.name])),
    byPath: new Map([...links].reverse().map(link => [link.path, link.name])) };
  const historical = JSON.parse(execFileSync("git", ["show", "2ef469c253^:data/items/items-pc1.json"], { encoding: "utf8", maxBuffer: 30_000_000 })).item;
  const categories = new Map(historical.map(item => [normalizeName(item.name), item.category || "Adventuring Gear"]));
  const families = [...new Set(links.map(link => link.path))];
  const records = [];
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < families.length) {
      const path = families[next++];
      const html = await cachedPage(path, `pages/${path.replace(".aspx?ID=", "-")}.html`, refresh);
      records.push(...parseEquipmentPage(html, links.filter(link => link.path === path), references, categories));
    }
  }));
  const traitFile = new URL("../data/traits.json", import.meta.url);
  const traitData = JSON.parse(await readFile(traitFile, "utf8"));
  const traitLinks = DomUtils.findAll(node => node.name === "a" && /^Traits\.aspx\?ID=\d+$/.test(node.attribs.href || ""), index.children);
  const traitPaths = new Map(traitLinks.map(link => [text(link).replace(/\s+\([^)]*\)$/, "").toLowerCase(), link.attribs.href]));
  const needed = [...new Set(records.flatMap(record => record.traits))].filter(name => !traitData.traits.some(record => record.name.toLowerCase() === name));
  for (const name of needed) {
    const path = traitPaths.get(name);
    if (!path) throw new Error(`Missing PC1 trait: ${name}`);
    const html = await cachedPage(path, `traits/${name}.html`, refresh);
    traitData.traits.push(parseEquipmentTrait(html, name, references));
  }
  if (needed.length) {
    traitData.traits.sort((a, b) => a.name.localeCompare(b.name, "en"));
    await writeFile(traitFile, JSON.stringify(traitData, null, 2) + "\n");
    console.log(`traits: added ${needed.length} PC1 definitions`);
  }
  records.sort((a, b) => a.name.localeCompare(b.name, "en"));
  await writeFile(new URL("../data/equipment.json", import.meta.url), JSON.stringify({
    _meta: { content: "All 262 Player Core equipment index entries: adventuring gear and variants, weapons and ammunition, armor, and shields. English descriptions and statistics from Archives of Nethys; excludes non-PC1 variants and appended magic-item lists.", reference: origin + "Sources.aspx?ID=216", license: "Pathfinder Player Core © 2023 Paizo Inc. Game-content licence and attribution notices: https://2e.aonprd.com/Licenses.aspx" },
    sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], equipment: records,
  }, null, 2) + "\n");
  console.log(`equipment: ${records.length} PC1 entries`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importPC1Equipment({ refresh: process.argv.includes("--refresh") });
