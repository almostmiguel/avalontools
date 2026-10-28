import { escapeHtml, renderContent, renderInline } from "./content-renderer.js";
import { createRuleLibrary } from "./rule-library.js";
import { renderReferenceCitation, sourceTone } from "./reference-data.js";

const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const normalize = value => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

export const ACTION_CATEGORIES = {
  basic: "Basic", specialty: "Specialty basic", skill: "Skill", ancestry: "Ancestry", class: "Class", general: "General",
};
export const ACTION_TIMES = {
  free: "Free action", reaction: "Reaction", "action-1": "1 action", "action-2": "2 actions", "action-3": "3 actions",
  varies: "Varies", round: "Rounds", minute: "Minutes", hour: "Hours", day: "Days",
};
export const ACTION_FILTERS = [
  { key: "source", label: "Sources" }, { key: "category", label: "Categories" }, { key: "time", label: "Action cost / time" },
];
export const CATALOG_FILTERS = [{ key: "source", label: "Sources" }, { key: "category", label: "Types" }];
export const emptyActionFilters = () => Object.fromEntries(ACTION_FILTERS.map(({ key }) => [key, new Map()]));
export const emptyCatalogFilters = () => Object.fromEntries(CATALOG_FILTERS.map(({ key }) => [key, new Map()]));

export function createReferenceCatalog(payload, { collection, href, validate = () => {}, decorate = () => ({}) }) {
  if (!payload || !Array.isArray(payload[collection])) throw new Error(`data needs a “${collection}” array.`);
  const base = createRuleLibrary({ sources: payload.sources, rules: payload[collection].map(entry => ({
    name: entry?.name, id: entry?.id, source: entry?.source, page: entry?.page, aliases: entry?.aliases, ruleDefault: entry?.primary,
  })) });
  const records = base.rules.map(rule => {
    const entry = payload[collection][rule.order];
    validate(entry, rule);
    const category = entry.category?.trim() || "General";
    return {
      ...rule, entry, category,
      searchText: normalize([rule.name, ...rule.aliases, category].join(" ")),
      href: `${href}?${new URLSearchParams({ id: rule.id })}`,
      ...decorate(entry, rule, category),
    };
  });
  const byId = new Map(records.map(record => [record.id, record]));
  const registry = { resolve(name, source) {
    const result = base.registry.resolve(name, source);
    return result.target ? { ...result, target: byId.get(result.target.id) } : result;
  } };
  return { records, sources: base.sources, get: id => byId.get(id), registry };
}

export function createCatalog(payload, { collection, href }) {
  return createReferenceCatalog(payload, {
    collection, href,
    validate(entry, rule) {
      if (!Array.isArray(entry?.entries)) throw new Error(`Entry “${rule.name}” needs an entries array.`);
      if (entry.category != null && (typeof entry.category !== "string" || !entry.category.trim())) throw new Error(`Entry “${rule.name}” needs a text category.`);
    },
  });
}

export function catalogOptions(catalog) {
  return {
    source: catalog.sources.map(value => ({ value, label: value })),
    category: [...new Set(catalog.records.map(record => record.category))].sort(compare).map(value => ({ value, label: value })),
  };
}

export function catalogMatchesFilters(record, filters, omit = "") {
  return CATALOG_FILTERS.every(({ key }) => {
    if (key === omit) return true;
    const value = key === "source" ? record.source : record.category;
    const states = filters[key];
    if (states.get(value) === -1) return false;
    const includes = [...states.values()].some(state => state === 1);
    return !includes || states.get(value) === 1;
  });
}

export function searchCatalog(catalog, query = "") {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return catalog.records.filter(record => terms.every(term => record.searchText.includes(term)));
}

export function sortCatalog(records, key = "name", order = "asc") {
  const direction = order === "desc" ? -1 : 1;
  return [...records].sort((a, b) => direction * compare(key === "category" ? a.category : a[key], key === "category" ? b.category : b[key])
    || compare(a.name, b.name) || compare(a.id, b.id));
}

