import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";

const cache = new URL("../.cache/core-encounters/", import.meta.url);
const decode = new MarkdownIt().utils.unescapeAll;
const plain = html => decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const base = "https://2e.aonprd.com/";
const headers = { "User-Agent": "AvalonTools core reference importer" };

async function download(path, filename, refresh) {
  const target = new URL(filename, cache);
  if (!refresh) {
    try { return await readFile(target, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const response = await fetch(new URL(path, base), { headers, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const html = await response.text();
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, html);
  return html;
}

// Convert source HTML into the site's safe JSON blocks; no raw HTML is published.
export function importEncounterContent(html) {
  return decode(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<span\b[^>]*class=['"]action['"][^>]*>\[([^\]]+)\]<\/span>/gi, (_, action) => {
      const symbol = { "one-action": "1", "two-actions": "2", "three-actions": "3", reaction: "r", "free-action": "f" }[action];
      if (!symbol) throw new Error(`Unknown action symbol: ${action}`);
      return `{@as ${symbol}}`;
    })
    .replace(/<a\b[^>]*href\s*=\s*["']\/?([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
      const text = plain(body);
      const kind = { Conditions: "condition", Skills: "skill", Actions: "action", Traits: "trait", Hazards: "hazard", Curses: "affliction", Diseases: "affliction" }[/^(\w+)\.aspx/i.exec(href)?.[1]];
      // Nethys link labels can be inflected or include a trait's parameter.
      const actions = { Steals: "Steal", Escapes: "Escape", Striking: "Strike", "Pick the Lock": "Pick a Lock", disable: "Disable a Device" };
      const name = kind === "action" ? actions[text] || text : kind === "trait" ? text === "moves" ? "Move" : text.replace(/\s+(?:d?\d+).*$/, "") : text;
      if (kind === "action" && name === "Activate an Item") return text; // No item-activation catalog exists yet.
      const source = ["hazard", "affliction"].includes(kind) ? "GMC" : "";
      return kind ? `{@${kind} ${name}${source || name !== text ? `|${source}` : ""}${name !== text ? `|${text}` : ""}}` : text;
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, body) => `{@b ${body.replace(/<[^>]*>/g, "")}}`)
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, body) => `{@i ${body.replace(/<[^>]*>/g, "")}}`)
    .replace(/<hr\b[^>]*>/gi, "\n\n__HR__\n\n")
    .replace(/<br\s*\/?>|<\/(?:p|li|h[1-6])>/gi, "\n\n")
    .replace(/;\s*(?=\{@b Stage \d+\})/g, "\n\n")
    .replace(/<[^>]*>/g, ""))
    .split(/\n\s*\n/).map(text => text.replace(/\s+/g, " ").trim()).filter(Boolean)
    .map(text => text === "__HR__" ? { type: "hr" } : text);
}

function parseBlock(html, category) {
  const heading = /<h[12]\b[^>]*class="title[^\"]*"[^>]*>([\s\S]*?)<\/h[12]>/.exec(html);
  if (!heading) throw new Error("Missing stat block title.");
  const title = heading[1].replace(/<a\b[^>]*href\s*=\s*"PFS\.aspx"[^>]*>[\s\S]*?<\/a>/gi, "");
  const rank = /<span[^>]*margin-left:auto[^>]*>([\s\S]*?)<\/span>/.exec(title);
  const name = plain(title.replace(rank?.[0] || "", ""));
  const level = /(-?\d+)\s*$/.exec(plain(rank?.[1] || ""));
  const remainder = html.slice(heading.index + heading[0].length);
  const source = /<b>Source<\/b>([\s\S]*?)<br\s*\/?>/i.exec(remainder);
  const page = /GM Core pg\. (\d+)/.exec(plain(source?.[1] || ""));
  if (!page) throw new Error(`Missing GM Core source: ${name}`);
  const traits = [...remainder.slice(0, source.index).matchAll(/<span class="trait[^\"]*">([\s\S]*?)<\/span>/g)].map(match => plain(match[1]).toLowerCase());
  let body = remainder.slice(source.index + source[0].length).split(/<div class="clear">|<div class="footer"|<nethys-search/)[0];
  const complexity = category === "Hazard" ? /<b>Complexity<\/b>\s*(Simple|Complex)/.exec(body)?.[1] : undefined;
  if (category === "Hazard" && !complexity) throw new Error(`Missing complexity: ${name}`);
  if (category === "Hazard") body = body.replace(/<b>Complexity<\/b>\s*(Simple|Complex)<br\s*\/?>/, "");
  return { name, source: "GMC", page: Number(page[1]), category: category === "Hazard" ? traits.includes("haunt") ? "Haunt" : traits.includes("environmental") ? "Environmental" : "Trap" : category,
    level: level ? Number(level[1]) : null, traits, ...(complexity ? { complexity } : {}), entries: importEncounterContent(body) };
}

export async function importCoreEncounters({ refresh = false } = {}) {
  await mkdir(cache, { recursive: true });
  const index = await download("Sources.aspx?ID=218", "gm-source.html", refresh);
  const hazardLinks = [...new Set([...index.matchAll(/href="(Hazards\.aspx\?ID=\d+)"/g)].map(match => match[1]))];
  if (hazardLinks.length !== 32) throw new Error(`Expected 32 GM Core hazards; found ${hazardLinks.length}. Review source changes.`);
  const hazards = [];
  for (const path of hazardLinks) {
    const html = await download(path, `aon/hazards-${new URL(path, base).searchParams.get("ID")}.html`, refresh);
    hazards.push(parseBlock(html, "Hazard"));
  }
  const afflictions = [];
  for (const [category, path] of [["Curse", "Curses.aspx"], ["Disease", "Diseases.aspx"]]) {
    const html = await download(path, `${category === "Curse" ? "curses" : "diseases"}.html`, refresh);
    const blocks = [...html.matchAll(/<h2 class="title">[\s\S]*?(?=<h2 class="title">|<div class="clear">|<nethys-search|<\/form>)/g)];
    for (const [block] of blocks) {
      if (/GM Core pg\./.test(block.match(/<b>Source<\/b>([\s\S]*?)<br\s*\/?>/)?.[1] || "")) afflictions.push(parseBlock(block, category));
    }
  }
  // The source index lists the GM Core poisons consecutively, before alchemical tools.
  for (let id = 2891; id <= 2909; id++) {
    const html = await download(`Equipment.aspx?ID=${id}`, `aon/equipment-${id}.html`, refresh);
    const record = parseBlock(html, "Poison");
    if (!record.traits.includes("poison")) throw new Error(`Expected a poison at Equipment ID ${id}.`);
    afflictions.push(record);
  }
  // Preserve the staged PC1 afflictions embedded in spells, rather than labelling spells as hazards.
  const revision = execFileSync("git", ["rev-parse", "2ef469c253^"], { encoding: "utf8" }).trim();
  const spells = JSON.parse(execFileSync("git", ["show", `${revision}:data/spells/spells-pc1.json`], { encoding: "utf8", maxBuffer: 30_000_000 })).spell;
  for (const spell of spells.filter(spell => spell.source === "PC1")) for (const entry of spell.entries || []) {
    if (entry?.type !== "affliction") continue;
    const entries = [`This affliction is caused by {@i ${spell.name}}. Use the caster's spell DC for its Fortitude saving throw.`, ...spell.entries.filter(item => typeof item === "string"), ...(entry.note ? [entry.note] : [])];
    const outcomes = spell.entries.find(item => item.type === "successDegree")?.entries;
    if (outcomes) entries.push({ type: "list", style: "list-no-bullets", items: Object.entries(outcomes).map(([name, value]) => ({ type: "item", name, entries: Array.isArray(value) ? value : [value] })) });
    if (entry.maxDuration) entries.push(`{@b Maximum Duration} ${entry.maxDuration}`);
    if (entry.onset) entries.push(`{@b Onset} ${entry.onset}`);
    for (const stage of entry.stages || []) entries.push(`{@b Stage ${stage.stage}} ${stage.entry}${stage.duration ? ` (${stage.duration})` : ""}`);
    if (spell.heightened?.plusX) for (const [ranks, descriptions] of Object.entries(spell.heightened.plusX)) entries.push({ type: "item", name: `Heightened (+${ranks})`, entry: descriptions });
    afflictions.push({ name: entry.name, source: "PC1", page: spell.page, category: entry.traits.includes("curse") ? "Curse" : entry.traits.includes("disease") ? "Disease" : "Poison", level: entry.level ?? null, traits: entry.traits, entries });
  }
  const sources = [{ id: "PC1", name: "Player Core", source: "PC1" }, { id: "GMC", name: "GM Core", source: "GMC" }];
  // Include definitions for the new hazard/poison badges so their existing links and previews resolve.
  const traitFile = new URL("../data/traits.json", import.meta.url);
  const traitData = JSON.parse(await readFile(traitFile, "utf8"));
  const missingTraits = [...new Set([...hazards, ...afflictions].flatMap(record => [...record.traits,
    ...[...JSON.stringify(record.entries).matchAll(/\{@trait ([^}|]+)/g)].map(match => match[1].toLowerCase()),
  ]))]
    .filter(name => !traitData.traits.some(trait => trait.name.toLowerCase() === name));
  const pages = [await readFile(new URL("curses.html", cache), "utf8"), await readFile(new URL("diseases.html", cache), "utf8")];
  for (const path of hazardLinks) pages.push(await readFile(new URL(`aon/hazards-${new URL(path, base).searchParams.get("ID")}.html`, cache), "utf8"));
  for (let id = 2891; id <= 2909; id++) pages.push(await readFile(new URL(`aon/equipment-${id}.html`, cache), "utf8"));
  pages.push(await download("Traits.aspx", "traits-index.html", refresh));
  const traitLinks = new Map([...pages.join("\n").matchAll(/href="\/?(Traits\.aspx\?ID=\d+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [plain(match[2]).toLowerCase(), match[1]]));
  for (const name of missingTraits) {
    if (name === "complex") {
      traitData.traits.push({ name: "Complex", source: "GMC", page: 104, category: "Hazard", categories: ["Hazard"], entries: ["A complex hazard rolls initiative and follows a routine on its turn. See {@hazard Spinning Blade Pillar|GMC} for an example."] });
      if (!traitData.sources.some(source => source.id === "GMC")) traitData.sources.push(sources.find(source => source.id === "GMC"));
      continue;
    }
    const path = traitLinks.get(name);
    if (!path) throw new Error(`Missing trait reference: ${name}`);
    const html = await download(path, `traits-${name}.html`, refresh);
    const body = html.match(/<h1 class="title">[\s\S]*?<\/h1>([\s\S]*?)<nethys-search/)?.[1];
    const source = body?.match(/<b>Source<\/b>([\s\S]*?)<br\s*\/?>/);
    const citation = plain(source?.[1] || "").match(/(GM Core|Player Core) pg\. (\d+)/);
    if (!citation) throw new Error(`Missing core source for trait: ${name}`);
    const category = ["complex", "environmental", "haunt"].includes(name) ? "Hazard" : name === "virulent" ? "Affliction" : name === "deadly" ? "Weapon" : "Poison";
    const content = body.slice(source.index + source[0].length).split(/<div class="footer"|<div class="clear">/)[0];
    const sourceId = citation[1] === "GM Core" ? "GMC" : "PC1";
    traitData.traits.push({ name: name.charAt(0).toUpperCase() + name.slice(1), source: sourceId, page: Number(citation[2]), categories: [category], category, entries: importEncounterContent(content) });
    if (!traitData.sources.some(source => source.id === sourceId)) traitData.sources.push(sources.find(source => source.id === sourceId));
  }
  if (missingTraits.length) {
    traitData.traits.sort((a, b) => a.name.localeCompare(b.name, "en"));
    await writeFile(traitFile, JSON.stringify(traitData, null, 2) + "\n");
    console.log(`traits: added ${missingTraits.length} core definitions`);
  }
  for (const [collection, records] of Object.entries({ hazards, afflictions })) {
    const payload = { _meta: { content: "Player Core and GM Core only. GM Core stat blocks transcribed from Archives of Nethys; embedded PC1 afflictions extracted from the historical repository.", references: [base + "Sources.aspx?ID=218", base + "Rules.aspx?ID=2389"], pc1Revision: revision, license: "See data/encounters.README.md for content attribution and licence references." },
      sources: sources.filter(source => records.some(record => record.source === source.id)),
      [collection]: records.sort((a, b) => a.name.localeCompare(b.name, "en") || a.source.localeCompare(b.source)) };
    await writeFile(new URL(`../data/${collection}.json`, import.meta.url), JSON.stringify(payload, null, 2) + "\n");
    console.log(`${collection}: ${records.length} entries`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importCoreEncounters({ refresh: process.argv.includes("--refresh") });
