import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = "https://2e.aonprd.com/";
const cache = new URL("../.tmp-ancestries/", import.meta.url);
const names = { "anão": "Dwarf", elfo: "Elf", gnomo: "Gnome", goblin: "Goblin", nuuma: "Halfling", humano: "Human", leshy: "Leshy", orc: "Orc", aiuvarin: "Aiuvarin", cambiante: "Changeling", dromaar: "Dromaar", nefilim: "Nephilim" };
const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…", times: "×" };
const decode = text => text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, key) => key[0] === "#" ? String.fromCodePoint(key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1))) : entities[key] ?? all);
const plain = html => decode(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function download(page) {
  await mkdir(cache, { recursive: true });
  const path = new URL(page.replace(/[^a-z\d]/gi, "_") + ".html", cache);
  try { return await readFile(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const response = await fetch(base + page, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${page}: HTTP ${response.status}`);
  const html = await response.text();
  await writeFile(path, html);
  return html;
}

function inline(html) {
  return plain(html
    .replace(/<span\b[^>]*class=['"]action['"][^>]*title=['"]([^'"]+)['"][^>]*>[\s\S]*?<\/span>/gi, (_all, label) => `{@as ${/reaction/i.test(label) ? "r" : /free/i.test(label) ? "f" : /two/i.test(label) ? "2" : /three/i.test(label) ? "3" : "1"}}`)
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_all, attributes, body) => {
      const href = decode(attributes.match(/href\s*=\s*["']([^"']+)["']/i)?.[1] || "");
      const text = plain(body);
      if (!text || /PFS\.aspx|Sources\.aspx/i.test(href)) return text;
      const tag = /(?:^|\/)Traits\.aspx/i.test(href) ? "trait" : /(?:^|\/)Actions\.aspx/i.test(href) ? "action" : /(?:^|\/)Skills\.aspx/i.test(href) ? "skill" : /(?:^|\/)Feats\.aspx/i.test(href) ? "feat" : /(?:^|\/)Classes\.aspx/i.test(href) ? "class" : /(?:^|\/)Spells\.aspx/i.test(href) ? "spell" : null;
      const actionName = { Climbing: "Climb", "Treat your Wounds": "Treat Wounds" }[text];
      if (tag === "action" && actionName) return `{@action ${actionName}|PC1|${text}}`;
      return tag ? `{@${tag} ${text}|PC1}` : text;
    })
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag, body) => `{@b ${plain(body)}}`)
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_all, _tag, body) => `{@i ${plain(body)}}`));
}

// Keep paragraphs, headings, lists, links and embedded action costs as native blocks.
export function ancestryHtmlEntries(html) {
  const blocks = [];
  const token = block => { blocks.push(block); return `\nBLOCK_${blocks.length - 1}\n`; };
  html = html.replace(/<b>Source<\/b>[\s\S]*?<br\s*\/?>/gi, "")
    .replace(/<h[1-6]\b[^>]*>Feats Requiring[\s\S]*$/i, "")
    .replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_all, table) => {
      const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => inline(cell[1])));
      return token({ type: "table", colLabels: rows.shift(), rows });
    })
    .replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_all, tag, body) => token({ type: "list", ...(tag === "ol" ? { style: "list-decimal" } : {}), items: [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(item => inline(item[1])) }))
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level, body) => token({ type: `h${Math.max(2, Number(level))}`, name: inline(body), entries: [] }))
    .replace(/<br\s*\/?>|<hr\s*\/?>|<\/(p|div)>/gi, "\n");
  const root = [], stack = [{ level: 0, entries: root }];
  for (const paragraph of html.split(/\n+/)) {
    const marker = /^\s*BLOCK_(\d+)\s*$/.exec(paragraph);
    const entry = marker ? blocks[Number(marker[1])] : inline(paragraph);
    if (!entry) continue;
    if (typeof entry === "object" && /^h[1-6]$/.test(entry.type)) {
      const level = Number(entry.type[1]);
      while (stack.at(-1).level >= level) stack.pop();
      stack.at(-1).entries.push(entry);
      stack.push({ level, entries: entry.entries });
    } else stack.at(-1).entries.push(entry);
  }
  return root;
}

function mainContent(html) {
  const start = html.indexOf('<h1 class="title">');
  const end = html.indexOf('<div class="footer"', start);
  if (start < 0 || end < 0) throw new Error("Missing ancestry content");
  return html.slice(start, end);
}

function headings(html, levels = "12") {
  const matches = [...html.matchAll(new RegExp(`<h([${levels}])\\b[^>]*>([\\s\\S]*?)<\\/h\\1>`, "gi"))];
  return matches.map((match, index) => ({ name: plain(match[2]), level: Number(match[1]), title: match[2], html: html.slice(match.index + match[0].length, matches[index + 1]?.index ?? html.length) }));
}

function pc1Source(html) {
  const source = html.match(/<b>Source<\/b>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const page = source && plain(source[1]).match(/^Player Core pg\. (\d+)/);
  return page ? Number(page[1]) : null;
}

function afterSource(html) {
  return html.replace(/^[\s\S]*?<b>Source<\/b>[\s\S]*?<br\s*\/?>/i, "")
    .replace(/^\s*<u><a href="PFS\.aspx">[\s\S]*?<\/i>(?:<br\s*\/?>)*/i, "");
}

// Heritage entries describe the grant; the Actions catalog owns the ability body.
export function linkHeritageAbilities(entries) {
  const abilities = [];
  const remove = value => {
    if (Array.isArray(value)) return value.map(remove).filter(item => item !== undefined);
    if (!value || typeof value !== "object") return value;
    if (value.type === "ability" || /^h[1-6]$/.test(value.type || "") && /\{@action|\{@as /.test(value.name || "")) {
      const name = value.name?.match(/\{@action ([^}|]+)/)?.[1] || value.name?.replace(/\{@as[^}]*\}/g, "").trim();
      if (name) abilities.push({ name, cost: value.actions || value.name?.match(/\{@as ([^}]+)/)?.[1] });
      return undefined;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remove(item)]));
  };
  const surviving = remove(entries);
  const link = value => {
    if (Array.isArray(value)) return value.map(link);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, link(item)]));
    if (typeof value !== "string") return value;
    return value.split(/(\{@[^{}]*\})/g).map(part => part.startsWith("{@") ? part : abilities.reduce((text, ability) => text.replace(new RegExp(`\\b${ability.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), `{@action ${ability.name}|PC1}`), part)).join("");
  };
  const result = link(surviving);
  for (const ability of abilities) if (!JSON.stringify(result).includes(`{@action ${ability.name}`)) result.push(`You gain the {@action ${ability.name}|PC1} ${ability.cost === "r" ? "reaction" : "activity"}.`);
  return result;
}

