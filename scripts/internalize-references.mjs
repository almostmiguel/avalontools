import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalog, createActionLibrary } from "../js/reference-library.js";
import { createRuleLibrary } from "../js/rule-library.js";
import { createFeatCatalog } from "../js/feat-library.js";
import { createClassOverviewCatalog } from "../js/class-reader.js";
import { createCreatureCatalog, createCompanionCatalog } from "../js/creature-library.js";
import { inlineText } from "../js/content-renderer.js";

const nethys = /(?:^|\.)aonprd\.com$|(?:^|\.)archivesofnethys\.com$/i;
const normalize = value => inlineText(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
const pathKinds = { Rules: "rule", Feats: "feat", Equipment: "equipment", Weapons: "equipment", Armor: "equipment", Shields: "equipment", Actions: "action", Traits: "trait", Ancestries: "ancestry", Heritages: "ancestry", Archetypes: "archetype", Backgrounds: "background", Classes: "class", Spells: "spell", Rituals: "rule", Monsters: "creature", MonsterAbilities: "creatureability", Familiars: "companion", Companions: "companion", Conditions: "condition", Skills: "skill" };
const aliases = { climbing: "Climb", demoralizing: "Demoralize", grappling: "Grapple", aiding: "Aid", "casting a spell": "Cast a Spell", cast: "Cast a Spell", refocusing: "Refocus", strikes: "Strike", escaping: "Escape", escapes: "Escape", disable: "Disable a Device", "raise your shield": "Raise a Shield", goblins: "Goblin", elves: "Elf", dwarven: "Dwarf", "temporary hit points": "Temporary Hit Points", imprecise: "Imprecise Senses", "environmental cold effects": "Cold", "environmental heat effects": "Heat", "starvation or thirst": "Starvation and Thirst" };

function externalUrl(value) {
  try { const url = new URL(value); return nethys.test(url.hostname) ? url : null; } catch { return null; }
}

function splitArguments(value) {
  const result = []; let start = 0, depth = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "{") depth++; else if (value[i] === "}") depth--;
    else if (value[i] === "|" && !depth) { result.push(value.slice(start, i)); start = i + 1; }
  }
  return [...result, value.slice(start)];
}

function rewriteTags(input, replace) {
  let result = "", cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf("{@", cursor);
    if (start < 0) return result + input.slice(cursor);
    result += input.slice(cursor, start);
    let end = start + 2, depth = 1;
    for (; end < input.length && depth; end++) { if (input[end] === "{") depth++; else if (input[end] === "}") depth--; }
    if (depth) return result + input.slice(start);
    const body = rewriteTags(input.slice(start + 2, end - 1), replace);
    result += replace(body) ?? `{@${body}}`; cursor = end;
  }
  return result;
}

