import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseDocument, DomUtils } from "htmlparser2";
import { htmlText as text, foldHtmlReference as fold, htmlContentBlocks, renderHtmlInline } from "./html-content.mjs";

const origin = "https://2e.aonprd.com/";
const cache = new URL("../.cache/creatures/", import.meta.url);
const books = [{ id: "MC1", name: "Monster Core", aon: 221, count: 411 }, { id: "MC2", name: "Monster Core 2", aon: 276, count: 395 }];
const creatureTypes = new Set(["Aberration", "Animal", "Beast", "Celestial", "Construct", "Dragon", "Elemental", "Fey", "Fiend", "Fungus", "Humanoid", "Monitor", "Ooze", "Plant", "Spirit", "Undead"]);

async function cachedPage(path, file, refresh) {
  const target = new URL(file, cache);
  if (!refresh) { try { return await readFile(target, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      const html = await response.text();
      await mkdir(new URL("./", target), { recursive: true }); await writeFile(target, html); return html;
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

const abilitySources = { "Monster Core": "MC1", "Monster Core 2": "MC2", "Rage of Elements": "RoE", "NPC Core": "NC", "Bestiary": "B", "Bestiary 3": "B3" };
const improvedAbilities = ["Improved Grab", "Improved Knockdown", "Improved Push"];

export function parseCreatureAbilityIndex(html, references) {
  const document = parseDocument(html);
  const headings = DomUtils.findAll(node => node.name === "h2" && node.attribs?.class === "title", document.children);
  return headings.flatMap(heading => {
    const link = DomUtils.findOne(node => node.name === "a" && /^MonsterAbilities\.aspx\?ID=/.test(node.attribs.href || ""), heading.children);
    if (!link) return [];
    const siblings = heading.parent.children;
    const start = siblings.indexOf(heading) + 1;
    let stop = start;
    while (stop < siblings.length && !(siblings[stop].name === "h2" && siblings[stop].attribs?.class === "title")) stop++;
    const nodes = siblings.slice(start, stop);
    const source = nodes.findIndex(node => ["b", "strong"].includes(node.name) && text(node) === "Source");
    const end = nodes.findIndex((node, index) => index > source && node.name === "br");
    const citation = /^(.*?) pg\. (\d+)/.exec(nodes.slice(source + 1, end).map(text).join(" ").trim());
    const name = text(link);
    // Nethys publishes common core definitions once. Include the remastered
    // glossary and the older Sneak Attack entry still linked by core creatures.
    if (!citation || !["Monster Core", "Monster Core 2", "Rage of Elements", "NPC Core"].includes(citation[1]) && name !== "Sneak Attack") return [];
    const action = DomUtils.findOne(node => /(?:^|\s)action(?:\s|$)/.test(node.attribs?.class || ""), heading.children);
    const actions = action && ({ "[one-action]": "1", "[two-actions]": "2", "[three-actions]": "3", "[reaction]": "r", "[free-action]": "f" })[text(action)];
    return [{ id: `ability-${fold(name).replaceAll(" ", "-")}`, name, kind: "ability", source: abilitySources[citation[1]], page: Number(citation[2]),
      category: actions === "r" ? "Reaction" : actions === "f" ? "Free action" : actions ? "Action" : "Passive", ...(actions ? { actions } : {}),
      entries: htmlContentBlocks(nodes.slice(end + 1), references), reference: origin + link.attribs.href }];
  });
}

export async function importCreatureAbilities({ refresh = false } = {}) {
  const payloadFile = new URL("../data/creatures.json", import.meta.url);
  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  const html = await cachedPage("MonsterAbilities.aspx", "abilities/index.html", refresh);
  const references = { externalFallback: true };
  for (const [kind, collection] of [["action", "actions"], ["condition", "conditions"], ["skill", "skills"], ["trait", "traits"], ["spell", "spells"], ["equipment", "equipment"]]) {
    const data = JSON.parse(await readFile(new URL(`../data/${collection}.json`, import.meta.url), "utf8"));
    const names = data[collection].map(record => record.name).sort((a, b) => b.length - a.length);
    references[kind] = { names, byName: new Map(names.map(name => [fold(name), name])), byPath: new Map() };
  }
  const definitions = parseCreatureAbilityIndex(html, references);
  if (definitions.length !== 42) throw new Error(`Expected 42 core glossary/shared abilities, found ${definitions.length}; review the Nethys glossary.`);
  const abilityNames = entry => [entry.name, ...(entry.name.startsWith("Improved Grab,") ? improvedAbilities : [])];
  const byName = new Map(definitions.flatMap(entry => abilityNames(entry).map(name => [fold(name), entry.name])));
  const byPath = new Map(definitions.map(entry => [entry.reference.slice(origin.length), entry.name]));
  // Old IDs still occur in the source stat blocks; use their displayed name
  // to resolve the current definition, including the three Improved variants.
  for (const match of JSON.stringify(payload).matchAll(/\{@link ([^|{}]+)\|https:\/\/2e\.aonprd\.com\/(MonsterAbilities\.aspx\?ID=\d+)\}/g)) {
    const name = byPath.get(match[2]) || byName.get(fold(match[1])) || definitions.find(entry => fold(match[1]).startsWith(fold(entry.name) + " "))?.name;
    if (!name) throw new Error(`Missing local creature ability: ${match[1]} (${match[2]})`);
    byPath.set(match[2], name);
  }
  references.creatureability = { names: definitions.flatMap(abilityNames).sort((a, b) => b.length - a.length), byName, byPath,
    sourceByName: new Map(definitions.map(entry => [entry.name, entry.source])),
    sourceByPath: new Map([...byPath].map(([path, name]) => [path, definitions.find(entry => entry.name === name).source])) };
  const abilities = parseCreatureAbilityIndex(html, references);
  const replace = value => {
    if (typeof value === "string") return value.replace(/\{@link ([^|{}]+)\|https:\/\/2e\.aonprd\.com\/(MonsterAbilities\.aspx\?ID=\d+)\}/g, (_tag, label, path) => {
      const name = byPath.get(path), entry = abilities.find(entry => entry.name === name);
      if (!entry) throw new Error(`Missing creature ability: ${path}`);
      return `{@creatureability ${name}|${entry.source}${name !== label ? `|${label}` : ""}}`;
    }).replace(/\{@action ([^|{}]+)\|(?:\|([^{}]*))?\}/g, (tag, target, label) => {
      const canonical = byName.get(fold(target)), entry = abilities.find(entry => entry.name === canonical);
      return entry ? `{@creatureability ${entry.name}|${entry.source}${label || target !== entry.name ? `|${label || target}` : ""}}` : tag;
    });
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child)]));
    return value;
  };
  const updated = replace(payload);
  updated.abilities = abilities.map(({ reference, ...entry }) => entry);
  for (const entry of abilities) if (!updated.sources.some(source => source.id === entry.source)) updated.sources.push({ id: entry.source, name: Object.keys(abilitySources).find(name => abilitySources[name] === entry.source), source: entry.source });
  if (updated._meta) updated._meta.abilities = "42 shared creature ability definitions: the Monster Core glossary plus current shared definitions used by Monster Core and Monster Core 2 creatures. Nethys cites Grab/Knockdown/Push/Reactive Strike to Rage of Elements, troop rules to NPC Core, and Sneak Attack to Bestiary; their original citations are preserved.";
  await writeFile(payloadFile, JSON.stringify(updated, null, 2) + "\n");
  console.log(`creature abilities: ${abilities.length}; external ability references replaced with local tags`);
}