export function renderCatalogResults(records, selectedId, { plural }) {
  if (!records.length) return `<div class="rules-empty"><h2>No matching ${plural.toLowerCase()}</h2><p>Try another name or clear your filters.</p><button type="button" data-clear-catalog>Clear search and filters</button></div>`;
  return `<ul class="rules-results">${records.map(record => `<li><a class="catalog-result" href="${escapeHtml(record.href)}" data-select-catalog="${escapeHtml(record.id)}"${record.id === selectedId ? ' aria-current="true"' : ""}><strong class="rule-result-name">${escapeHtml(record.name)}</strong><span class="catalog-result-category">${escapeHtml(record.category)}</span><span class="catalog-result-source source-color" data-source-tone="${sourceTone(record.sourceId)}" title="${escapeHtml(record.sourceName)}${record.page ? `, page ${record.page}` : ""}">${escapeHtml(record.source)}</span></a></li>`).join("")}</ul>`;
}

export function renderCatalogDetail(record, { singular }) {
  return `<header class="rule-page-heading"><p class="catalog-category-label">${escapeHtml(record.category)} ${escapeHtml(singular.toLowerCase())}</p><div class="rule-title-row"><h2 id="catalog-detail-title">${escapeHtml(record.name)}</h2></div><div class="rule-meta-row"><p class="rule-page-source">${renderReferenceCitation(record)}</p></div></header><article class="rich-content rule-page-content">${renderContent({ entries: record.entry.entries }, { source: record.source, anchorPrefix: "catalog-section" }).html || "<p>No description has been added yet.</p>"}</article>`;
}

export function createActionLibrary(payload) {
  const catalog = createReferenceCatalog(payload, {
    collection: "actions", href: "actions.html",
    validate(entry, rule) {
      if (!Array.isArray(entry?.entries)) throw new Error(`Action “${rule.name}” needs an entries array.`);
      for (const key of ["classes", "ancestries", "skills", "traits"]) {
        if (entry[key] != null && (!Array.isArray(entry[key]) || entry[key].some(value => typeof value !== "string"))) throw new Error(`Action “${rule.name}” needs an array of strings for ${key}.`);
      }
      if (!Object.hasOwn(ACTION_CATEGORIES, entry.category)) throw new Error(`Action “${rule.name}” has an unknown category.`);
      const time = entry.time;
      if (!time || !["free", "reaction", "action", "varies", "round", "minute", "hour", "day"].includes(time.unit)) throw new Error(`Action “${rule.name}” needs a valid time unit.`);
      if (time.unit === "action" && ![1, 2, 3].includes(time.value)) throw new Error(`Action “${rule.name}” needs an action cost of 1, 2 or 3.`);
      if (time.value != null && (!Number.isFinite(time.value) || time.value <= 0)) throw new Error(`Action “${rule.name}” needs a positive time value.`);
      const keys = new Set([time.unit === "action" ? `action-${time.value}` : time.unit, ...(Array.isArray(time.options) ? time.options : [])]);
      if ([...keys].some(key => !Object.hasOwn(ACTION_TIMES, key))) throw new Error(`Action “${rule.name}” has an unknown time option.`);
    },
    decorate(entry) {
      const time = entry.time, timeKey = time.unit === "action" ? `action-${time.value}` : time.unit;
      const label = time.label || (time.unit === "action" ? ACTION_TIMES[timeKey] : ["free", "reaction", "varies"].includes(time.unit) ? ACTION_TIMES[timeKey]
        : time.value ? `${time.value} ${time.unit}${time.value === 1 ? "" : "s"}` : ACTION_TIMES[timeKey]);
      return { time, timeKey, costKeys: new Set([timeKey, ...(Array.isArray(time.options) ? time.options : [])]), timeLabel: label,
        owners: [...(entry.skills || []), ...(entry.ancestries || []), ...(entry.classes || [])] };
    },
  });
  return { ...catalog, actions: catalog.records };
}

export function actionMatchesFilters(action, filters, omit = "") {
  return ACTION_FILTERS.every(({ key }) => {
    if (key === omit) return true;
    const values = key === "time" ? action.costKeys : new Set([key === "source" ? action.source : action.category]);
    let includes = false, included = false;
    for (const [value, state] of filters[key]) {
      if (state === -1 && values.has(value)) return false;
      if (state === 1) { includes = true; if (values.has(value)) included = true; }
    }
    return !includes || included;
  });
}

export function searchActions(library, query = "") { return searchCatalog({ records: library.actions }, query); }

