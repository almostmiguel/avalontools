// Rule source/type facets and their URL representation.
import { escapeHtml } from "./content-renderer.js";

export const FILTER_GROUPS = [
  { key: "source", label: "Sources", singular: "Source" },
  { key: "kind", label: "Types", singular: "Type" },
];

export const emptyFilters = () => Object.fromEntries(FILTER_GROUPS.map(({ key }) => [key, new Map()]));
export const filterOptions = library => ({
  source: library.sources.map(value => ({ value, label: value })),
  kind: [{ value: "core", label: "Core" }, { value: "optional", label: "Optional" }, { value: "setting", label: "Setting" }],
});

export function readFilters(params, options) {
  const filters = emptyFilters();
  for (const { key } of FILTER_GROUPS) {
    const canonical = value => options[key].find(option => key === "source"
      ? option.value.toLowerCase() === value.toLowerCase() : option.value === value)?.value;
    for (const [parameter, state] of [[key, 1], [`not-${key}`, -1]]) {
      for (const raw of params.getAll(parameter)) {
        const value = canonical(raw);
        if (value != null) filters[key].set(value, state);
      }
    }
  }
  return filters;
}

export function writeFilters(params, filters) {
  params.delete("topic");
  params.delete("not-topic");
  for (const { key } of FILTER_GROUPS) {
    params.delete(key);
    params.delete(`not-${key}`);
    for (const [value, state] of [...filters[key]].sort(([a], [b]) => a.localeCompare(b))) {
      params.append(state === -1 ? `not-${key}` : key, value);
    }
  }
}

export function toggleFilter(filters, group, value, exclude = false) {
  const state = exclude ? -1 : 1;
  if (filters[group].get(value) === state) filters[group].delete(value);
  else filters[group].set(value, state);
}

const valueOf = (rule, group) => group === "kind" ? rule.kind : rule.source;

function matchesGroup(value, states) {
  const state = states.get(value);
  if (state === -1) return false;
  if (state === 1) return true;
  for (const selected of states.values()) if (selected === 1) return false;
  return true;
}

export function matchesFilters(rule, filters, omit = "") {
  if (!filters) return true;
  return FILTER_GROUPS.every(({ key }) => key === omit || matchesGroup(valueOf(rule, key), filters[key]));
}

export function filterCounts(rules, filters, options) {
  return Object.fromEntries(FILTER_GROUPS.map(({ key }) => {
    const counts = new Map(options[key].map(({ value }) => [value, 0]));
    for (const rule of rules) {
      if (!matchesFilters(rule, filters, key)) continue;
      const value = valueOf(rule, key);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [key, counts];
  }));
}

export function renderFilterGroups(options) {
  return FILTER_GROUPS.map(({ key, label }) => `<fieldset class="rule-filter-group"><legend class="sr-only">${label}</legend><div class="filter-group-heading"><span aria-hidden="true">${label}</span><button class="filter-group-clear" type="button" data-clear-filter="${key}" aria-label="Clear ${label.toLowerCase()} filters">Clear</button></div><div class="filter-options">${options[key].map(({ value }, index) => `<button id="rule-filter-${key}-${index}" class="filter-pill" type="button" data-filter-group="${key}" data-filter-value="${escapeHtml(value)}"></button>`).join("")}</div></fieldset>`).join("");
}

export function renderFilterChips(filters, options) {
  return FILTER_GROUPS.flatMap(({ key, singular }) => [...filters[key]].map(([value, state]) => {
    const label = options[key].find(option => option.value === value)?.label || value;
    const excluded = state === -1;
    return `<button class="active-filter${excluded ? " active-filter--exclude" : ""}" type="button" data-remove-filter="${key}" data-filter-value="${escapeHtml(value)}" aria-label="Remove ${excluded ? "excluded" : "included"} ${singular.toLowerCase()} ${escapeHtml(label)}"><span>${singular}: ${excluded ? "−" : "+"} ${escapeHtml(label)}</span><span aria-hidden="true">×</span></button>`;
  })).join("");
}