export function parseCreaturePage(html, selection, references) {
  const start = html.search(/<h1\b[^>]*class="title"/);
  if (start < 0) throw new Error(`Missing creature: ${selection.path}`);
  const end = html.indexOf('<div class="clear">', start);
  const document = parseDocument(html.slice(start, end < 0 ? undefined : end));
  const heading = DomUtils.findOne(node => /monster-statblock-name/.test(node.attribs?.class || ""), document.children);
  if (!heading) throw new Error(`Missing stat block: ${selection.name}`);
  const rank = /Creature\s+(-?\d+)/.exec(text(heading));
  if (!rank) throw new Error(`Missing level: ${selection.name}`);
  const nodes = heading.parent.children.slice(heading.parent.children.indexOf(heading) + 1);
  const familyNode = nodes.find(node => /monster-family/.test(node.attribs?.class || ""));
  const family = familyNode && DomUtils.findOne(node => node.name === "a" && /^MonsterFamilies\.aspx/.test(node.attribs.href || ""), familyNode.children);
  const stop = familyNode ? nodes.indexOf(familyNode) : nodes.length;
  const statNodes = nodes.slice(0, stop);
  const source = statNodes.findIndex(node => ["b", "strong"].includes(node.name) && text(node) === "Source");
  const citationEnd = statNodes.findIndex((node, index) => index > source && node.name === "br");
  const citation = statNodes.slice(source + 1, citationEnd).map(text).join(" ");
  const page = new RegExp(`${selection.book.name} pg\\. (\\d+)`).exec(citation);
  if (source < 0 || !page) throw new Error(`Missing ${selection.book.id} citation: ${selection.name}: ${citation}`);
  const traits = statNodes.slice(0, source).filter(node => /^trait/.test(node.attribs?.class || ""));
  const size = traits.filter(node => node.attribs.class === "traitsize").map(text).join(" or ");
  const labels = traits.filter(node => node.attribs.class !== "traitsize").map(text);
  const body = statNodes.slice(citationEnd + 1);
  // These spans are separate stat lines/abilities in the printed block, not inline text.
  for (const node of DomUtils.findAll(node => /hanging-indent/.test(node.attribs?.class || ""), body)) node.name = "div";
  const introNodes = [];
  const title = document.children.find(node => node.name === "h1");
  if (title && title !== heading) {
    for (const node of document.children.slice(document.children.indexOf(title) + 1)) {
      if (node === heading || /hide-on-print/.test(node.attribs?.class || "")) break;
      introNodes.push(node);
    }
  }
  // Some stat blocks abbreviate abilities defined in their family, such as
  // vampire weaknesses and Drink Blood. Keep that material once per family.
  let familyRules;
  if (familyNode && family) {
    const familyHeading = familyNode.children.find(node => node.name === "h1");
    if (familyHeading) {
      const familyNodes = familyNode.children.slice(familyNode.children.indexOf(familyHeading) + 1);
      const citationEnd = familyNodes.findIndex(node => node.name === "br");
      const citation = familyNodes.slice(0, citationEnd).map(text).join(" ");
      const match = /Monster Core( 2)? pg\. (\d+)/.exec(citation);
      if (match) {
        const body = familyNodes.slice(citationEnd + 1);
        for (const node of DomUtils.findAll(node => /hanging-indent/.test(node.attribs?.class || ""), body)) node.name = "div";
        familyRules = { id: `${match[1] ? "MC2" : "MC1"}:${fold(text(family)).replaceAll(" ", "-")}`, name: text(family), source: match[1] ? "MC2" : "MC1", page: Number(match[2]), entries: htmlContentBlocks(body, references) };
      }
    }
  }
  return {
    name: selection.name, source: selection.book.id, page: Number(page[1]), level: Number(rank[1]),
    category: labels.find(label => creatureTypes.has(label)) || "Other", size,
    rarity: labels.find(label => ["Uncommon", "Rare", "Unique"].includes(label)) || "Common",
    traits: labels.map(label => label.toLowerCase()), ...(family ? { family: text(family) } : {}),
    ...(introNodes.length ? { description: htmlContentBlocks(introNodes, references) } : {}),
    ...(familyRules ? { familyRules } : {}),
    entries: htmlContentBlocks(body, references), reference: origin + selection.path,
  };
}