export function internalizeData(payloads) {
  const catalogs = {};
  for (const [kind, collection] of Object.entries({ action: "actions", condition: "conditions", skill: "skills", class: "classes", feat: "feats", trait: "traits", ancestry: "ancestries", archetype: "archetypes", background: "backgrounds", equipment: "equipment", spell: "spells", affliction: "afflictions", hazard: "hazards", companion: "companions", creature: "creatures", rule: "rules" })) {
    const payload = payloads[collection]; if (!payload) continue;
    catalogs[kind] = kind === "feat" ? createFeatCatalog(payload) : kind === "class" ? createClassOverviewCatalog(payload) : kind === "creature" ? createCreatureCatalog(payload) : kind === "companion" ? createCompanionCatalog(payload) : kind === "action" ? createActionLibrary(payload) : kind === "rule" ? createRuleLibrary(payload) : createCatalog(payload, { collection, href: `${collection}.html` });
  }
  if (catalogs.creature) catalogs.creatureability = catalogs.creature;
  const byName = {}, byPath = new Map();
  for (const [kind, catalog] of Object.entries(catalogs)) {
    byName[kind] = new Map();
    const add = (name, record) => { const key = normalize(name); if (!byName[kind].has(key)) byName[kind].set(key, []); if (!byName[kind].get(key).includes(record)) byName[kind].get(key).push(record); };
    for (const record of catalog.records || catalog.rules) {
      if (kind === "creatureability" && record.kind !== "ability" || kind === "creature" && record.kind === "ability") continue;
      for (const name of [record.name, ...(record.entry?.aliases || []), ...(record.aliases || [])]) add(name, record);
      if (kind === "class") {
        for (const feature of record.entry.features) { add(feature.name, record); add(`${feature.name} class feature`, record); add(`${record.name}'s ${feature.name}`, record); }
      }
      if (kind === "ancestry") for (const heritage of record.entry.heritages || []) add(heritage.name, record);
      const variant = /^(.*?)\s+\(([^)]+)\)$/.exec(record.name);
      if (variant) add(`${variant[2]} ${variant[1]}`, record);
      const url = externalUrl(record.entry?.reference || record.reference || "");
      if (url) { const key = url.pathname.toLowerCase() + "?" + url.searchParams.get("ID"); if (!byPath.has(key)) byPath.set(key, []); byPath.get(key).push({ kind, record }); }
    }
  }
  const stats = { converted: 0, plainText: 0, metadata: 0 };
  const choose = (records, context) => {
    const unique = [...new Map(records.map(record => [record.id, record])).values()];
    if (unique.length === 1) return unique[0];
    const ownSource = unique.filter(record => record.source === context.source);
    if (ownSource.length === 1) return ownSource[0];
    const owners = unique.filter(record => record.traits?.some(trait => context.traits?.includes(trait)));
    return owners.length === 1 ? owners[0] : null;
  };
  function resolveLink(label, url, context) {
    const pathKind = pathKinds[url.pathname.match(/\/(\w+)\.aspx/i)?.[1]];
    if (!pathKind) return null;
    const key = normalize(label), alias = aliases[key];
    const candidates = [key, ...(alias ? [normalize(alias)] : []), key.replace(/\s+\d.*$/, ""), key.replace(/s$/, "")];
    const quantity = inlineText(label).replace(/\s+\([^)]*(?:\d|see )[^)]*\)\s*$/, "");
    candidates.push(normalize(quantity));
    for (const kind of [...new Set([pathKind, ...(["rule", "creatureability", "trait", "action"].includes(pathKind) ? ["rule", "creatureability", "trait", "action"] : [])])]) {
      for (const candidate of candidates) {
        const target = choose(byName[kind]?.get(candidate) || [], context);
        if (target) return { kind, target };
      }
    }
    // A short label such as “basic” may point to a fully named local rule.
    const targets = byPath.get(url.pathname.toLowerCase() + "?" + url.searchParams.get("ID")) || [];
    const matching = targets.filter(({ kind, record }) => kind === pathKind && candidates.some(candidate => normalize(record.name) === candidate));
    const target = choose(matching.map(item => item.record), context);
    return target ? { kind: pathKind, target } : null;
  }
  function string(value, context) {
    value = rewriteTags(value, body => {
      const match = /^link\s+([\s\S]*)$/i.exec(body); if (!match) return null;
      const [label, href] = splitArguments(match[1]), url = externalUrl(href);
      const route = ({ "companions-and-familiars": "companions", companions: "companions", equipment: "equipment", traits: "traits", conditions: "conditions" })[(href || label).toLowerCase()];
      if (!url && route) { stats.converted++; return `{@catalog ${route}${label === route ? "" : `|${label}`}}`; }
      if (!url) return null;
      const resolved = resolveLink(label, url, context);
      if (!resolved) { stats.plainText++; return label; }
      const { kind, target } = resolved, catalog = catalogs[kind];
      let name = target.name;
      if (catalog.registry.resolve(name, target.source).target?.id !== target.id) {
        const alias = (target.aliases || target.entry?.aliases || []).find(alias => catalog.registry.resolve(alias, target.source).target?.id === target.id);
        name = alias || target.localId || target.id;
      }
      stats.converted++;
      return `{@${kind} ${name}|${target.source}${label === name ? "" : `|${label}`}}`;
    });
    return value
      .replace(/\{@b Source:?\}\s*\{@i [^{}]*?\s+pg\.\s*\d+(?:[-–]\d+)?\}/g, "")
      .replace(/\s*\((?:Player Core(?: 2)?|GM Core|Monster Core(?: 2)?)(?:\s+(?:pg\.?|p\.))?\s+\d+(?:[-–]\d+)?\)/g, "")
      .replace(/https?:\/\/(?:[a-z0-9-]+\.)*(?:aonprd\.com|archivesofnethys\.com)[^\s<>{}|"\]]*/gi, "");
  }
  function walk(value, context = {}) {
    if (typeof value === "string") return string(value, context);
    if (Array.isArray(value)) return value.map(item => walk(item, context));
    if (!value || typeof value !== "object") return value;
    const ownContext = { ...context, ...(typeof value.source === "string" && !externalUrl(value.source) ? { source: value.source } : {}), ...(value.traits ? { traits: value.traits } : {}) };
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (["_meta", "reference", "references", "referenceUrl", "referenceSource", "importedFrom", "revision"].includes(key) || typeof child === "string" && externalUrl(child)) { stats.metadata++; continue; }
      result[key] = walk(child, ownContext);
    }
    return result;
  }
  return { payloads: Object.fromEntries(Object.entries(payloads).map(([key, payload]) => [key, walk(payload)])), stats };
}

export async function internalizeJsonFiles() {
  const root = new URL("../data/", import.meta.url);
  const files = (await readdir(root)).filter(file => file.endsWith(".json") && !file.endsWith(".schema.json"));
  const payloads = Object.fromEntries(await Promise.all(files.map(async file => [file.slice(0, -5), JSON.parse(await readFile(new URL(file, root), "utf8"))])));
  const result = internalizeData(payloads);
  for (const [name, payload] of Object.entries(result.payloads)) if (JSON.stringify(payload) !== JSON.stringify(payloads[name])) await writeFile(new URL(`${name}.json`, root), JSON.stringify(payload, null, 2) + "\n");
  return result.stats;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await internalizeJsonFiles());
