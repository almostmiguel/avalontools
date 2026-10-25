import { escapeHtml, inlineText, renderContent } from "./content-renderer.js";

const fold = value => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
export const RULE_KINDS = { core: "Core rule", optional: "Optional rule", setting: "Setting rule" };
const RULE_LIST_KINDS = { ...RULE_KINDS, core: "Core" };

function textOf(value) {
  if (value == null) return "";
  if (typeof value !== "object") return inlineText(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  return [value.name, value.entries ?? value.entry ?? value.items ?? value.rows ?? value.effect,
    value.access, value.cost, value.prerequisites, value.trigger, value.requirements, value.frequency, value.special]
    .filter(value => value != null).map(textOf).join(" ");
}

function collectRules(entries) {
  const collected = [];
  const visit = (value, inherited = {}, parentEntry = null, root = false) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (root) throw new Error("Each rule needs a name and a unique id.");
      if (Array.isArray(value)) value.forEach(child => visit(child, inherited, parentEntry));
      return;
    }
    const ownsSetting = ["original", "modified"].includes(value.setting);
    const kind = value.type === "ability" && !Object.hasOwn(RULE_KINDS, value.kind) ? undefined : value.kind;
    const mainHeader = root ? value.name : inherited.mainHeader;
    const metadata = {
      mainHeader,
      source: typeof value.source === "string" && value.source.trim() ? value.source : inherited.source,
      page: value.page ?? inherited.page,
      topic: value.topic ?? (!root && value.rule === true ? mainHeader : inherited.topic),
      kind: kind || (value.setting === "original" ? "setting" : inherited.kind),
      setting: ownsSetting ? value.setting : inherited.setting,
      settingNote: ownsSetting ? value.settingNote : value.settingNote ?? inherited.settingNote,
    };
    let parent = parentEntry;
    if (root || value.rule === true) {
      collected.push({ entry: value, metadata, parentEntry });
      parent = value;
    }
    Object.values(value).forEach(child => visit(child, metadata, parent));
  };
  entries.forEach(entry => visit(entry, {}, null, true));
  return collected;
}

// Top-level rules and explicitly promoted blocks are indexed, independently of books.
export function createLibrary(payload) {
  if (!payload || !Array.isArray(payload.rules)) throw new Error('data/rules.json needs a "rules" array.');
  if (payload.sources != null && !Array.isArray(payload.sources)) throw new Error('"sources" must be an array of reference metadata.');
  const sourceMap = new Map();
  for (const source of payload.sources ?? []) {
    if (!source || typeof source.id !== "string" || !source.id.trim() || typeof source.name !== "string" || !source.name.trim()) {
      throw new Error("Each source reference needs an id and name.");
    }
    for (const key of new Set([source.id, source.source || source.id].map(fold))) {
      if (sourceMap.has(key)) throw new Error("Source ids must be unique.");
      sourceMap.set(key, source);
    }
  }
  const byId = new Map();
  const byEntry = new WeakMap();
  const identities = new Set();
  const targets = new Map();
  const globalTargets = new Map();
  const rules = collectRules(payload.rules).map(({ entry, metadata, parentEntry }) => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim() || typeof entry.id !== "string" || !entry.id.trim()) {
      throw new Error(parentEntry ? "A promoted rule needs a name and a unique id." : "Each rule needs a name and a unique id.");
    }
    const sourceId = typeof metadata.source === "string" && metadata.source.trim() ? metadata.source.trim() : "Avalon";
    const reference = sourceMap.get(fold(sourceId)) || { id: sourceId, name: sourceId };
    const source = reference.source || reference.id;
    const id = `${reference.id}:${entry.id.trim()}`;
    if (identities.has(fold(id))) throw new Error(`Duplicate rule id: ${id}`);
    identities.add(fold(id));
    const kind = metadata.kind || (metadata.setting === "original" ? "setting" : "core");
    if (!Object.hasOwn(RULE_KINDS, kind)) throw new Error(`Rule “${entry.name}” needs kind core, optional, or setting.`);
    const description = textOf(entry.entries ?? entry.entry ?? entry.items ?? entry.effect ?? "").replace(/\s+/g, " ").trim();
    const topics = [...new Set((Array.isArray(metadata.topic) ? metadata.topic : [metadata.topic])
      .filter(topic => typeof topic === "string").map(topic => inlineText(topic.trim()).trim()).filter(Boolean))];
    if (!topics.length) topics.push("General");
    const name = inlineText(typeof entry.ruleName === "string" && entry.ruleName.trim() ? entry.ruleName : entry.name);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter(alias => typeof alias === "string").map(inlineText) : [];
    if (name !== inlineText(entry.name)) aliases.push(inlineText(entry.name));
    const rule = {
      id, name, entry, source, sourceName: reference.name,
      page: Number.isInteger(metadata.page) && metadata.page > 0 ? metadata.page : null,
      topic: topics[0], topics,
      kind, setting: metadata.setting, settingNote: metadata.settingNote,
      parentId: parentEntry ? byEntry.get(parentEntry).id : null,
      description,
      aliases: [...new Set(aliases)],
      href: `rules.html?${new URLSearchParams({ id })}`,
    };
    byId.set(id, rule);
    byEntry.set(entry, rule);
    const names = new Set([rule.name, entry.id, ...rule.aliases].map(fold));
    for (const sourceKey of new Set([source, reference.id, sourceId].map(fold))) {
      for (const name of names) {
        const key = JSON.stringify([sourceKey, name]);
        if (!targets.has(key)) targets.set(key, []);
        targets.get(key).push(rule);
      }
    }
    for (const name of names) {
      if (!globalTargets.has(name)) globalTargets.set(name, []);
      globalTargets.get(name).push(rule);
    }
    return rule;
  });
  rules.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.topic.localeCompare(b.topic));
  const registry = {
    resolve(name, source) {
      if (!fold(source)) {
        const target = globalTargets.get(fold(name))?.[0];
        return target ? { status: "found", target } : { status: "missing" };
      }
      const matches = targets.get(JSON.stringify([fold(source), fold(name)])) || [];
      if (!matches.length) return { status: "missing" };
      const exactIds = matches.filter(rule => fold(rule.entry.id) === fold(name));
      const defaults = matches.filter(rule => rule.entry.ruleDefault === true);
      const candidates = exactIds.length ? exactIds : defaults.length ? defaults : matches;
      return candidates.length === 1 ? { status: "found", target: candidates[0] } : { status: "ambiguous" };
    },
  };
  const topics = [...new Set(rules.flatMap(rule => rule.topics))].sort((a, b) => a.localeCompare(b, "en"));
  const sources = [...new Set(rules.map(rule => rule.source))].sort();
  return { rules, topics, sources, registry, get: id => byId.get(id), fromEntry: entry => byEntry.get(entry) };
}

