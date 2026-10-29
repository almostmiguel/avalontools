import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const revision = execFileSync("git", ["rev-parse", "2ef469c253^"], { encoding: "utf8" }).trim();
const old = JSON.parse(execFileSync("git", ["show", `${revision}:data/traits.json`], { encoding: "utf8", maxBuffer: 10_000_000 })).trait.filter(t => t.source === "PC1");
const normalize = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const names = Object.fromEntries(`aberracao=Aberration;acefalo=Mindless;acido=Acid;agua=Water;alquimico=Alchemical;anao=Dwarf;anfibio=Amphibious;anjo=Angel;aquatico=Aquatic;ar=Air;arcano=Arcane;arconte=Archon;armadilha=Trap;besta=Beast;bomba=Bomb;cambiante=Changeling;composicao=Composition;construto=Construct;consumivel=Consumable;convocacao=Summon;convocado=Summoned;demonio=Demon;diabo=Devil;dinossauro=Dinosaur;divino=Divine;doenca=Disease;dragao=Dragon;eletricidade=Electricity;elfo=Elf;escuridao=Darkness;espirito=Spirit;estriga=Hag;estrutura=Structure;etereo=Ethereal;eversao=Void;fada=Fey;foco=Focus;fogo=Fire;forca=Force;fungo=Fungus;gigante=Giant;gnomo=Gnome;humanoide=Humanoid;infero=Fiend;infortunio=Misfortune;lacaio=Minion;limo=Ooze;madeira=Wood;maldicao=Curse;mecanico=Mechanical;morte=Death;morto-vivo=Undead;nefilim=Nephilim;nao letal=Nonlethal;nuuma=Halfling;ocultista=Occult;oleo=Oil;olfativo=Olfactory;planta=Plant;pocao=Potion;possessao=Possession;profano=Unholy;sagrado=Holy;santificado=Sanctified;sombra=Shadow;sono=Sleep;sortilegio=Hex;sutil=Subtle;truque=Cantrip;varinha=Wand;videncia=Scrying`.split(";").map(pair => pair.split("=")));
const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", times: "×" };
const decode = s => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, key) => key[0] === "#" ? String.fromCodePoint(key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1))) : entities[key] ?? all);
const plain = html => decode(html.replace(/<[^>]*>/g, "")).trim();
const indexResponse = await fetch("https://2e.aonprd.com/Traits.aspx", { signal: AbortSignal.timeout(45000) });
if (!indexResponse.ok) throw new Error(`Trait index: HTTP ${indexResponse.status}`);
const index = await indexResponse.text();
const links = new Map([...index.matchAll(/href="(Traits\.aspx\?ID=\d+[^"]*)"[^>]*>(.*?)<\/a>/gs)].map(m => [normalize(plain(m[2])), `https://2e.aonprd.com/${decode(m[1])}`]));
const inputs = old.map(t => ({ ...t, english: t.alias?.[0] || names[normalize(t.name)] || t.name }));
const missing = inputs.filter(t => !links.has(normalize(t.english)));
if (missing.length) { console.error("Missing English matches:", missing.map(t => [t.name, t.english])); process.exit(1); }

function content(html) {
  // Keep tables as native table blocks; retain paragraph breaks and inline emphasis.
  const tables = [];
  html = html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, table) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plain(cell[1])));
    const headers = rows.shift();
    tables.push({ type: "table", colLabels: headers, rows });
    return `\n\nTABLE_${tables.length - 1}\n\n`;
  });
  html = html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<(b|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, body) => `{@b ${plain(body)}}`)
    .replace(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, body) => `{@i ${plain(body)}}`)
    .replace(/<br\s*\/?>/gi, "\n\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n");
  return plain(html).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean).map(s => /^TABLE_\d+$/.test(s) ? tables[Number(s.slice(6))] : s);
}
const records = [];
const mismatches = [];
let cursor = 0;
async function worker() {
  while (cursor < inputs.length) {
    const t = inputs[cursor++], url = links.get(normalize(t.english));
    const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const html = await response.text();
    const block = html.match(/<h1 class="title">[\s\S]*?<\/h1>([\s\S]*?)<nethys-search/);
    if (!block) throw new Error(`Missing trait description: ${t.english}`);
    const source = block[1].match(/<b>Source<\/b>([\s\S]*?)<br\s*\/?>/i);
    if (!source) throw new Error(`Missing source: ${t.english}`);
    const sourceText = plain(source[1]);
    if (!/Player Core pg\. \d+/.test(sourceText)) { mismatches.push({ name: t.english, source: sourceText, url }); continue; }
    const entries = content(block[1].slice(source.index + source[0].length));
    const categories = t.categories.map(type => type[0].toUpperCase() + type.slice(1));
    records.push({ name: t.english, source: "PC1", page: Number(sourceText.match(/Player Core pg\. (\d+)/)?.[1]) || t.page, categories, category: categories.join(" · "), entries, referenceSource: sourceText });
    if (records.length % 20 === 0) console.log(`Downloaded ${records.length}/${inputs.length}`);
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
records.sort((a, b) => a.name.localeCompare(b.name, "en"));
writeFileSync("data/traits.json", JSON.stringify({ _meta: { importedFrom: "https://github.com/almostmiguel/avalontools", revision, content: "PC1 trait selection and categories from the historical repository; English descriptions and source pages checked against Archives of Nethys. Entries without a PC1 source on Nethys are excluded.", reference: "https://2e.aonprd.com/Traits.aspx", sourceDifferences: mismatches }, sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], traits: records }, null, 2) + "\n");
console.log(JSON.stringify({ count: records.length, sourceDifferences: mismatches }, null, 2));