const ancestryLinks = html => new Map([...html.matchAll(/href="(Ancestries\.aspx\?ID=\d+)"[^>]*>(.*?)<\/a>/g)].map(match => [plain(match[2]), match[1]]));
const englishHeritages = [
  ["Forge Dwarf", "Ancient-Blooded Dwarf", "Strong-Blooded Dwarf", "Death Warden Dwarf", "Rock Dwarf"],
  ["Ancient Elf", "Arctic Elf", "Cavern Elf", "Woodland Elf", "Whisper Elf", "Seer Elf"],
  ["Chameleon Gnome", "Fey-Touched Gnome", "Wellspring Gnome", "Sensate Gnome", "Umbral Gnome"],
  ["Charhide Goblin", "Snow Goblin", "Irongut Goblin", "Unbreakable Goblin", "Razortooth Goblin"],
  ["Jinxed Halfling", "Hillock Halfling", "Wildwood Halfling", "Twilight Halfling", "Gutsy Halfling", "Nomadic Halfling"],
  ["Skilled Human", "Versatile Human"],
  ["Seaweed Leshy", "Gourd Leshy", "Cactus Leshy", "Vine Leshy", "Leaf Leshy", "Fruit Leshy", "Fungus Leshy", "Lotus Leshy", "Root Leshy"],
  ["Battle-Ready Orc", "Deep Orc", "Rainfall Orc", "Badlands Orc", "Winter Orc", "Hold-Scarred Orc", "Grave Orc"],
];

