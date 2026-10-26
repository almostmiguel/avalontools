import { escapeHtml, renderInline, renderContent } from "./content-renderer.js";
import { createLibrary } from "./rules-library.js";
import { sourceTone, renderRuleCitation } from "./rule-sources.js";

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
const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const normalize = text => String(text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
export const emptyActionFilters = () => Object.fromEntries(ACTION_FILTERS.map(({ key }) => [key, new Map()]));

export function createActionLibrary(payload) {
  if (!payload || !Array.isArray(payload.actions)) throw new Error('data/actions.json needs an "actions" array.');
  const base = createLibrary({ sources: payload.sources, rules: payload.actions.map(entry => ({
    name: entry?.name, id: entry?.id, source: entry?.source, page: entry?.page, aliases: entry?.aliases, ruleDefault: entry?.primary,
  })) });
  const actions = base.rules.map(rule => {
    const entry = payload.actions[rule.order];
    for (const key of ["classes", "ancestries", "skills", "traits"]) {
      if (entry[key] != null && (!Array.isArray(entry[key]) || entry[key].some(value => typeof value !== "string"))) throw new Error(`Action “${rule.name}” needs an array of strings for ${key}.`);
    }
    if (!Object.hasOwn(ACTION_CATEGORIES, entry.category)) throw new Error(`Action “${rule.name}” has an unknown category.`);
    const time = entry.time;
    if (!time || !["free", "reaction", "action", "varies", "round", "minute", "hour", "day"].includes(time.unit)) throw new Error(`Action “${rule.name}” needs a valid time unit.`);
    if (time.unit === "action" && ![1, 2, 3].includes(time.value)) throw new Error(`Action “${rule.name}” needs an action cost of 1, 2 or 3.`);
    if (time.value != null && (!Number.isFinite(time.value) || time.value <= 0)) throw new Error(`Action “${rule.name}” needs a positive time value.`);
    const timeKey = time.unit === "action" ? `action-${time.value}` : time.unit;
    const costKeys = new Set([timeKey, ...(Array.isArray(time.options) ? time.options : [])]);
    if ([...costKeys].some(key => !Object.hasOwn(ACTION_TIMES, key))) throw new Error(`Action “${rule.name}” has an unknown time option.`);
    const label = time.label || (time.unit === "action" ? ACTION_TIMES[timeKey] : ["free", "reaction", "varies"].includes(time.unit) ? ACTION_TIMES[timeKey]
      : time.value ? `${time.value} ${time.unit}${time.value === 1 ? "" : "s"}` : ACTION_TIMES[timeKey]);
    const owners = [...(entry.skills || []), ...(entry.ancestries || []), ...(entry.classes || [])];
    return { ...rule, entry, category: entry.category, time, timeKey, costKeys, timeLabel: label,
      owners, searchText: normalize([rule.name, ...rule.aliases].join(" ")),
      href: `actions.html?${new URLSearchParams({ id: rule.id })}` };
  });
  const byId = new Map(actions.map(action => [action.id, action]));
  const registry = { resolve(name, source) {
    const result = base.registry.resolve(name, source);
    return result.target ? { ...result, target: byId.get(result.target.id) } : result;
  } };
  return { actions, sources: base.sources, get: id => byId.get(id), registry };
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

export function searchActions(library, query = "") {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return library.actions.filter(action => terms.every(term => action.searchText.includes(term)));
}

export function sortActions(actions, key = "name", order = "asc") {
  const direction = order === "desc" ? -1 : 1;
  const timeOrder = Object.keys(ACTION_TIMES);
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
  return `<header class="rule-page-heading"><p class="action-category-label">${ACTION_CATEGORIES[action.category]} action${context ? ` <span>· ${escapeHtml(context)}</span>` : ""}</p><div class="rule-title-row"><h2 id="action-detail-title">${escapeHtml(action.name)}</h2>${actionTimeHtml(action)}</div><div class="rule-meta-row"><p class="rule-page-source">${renderRuleCitation(action)}</p></div></header><article class="rich-content rule-page-content action-page-content">${renderActionBody(action, library, rules)}</article>`;
}
