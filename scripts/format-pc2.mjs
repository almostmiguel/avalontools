// Align PC2 records with the native structures already used by PC1.
import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const heading = entry => entry && typeof entry === "object" && /^h[1-6]$/.test(entry.type || "");
const outcome = /^\{@b (Critical Success|Success|Failure|Critical Failure)\}\s*([\s\S]*)$/;

// The source importer emits adjacent headings and paragraphs. PC1 nests each
// heading's body, so keep the same content while grouping those siblings.
function formatBlocks(value, { degrees = false } = {}) {
  if (Array.isArray(value)) return value.map(item => formatBlocks(item, { degrees }));
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, formatBlocks(item, { degrees })]));
  if (result.type === "list" && Array.isArray(result.items)) result.items = result.items.map(item => item && typeof item === "object" && Object.keys(item).length === 1 && Array.isArray(item.entries) && item.entries.length === 1 && typeof item.entries[0] === "string" ? item.entries[0] : item);
  if (!Array.isArray(result.entries)) return result;
  const flat = result.entries, nested = [], stack = [{ level: 0, entries: nested }];
  for (const entry of flat) {
    if (entry === "") continue;
    if (!heading(entry)) { stack.at(-1).entries.push(entry); continue; }
    if (!entry.name && !entry.entries?.length) continue;
    let level = Number(entry.type[1]);
    const parent = stack.at(-1);
    // An action title directly beneath a section belongs to that section.
    if (level === parent.level && !parent.entries.length && /\{@(?:action|as)\s/i.test(entry.name || "")) level++;
    while (stack.at(-1).level >= level) stack.pop();
    const node = { ...entry, type: `h${Math.min(level, 6)}`, entries: [...(entry.entries || [])] };
    stack.at(-1).entries.push(node);
    stack.push({ level, entries: node.entries });
  }
  if (degrees) {
    const group = entries => {
      for (let index = 0; index < entries.length; index++) {
        const first = typeof entries[index] === "string" && outcome.exec(entries[index]);
        if (!first) { if (entries[index]?.entries) group(entries[index].entries); continue; }
        let end = index; const items = [];
        while (end < entries.length && typeof entries[end] === "string") {
          const match = outcome.exec(entries[end]); if (!match) break;
          items.push({ type: "item", name: match[1], entries: [match[2]] }); end++;
        }
        if (items.length > 1) entries.splice(index, end - index, { type: "list", style: "list-no-bullets", items });
        else index = end - 1;
      }
    };
    group(nested);
  }
  result.entries = nested;
  return result;
}

function flavorEntry(entry) {
  if (typeof entry === "string") return { type: "flavor", entries: [entry.replace(/^\{@i ([\s\S]*)\}$/, "$1")] };
  if (entry?.type === "flavor") {
    const content = entry.entries ?? (entry.entry == null ? [] : [entry.entry]);
    return { ...Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "entry")), entries: content.map(value => typeof value === "string" ? value.replace(/^\{@i ([\s\S]*)\}$/, "$1") : value) };
  }
  return entry;
}

function classSkills(skills) {
  const result = [];
  for (const choice of skills?.t || []) {
    if (choice.skill || typeof choice.entry !== "string") { result.push(choice); continue; }
    const entry = choice.entry.trim();
    if (/^a number of skills equal to \d+ plus your Intelligence modifier$/i.test(entry)) continue;
    const mixed = /^([A-Z][a-z]+)\s+Trained in\s+(.+)$/.exec(entry);
    if (mixed) {
      result.push({ skill: [mixed[1]] }, { skill: [/deity/i.test(mixed[2]) ? "Deity Dependant" : "Subclass Dependant"], entry: mixed[2] });
    } else if (/^[A-Z][a-z]+$/.test(entry)) result.push({ skill: [entry] });
    else result.push({ skill: ["Subclass Dependant"], entry });
  }
  return { ...skills, t: result };
}

function lowerHeadings(entries, minimum = 5) {
  for (const entry of entries) if (heading(entry)) {
    const level = Math.min(6, Math.max(minimum, Number(entry.type[1])));
    entry.type = `h${level}`;
    if (entry.entries) lowerHeadings(entry.entries, level + 1);
  }
}

function linkBackgroundLore(value, lore) {
  if (typeof value !== "string") return value;
  const names = (lore || []).map(name => `${name} Lore`).sort((a, b) => b.length - a.length);
  if (!names.length) return value;
  const pattern = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return value.replace(new RegExp(`(\\{@[^{}]*\\})|\\b(${pattern})\\b`, "gi"), (all, existing, label) => existing || `{@skill Lore||${label}}`);
}

