import { escapeHtml, inlineText, renderContent } from "./content-renderer.js";
import { matchesFilters } from "./rules-filters.js";
import { sourceTone } from "./rule-sources.js";

const fold = value => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
const slug = value => fold(value).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
export const RULE_KINDS = { core: "Core rule", optional: "Optional rule", setting: "Setting rule" };
const NESTED_RULE_TYPES = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "box"]);
const compareText = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const indexedName = entry => typeof entry.ruleName === "string" && entry.ruleName.trim() ? inlineText(entry.ruleName) : inlineText(entry.name);

function generatedRuleIds(records, sourceMap) {
  const groups = new Map();
  for (const record of records) {
    const sourceId = record.metadata.source?.trim() || "Avalon";
    const source = sourceMap.get(fold(sourceId))?.id || sourceId;
    const base = typeof record.entry.id === "string" ? record.entry.id.trim() : slug(indexedName(record.entry));
    const key = fold(base);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...record, source, base });
  }
  const used = new Set(groups.keys());
  const repeated = [...groups.values()].filter(group => group.length > 1).flat()
    .filter(({ entry, base }) => entry.id === undefined && base)
    .map(record => ({ ...record, prefix: record.base + "-" + (Number.isInteger(record.metadata.page) && record.metadata.page > 0 ? record.metadata.page : "no-page") }));
  const pageCounts = new Map();
  for (const { prefix } of repeated) pageCounts.set(fold(prefix), (pageCounts.get(fold(prefix)) || 0) + 1);
  const ids = new WeakMap();
  for (const { entry, source, prefix } of repeated) {
    const qualified = pageCounts.get(fold(prefix)) > 1 || used.has(fold(prefix)) ? prefix + "-" + slug(source) : prefix;
    let candidate = qualified, suffix = 2;
    while (used.has(fold(candidate))) candidate = qualified + "-" + suffix++;
    used.add(fold(candidate));
    ids.set(entry, candidate);
  }
  return ids;
}

function collectRules(entries, chapters) {
  const collected = [];
  const visit = (value, inherited = {}, parentEntry = null, root = false) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (root) throw new Error("Each rule needs a name.");
      if (Array.isArray(value)) value.forEach(child => visit(child, inherited, parentEntry));
      return;
    }
    const ownsSetting = ["original", "modified"].includes(value.setting);
    const kind = value.type === "ability" && !Object.hasOwn(RULE_KINDS, value.kind) ? undefined : value.kind;
    const source = typeof value.source === "string" && value.source.trim() ? value.source : inherited.source;
    const chapterRoot = root && value.type === "h1";
    const metadata = {
      source,
      chapter: chapterRoot ? inlineText(value.name).trim() : value.chapter ?? (fold(source) === fold(inherited.source) ? inherited.chapter : undefined),
      page: value.page ?? inherited.page,
      kind: kind || (value.setting === "original" ? "setting" : inherited.kind),
      setting: ownsSetting ? value.setting : inherited.setting,
      settingNote: ownsSetting ? value.settingNote : value.settingNote ?? inherited.settingNote,
    };
    let parent = parentEntry;
    const named = typeof value.name === "string" && value.name.trim();
    if (chapterRoot) {
      if (!named) throw new Error("Each chapter needs a name.");
      chapters.push({ entry: value, metadata });
    } else if (value.rule !== false && (root || (NESTED_RULE_TYPES.has(value.type) && (named || value.rule === true)))) {
      collected.push({ entry: value, metadata, parentEntry });
      parent = value;
    }
    Object.values(value).forEach(child => visit(child, metadata, parent));
  };
  entries.forEach(entry => visit(entry, {}, null, true));
  return collected;
}