export async function importCoreCreatures({ refresh = false } = {}) {
  const selections = [], traitLinks = new Map();
  for (const book of books) {
    const html = await cachedPage(`Sources.aspx?ID=${book.aon}`, `${book.id.toLowerCase()}.html`, refresh);
    const document = parseDocument(html);
    const links = DomUtils.findAll(node => node.name === "a" && /^Monsters\.aspx\?ID=\d+$/.test(node.attribs.href || ""), document.children);
    if (links.length !== book.count) throw new Error(`${book.name}: expected ${book.count}, found ${links.length}; review the index.`);
    selections.push(...links.map(node => ({ name: text(node), path: node.attribs.href, book })));
    for (const node of DomUtils.findAll(node => node.name === "a" && /^Traits\.aspx\?ID=\d+$/.test(node.attribs.href || ""), document.children)) {
      const label = /^(.*?)\s+\(([^)]+)\)$/.exec(text(node));
      const name = label?.[1] || text(node);
      if (!traitLinks.has(name.toLowerCase())) traitLinks.set(name.toLowerCase(), { name, category: label?.[2] || "Monster", path: node.attribs.href, book });
    }
  }
  // Some traits originated outside these books but are used by core creatures.
  // Collect their canonical labels before converting any inline references.
  let inspectNext = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (inspectNext < selections.length) {
      const selection = selections[inspectNext++];
      const document = parseDocument(await cachedPage(selection.path + "&NoRedirect=1", `pages/${selection.path.replace(".aspx?ID=", "-")}.html`, refresh));
      const heading = DomUtils.findOne(node => /monster-statblock-name/.test(node.attribs?.class || ""), document.children);
      if (!heading) throw new Error(`Missing stat block: ${selection.name}`);
      for (const node of heading.parent.children.slice(heading.parent.children.indexOf(heading) + 1)) {
        if (node.name === "br") break;
        if (!/^trait/.test(node.attribs?.class || "") || node.attribs.class === "traitsize") continue;
        const name = text(node), link = DomUtils.findOne(child => child.name === "a", node.children || []);
        if (link && !traitLinks.has(name.toLowerCase())) traitLinks.set(name.toLowerCase(), { name, category: "Monster", path: link.attribs.href.replace(/^\//, ""), book: selection.book });
      }
    }
  }));
  const references = { externalFallback: true };
  for (const [kind, collection] of [["action", "actions"], ["condition", "conditions"], ["skill", "skills"], ["trait", "traits"], ["spell", "spells"], ["equipment", "equipment"]]) {
    const data = JSON.parse(await readFile(new URL(`../data/${collection}.json`, import.meta.url), "utf8"));
    const names = [...new Set([...data[collection].map(record => record.name), ...(kind === "trait" ? [...traitLinks.values()].map(trait => trait.name) : [])])];
    references[kind] = { names: names.sort((a, b) => b.length - a.length), byName: new Map(names.map(name => [fold(name), name])), byPath: new Map() };
    if (kind === "trait") for (const trait of traitLinks.values()) references.trait.byPath.set(trait.path, trait.name);
  }
  references.creature = { names: selections.map(item => item.name).sort((a, b) => b.length - a.length), byName: new Map(selections.map(item => [fold(item.name), item.name])), byPath: new Map(selections.map(item => [item.path, item.name])), sourceByPath: new Map(selections.map(item => [item.path, item.book.id])) };
  const records = []; let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < selections.length) {
      const selection = selections[next++];
      const html = await cachedPage(selection.path + "&NoRedirect=1", `pages/${selection.path.replace(".aspx?ID=", "-")}.html`, false);
      records.push(parseCreaturePage(html, selection, references));
    }
  }));
  const traitFile = new URL("../data/traits.json", import.meta.url);
  const traitData = JSON.parse(await readFile(traitFile, "utf8"));
  let added = 0;
  for (const trait of traitLinks.values()) {
    if (traitData.traits.some(entry => entry.name.toLowerCase() === trait.name.toLowerCase())) continue;
    const document = parseDocument(await cachedPage(trait.path, `traits/${trait.path.replace(".aspx?ID=", "-")}.html`, refresh));
    const heading = DomUtils.findOne(node => node.name === "h1" && node.attribs?.class === "title", document.children);
    if (!heading) throw new Error(`Missing trait title: ${trait.name}`);
    const nodes = heading.parent.children.slice(heading.parent.children.indexOf(heading) + 1);
    const source = nodes.findIndex(node => node.name === "b" && text(node) === "Source");
    const end = nodes.findIndex((node, index) => index > source && node.name === "br");
    const citationNodes = nodes.slice(source + 1, end);
    const links = DomUtils.findAll(node => node.name === "a" && /^Sources\.aspx/.test(node.attribs?.href || ""), citationNodes);
    const citation = /^(.*?) pg\. (\d+)/.exec(text(links.find(link => text(link).startsWith(trait.book.name + " pg.")) || links[0] || { children: citationNodes }));
    if (!citation) throw new Error(`Missing trait source: ${trait.name}`);
    let traitSource = traitData.sources.find(source => source.name === citation[1]);
    if (!traitSource) {
      const id = ({ "Player Core": "PC1", "Player Core 2": "PC2", "Monster Core": "MC1", "Monster Core 2": "MC2", "GM Core": "GMC" })[citation[1]] || citation[1].split(/[^A-Za-z0-9]+/).map(word => word.charAt(0).toUpperCase()).join("");
      traitSource = { id, name: citation[1], source: id }; traitData.sources.push(traitSource);
    }
    const stop = nodes.findIndex(node => node.name === "nethys-search");
    traitData.traits.push({ name: trait.name, source: traitSource.id, page: Number(citation[2]), category: trait.category, categories: [trait.category], entries: htmlContentBlocks(nodes.slice(end + 1, stop < 0 ? undefined : stop), references) }); added++;
  }
  if (added) {
    for (const book of books) if (!traitData.sources.some(source => source.id === book.id)) traitData.sources.push({ id: book.id, name: book.name, source: book.id });
    traitData.traits.sort((a, b) => a.name.localeCompare(b.name, "en"));
    await writeFile(traitFile, JSON.stringify(traitData, null, 2) + "\n");
  }
  records.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const families = new Map();
  for (const record of records) if (record.familyRules) {
    families.set(record.familyRules.id, record.familyRules);
    record.familyId = record.familyRules.id; delete record.familyRules;
  }
  await writeFile(new URL("../data/creatures.json", import.meta.url), JSON.stringify({
    _meta: { content: "All creatures indexed under Monster Core (411) and Monster Core 2 (395). English stat blocks, individual descriptions and shared family rules from Archives of Nethys; normal statistics without elite/weak adjustments. Family material is stored once; appended catalogs of creatures from other books are excluded.", references: books.map(book => origin + `Sources.aspx?ID=${book.aon}`), license: "Pathfinder Monster Core © 2024 and Monster Core 2 © 2025 Paizo Inc. Game-content licence and attribution notices: https://2e.aonprd.com/Licenses.aspx" },
    sources: books.map(({ id, name }) => ({ id, name, source: id })), creatures: records, families: [...families.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }, null, 2) + "\n");
  console.log(`creatures: ${records.length}; added ${added} core traits`);
  await importCreatureAbilities({ refresh });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--abilities-only")) await importCreatureAbilities({ refresh: process.argv.includes("--refresh") });
  else await importCoreCreatures({ refresh: process.argv.includes("--refresh") });
}