export function sortActions(actions, key = "name", order = "asc") {
  const direction = order === "desc" ? -1 : 1, timeOrder = Object.keys(ACTION_TIMES);
  return [...actions].sort((a, b) => direction * (key === "time" ? timeOrder.indexOf(a.timeKey) - timeOrder.indexOf(b.timeKey)
    || (a.time.value || 0) - (b.time.value || 0) : compare(key === "category" ? ACTION_CATEGORIES[a.category] : a[key] || a.name, key === "category" ? ACTION_CATEGORIES[b.category] : b[key] || b.name))
    || compare(a.name, b.name) || compare(a.id, b.id));
}

export function actionTimeHtml(action) {
  const symbol = action.time.unit === "action" ? String(action.time.value) : action.time.unit === "free" ? "f" : action.time.unit === "reaction" ? "r" : null;
  return `<span class="action-time" title="${escapeHtml(action.timeLabel)}">${symbol ? renderInline(`{@as ${symbol}}`) : escapeHtml(action.timeLabel)}</span>`;
}

export function renderActionResults(actions, selectedId) {
  if (!actions.length) return '<div class="rules-empty"><h2>No matching actions</h2><p>Try another name or clear your filters.</p><button type="button" data-clear-actions>Clear search and filters</button></div>';
  return `<ul class="rules-results">${actions.map(action => `<li><a class="action-result" href="${escapeHtml(action.href)}" data-select-action="${escapeHtml(action.id)}"${action.id === selectedId ? ' aria-current="true"' : ""}><strong class="rule-result-name">${escapeHtml(action.name)}</strong><span class="action-result-category" title="${escapeHtml(action.owners.join(", "))}">${ACTION_CATEGORIES[action.category]}${action.owners.length ? `<small>${escapeHtml(action.owners.join(", "))}</small>` : ""}</span>${actionTimeHtml(action)}<span class="rule-result-source source-color" data-source-tone="${sourceTone(action.sourceId)}" title="${escapeHtml(action.sourceName)}${action.page ? `, page ${action.page}` : ""}">${escapeHtml(action.source)}</span></a></li>`).join("")}</ul>`;
}

export function renderActionBody(action, library, rules, { anchorPrefix = "action-section" } = {}) {
  const options = { source: action.source, resolveAction: library.registry.resolve, resolveRule: rules?.registry.resolve, anchorPrefix };
  const entry = action.entry;
  const fields = [["Prerequisites", entry.prerequisites], ["Access", entry.access], ["Frequency", entry.frequency], ["Trigger", entry.trigger], ["Requirements", entry.requirements], ["Cost", entry.cost]]
    .filter(([, value]) => value != null && value !== "" && value !== false);
  const details = fields.length ? `<dl class="ability-fields action-fields">${fields.map(([label, value], index) => `<div class="ability-field"><dt>${label}</dt><dd>${renderContent({ entries: Array.isArray(value) ? value : [value] }, { ...options, anchorPrefix: `${anchorPrefix}-field-${index}` }).html}</dd></div>`).join("")}</dl>` : "";
  const traits = entry.traits?.length ? `<div class="ability-traits" role="list" aria-label="Traits">${entry.traits.map(trait => `<span class="ability-trait" role="listitem">${escapeHtml(trait)}</span>`).join("")}</div>` : "";
  return `${traits}${details}<div class="ability-effect">${renderContent({ entries: entry.entries || [] }, options).html || "<p>No description has been added yet.</p>"}</div>${entry.special ? `<dl class="ability-fields"><div class="ability-field"><dt>Special</dt><dd>${renderContent({ entries: [entry.special] }, { ...options, anchorPrefix: `${anchorPrefix}-special` }).html}</dd></div></dl>` : ""}`;
}

export function renderActionDetail(action, library, rules) {
  const context = [action.owners.join(", "), action.entry.level != null ? `Level ${action.entry.level} feat` : ""].filter(Boolean).join(" · ");
  return `<header class="rule-page-heading"><p class="action-category-label">${ACTION_CATEGORIES[action.category]} action${context ? ` <span>· ${escapeHtml(context)}</span>` : ""}</p><div class="rule-title-row"><h2 id="action-detail-title">${escapeHtml(action.name)}</h2>${actionTimeHtml(action)}</div><div class="rule-meta-row"><p class="rule-page-source">${renderReferenceCitation(action)}</p></div></header><article class="rich-content rule-page-content action-page-content">${renderActionBody(action, library, rules)}</article>`;
}
