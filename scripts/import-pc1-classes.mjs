import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const revision = "2ef469c253^";
const traitNames = { arcane: "arcane", auditory: "auditory", divine: "divine", incomum: "uncommon", emotion: "emotion", dwarf: "dwarf", elf: "elf", gnome: "gnome", halfling: "halfling", human: "human", changeling: "changeling", nephilim: "nephilim" };
const readOld = path => JSON.parse(execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8", maxBuffer: 20_000_000 }));

// Convert the historical Tools data to the site's native rich-content blocks.
export function normalizeClassContent(value, actions = []) {
  if (Array.isArray(value)) return value.map(item => normalizeClassContent(item, actions));
  if (!value || typeof value !== "object") return value;
  if (value.type === "data") {
    const action = actions.find(action => action.source === "PC1" && action.name.toLowerCase() === value.name?.toLowerCase());
    if (!action) throw new Error(`Missing embedded ${value.tag}: ${value.name}`);
    const cost = action.time?.unit === "action" ? String(action.time.value) : action.time?.unit === "reaction" ? "r" : action.time?.unit === "free" ? "f" : undefined;
    return {
      type: "ability", name: action.name, actions: cost, traits: action.traits,
      trigger: action.trigger, requirements: action.requirements, frequency: action.frequency,
      entries: normalizeClassContent(action.entries, actions), special: action.special,
    };
  }
  if (value.type === "successDegree") return {
    type: "list", style: "list-no-bullets",
    items: [["criticalSuccess", "Critical Success"], ["success", "Success"], ["failure", "Failure"], ["criticalFailure", "Critical Failure"]]
      .filter(([key]) => value[key] != null).map(([key, name]) => ({ type: "item", name, entries: normalizeClassContent(value[key], actions) })),
  };
  const result = Object.fromEntries(Object.entries(value).filter(([key]) => !["aliases", "referenceurl"].includes(key.toLowerCase())).map(([key, item]) => [key, normalizeClassContent(item, actions)]));
  if (/^pf2-h[1-6]$/.test(result.type)) result.type = result.type.slice(4);
  if (result.type === "pf2-options") { result.type = "list"; result.style = "list-no-bullets"; }
  if (result.type === "pf2-brown-box") result.type = "box";
  if (result.type === "pf2-inset") result.type = "inset";
  if (result.type === "pf2-title") result.type = "h3";
  if (result.type === "table" && Array.isArray(result.labelRowIdx)) {
    const lastHeader = Math.max(...result.labelRowIdx);
    result.colLabels = result.rows[lastHeader];
    result.rows = result.rows.slice(lastHeader + 1);
    result.caption = result.caption || result.name;
    for (const key of ["name", "labelRowIdx", "spans", "minimizeTo", "cellStyles", "colStyles"]) delete result[key];
  }
  if (result.type === "ability") {
    const activity = result.activity;
    if (activity) result.actions = activity.unit === "action" ? String(activity.number) : activity.unit === "reaction" ? "r" : activity.unit === "free" ? "f" : undefined;
  }
  if (result.traits) result.traits = result.traits.map(trait => traitNames[trait] || trait);
  if (result.frequency && typeof result.frequency === "object") {
    const { number, interval = 1, unit } = result.frequency;
    result.frequency = `${number === 1 ? "Once" : `${number} times`} per ${interval === 1 ? unit : `${interval} ${unit}s`}`;
  }
  return result;
}

export function importPC1Classes() {
  const actions = JSON.parse(readFileSync(new URL("../data/actions.json", import.meta.url), "utf8")).actions;
  const index = readOld("data/class/index.json");
  const classes = Object.values(index).map(file => {
    const data = readOld(`data/class/${file}`), record = data.class.find(entry => entry.source === "PC1");
    if (!record) throw new Error(`${file} has no PC1 class.`);
    const features = data.classFeature.filter(feature => feature.source === "PC1" && feature.classSource === "PC1" && feature.className === record.name);
    for (const ref of record.classFeatures) {
      const [name, , source, level] = (typeof ref === "string" ? ref : ref.classFeature).split("|");
      if (source !== "PC1" || !features.some(feature => feature.name === name && feature.level === Number(level))) throw new Error(`Missing PC1 class feature: ${name} (${record.name}, ${level}).`);
    }
    const subclasses = record.subclasses.filter(subclass => subclass.source === "PC1").map(subclass => {
      const seen = new Set();
      const features = data.subclassFeature.filter(feature => feature.source === "PC1" && feature.subclassSource === "PC1" && feature.subclassShortName === subclass.shortName).filter(feature => {
        const key = JSON.stringify(feature);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      if (!features.length) throw new Error(`Missing PC1 subclass features: ${record.name}, ${subclass.name}.`);
      return { name: subclass.name, shortName: subclass.shortName, type: subclass.type, source: "PC1", page: subclass.page, features };
    });
    return normalizeClassContent({
      name: record.name, source: "PC1", page: record.page, keyAbility: record.keyAbility, hp: record.hp,
      image: `img/classes/${record.name.toLowerCase()}.webp`,
      summary: record.summary.text, entries: [{ type: "flavor", entries: record.flavor }], playstyle: record.fluff,
      initialProficiencies: record.initialProficiencies, advancement: record.advancement, features, subclasses,
    }, actions);
  });
  return {
    _meta: { importedFrom: "https://github.com/almostmiguel/avalontools", revision, content: "Player Core only", note: "Native block types; embedded actions expanded from local PC1 actions." },
    sources: [{ id: "PC1", name: "Player Core", source: "PC1" }], classes,
  };
}

export function importPC1Feats() {
  const actions = JSON.parse(readFileSync(new URL("../data/actions.json", import.meta.url), "utf8")).actions;
  return {
    _meta: { importedFrom: "https://github.com/almostmiguel/avalontools", revision, content: "Player Core only", note: "Shared by the Feats browser and class readers; native rich-content blocks." },
    sources: [{ id: "PC1", name: "Player Core", source: "PC1" }],
    feats: readOld("data/feats/feats-pc1.json").feat.filter(feat => feat.source === "PC1").map(feat => normalizeClassContent(feat, actions)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = process.argv.includes("--feats") ? importPC1Feats() : importPC1Classes();
  console.log(process.argv.includes("--summary") ? JSON.stringify({ classes: data.classes?.length, features: data.classes?.reduce((n, c) => n + c.features.length, 0), subclasses: data.classes?.reduce((n, c) => n + c.subclasses.length, 0), feats: data.feats?.length, bytes: JSON.stringify(data).length }) : JSON.stringify(data, null, 2));
}
