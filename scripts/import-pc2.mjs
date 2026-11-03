// Re-runnable PC2 import. Download separately with cache-pc2.mjs; parse from cache offline.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, DomUtils as D } from "htmlparser2";
import { page, selections, origin } from "./cache-pc2.mjs";
import { htmlText as text, htmlContentBlocks as blocks, renderHtmlInline as inline, foldHtmlReference as fold } from "./html-content.mjs";
import { parseSpellPage } from "./import-pc1-spells.mjs";
import { parseEquipmentPage } from "./import-pc1-equipment.mjs";
import { createFeatCatalog } from "../js/feat-library.js";
import { internalizeData } from "./internalize-references.mjs";
import { formatPC2 } from "./format-pc2.mjs";

const source = { id: "PC2", name: "Player Core 2", source: "PC2" };
const sourceOptions = { source: "PC2", sourceName: source.name };
const slug = value => fold(value).replaceAll(" ", "-");
const load = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const references = { externalFallback: true };

export function contentNodes(html) {
  const start = html.search(/<h1\b[^>]*class="title"/);
  if (start < 0) throw new Error("Missing Nethys content title");
  const end = html.indexOf('<div class="clear">', start);
  const fragment = html.slice(start, end < 0 ? undefined : end)
    .replace(/<a\b[^>]*href\s*=\s*["']PFS\.aspx["'][^>]*>[\s\S]*?<\/a>\s*<\/span>/gi, "")
    .replace(/<u><a\b[^>]*href=["']PFS\.aspx["'][^>]*><b><i>PFS Note[\s\S]*?<\/i>/gi, "");
  const doc = parseDocument(fragment);
  const heading = D.findOne(node => node.name === "h1", doc.children);
  return heading.parent.children;
}
const traitsOf = nodes => D.findAll(node => /^trait/.test(node.attribs?.class || ""), nodes).map(node => text(node).toLowerCase());
function citation(nodes) {
  const match = /Player Core 2 pg\. (\d+)/.exec(nodes.map(text).join(" "));
  if (!match) throw new Error(`Missing PC2 citation: ${nodes.map(text).join(" ").slice(0,150)}`);
  return Number(match[1]);
}
function afterSource(nodes) {
  const sourceBox = nodes.findIndex(node => (node.attribs?.class || "").split(/\s+/).includes("sources"));
  if (sourceBox >= 0) return nodes.slice(sourceBox + 1);
  const index = nodes.findIndex(node => ["b", "strong"].includes(node.name) && text(node) === "Source");
  if (index < 0) throw new Error("Missing source field");
  const end = nodes.findIndex((node, i) => i > index && node.name === "br");
  return nodes.slice(end + 1);
}
function fields(nodes) {
  const result = new Map(); let key;
  for (const node of nodes) {
    if (["b", "strong"].includes(node.name)) { key = text(node).replace(/:$/, ""); result.set(key, []); }
    else if (key) result.get(key).push(node);
  }
  return { nodes: result, value: key => inline(result.get(key) || [], references).replace(/;\s*$/, "").trim() };
}
function bodyBlocks(nodes) {
  // Strip repeated citations from embedded abilities, but retain their actual rules.
  const cleaned = [...nodes];
  for (let i = cleaned.length - 1; i >= 0; i--) if (["b", "strong"].includes(cleaned[i].name) && text(cleaned[i]) === "Source") {
    let end = i + 1; while (end < cleaned.length && cleaned[end].name !== "br") end++;
    cleaned.splice(i, end - i + 1);
  }
  return blocks(cleaned, references).filter(entry => typeof entry !== "string" || !entry.startsWith("{@b Ancestry Page}"));
}
function sections(nodes, pattern = /^h[12]$/) {
  const result = [];
  for (const node of nodes) {
    if (pattern.test(node.name || "")) result.push({ heading: node, name: text(node), nodes: [] });
    else if (result.length) result.at(-1).nodes.push(node);
  }
  return result;
}
function generic(selection, nodes) {
  return { name: selection.name, source: "PC2", page: citation(nodes), entries: bodyBlocks(afterSource(nodes)), reference: origin + selection.path };
}
export function parsePC2Feat(html, selection) {
  const nodes = contentNodes(html), heading = nodes[0];
  const boundary = nodes.findIndex(node => node.name === "hr");
  if (boundary < 0) throw new Error(`Missing feat body: ${selection.name}`);
  const metadata = nodes.slice(1, boundary), values = fields(metadata);
  const rank = /Feat\s+(\d+)/.exec(text(heading));
  if (!rank) throw new Error(`Missing feat level: ${selection.name}`);
  const name = selection.name;
  if (!fold(text(heading)).startsWith(fold(name) + " ")) throw new Error(`Unexpected feat title: ${name}`);
  const appendix = nodes.findIndex((node, index) => index > boundary && /^h[1-6]$/.test(node.name || "") && (text(node) === "Traits" || /Leads To\.\.\.$/.test(text(node))));
  const record = { name, source: "PC2", id: `aon-${selection.path.match(/ID=(\d+)/)[1]}`, page: citation(metadata), level: Number(rank[1]), traits: traitsOf(metadata), entries: bodyBlocks(nodes.slice(boundary + 1, appendix < 0 ? undefined : appendix)), reference: origin + selection.path };
  const actions = D.findAll(node => (node.attribs?.class || "").split(/\s+/).includes("action"), heading.children || []);
  if (actions.length) record.activity = { unit: "action", entry: inline(actions, references) };
  const cost = actions[0] && text(actions[0]);
  if (cost) record.activity = cost.includes("reaction") ? { unit: "reaction", number: 1 } : cost.includes("free") ? { unit: "free", number: 1 } : { unit: "action", number: cost.includes("two") ? 2 : cost.includes("three") ? 3 : 1 };
  if (actions.length > 1) record.activity.options = actions.map(node => ({ "[one-action]": "1", "[two-actions]": "2", "[three-actions]": "3", "[reaction]": "r", "[free-action]": "f" })[text(node)]);
  for (const key of ["Prerequisites", "Requirements", "Trigger", "Frequency", "Access", "Cost"]) if (values.value(key)) record[key.toLowerCase()] = values.value(key);
  const archetypes = (values.nodes.get("Archetype") || values.nodes.get("Archetypes") || []).flatMap(node => D.findAll(child => child.name === "a" && /Archetypes\.aspx/.test(child.attribs?.href || ""), [node])).map(text);
  if (archetypes.length) record.featType = { archetype: [...new Set(archetypes)] };
  return record;
}
function embeddedActions(html, category) {
  const nodes = contentNodes(html), records = [];
  for (const heading of D.findAll(node => /^h[2-6]$/.test(node.name || "") && !/Feat\s+\d/.test(text(node)) && D.findOne(child => /(?:^|\s)action(?:\s|$)/.test(child.attribs?.class || ""), node.children || []), nodes)) {
    const siblings = heading.parent.children, start = siblings.indexOf(heading), section = [];
    for (const node of siblings.slice(start + 1)) { if (/^h[1-6]$/.test(node.name || "")) break; section.push(node); }
    const boundary = section.findIndex(node => node.name === "hr");
    const metadata = section.slice(0, boundary < 0 ? undefined : boundary);
    if (boundary < 0 || !/Player Core 2 pg\./.test(metadata.map(text).join(" "))) continue;
    const link = D.findOne(node => node.name === "a" && /Actions\.aspx\?ID=/.test(node.attribs?.href || ""), heading.children);
    const name = link ? text(link) : text(heading).replace(/\[.*?\]/g, "").trim(), values = fields(metadata);
    const symbols = D.findAll(child => /(?:^|\s)action(?:\s|$)/.test(child.attribs?.class || ""), heading.children).map(text);
    const symbol = symbols[0];
    const time = symbol.includes("reaction") ? { unit: "reaction", value: 1 } : symbol.includes("free") ? { unit: "free", value: 1 } : { unit: "action", value: symbol.includes("two") ? 2 : symbol.includes("three") ? 3 : 1 };
    if (symbols.length > 1) { time.options = symbols.map(value => value.includes("free") ? "free" : value.includes("reaction") ? "reaction" : value.includes("two") ? "action-2" : value.includes("three") ? "action-3" : "action-1"); time.unit = "varies"; delete time.value; time.label = time.options.map(value => ({ free: "Free action", reaction: "Reaction", "action-1": "1 action", "action-2": "2 actions", "action-3": "3 actions" })[value]).join(" or "); }
    const record = { name, source: "PC2", page: citation(metadata), category, time, traits: traitsOf(metadata), entries: bodyBlocks(section.slice(boundary + 1)), ...(link ? { reference: new URL(link.attribs.href, origin).href } : {}) };
    for (const key of ["Trigger", "Requirements", "Frequency", "Cost"]) if (values.value(key)) record[key.toLowerCase()] = values.value(key);
    if (record.entries.length) records.push(record);
  }
  return records;
}
function parseAncestry(html, selection, heritageRecords) {
  const nodes = contentNodes(html), parts = sections(nodes);
  const mechanics = parts.findIndex(part => part.name === `${selection.name} Mechanics`);
  const versatile = /Versatile Heritage/.test(text(nodes[0]));
  const introParts = mechanics < 0 ? parts : parts.slice(0, mechanics);
  const first = introParts[0];
  const entry = { name: selection.name, source: "PC2", page: citation(first.nodes), category: versatile ? "Versatile heritage" : "Ancestry", versatile,
    traits: traitsOf(first.nodes.slice(0, first.nodes.findIndex(node => node.name === "b" && text(node) === "Source"))),
    entries: [...bodyBlocks(afterSource(first.nodes)), ...introParts.slice(1).map(part => ({ type: "h3", name: part.name, entries: bodyBlocks(part.nodes) }))],
    heritages: [], features: [], heritageInfo: [], reference: origin + selection.path };
  entry.rarity = entry.traits.find(trait => ["uncommon", "rare", "unique"].includes(trait)) || "common";
  entry.traits = entry.traits.filter(trait => trait !== entry.rarity);
  if (entry.entries[0] && typeof entry.entries[0] === "string") entry.entries[0] = { type: "flavor", entries: [entry.entries[0]] };
  if (versatile) {
    const heritage = heritageRecords.find(record => record.ancestry === selection.name);
    if (!heritage) throw new Error(`Missing versatile heritage: ${selection.name}`);
    entry.entries = heritage.entries;
  }
  if (!versatile) {
    const values = name => bodyBlocks(parts.slice(mechanics + 1).find(part => part.name === name)?.nodes || []).filter(value => typeof value === "string");
    entry.hp = Number(values("Hit Points")[0]); entry.size = values("Size"); entry.speed = values("Speed").join(" ");
    entry.boosts = values("Attribute Boosts"); entry.flaws = [...values("Attribute Flaw"), ...values("Attribute Flaws")]; entry.languages = values("Languages");
    const metadata = new Set(["Hit Points", "Size", "Speed", "Attribute Boosts", "Attribute Flaw", "Attribute Flaws", "Languages"]);
    entry.features = parts.slice(mechanics + 1).filter(part => !metadata.has(part.name)).map(part => ({ name: part.name, entries: bodyBlocks(part.nodes) }));
    entry.heritages = heritageRecords.filter(record => record.ancestry === selection.name).map(({ ancestry, ...record }) => record);
    if (!entry.hp || !entry.size.length || !entry.heritages.length) throw new Error(`Missing ancestry mechanics: ${entry.name}`);
  }
  return entry;
}
function parseClass(html, selection, options) {
  const nodes = contentNodes(html), all = sections(nodes);
  const firstProfs = all.findIndex(part => part.name === "Initial Proficiencies");
  const classFeatures = all.findIndex(part => part.name === "Class Features");
  const introText = all[0].nodes.map(text).join(" ");
  const attribute = /Key Attribute:\s*([A-Z]+(?:\s+OR\s+[A-Z]+)?)/.exec(introText)?.[1];
  const hp = /Hit Points:\s*(\d+)/.exec(introText)?.[1];
  if (!attribute || !hp || firstProfs < 0 || classFeatures < 0) throw new Error(`Missing class statistics: ${selection.name}`);
  const profParts = all.slice(firstProfs + 1, classFeatures);
  const profText = name => profParts.find(part => part.name === name)?.nodes.map(text).join(" ").trim() || "";
  const proficiencyRank = value => /Legendary/i.test(value) ? "l" : /Master/i.test(value) ? "m" : /Expert/i.test(value) ? "e" : /Trained/i.test(value) ? "t" : "u";
  const grouped = value => {
    const output = {};
    for (const match of value.matchAll(/(Trained|Expert|Master|Legendary) in (.*?)(?=\s*(?:Trained|Expert|Master|Legendary) in |$)/g)) (output[proficiencyRank(match[1])] ||= []).push(match[2].trim());
    return output;
  };
  const saves = profText("Saving Throws"), skills = profText("Skills");
  const initialProficiencies = { perception: proficiencyRank(profText("Perception")),
    fort: proficiencyRank(/(Trained|Expert|Master|Legendary) in Fortitude/.exec(saves)?.[1]), ref: proficiencyRank(/(Trained|Expert|Master|Legendary) in Reflex/.exec(saves)?.[1]), will: proficiencyRank(/(Trained|Expert|Master|Legendary) in Will/.exec(saves)?.[1]),
    skills: { t: [{ entry: skills.replace(/Trained in a number of additional skills[\s\S]*$/, "").replace(/^Trained in /, "").trim() || "Skills granted by your class options" }], add: Number(/equal to (\d+)/.exec(skills)?.[1] || 0) },
    attacks: grouped(profText("Attacks")), defenses: grouped(profText("Defenses")), classDc: { entry: profText("Class DC") || profText("Spell DC") } };
  if (profText("Spells")) initialProficiencies.spells = grouped(profText("Spells"));
  const features = all.slice(classFeatures + 1).map(part => {
    const level = Number(/Level\s+(\d+)/.exec(part.name)?.[1] || 1);
    return { name: part.name.replace(/Level\s+\d+/, "").trim(), source: "PC2", level, page: citation(all[0].nodes), entries: bodyBlocks(part.nodes) };
  });
  const advancement = {};
  const table = D.findOne(node => node.name === "table", all[classFeatures].nodes);
  if (!table) throw new Error(`Missing advancement table: ${selection.name}`);
  for (const row of D.findAll(node => node.name === "tr", table.children).slice(1)) {
    const cells = row.children.filter(node => ["td", "th"].includes(node.name)); const level = Number(text(cells[0])); const benefits = text(cells[1]).toLowerCase();
    for (const [key, phrase] of Object.entries({ classFeats: `${selection.name.toLowerCase()} feat`, skillFeats: "skill feat", generalFeats: "general feat", ancestryFeats: "ancestry feat", skillIncrease: "skill increase", abilityBoosts: "attribute boosts" })) if (benefits.includes(phrase)) (advancement[key] ||= []).push(level);
  }
  const intro = bodyBlocks(afterSource(all[0].nodes));
  // Key-attribute/HP fields are rendered by the reader's statistics panel.
  const keyIndex = intro.findIndex(value => typeof value === "string" && value.includes("Key Attribute"));
  const entries = keyIndex < 0 ? intro : intro.slice(0, keyIndex);
  return { name: selection.name, source: "PC2", page: citation(all[0].nodes), keyAbility: attribute.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).replace(" Or ", " or "), hp: Number(hp),
    summary: afterSource(all[0].nodes).map(text).join(" ").split("Key Attribute:")[0].trim().split(/(?<=[.!?])\s/)[0], entries, playstyle: all.slice(1, firstProfs).map(part => ({ type: "h3", name: part.name, entries: bodyBlocks(part.nodes) })),
    initialProficiencies, advancement, features, subclasses: options, reference: origin + selection.path };
}
export async function importPC2({ backup } = {}) {
  const groups = await selections();
  const collections = ["actions", "ancestries", "archetypes", "backgrounds", "classes", "companions", "equipment", "feats", "rules", "spells", "traits"];
  const payloads = Object.fromEntries(await Promise.all(collections.map(async name => [name, await load(name)])));
  const indexKinds = { Ancestries: "ancestry", Archetypes: "archetype", Backgrounds: "background", Classes: "class", Equipment: "equipment", Weapons: "equipment", Feats: "feat", Spells: "spell", Traits: "trait", "Familiar Abilities": "companion", "Familiars (Specific)": "companion", Rules: "rule" };
  for (const [kind, collection] of Object.entries({ action: "actions", condition: "conditions", skill: "skills", ancestry: "ancestries", archetype: "archetypes", background: "backgrounds", class: "classes", equipment: "equipment", feat: "feats", spell: "spells", trait: "traits", companion: "companions", rule: "rules" })) {
    const data = payloads[collection] || await load(collection);
    const records = data[collection].filter(record => record.source !== "PC2");
    references[kind] = { names: records.map(record => record.name), byName: new Map(records.map(record => [fold(record.name), record.name])), byPath: new Map(), sourceByName: new Map(records.map(record => [record.name, record.source])), sourceByPath: new Map() };
    // If the historical catalog has two class-specific feats with the same name,
    // retain Nethys's precise link rather than inventing which variant it means.
    if (kind === "feat") {
      const counts = new Map();
      for (const record of records) counts.set(fold(record.name), (counts.get(fold(record.name)) || 0) + 1);
      for (const [name, count] of counts) if (count > 1) references[kind].byName.delete(name);
    }
  }
  for (const [group, kind] of Object.entries(indexKinds)) for (const item of groups[group] || []) {
    const name = item.name.replace(group === "Traits" ? /\s+\([^)]+\)$/ : /\s+\((?:master|familiar)\)$/, "");
    if (!references[kind].byPath.has(item.path) || name.length < references[kind].byPath.get(item.path).length) references[kind].byPath.set(item.path, name);
    references[kind].sourceByPath.set(item.path, "PC2");
    if (!references[kind].byName.has(fold(name))) { references[kind].names.push(name); references[kind].byName.set(fold(name), name); references[kind].sourceByName.set(name, "PC2"); }
  }
  const additions = Object.fromEntries(collections.map(name => [name, []]));
  const actionNames = new Set(), actionPages = [];
  for (const [group, items] of Object.entries(groups)) for (const item of items) {
    if (!["Classes", "Ancestries", "Ancestry Heritages", "Champion Causes", "Methodologies", "Research Fields", "Mysteries", "Bloodlines", "Swashbuckler Styles", "Archetypes", "Feats"].includes(group)) continue;
    const html = await page(item.path), category = /Ancestr/.test(group) ? "ancestry" : "class";
    actionPages.push({ html, category });
    for (const action of embeddedActions(html, category)) {
      references.action.byName.set(fold(action.name), action.name); references.action.sourceByName.set(action.name, "PC2");
      if (!references.action.names.includes(action.name)) references.action.names.push(action.name);
      if (action.reference) { const path = action.reference.slice(origin.length); references.action.byPath.set(path, action.name); references.action.sourceByPath.set(path, "PC2"); }
    }
  }
  for (const item of groups.Feats) additions.feats.push(parsePC2Feat(await page(item.path), item));
  console.log(`Parsed ${additions.feats.length} feats`);
  const feats = createFeatCatalog({ sources: [source], feats: additions.feats });
  const oldFeats = createFeatCatalog({ ...payloads.feats, feats: payloads.feats.feats.filter(entry => entry.source !== "PC2") });
  for (const item of groups.Archetypes) {
    const nodes = contentNodes(await page(item.path));
    const end = nodes.findIndex((node, i) => i > 0 && /^h[12]$/.test(node.name || ""));
    const record = generic(item, nodes.slice(0, end < 0 ? undefined : end));
    record.category = groups.Classes.some(entry => entry.name === item.name) ? "Multiclass" : "Archetype";
    record.feats = feats.records.filter(feat => feat.entry.featType?.archetype?.includes(item.name)).map(feat => feat.id);
    // Include PC1 additional feats granted by PC2 archetypes, at the printed archetype level.
    const additional = nodes.filter(node => node.name === "h2" && /Feat\s+\d+/.test(text(node)));
    for (const heading of additional) {
      const link = D.findOne(node => node.name === "a" && /Feats\.aspx\?ID=/.test(node.attribs?.href || ""), heading.children);
      if (!link) continue;
      const result = oldFeats.registry.resolve(text(link), "PC1");
      if (result.target && !record.feats.includes(result.target.id) && !feats.records.some(feat => feat.name === text(link) && record.feats.includes(feat.id))) {
        record.feats.push(result.target.id);
        (record.featLevels ||= {})[result.target.id] = Number(/Feat\s+(\d+)/.exec(text(heading))[1]);
      }
    }
    if (!record.feats.length) throw new Error(`Missing archetype feats: ${item.name}`);
    additions.archetypes.push(record);
  }
  const oldBackgrounds = backup ? JSON.parse(await readFile(resolve(backup, "data/backgrounds/backgrounds-pc2.json"), "utf8")).background : [];
  for (const item of groups.Backgrounds) {
    const record = generic(item, contentNodes(await page(item.path)));
    const old = oldBackgrounds.find(entry => entry.name === item.name);
    const content = JSON.stringify(record.entries);
    record.boosts = old?.boosts || [...new Set(content.match(/Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma/g) || [])].map(value => value.toLowerCase());
    record.skills = old?.skills || [...new Set([...content.matchAll(/\{@skill ([^|}]+)/g)].map(match => match[1].toLowerCase()))];
    record.categories = record.boosts.filter(value => value !== "free").map(value => value.charAt(0).toUpperCase() + value.slice(1));
    if (!record.categories.length) record.categories = ["Free boosts"];
    record.category = record.categories.join(" / ") || "Free boosts";
    additions.backgrounds.push(record);
  }
  const heritages = [];
  for (const item of groups["Ancestry Heritages"]) {
    const nodes = contentNodes(await page(item.path));
    const record = generic(item, nodes); record.traits = traitsOf(nodes.slice(0, nodes.findIndex(node => node.name === "b")));
    // The PC2 index uses ancestry names in each non-versatile heritage name.
    record.ancestry = groups.Ancestries.find(ancestry => item.name.toLowerCase().includes(ancestry.name.toLowerCase()))?.name || (/\bRat$/.test(item.name) ? "Ratfolk" : undefined);
    if (!record.ancestry) throw new Error(`Missing heritage ancestry: ${item.name}`);
    heritages.push(record);
  }
  for (const item of groups.Ancestries) additions.ancestries.push(parseAncestry(await page(item.path), item, heritages));
  const classOptionGroups = { Alchemist: ["Research Fields"], Barbarian: ["Instincts"], Champion: ["Champion Causes"], Investigator: ["Methodologies"], Monk: [], Oracle: ["Mysteries"], Sorcerer: ["Bloodlines"], Swashbuckler: ["Swashbuckler Styles"] };
  for (const item of groups.Classes) {
    const options = [];
    for (const group of classOptionGroups[item.name]) for (const option of groups[group]) {
      const record = generic(option, contentNodes(await page(option.path)));
      options.push({ name: option.name, shortName: option.name, type: group.replace(/ies$/, "y").replace(/s$/, ""), source: "PC2", page: record.page, features: [{ name: option.name, source: "PC2", page: record.page, level: 1, entries: record.entries }] });
    }
    additions.classes.push(parseClass(await page(item.path), item, options));
  }
  for (const item of groups.Spells) additions.spells.push({ ...parseSpellPage(await page(item.path), item.name, references, sourceOptions), reference: origin + item.path });
  const equipmentPaths = new Map();
  for (const item of [...groups.Equipment, ...groups.Weapons]) { if (!equipmentPaths.has(item.path)) equipmentPaths.set(item.path, []); equipmentPaths.get(item.path).push(item); }
  for (const [path, items] of equipmentPaths) {
    const records = parseEquipmentPage(await page(path), items, references, new Map(), sourceOptions);
    for (const record of records) {
      record.reference = origin + path;
      if (record.category === "Adventuring Gear") record.category = record.traits.includes("snare") ? "Snare" : record.traits.includes("alchemical") ? "Alchemical Item" : record.traits.includes("talisman") ? "Talisman" : record.traits.includes("consumable") ? "Consumable" : /worn/.test(record.usage || "") ? "Worn Item" : "Held Item";
    }
    additions.equipment.push(...records);
  }
  for (const item of groups.Traits) {
    const name = item.name.replace(/\s+\([^)]+\)$/, "");
    const record = generic({ ...item, name }, contentNodes(await page(item.path)));
    record.categories = [item.name.match(/\(([^)]+)\)$/)?.[1] || "Other"]; record.category = record.categories[0];
    additions.traits.push(record);
  }
  const familiarAbilities = [];
  for (const item of groups["Familiar Abilities"]) {
    const record = generic({ ...item, name: item.name.replace(/\s+\((?:master|familiar)\)$/, "") }, contentNodes(await page(item.path)));
    record.kind = "familiar"; record.category = /\(master\)$/.test(item.name) ? "Master" : "Familiar";
    record.entries = record.entries.filter(entry => typeof entry !== "string" || !entry.startsWith("{@b Ability Type}"));
    familiarAbilities.push(record);
  }
  for (const item of groups["Familiars (Specific)"]) {
    const record = generic(item, contentNodes(await page(item.path)));
    record.kind = "specific-familiar"; record.category = "Specific Familiar"; record.traits = traitsOf(contentNodes(await page(item.path)));
    additions.companions.push(record);
  }
  for (const group of ["Rituals", "Rules", "Languages", "Class Kits", "Class Sample Builds"]) {
    const entries = [];
    for (const item of groups[group]) {
      const record = generic(item, contentNodes(await page(item.path)));
      entries.push({ ...record, type: "h2", id: `pc2-${slug(group)}-${item.path.match(/ID=(\d+)/)[1]}` });
    }
    additions.rules.push({ type: "h1", name: group, source: "PC2", page: Math.min(...entries.map(entry => entry.page)), entries });
  }
  for (const { html, category } of actionPages) {
    for (const action of embeddedActions(html, category)) {
      const key = `${action.name}|${action.page}`;
      if (actionNames.has(key)) continue;
      actionNames.add(key); additions.actions.push(action);
    }
  }
  const counts = {};
  for (const name of collections) {
    const payload = payloads[name];
    payload.sources = [...payload.sources.filter(entry => entry.id !== "PC2"), source];
    // Reprinted traits share one definition so trait popovers stay unambiguous.
    const existing = payload[name].filter(entry => entry.source !== "PC2");
    const records = name === "traits" ? additions[name].filter(entry => !existing.some(old => fold(old.name) === fold(entry.name))) : additions[name];
    payload[name] = [...existing, ...records];
    if (name === "companions") payload.familiarAbilities = [...(payload.familiarAbilities || []).filter(entry => entry.source !== "PC2"), ...familiarAbilities];
    payload._meta = { ...payload._meta, pc2: { source: origin + "Sources.aspx?ID=227", content: "English Player Core 2 content from Archives of Nethys, including the errata listed in its source index.", license: origin + "Licenses.aspx", count: records.length, ...(name === "backgrounds" && backup ? { backup: "PC2 boosts and skills cross-checked against the before-reset backup." } : {}) } };
    counts[name] = records.length;
  }
  counts.familiarAbilities = familiarAbilities.length;
  // All parsing must succeed before replacing any live data file.
  formatPC2(payloads, { backgrounds: oldBackgrounds });
  const cleanupInputs = { ...payloads };
  for (const name of ["conditions", "skills", "creatures", "afflictions", "hazards"]) cleanupInputs[name] = await load(name);
  const cleaned = internalizeData(cleanupInputs).payloads;
  for (const name of Object.keys(payloads)) await writeFile(new URL(`../data/${name}.json`, import.meta.url), JSON.stringify(cleaned[name], null, 2) + "\n");
  await writeFile(new URL("../data/pc2-coverage.json", import.meta.url), JSON.stringify({ source: "PC2", index: Object.fromEntries(Object.entries(groups).map(([name, values]) => [name, values.length])), imported: counts }, null, 2) + "\n");
  console.log("PC2 import complete", counts);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await importPC2({ backup: process.argv.includes("--backup") ? process.argv[process.argv.indexOf("--backup") + 1] : undefined });
