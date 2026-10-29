import { escapeHtml } from "./content-renderer.js";
import { loadJson } from "./reference-data.js";
import { createRuleLibrary } from "./rule-library.js";
import { attachReferencePreviews } from "./reference-previews.js";
import {
  ACTION_CATEGORIES, ACTION_TIMES, ACTION_FILTERS, CATALOG_FILTERS,
  createActionLibrary, createCatalog, catalogOptions, catalogValues, actionMatchesFilters, catalogMatchesFilters, actionValues, actionTraitOptions, groupTraitFilterOptions,
  searchCatalog, sortActions, sortCatalog, renderActionResults, renderActionDetail, renderCatalogResults, renderCatalogDetail,
} from "./reference-library.js";

export const REFERENCE_TYPES = {
  ancestries: {
    collection: "ancestries", singular: "Ancestry", plural: "Ancestries", kind: "ancestry", href: "ancestries.html",
    dependencies: { feats: "data/feats.json" },
    loadRules: true, loadDefinition: () => import("./ancestry-reader.js").then(module => module.ANCESTRY_BROWSER_DEFINITION),
  },
  backgrounds: {
    collection: "backgrounds", singular: "Background", plural: "Backgrounds", kind: "background", href: "backgrounds.html",
    loadRules: true, loadDefinition: () => import("./character-library.js").then(module => module.BACKGROUND_BROWSER_DEFINITION),
  },
  archetypes: {
    collection: "archetypes", singular: "Archetype", plural: "Archetypes", kind: "archetype", href: "archetypes.html",
    dependencies: { feats: "data/feats.json" },
    loadRules: true, loadDefinition: () => import("./character-library.js").then(module => module.ARCHETYPE_BROWSER_DEFINITION),
  },
  classes: {
    collection: "classes", singular: "Class", plural: "Classes", kind: "class", href: "classes.html",
    dependencies: { feats: "data/feats.json" },
    loadRules: true, loadDefinition: () => import("./class-reader.js").then(module => module.CLASS_BROWSER_DEFINITION),
  },
  feats: {
    collection: "feats", singular: "Feat", plural: "Feats", kind: "feat", href: "feats.html",
    dependencies: { archetypes: "data/archetypes.json" },
    loadTraits: true,
    loadRules: true, loadDefinition: () => import("./feat-library.js").then(module => module.FEAT_BROWSER_DEFINITION),
  },
  actions: {
    collection: "actions", singular: "Action", plural: "Actions", kind: "action", href: "actions.html",
    loadTraits: true, sortKeys: ["name", "category", "time", "source"],
    prefix: "actions", detailPrefix: "action", attribute: "action", clearAttribute: "clear-actions", filters: ACTION_FILTERS,
    create: createActionLibrary, matches: actionMatchesFilters, sort: sortActions,
    options: library => ({
      source: library.sources.map(value => ({ value, label: value })),
      category: Object.entries(ACTION_CATEGORIES).map(([value, label]) => ({ value, label })),
      time: Object.entries(ACTION_TIMES).map(([value, label]) => ({ value, label })),
      trait: actionTraitOptions(library),
    }),
    values: actionValues,
    renderResults: renderActionResults, renderDetail: renderActionDetail,
    selectionStatus: record => `${record.name} selected. ${record.timeLabel}.`,
    loadRules: true,
  },
  ...Object.fromEntries(["conditions", "skills", "traits"].map(collection => [collection, {
    collection, singular: { conditions: "Condition", skills: "Skill", traits: "Trait" }[collection],
    plural: collection[0].toUpperCase() + collection.slice(1), kind: collection.slice(0, -1), href: `${collection}.html`,
    prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters: collection === "skills" ? [] : collection === "traits" ? CATALOG_FILTERS.filter(({ key }) => key === "category") : CATALOG_FILTERS,
    sortKeys: collection === "skills" ? ["name", "source"] : ["name", "category", "source"],
    showCategory: collection !== "skills",
    create: createCatalog, options: catalogOptions, matches: catalogMatchesFilters, sort: sortCatalog,
    values: catalogValues,
    renderResults: (records, selectedId, _library, config) => renderCatalogResults(records, selectedId, config),
    renderDetail: (record, _library, _rules, config) => renderCatalogDetail(record, config),
  }])),
};