export async function importPC1Ancestries() {
  const revision = execFileSync("git", ["rev-parse", "2ef469c253^"], { encoding: "utf8" }).trim();
  const readOld = path => JSON.parse(execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8", maxBuffer: 20_000_000 }));
  const index = readOld("data/ancestries/index.json");
  const originals = Object.values(index).flatMap(file => readOld(`data/ancestries/${file}`).ancestry || []);
  const versatile = readOld("data/ancestries/versatile-heritages.json").versatileHeritage;
  const imageFiles = await readdir(new URL("../img/ancestries/", import.meta.url)).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const links = new Map([...ancestryLinks(await download("Ancestries.aspx")), ...ancestryLinks(await download("Ancestries.aspx?Versatile=true"))]);
  const records = [];
  for (const [index, original] of [...originals, ...versatile].filter(entry => entry.source === "PC1").entries()) {
    const name = names[original.name.toLowerCase()];
    if (!name || !links.has(name)) throw new Error(`No English ancestry match for ${original.name}`);
    const pagePath = links.get(name);
    const html = mainContent(await download(pagePath));
    const sections = headings(html);
    const page = pc1Source(sections[0].html);
    if (!page) throw new Error(`${name}: source is not Player Core`);
    const mechanicsIndex = sections.findIndex(section => section.name === `${name} Mechanics`);
    const mechanics = mechanicsIndex < 0 ? [] : sections.slice(mechanicsIndex + 1);
    const description = afterSource(sections[0].html);
    const flavorMatch = /^\s*<i>([\s\S]*?)<\/i>(?:<br\s*\/?>)+/i.exec(description);
    const flavor = flavorMatch ? plain(flavorMatch[1]) : null;
    const infoSections = sections.slice(1, mechanicsIndex < 0 ? sections.length : mechanicsIndex);
    const entries = [...(flavor ? [{ type: "flavor", entries: [flavor] }] : []), ...ancestryHtmlEntries(flavorMatch ? description.slice(flavorMatch[0].length) : description), ...infoSections.map(section => ({ type: "h2", name: section.name, entries: ancestryHtmlEntries(section.html) }))];
    const values = title => ancestryHtmlEntries(mechanics.find(section => section.name === title)?.html || "").filter(value => typeof value === "string");
    const mechanicsFields = new Set(["Hit Points", "Size", "Speed", "Attribute Boosts", "Attribute Flaw", "Attribute Flaws", "Languages"]);
    const features = mechanics.filter(section => !mechanicsFields.has(section.name)).map(section => ({ name: section.name, entries: ancestryHtmlEntries(section.html) }));
    const traits = [...sections[0].html.matchAll(/<span class="trait\w*">([\s\S]*?)<\/span>/g)].map(match => plain(match[1]).toLowerCase());
    let heritages = [];
    let heritageInfo = [];
    if (!original.versatile) {
      const id = pagePath.match(/ID=(\d+)/)[1];
      const heritagePage = mainContent(await download(`Heritages.aspx?Ancestry=${id}`));
      const heritageSections = headings(heritagePage);
      heritageInfo = ancestryHtmlEntries(afterSource(heritageSections[0].html));
      const pc1 = heritageSections.filter(section => section.level === 2 && pc1Source(section.html) && !section.html.includes("<b>Ancestry Page</b>"));
      const byName = new Map(pc1.map(section => [section.name.toLowerCase(), section]));
      heritages = original.heritage.filter(heritage => heritage.source === "PC1").map((heritage, heritageIndex) => {
        const english = englishHeritages[index]?.[heritageIndex];
        const section = byName.get(english?.toLowerCase());
        if (!section) throw new Error(`${name}: no PC1 match for ${heritage.name} (${english}). Available: ${[...byName.keys()].join(", ")}`);
        const traits = [...section.html.slice(0, section.html.indexOf("<b>Source</b>")).matchAll(/<span class="trait\w*">([\s\S]*?)<\/span>/g)].map(match => plain(match[1]).toLowerCase());
        return { name: section.name, source: "PC1", page: pc1Source(section.html), traits, entries: linkHeritageAbilities(ancestryHtmlEntries(afterSource(section.html))) };
      });
    } else {
      const heritageSource = headings(mainContent(await download("Heritages.aspx?Ancestry=59"))).find(section => section.name === name && section.html.includes("<b>Ancestry Page</b>") && pc1Source(section.html));
      if (!heritageSource) throw new Error(`${name}: missing versatile heritage rules`);
      features.push({ name: `${name} Heritage`, entries: ancestryHtmlEntries(afterSource(heritageSource.html).replace(/^\s*<b>Ancestry Page<\/b>[\s\S]*?<br\s*\/?>/i, "")) });
    }
    const rarity = traits.find(trait => ["uncommon", "rare", "unique"].includes(trait)) || "common";
    const images = imageFiles.filter(file => new RegExp(`^${slug(name)}(?:-[^.]+)?\\.(?:webp|png|jpe?g|avif|svg)$`, "i").test(file)).sort().map(file => `img/ancestries/${file}`);
    records.push({ name, source: "PC1", page: name === "Leshy" ? 67 : page, category: original.versatile ? "Versatile heritage" : "Ancestry", versatile: Boolean(original.versatile), rarity, traits: traits.filter(trait => trait !== rarity),
      ...(images.length ? { images } : {}),
      ...(original.versatile ? {} : { hp: Number(values("Hit Points")[0]), size: values("Size"), speed: values("Speed").join(" "), boosts: values("Attribute Boosts"), flaws: [...values("Attribute Flaw"), ...values("Attribute Flaws")], languages: values("Languages") }),
      entries, features, heritageInfo, heritages });
    console.log(`${name}: ${heritages.length} heritages, ${features.length} features`);
  }
  return { _meta: { importedFrom: "https://github.com/almostmiguel/avalontools", revision, content: "PC1 selection from the historical repository. Portuguese names and text matched to their English PC1 entries on Archives of Nethys; measurements follow the English text. Pathfinder Society campaign notes are omitted.", reference: base + "Ancestries.aspx", sourceNotes: ["The Nethys Leshy ancestry page lists page 57; this import uses page 67, matching its PC1 heritage entries and the shared PC1 Leshy feats."] }, sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], ancestries: records };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = await importPC1Ancestries();
  await writeFile(new URL("../data/ancestries.json", import.meta.url), JSON.stringify(data, null, 2) + "\n");
  console.log(`Imported ${data.ancestries.length} entries and ${data.ancestries.reduce((count, entry) => count + entry.heritages.length, 0)} heritages`);
}