export function searchRules(library, { query = "", topic = "", source = "", kind = "" } = {}) {
  const terms = fold(query).split(" ").filter(Boolean);
  const phrase = fold(query);
  return library.rules.filter(rule => (!topic || rule.topics.includes(topic)) && (!source || fold(rule.source) === fold(source)) && (!kind || rule.kind === kind))
    .map(rule => {
      const name = fold(rule.name);
      const aliases = rule.aliases.map(fold);
      const haystack = [name, ...aliases].join(" ");
      if (!terms.every(term => haystack.includes(term))) return null;
      const score = !phrase ? 0 : name === phrase ? 100 : aliases.includes(phrase) ? 90 : name.startsWith(phrase) ? 80 : name.includes(phrase) ? 70 : terms.every(term => name.includes(term)) ? 60 : 0;
      return { rule, score: score + (phrase && rule.entry.ruleDefault === true ? 1 : 0) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.rule.name.localeCompare(b.rule.name, "en", { sensitivity: "base", numeric: true })).map(result => result.rule);
}

export function sortRules(rules, { sort = "", order = "asc" } = {}) {
  const fields = { name: rule => rule.name, type: rule => RULE_LIST_KINDS[rule.kind], source: rule => rule.source };
  if (!Object.hasOwn(fields, sort)) return [...rules];
  const compare = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
  const direction = order === "desc" ? -1 : 1;
  return [...rules].sort((a, b) => direction * compare(fields[sort](a), fields[sort](b))
    || compare(a.name, b.name) || compare(a.source, b.source) || compare(a.id, b.id));
}

export function renderRuleBody(rule, library, { anchorPrefix = "rule-section" } = {}) {
  const entry = rule.entry;
  const section = !entry.type || ["entries", "section"].includes(entry.type) || /^h[1-6]$/.test(entry.type);
  const content = section ? entry.entries ?? entry.entry ?? [] : [{ ...entry, setting: undefined }];
  return renderContent({ entries: [{ entries: content, setting: rule.setting, settingNote: rule.settingNote }] }, {
    source: rule.source, resolveRule: library.registry.resolve, anchorPrefix,
  }).html || "<p>No description has been added yet.</p>";
}

export function renderResults(rules, { hasRules = true, selectedId = null } = {}) {
  if (!hasRules) return '<div class="rules-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2>A place for your rules</h2><p>No rules have been added yet. This reference will grow with the rules chosen for Avalon.</p></div>';
  if (!rules.length) return '<div class="rules-empty"><h2>No matching rules</h2><p>Try a different search or clear your filters.</p><button type="button" data-clear-filters>Clear filters</button></div>';
  return `<ul class="rules-results">${rules.map(rule => `<li><a class="rule-result" href="${escapeHtml(rule.href)}" data-select-rule="${escapeHtml(rule.id)}"${rule.id === selectedId ? ' aria-current="true"' : ""}><strong class="rule-result-name">${escapeHtml(rule.name)}</strong><span class="rule-result-type rule-kind--${rule.kind}">${RULE_LIST_KINDS[rule.kind]}</span><span class="rule-result-source" title="${escapeHtml(rule.sourceName)}${rule.page && rule.setting !== "original" ? `, page ${rule.page}` : ""}">${escapeHtml(rule.source)}</span></a></li>`).join("")}</ul>`;
}