export function formatPC2(payloads, { backgrounds = [], hasImage = path => existsSync(resolve(root, path)) } = {}) {
  const counts = {};
  for (const [collection, payload] of Object.entries(payloads)) {
    if (!Array.isArray(payload?.[collection])) continue;
    let changed = 0;
    payload[collection] = payload[collection].map(original => {
      if (original.source !== "PC2") return original;
      let entry = formatBlocks(original, { degrees: ["classes", "feats", "actions"].includes(collection) });
      if (["classes", "backgrounds", "archetypes", "ancestries"].includes(collection) && entry.entries?.length) {
        if (collection === "ancestries" && entry.versatile && typeof entry.entries[0] === "string" && !entry.features.length) {
          const match = /^(.*?[.!?])\s+([\s\S]+)$/.exec(entry.entries[0]);
          if (match) {
            entry.features = [{ name: `${entry.name} Heritage`, entries: [match[2]] }];
            entry.entries[0] = match[1];
          }
        }
        entry.entries[0] = flavorEntry(entry.entries[0]);
      }
      if (collection === "backgrounds") {
        const old = backgrounds.find(item => item.name === entry.name);
        for (const key of ["remaster", "lore", "feats"]) if (entry[key] == null && old?.[key] != null) entry[key] = old[key];
        entry.entries = entry.entries.map(item => linkBackgroundLore(typeof item === "string" && /attribute boosts?\b/i.test(item) ? item.replace(/\{@b (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\}/g, "$1") : item, entry.lore));
      }
      if (collection === "classes") {
        const image = `img/classes/${entry.name.toLowerCase()}.webp`;
        if (!entry.image && hasImage(image)) entry.image = image;
        entry.playstyle = entry.playstyle.filter(item => !(item.name === `Roleplaying the ${entry.name}` && !item.entries?.length && !item.entry));
        for (const item of entry.playstyle) {
          if (/^(During (?:Combat|Social) Encounters|While Exploring|In Downtime)\.\.\.$/.test(item.name || "")) item.name = item.name.replace(/\b(?:Combat|Social|Encounters|While|Exploring|In|Downtime)\b/g, word => word.toLowerCase()).replace(/^while/, "While").replace(/^in/, "In");
          if (item.name === "You Might...") item.name = "You might...";
          if (item.name === "Others Probably...") item.name = "Others probably...";
        }
        const profs = entry.initialProficiencies;
        for (const key of ["perception", "fort", "ref", "will"]) if (typeof profs[key] === "string") profs[key] = profs[key].toUpperCase();
        profs.skills = classSkills(profs.skills);
        if (profs.classDc?.entry && !profs.classDc.prof) profs.classDc.prof = /\b(trained|expert|master|legendary)\b/i.exec(profs.classDc.entry)?.[1]?.charAt(0).toLowerCase();
        for (const feature of entry.features) { feature.className ??= entry.name; feature.classSource ??= "PC2"; }
        for (const option of entry.subclasses) for (const feature of option.features) {
          feature.className ??= entry.name; feature.classSource ??= "PC2";
          feature.subclassShortName ??= option.shortName; feature.subclassSource ??= "PC2";
          if (feature.name === option.name) feature.name = option.type;
          if (!(feature.entries.length === 1 && feature.entries[0]?.type === "h4" && feature.entries[0]?.name === option.name)) feature.entries = [{ type: "h4", name: option.name, entries: feature.entries }];
          lowerHeadings(feature.entries[0].entries);
        }
      }
      if (collection === "feats") {
        entry.remaster ??= true;
        const index = entry.entries.findIndex(item => typeof item === "string" && /^\{@b Special\}\s*/.test(item));
        if (index >= 0 && entry.special == null) entry.special = [entry.entries.splice(index, 1)[0].replace(/^\{@b Special\}\s*/, "")];
      }
      if (JSON.stringify(entry) !== JSON.stringify(original)) changed++;
      return entry;
    });
    counts[collection] = changed;
  }
  // Familiar abilities are a separate collection in the companions payload.
  if (payloads.companions?.familiarAbilities) payloads.companions.familiarAbilities = payloads.companions.familiarAbilities.map(entry => entry.source === "PC2" ? formatBlocks(entry) : entry);
  return counts;
}

export async function formatPC2Files({ backup } = {}) {
  const collections = ["actions", "ancestries", "archetypes", "backgrounds", "classes", "companions", "equipment", "feats", "spells", "traits"];
  const payloads = Object.fromEntries(await Promise.all(collections.map(async name => [name, JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"))])));
  const originals = Object.fromEntries(Object.entries(payloads).map(([name, data]) => [name, JSON.stringify(data)]));
  const backgrounds = backup ? JSON.parse(readFileSync(resolve(backup, "data/backgrounds/backgrounds-pc2.json"), "utf8")).background : [];
  const counts = formatPC2(payloads, { backgrounds });
  for (const [name, payload] of Object.entries(payloads)) if (JSON.stringify(payload) !== originals[name]) await writeFile(new URL(`../data/${name}.json`, import.meta.url), JSON.stringify(payload, null, 2) + "\n");
  return counts;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await formatPC2Files({ backup: process.argv.includes("--backup") ? process.argv[process.argv.indexOf("--backup") + 1] : undefined }));