// Top-level h1 blocks are chapters; other named headings and boxes are rules unless opted out.
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
  const qualifiedTargets = new Map();
  const chapterRecords = [];
  const records = collectRules(payload.rules, chapterRecords);
  const chapters = chapterRecords.map(({ entry, metadata }) => {
    const sourceId = metadata.source?.trim() || "Avalon";
    const reference = sourceMap.get(fold(sourceId)) || { id: sourceId, name: sourceId };
    const localId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : slug(metadata.chapter);
    return {
      id: reference.id + ":" + localId, localId, name: metadata.chapter, aliases: [], isChapter: true,
      chapter: metadata.chapter, href: chapterHref(reference.id, metadata.chapter), kind: metadata.kind || "core",
      entry, title: metadata.chapter, sourceId: reference.id, source: reference.source || reference.id,
      sourceName: reference.name, page: metadata.page, setting: metadata.setting, settingNote: metadata.settingNote,
    };
  });
  const generatedIds = generatedRuleIds(records, sourceMap);
  const authoredRules = records.map(({ entry, metadata, parentEntry }, order) => {
    if (!entry || typeof entry.name !== "string" || !entry.name.trim()) {
      throw new Error(parentEntry ? "A promoted rule needs a name." : "Each rule needs a name.");
    }
    const headingName = inlineText(entry.name);
    const name = indexedName(entry);
    if (entry.id !== undefined && (typeof entry.id !== "string" || !entry.id.trim())) {
      throw new Error(`Rule “${name}” needs a non-empty string id, or omit id to generate it from the name.`);
    }
    const localId = entry.id?.trim() || generatedIds.get(entry) || slug(name);
    if (!localId) throw new Error(`Rule “${name}” needs an explicit id because its name contains no letters or numbers.`);
    const sourceId = typeof metadata.source === "string" && metadata.source.trim() ? metadata.source.trim() : "Avalon";
    const reference = sourceMap.get(fold(sourceId)) || { id: sourceId, name: sourceId };
    const source = reference.source || reference.id;
    const id = `${reference.id}:${localId}`;
    if (identities.has(fold(id))) throw new Error(`Duplicate rule id: ${id}. Give these rules explicit, unique ids.`);
    identities.add(fold(id));
    const kind = metadata.kind || (metadata.setting === "original" ? "setting" : "core");
    if (!Object.hasOwn(RULE_KINDS, kind)) throw new Error(`Rule “${entry.name}” needs kind core, optional, or setting.`);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter(alias => typeof alias === "string").map(inlineText) : [];
    if (name !== headingName) aliases.push(headingName);
    const rule = {
      id, localId, name, entry, source, sourceId: reference.id, sourceName: reference.name, order,
      chapter: typeof metadata.chapter === "string" && metadata.chapter.trim() ? inlineText(metadata.chapter.trim()) : null,
      page: Number.isInteger(metadata.page) && metadata.page > 0 ? metadata.page : null,
      kind, setting: metadata.setting, settingNote: metadata.settingNote,
      parentId: parentEntry ? byEntry.get(parentEntry).id : null,
      aliases: [...new Set(aliases)],
      href: `rules.html?${new URLSearchParams({ id })}`,
    };
    byId.set(id, rule);
    qualifiedTargets.set(fold(id), rule);
    byEntry.set(entry, rule);
    const names = new Set([rule.name, localId, ...rule.aliases].map(fold));
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
  const rules = [...authoredRules].sort((a, b) => compareText(a.name, b.name) || a.order - b.order);
  const registry = {
    resolve(name, source) {
      const key = fold(name);
      const explicit = qualifiedTargets.get(key);
      if (explicit && (!fold(source) || [explicit.source, explicit.sourceId].some(value => fold(value) === fold(source)))) return { status: "found", target: explicit };
      let matches = fold(source) ? targets.get(JSON.stringify([fold(source), key])) || [] : globalTargets.get(key) || [];
      if (!matches.length) matches = chapters.filter(chapter =>
        [chapter.name, chapter.localId, chapter.id].some(value => fold(value) === key) &&
        (!fold(source) || [chapter.source, chapter.sourceId].some(value => fold(value) === fold(source))));
      if (!matches.length) return { status: "missing" };
      const named = matches.filter(rule => [rule.name, ...rule.aliases].some(value => fold(value) === key));
      const candidates = named.length ? named : matches;
      const defaults = candidates.filter(rule => rule.entry.ruleDefault === true);
      const preferred = defaults.length ? defaults : candidates;
      return preferred.length === 1 ? { status: "found", target: preferred[0] } : { status: "ambiguous", matches: preferred };
    },
  };
  const sources = [...new Set([...rules, ...chapters].map(rule => rule.source))].sort();
  return { rules, authoredRules, chapters, sources, sourceOrder: (payload.sources ?? []).map(source => source.id), registry, get: id => byId.get(id), fromEntry: entry => byEntry.get(entry) };
}

export function searchRules(library, { query = "", source = "", kind = "", filters } = {}) {
  const phrase = fold(query);
  const sourceName = fold(source);
  const candidates = library.rules.filter(rule => (!source || fold(rule.source) === sourceName) && (!kind || rule.kind === kind) && matchesFilters(rule, filters));
  if (!phrase) return candidates;
  const terms = phrase.split(" ");
  return candidates
    .map(rule => {
      const name = fold(rule.name);
      const aliases = rule.aliases.map(fold);
      const haystack = [name, ...aliases].join(" ");
      if (!terms.every(term => haystack.includes(term))) return null;
      const score = !phrase ? 0 : name === phrase ? 100 : aliases.includes(phrase) ? 90 : name.startsWith(phrase) ? 80 : name.includes(phrase) ? 70 : terms.every(term => name.includes(term)) ? 60 : 0;
      return { rule, score: score + (phrase && rule.entry.ruleDefault === true ? 1 : 0) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || compareText(a.rule.name, b.rule.name)).map(result => result.rule);
}

export function renderRuleContent(rule, library, { anchorPrefix = "rule-section", headingOffset = 0, headingLink } = {}) {
  const entry = rule.entry;
  const section = !entry.type || ["entries", "section"].includes(entry.type) || /^h[1-6]$/.test(entry.type);
  const content = section ? entry.entries ?? entry.entry ?? [] : [{ ...entry, setting: undefined }];
  const rendered = renderContent({ entries: [{ entries: content, setting: rule.setting, settingNote: rule.settingNote }] }, {
    source: rule.source, resolveRule: library.registry.resolve, anchorPrefix, headingOffset, headingLink,
  });
  return { ...rendered, html: rendered.html || "<p>No description has been added yet.</p>" };
}

export function renderRuleBody(rule, library, options) {
  return renderRuleContent(rule, library, options).html;
}

export function renderRuleOutline(headings) {
  const sections = headings.filter(heading => heading.outline);
  if (!sections.length) return "";
  const firstLevel = Math.min(...sections.map(heading => heading.level));
  return `<details id="rule-outline" class="rule-outline"><summary aria-label="On this page" title="On this page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg></summary><nav class="rule-outline-panel" aria-label="On this page"><div class="outline-panel-heading">On this page <span>${sections.length} ${sections.length === 1 ? "section" : "sections"}</span></div><ol>${sections.map(heading => `<li data-depth="${heading.level - firstLevel}"><a data-outline-link href="#${escapeHtml(heading.id)}">${escapeHtml(inlineText(heading.name))}</a></li>`).join("")}</ol></nav></details>`;
}

export function rulePath(library, rule) {
  const path = [];
  const seen = new Set();
  for (let current = rule; current && !seen.has(current.id); current = library.get(current.parentId)) {
    seen.add(current.id);
    path.unshift(current);
  }
  return path;
}

export function renderRulePath(rule, library) {
  const path = rulePath(library, rule);
  if (path.length < 2) return "";
  return `<nav class="rule-path" aria-label="Rule hierarchy"><ol>${path.map((item, index) => `<li>${index === path.length - 1
    ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
    : `<a class="rule-link" href="${escapeHtml(item.href)}" data-rule-name="${escapeHtml(item.id)}" data-rule-source="${escapeHtml(item.source)}">${escapeHtml(item.name)}</a>`}</li>`).join("")}</ol></nav>`;
}

export const chapterKey = (sourceId, chapter) => JSON.stringify([sourceId, chapter]);
export const chapterHref = (sourceId, chapter) => "rules.html?" + new URLSearchParams({ "chapter-source": sourceId, chapter });

const browseGroups = rule => [JSON.stringify(["source", rule.sourceId]), JSON.stringify(["chapter", rule.sourceId, rule.chapter])];
const sameBrowseGroup = (a, b) => a && b && a.sourceId === b.sourceId && a.chapter === b.chapter;

function browseRulePath(library, rule) {
  const path = [];
  for (let current = rule; sameBrowseGroup(current, rule); current = library.get(current.parentId)) path.unshift(current);
  return path;
}

export function browseBranchIds(library, rule) {
  return rule ? [...browseGroups(rule), ...browseRulePath(library, rule).slice(0, -1).map(parent => parent.id)] : [];
}

export function renderBrowse(library, matches, { selectedId = null, selectedChapter = null, expanded = new Set(), includeEmptyChapters = matches.length === library.rules.length } = {}) {
  if (!matches.length && !(includeEmptyChapters && library.chapters.length)) return renderEmptyRules(library.rules.length > 0);
  const matched = new Set(matches.map(rule => rule.id));
  const visible = new Set();
  const open = new Set(expanded);
  if (selectedChapter) {
    open.add(JSON.stringify(["source", selectedChapter.sourceId]));
    open.add(JSON.stringify(["chapter", selectedChapter.sourceId, selectedChapter.title]));
  }
  const filtered = matches.length !== library.rules.length;
  for (const rule of matches) {
    const path = browseRulePath(library, rule);
    path.forEach(item => visible.add(item.id));
    if (filtered || rule.id === selectedId) browseBranchIds(library, rule).forEach(id => open.add(id));
  }
  const children = new Map();
  const sources = new Map();
  if (includeEmptyChapters) for (const chapter of library.chapters) {
    if (!sources.has(chapter.sourceId)) sources.set(chapter.sourceId, { name: chapter.sourceName, chapters: new Map(), count: 0 });
    sources.get(chapter.sourceId).chapters.set(chapter.title, { roots: [], count: 0 });
  }
  for (const rule of library.authoredRules) {
    if (!visible.has(rule.id)) continue;
    const actualParent = library.get(rule.parentId);
    const parent = sameBrowseGroup(actualParent, rule) ? rule.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(rule);
    if (!sources.has(rule.sourceId)) sources.set(rule.sourceId, { name: rule.sourceName, chapters: new Map(), count: 0 });
    const source = sources.get(rule.sourceId);
    if (!source.chapters.has(rule.chapter)) source.chapters.set(rule.chapter, { roots: [], count: 0 });
    const chapter = source.chapters.get(rule.chapter);
    if (!parent) chapter.roots.push(rule);
    if (matched.has(rule.id)) { source.count++; chapter.count++; }
  }
  const chevron = '<svg class="rule-branch-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
  const branch = rules => `<ul class="rules-branches">${rules.map(rule => {
    const hasChildren = children.has(rule.id);
    const context = matched.has(rule.id) ? "" : " rule-branch-link--context";
    const row = `${hasChildren ? chevron : '<span class="rule-branch-spacer" aria-hidden="true"></span>'}<a class="rule-branch-link${context}" href="${escapeHtml(rule.href)}" data-select-rule="${escapeHtml(rule.id)}"${rule.id === selectedId ? ' aria-current="true"' : ""}>${escapeHtml(rule.name)}</a>`;
    return hasChildren ? `<li><details data-rule-branch="${escapeHtml(rule.id)}"${open.has(rule.id) ? " open" : ""}><summary class="rule-branch-row">${row}</summary>${branch(children.get(rule.id))}</details></li>`
      : `<li><div class="rule-branch-row">${row}</div></li>`;
  }).join("")}</ul>`;
  const group = (id, label, count, content, type, sourceId, chapter = null) => {
    const icon = type === "source"
      ? '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-4a4 4 0 0 0-3 2"/>'
      : '<path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/>';
    const name = type === "chapter" && chapter != null
      ? '<a class="browse-group-name" href="' + escapeHtml(chapterHref(sourceId, chapter)) + '" data-select-chapter="' + escapeHtml(chapterKey(sourceId, chapter)) + '"' + (selectedChapter?.sourceId === sourceId && selectedChapter.title === chapter ? ' aria-current="true"' : "") + ">" + escapeHtml(label) + "</a>"
      : '<span class="browse-group-name">' + (type === "source" ? '<span class="browse-group-type">Source</span>' : "") + escapeHtml(label) + "</span>";
    return `<li><details data-rule-branch="${escapeHtml(id)}" data-browse-group="${type}"${open.has(id) ? " open" : ""}><summary class="rule-branch-row browse-group-row"${type === "source" ? ` data-source-tone="${sourceTone(sourceId)}"` : ""}>${chevron}<svg class="browse-group-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>${name}<span class="browse-group-count" aria-label="${count} matching rules">${count}</span></summary>${content}</details></li>`;
  };
  const sourceOrder = id => { const index = library.sourceOrder.indexOf(id); return index === -1 ? Infinity : index; };
  const sourceEntries = [...sources].sort(([a, first], [b, second]) => sourceOrder(a) - sourceOrder(b) || first.name.localeCompare(second.name, "en"));
  return `<nav class="rules-browse" aria-label="Rules by source and chapter"><ul class="rules-branches">${sourceEntries.map(([sourceId, source]) => {
    const chapters = [...source.chapters].sort(([a], [b]) => a == null ? 1 : b == null ? -1 : compareText(a, b));
    const content = `<ul class="rules-branches">${chapters.map(([chapter, data]) => group(JSON.stringify(["chapter", sourceId, chapter]), chapter || "Other rules", data.count, branch(data.roots), "chapter", sourceId, chapter)).join("")}</ul>`;
    return group(JSON.stringify(["source", sourceId]), source.name, source.count, content, "source", sourceId);
  }).join("")}</ul></nav>`;
}

function renderEmptyRules(hasRules) {
  if (!hasRules) return '<div class="rules-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2>A place for your rules</h2><p>No rules have been added yet. This reference will grow with the rules chosen for Avalon.</p></div>';
  return '<div class="rules-empty"><h2>No matching rules</h2><p>Try a different search or clear your filters.</p><button type="button" data-clear-filters>Clear search and filters</button></div>';
}