const plainClick = event => !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.button == null || event.button === 0);

// Definitions supply data, filters and renderers; the controller owns interaction and URL state.
export function mountReferenceBrowser(library, { document, window, config, rules = null, traits = null, attachPreviews = attachReferencePreviews }) {
  const { prefix, detailPrefix, attribute, filters: filterGroups } = config;
  const singular = config.singular.toLowerCase();
  const $ = selector => document.querySelector(selector);
  const control = name => $(`#${prefix}-${name}`);
  const search = control("search"), results = control("results"), detail = $(`#${detailPrefix}-detail`);
  const menu = control("filter-menu"), groups = control("filter-groups");
  const lists = config.lists || [], listControl = lists.length ? control("lists") : null;
  const options = config.options(library);
  if (options.trait) options.trait = groupTraitFilterOptions(options.trait, traits);
  const optionMaps = Object.fromEntries(filterGroups.map(({ key }) => [key, new Map(options[key].map(option => [option.value, option]))]));
  const canonicalOptions = Object.fromEntries(filterGroups.map(({ key }) => [key, new Map(options[key].map(option => [option.value.toLowerCase(), option.value]))]));
  const emptyFilters = () => Object.fromEntries(filterGroups.map(({ key }) => [key, new Map()]));
  const previews = attachPreviews({ document, window, registry: rules?.registry, traits, feats: library.featLibrary, [config.collection]: library });
  const data = (element, key) => element.dataset[`${attribute}${key}`];
  const closest = (event, suffix) => event.target.closest?.(`[data-${suffix}]`);
  let filters = emptyFilters(), selectedId = null, renderedId, sort = "name", order = "asc", excludeMode = false;
  let listId = lists[0]?.id || "";
  const currentList = () => lists.find(list => list.id === listId);
  const filterAvailable = key => !currentList()?.filterKeys || currentList().filterKeys.includes(key);
  const followSelectedList = record => {
    const list = record && lists.find(list => list.matches(record));
    if (list) listId = list.id;
    for (const { key } of filterGroups) if (!filterAvailable(key)) filters[key].clear();
  };
  let selectionError = "", matches = [], searchFrame = null, previousQuery, searched = [], destroyed = false, detailController = null;
  const listeners = [];
  const on = (target, type, handler) => { if (!target) return; target.addEventListener(type, handler); listeners.push(() => target.removeEventListener?.(type, handler)); };
  const searchRecords = () => {
    if (previousQuery !== search.value) { previousQuery = search.value; searched = searchCatalog(library, search.value); }
    return searched;
  };
  const renderFilterOptions = (key, values) => `<div class="filter-options">${values.map(({ value }) => `<button class="filter-pill" type="button" data-${attribute}-filter="${key}" data-filter-value="${escapeHtml(value)}"></button>`).join("")}</div>`;
  if (groups) groups.innerHTML = filterGroups.map(({ key, label }) => {
    const types = [...new Set(options[key].flatMap(option => option.groups || []))].sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
    const content = types.length ? types.map(type => `<fieldset class="filter-type-group"><legend>${escapeHtml(type)}</legend>${renderFilterOptions(key, options[key].filter(option => option.groups.includes(type)))}</fieldset>`).join("") : renderFilterOptions(key, options[key]);
    return `<fieldset class="rule-filter-group" data-${attribute}-filter-group="${key}"><legend class="sr-only">${escapeHtml(label)}</legend><div class="filter-group-heading"><span aria-hidden="true">${escapeHtml(label)}</span><button class="filter-group-clear" type="button" data-clear-${attribute}-group="${key}">Clear</button></div>${content}</fieldset>`;
  }).join("");
  if (listControl) listControl.innerHTML = lists.map(list => `<button type="button" data-${attribute}-list="${escapeHtml(list.id)}" aria-pressed="false">${escapeHtml(list.label)}</button>`).join("");

  const saveState = (mode = "replace") => {
    const url = new URL(window.location.href);
    url.searchParams.delete(config.kind);
    if (lists.length) {
      if (listId === lists[0].id) url.searchParams.delete("list"); else url.searchParams.set("list", listId);
    }
    for (const key of config.obsoleteParams || []) url.searchParams.delete(key);
    if (!selectedId) for (const key of config.detailStateParams || []) url.searchParams.delete(key);
    if (!filterGroups.length) for (const { key } of CATALOG_FILTERS) {
      url.searchParams.delete(key); url.searchParams.delete(`not-${key}`);
    }
    for (const [key, value] of [["q", search.value.trim()], ["id", selectedId], ["sort", sort === "name" ? "" : sort], ["order", order === "desc" ? "desc" : ""]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    for (const { key } of filterGroups) {
      url.searchParams.delete(key); url.searchParams.delete(`not-${key}`);
      for (const [value, state] of filters[key]) url.searchParams.append(state === -1 ? `not-${key}` : key, value);
    }
    url.hash = "";
    if (url.href !== window.location.href) window.history[mode === "push" ? "pushState" : "replaceState"](null, "", `${url.pathname}${url.search}`);
  };
  const readState = () => {
    const params = new URLSearchParams(window.location.search);
    listId = lists.find(list => list.id === params.get("list"))?.id || lists[0]?.id || "";
    search.value = params.get("q") || "";
    sort = (config.sortKeys || ["name", ...filterGroups.map(({ key }) => key)]).includes(params.get("sort")) ? params.get("sort") : "name";
    order = params.get("order") === "desc" ? "desc" : "asc";
    filters = emptyFilters();
    for (const { key } of filterGroups) for (const [parameter, state] of [[key, 1], [`not-${key}`, -1]]) for (const raw of params.getAll(parameter)) {
      const value = canonicalOptions[key].get(raw.toLowerCase());
      if (value != null) filters[key].set(value, state);
    }
    selectedId = params.get("id"); selectionError = "";
    if (!selectedId && params.has(config.kind)) {
      const found = library.registry.resolve(params.get(config.kind), params.get("source"));
      if (found.status === "found") selectedId = found.target.id;
      else selectionError = found.status === "ambiguous" ? `More than one ${singular} has this name. Choose an entry from the list.` : `This ${singular} has not been added yet. Search for another ${singular}.`;
    }
    if (selectedId && !library.get(selectedId)) selectionError = `This ${singular} could not be found. Search the list for its current name.`;
    const selected = library.get(selectedId);
    followSelectedList(selected);
    if (selected && (!config.matches(selected, filters) || !searchRecords().includes(selected))) { search.value = ""; filters = emptyFilters(); }
  };
  const render = ({ save = true } = {}) => {
    const list = currentList();
    const singular = (list?.singular || config.singular).toLowerCase(), plural = (list?.label || config.plural).toLowerCase();
    const article = /^[aeiou]/i.test(singular) ? "an" : "a";
    const listRecords = list ? library.records.filter(list.matches) : library.records;
    const candidates = list ? searchRecords().filter(list.matches) : searchRecords();
    matches = config.sort(candidates.filter(record => config.matches(record, filters)), sort, order);
    if (selectedId && !selectionError && !matches.some(record => record.id === selectedId)) selectedId = matches[0]?.id || null;
    results.innerHTML = config.renderResults(matches, selectedId, library, list ? { ...config, singular: list.singular, plural: list.label } : config);
    control("count").textContent = `${matches.length} ${matches.length === 1 ? singular : plural}`;
    control("summary").textContent = `${listRecords.length} ${plural} · ${library.sources.length} ${library.sources.length === 1 ? "source" : "sources"}`;
    for (const button of listControl?.querySelectorAll(`[data-${attribute}-list]`) || []) button.setAttribute("aria-pressed", String(data(button, "List") === listId));
    for (const { key } of filterGroups) {
      const group = groups?.querySelector?.(`[data-${attribute}-filter-group="${key}"]`);
      if (group) group.hidden = !filterAvailable(key);
    }
    const active = filterGroups.reduce((sum, { key }) => sum + filters[key].size, 0);
    const chips = control("active-filters");
    if (chips) chips.hidden = !active;
    if (chips) chips.innerHTML = filterGroups.flatMap(({ key, label }) => [...filters[key]].map(([value, state]) => {
      const text = optionMaps[key].get(value).label;
      return `<button class="active-filter${state === -1 ? " active-filter--exclude" : ""}" type="button" data-remove-${attribute}-filter="${key}" data-filter-value="${escapeHtml(value)}" aria-label="Remove ${escapeHtml(label)} ${escapeHtml(text)}"><span>${state === -1 ? "−" : "+"} ${escapeHtml(text)}</span><span aria-hidden="true">×</span></button>`;
    })).join("");
    if (control("filter-count")) control("filter-count").textContent = active ? String(active) : "";
    control("results-title").textContent = search.value.trim() ? "Search results" : active ? `Filtered ${plural}` : `All ${plural}`;
    // Count each candidate once per group, rather than scanning for every filter button.
    const counts = Object.fromEntries(filterGroups.map(({ key }) => {
      const values = new Map();
      for (const record of candidates) if (config.matches(record, filters, key)) for (const value of config.values(record, key)) values.set(value, (values.get(value) || 0) + 1);
      return [key, values];
    }));
    for (const button of groups?.querySelectorAll(`[data-${attribute}-filter]`) || []) {
      const key = data(button, "Filter"), value = button.dataset.filterValue, state = filters[key].get(value) || 0;
      const label = optionMaps[key].get(value).label, count = counts[key].get(value) || 0;
      button.setAttribute("data-state", state === -1 ? "exclude" : state === 1 ? "include" : "neutral");
      button.setAttribute("aria-pressed", String(state !== 0));
      button.setAttribute("aria-label", `${label}: ${state === -1 ? "excluded" : state === 1 ? "included" : "any"}. ${count} matching ${plural}.`);
      button.innerHTML = `${state ? `<span class="filter-pill-symbol" aria-hidden="true">${state === 1 ? "+" : "−"}</span>` : ""}<span class="filter-pill-label">${escapeHtml(label)}</span><span class="filter-pill-count">${count}</span>`;
    }
    control("include")?.setAttribute("aria-pressed", String(!excludeMode));
    control("exclude")?.setAttribute("aria-pressed", String(excludeMode));
    for (const button of control("sort").querySelectorAll(`[data-${attribute}-sort]`)) {
      const current = data(button, "Sort") === sort;
      button.setAttribute("aria-pressed", String(current));
      if (current) button.setAttribute("data-direction", order); else button.removeAttribute("data-direction");
      button.setAttribute("aria-label", `Sort by ${data(button, "Sort")}${current ? `, ${order === "asc" ? "ascending" : "descending"}` : ""}`);
    }
    const record = library.get(selectedId), key = `${listId}|${selectionError || record?.id || (matches.length ? "choose" : "empty")}`;
    if (key !== renderedId) {
      detailController?.destroy?.(); detailController = null;
      renderedId = key; previews?.hide(); detail.scrollTop = 0;
      detail.innerHTML = record && !selectionError ? config.renderDetail(record, library, rules, config)
        : `<div class="rules-detail-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2 id="${detailPrefix}-detail-title">${selectionError ? `${config.singular} not found` : matches.length ? `Choose ${article} ${singular}` : `No matching ${plural}`}</h2><p>${escapeHtml(selectionError || (matches.length ? `Select ${article} ${singular} from the list to read it here.` : `Adjust the search or filters to see ${plural}.`))}</p></div>`;
      if (record && !selectionError) detailController = config.mountDetail?.(record, detail, { library, document, window, rules, previews });
      void previews?.validateActions?.(detail);
      document.title = record && !selectionError ? `${record.name} · Avalon ${config.plural}` : `${list?.label || config.plural} · Avalon`;
      $(`#${detailPrefix}-selection-status`).textContent = record && !selectionError ? config.selectionStatus?.(record) || `${record.name} selected.` : selectionError || (matches.length ? `Select ${article} ${singular} from the list.` : `No matching ${plural}.`);
    }
    if (save) saveState();
  };
  const select = (id, reveal = false) => {
    if (destroyed || !library.get(id)) return false;
    const changed = selectedId !== id || Boolean(selectionError);
    selectedId = id; selectionError = "";
    followSelectedList(library.get(id));
    if (!matches.some(record => record.id === id)) { search.value = ""; filters = emptyFilters(); }
    render({ save: false }); saveState(changed ? "push" : "replace");
    const mobile = window.matchMedia?.("(max-width: 850px)").matches;
    if (reveal || mobile) { detail.focus({ preventScroll: true }); if (mobile) detail.scrollIntoView({ block: "start" }); }
    return true;
  };
  const switchList = id => {
    if (destroyed || id === listId || !lists.some(list => list.id === id)) return false;
    listId = id; selectedId = null; selectionError = ""; filters = emptyFilters(); search.value = "";
    render({ save: false }); saveState("push");
    listControl?.querySelector?.(`[data-${attribute}-list="${id}"]`)?.focus();
    return true;
  };
  const renderSearch = () => {
    if (searchFrame != null) window.cancelAnimationFrame?.(searchFrame);
    searchFrame = null; selectionError = ""; render();
  };
  const scheduleSearch = () => {
    if (typeof window.requestAnimationFrame !== "function") return renderSearch();
    if (searchFrame != null) window.cancelAnimationFrame?.(searchFrame);
    searchFrame = window.requestAnimationFrame(() => { searchFrame = null; if (!destroyed) renderSearch(); });
  };
  const clear = () => { search.value = ""; filters = emptyFilters(); renderSearch(); search.focus(); };
  on(search, "input", scheduleSearch);
  on(control("search-form"), "submit", event => { event.preventDefault(); renderSearch(); });
  on(control("clear"), "click", clear);
  on(control("filter-reset"), "click", () => { filters = emptyFilters(); selectionError = ""; render(); });
  on(control("active-filters"), "click", event => {
    const button = closest(event, `remove-${attribute}-filter`); if (!button) return;
    const key = button.dataset[`remove${attribute[0].toUpperCase() + attribute.slice(1)}Filter`];
    filters[key].delete(button.dataset.filterValue); selectionError = ""; render(); control("filter-summary").focus({ preventScroll: true });
  });
  for (const mode of ["include", "exclude"]) on(control(mode), "click", () => { excludeMode = mode === "exclude"; render({ save: false }); });
  const toggle = (event, exclude) => {
    const clearGroup = closest(event, `clear-${attribute}-group`);
    if (clearGroup) {
      const key = clearGroup.dataset[`clear${attribute[0].toUpperCase() + attribute.slice(1)}Group`];
      filters[key].clear(); selectionError = ""; render(); return;
    }
    const button = closest(event, `${attribute}-filter`); if (!button) return;
    event.preventDefault();
    const group = filters[data(button, "Filter")], value = button.dataset.filterValue, state = exclude ? -1 : 1;
    if (group.get(value) === state) group.delete(value); else group.set(value, state);
    selectionError = ""; render();
  };
  on(groups, "click", event => toggle(event, excludeMode || Boolean(event.shiftKey)));
  on(groups, "contextmenu", event => toggle(event, true));
  on(control("sort"), "click", event => {
    const button = closest(event, `${attribute}-sort`); if (!button) return;
    const key = data(button, "Sort"); order = sort === key && order === "asc" ? "desc" : "asc"; sort = key; render();
    $(".rules-results-scroll").scrollTop = 0;
  });
  on(results, "click", event => {
    if (closest(event, config.clearAttribute || `clear-${attribute}`)) return clear();
    const row = closest(event, `select-${attribute}`);
    if (row && plainClick(event) && select(row.dataset[`select${attribute[0].toUpperCase() + attribute.slice(1)}`])) event.preventDefault();
  });
  on(document, "click", event => {
    const listButton = closest(event, `${attribute}-list`);
    if (listButton && plainClick(event)) {
      if (switchList(data(listButton, "List"))) event.preventDefault();
      return;
    }
    const ref = closest(event, `${config.kind}-name`); if (!ref || !plainClick(event)) return;
    const found = library.registry.resolve(ref.dataset[`${config.kind}Name`], ref.dataset[`${config.kind}Source`]);
    if (found.status === "found" && select(found.target.id, true)) event.preventDefault();
  });
  on(document, "keydown", event => { if (event.key === "Escape" && menu?.open) { menu.open = false; control("filter-summary").focus(); } });
  on(document, "pointerdown", event => { if (menu && !menu.contains(event.target)) menu.open = false; });
  on(window, "popstate", () => { readState(); render({ save: false }); detailController?.sync?.(); });
  readState(); render();
  return {
    select, switchList, get selectedId() { return selectedId; }, get selectedList() { return listId; },
    destroy() {
      destroyed = true; window.cancelAnimationFrame?.(searchFrame); listeners.forEach(remove => remove()); detailController?.destroy?.(); previews?.destroy?.();
    },
  };
}

export function mountActions(library, context) {
  const browser = mountReferenceBrowser(library, { ...context, config: REFERENCE_TYPES.actions });
  return { ...browser, selectAction: browser.select, get selectedId() { return browser.selectedId; } };
}

export async function startReferenceBrowser(context) {
  const { document } = context, main = document.querySelector("#main");
  let config = context.config || REFERENCE_TYPES[document.body.dataset.catalog || document.body.dataset.page];
  try {
    if (!config) throw new Error("Unknown reference collection.");
    const [data, rules, definition, dependencies, traits] = await Promise.all([
      loadJson(config.dataPath || `data/${config.collection}.json`),
      config.loadRules ? loadJson("data/rules.json").then(createRuleLibrary).catch(() => null) : null,
      config.loadDefinition?.(),
      Promise.all(Object.entries(config.dependencies || {}).map(async ([key, path]) => [key, await loadJson(path)])).then(Object.fromEntries),
      config.loadTraits ? loadJson("data/traits.json").then(data => createCatalog(data, { collection: "traits", href: "traits.html" })).catch(() => null) : null,
    ]);
    config = { ...config, ...definition };
    return mountReferenceBrowser(config.create(data, { ...config, dependencies }), { ...context, config, rules, traits });
  } catch (error) {
    main.innerHTML = `<section class="rules-load-error" role="alert"><h1>Unable to open ${escapeHtml(config?.plural.toLowerCase() || "references")}</h1><p>${escapeHtml(error.message)}</p><a href="${escapeHtml(config?.href || "index.html")}">Reload ${escapeHtml(config?.plural.toLowerCase() || "references")}</a></section>`;
  } finally { main.removeAttribute("aria-busy"); }
}

export const startActions = context => startReferenceBrowser({ ...context, config: REFERENCE_TYPES.actions });

if (typeof document !== "undefined" && REFERENCE_TYPES[document.body.dataset.catalog || document.body.dataset.page]) {
  startReferenceBrowser({ document, window });
}
