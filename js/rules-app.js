import { escapeHtml } from "./content-renderer.js";
import { loadJson } from "./data-loader.js";
import { attachRulePreviews } from "./rule-links.js";
import { renderRuleCitation } from "./rule-sources.js";
import { createLibrary, renderResults, renderBrowse, renderRulePath, browseBranchIds, renderRuleContent, renderRuleOutline, RULE_KINDS, searchRules, sortRules } from "./rules-library.js";
import { FILTER_GROUPS, emptyFilters, filterOptions, readFilters, writeFilters, toggleFilter, matchesFilters, filterCounts, renderFilterGroups, renderFilterChips } from "./rules-filters.js";
import { createRuleMemory, renderStarButton, updateStarButton, renderSavedMenu } from "./rule-memory.js";

export async function loadLibrary() {
  return createLibrary(await loadJson("data/rules.json"));
}

const link = rule => `<a href="${escapeHtml(rule.href)}">${escapeHtml(rule.name)}</a>`;
const plainClick = event => !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.button == null || event.button === 0);
const closeOutline = (document, restoreFocus = false) => {
  const outline = document.querySelector("#rule-outline");
  if (!outline?.open) return;
  outline.open = false;
  if (restoreFocus) document.querySelector("#rule-outline > summary").focus();
};
const dismissOutlineOutside = (document, event) => {
  const outline = document.querySelector("#rule-outline");
  if (outline && !outline.contains(event.target)) closeOutline(document);
};

function ruleArticle(rule, library, embedded = false, starred = false) {
  const tag = embedded ? "h2" : "h1";
  const content = renderRuleContent(rule, library);
  return `<header class="rule-page-heading">${renderRulePath(rule, library)}<div class="rule-title-row"><${tag}${embedded ? ' id="rule-detail-title"' : ""}>${escapeHtml(rule.name)}</${tag}></div><div class="rule-meta-row"><p class="rule-page-source">${renderRuleCitation(rule)}<span class="rule-meta-kind rule-kind--${rule.kind}">${RULE_KINDS[rule.kind]}</span></p><div class="rule-reader-tools">${renderRuleOutline(content.headings)}${renderStarButton(rule, starred)}</div></div></header><article class="rich-content rule-page-content">${content.html}</article>`;
}

export function mountCatalog(library, { document, window, attachPreviews = attachRulePreviews }) {
  const search = document.querySelector("#rules-search");
  const options = filterOptions(library);
  const filterPanel = document.querySelector("#rules-filter-groups");
  const filterMenu = document.querySelector("#rules-filter-menu");
  const filterSummary = document.querySelector("#rules-filter-summary");
  const chips = document.querySelector("#rules-active-filters");
  let filterState = emptyFilters();
  let excludeClicks = false;
  const results = document.querySelector("#rules-results");
  const count = document.querySelector("#rules-count");
  const heading = document.querySelector("#results-title");
  const detail = document.querySelector("#rule-detail");
  const status = document.querySelector("#rule-selection-status");
  const saved = document.querySelector("#rules-saved");
  const memory = createRuleMemory(library, window);
  let savedOpen = false;
  let savedView = "starred";
  const sortButtons = ["name", "type", "source"].map(key => [key, document.querySelector(`#sort-${key}`)]);
  const viewButtons = ["index", "browse"].map(key => [key, document.querySelector(`#view-${key}`)]);
  const expanded = new Set();
  let view = "index";
  let sort = "";
  let order = "asc";
  let selectedId = null;
  let selectionError = "";
  let renderedKey;
  let matches = [];
  const previews = attachPreviews({ document, window, registry: library.registry });
  const refreshMemory = () => {
    saved.innerHTML = renderSavedMenu(memory, savedOpen, savedView);
    updateStarButton(document.querySelector("#rule-star"), library.get(selectedId), memory);
  };

  filterPanel.innerHTML = renderFilterGroups(options);
  document.querySelector("#library-summary").textContent = `${library.rules.length} rules · ${library.sources.length} ${library.sources.length === 1 ? "source" : "sources"}`;
  const filters = () => ({ query: search.value, filters: filterState });
  const hasFilters = () => FILTER_GROUPS.some(({ key }) => filterState[key].size);
  const activeSort = () => sort || (search.value.trim() ? "" : "name");
  const nextSortOrder = key => activeSort() === key && order === "asc" ? "desc" : "asc";
  const resetFilters = () => { search.value = ""; filterState = emptyFilters(); };
  const readState = () => {
    const params = new URLSearchParams(window.location.search);
    search.value = params.get("q") || "";
    filterState = readFilters(params, options);
    sort = ["name", "type", "source"].includes(params.get("sort")) ? params.get("sort") : "";
    order = sort && params.get("order") === "desc" ? "desc" : "asc";
    view = params.get("view") === "browse" ? "browse" : "index";
    selectedId = params.get("id");
    selectionError = "";
    if (!selectedId && params.has("rule")) {
      const found = library.registry.resolve(params.get("rule"), params.get("source"));
      if (found.status === "found") selectedId = found.target.id;
      else selectionError = found.status === "ambiguous" ? "More than one rule has this name. Choose one from the list." : "This rule could not be found. Search the list for its current name.";
    }
    if (selectedId && !library.get(selectedId)) selectionError = "This rule could not be found. Search the list for its current name.";
    if (selectedId && !selectionError && !searchRules(library, filters()).some(rule => rule.id === selectedId)) resetFilters();
  };
  const saveState = (mode = "replace", keepHash = false) => {
    const url = new URL(window.location.href);
    writeFilters(url.searchParams, filterState);
    for (const [key, value] of [["q", search.value.trim()], ["id", selectedId], ["sort", sort], ["order", sort ? order : ""], ["view", view === "browse" ? "browse" : ""]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    if (!selectionError) url.searchParams.delete("rule");
    if (!keepHash) url.hash = "";
    const href = `${url.pathname}${url.search}${url.hash}`;
    if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history[mode === "push" ? "pushState" : "replaceState"](null, "", href);
    }
  };
  const renderSelection = () => {
    const rule = library.get(selectedId);
    for (const row of results.querySelectorAll("[data-select-rule]")) {
      if (row.dataset.selectRule === selectedId) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
    if (view === "browse") {
      const ancestors = new Set(browseBranchIds(library, rule));
      for (const branch of results.querySelectorAll("[data-rule-branch]")) {
        if (ancestors.has(branch.dataset.ruleBranch)) branch.open = true;
      }
    }
    const key = selectionError || rule?.id || (matches.length ? "choose" : "empty");
    if (renderedKey === key) return;
    renderedKey = key;
    previews?.hide();
    detail.scrollTop = 0;
    if (rule && !selectionError) {
      memory.visit(rule.id);
      detail.innerHTML = ruleArticle(rule, library, true, memory.isStarred(rule.id));
      document.title = `${rule.name} · Avalon Rules`;
      status.textContent = `${rule.name} selected. ${RULE_KINDS[rule.kind]}.`;
    } else {
      const title = selectionError ? "Rule not found" : !library.rules.length ? "Your rules belong here" : !matches.length ? "No matching rules" : "Choose a rule";
      const message = selectionError || (!library.rules.length ? "Add your first rule to begin building the reference." : !matches.length ? "Adjust your search or filters to see rules." : "Select a rule from the list to read it here.");
      detail.innerHTML = `<div class="rules-detail-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2 id="rule-detail-title">${title}</h2><p>${escapeHtml(message)}</p></div>`;
      document.title = "Rules · Avalon";
      status.textContent = title;
    }
    refreshMemory();
  };
  const update = ({ save = true } = {}) => {
    const searched = searchRules(library, { query: search.value });
    matches = sortRules(searched.filter(rule => matchesFilters(rule, filterState)), { sort, order });
    if (!selectionError && !matches.some(rule => rule.id === selectedId)) selectedId = matches[0]?.id || null;
    results.innerHTML = view === "browse" ? renderBrowse(library, matches, { selectedId, expanded })
      : renderResults(matches, { hasRules: library.rules.length > 0, selectedId });
    document.querySelector("#rules-sort").hidden = view === "browse";
    for (const [key, button] of viewButtons) button.setAttribute("aria-pressed", String(view === key));
    count.textContent = `${matches.length} ${matches.length === 1 ? "rule" : "rules"}`;
    heading.textContent = search.value.trim() ? "Search results" : hasFilters() ? "Filtered rules" : view === "browse" ? "Browse rules" : "All rules";
    const counts = filterCounts(searched, filterState, options);
    const activeCount = FILTER_GROUPS.reduce((sum, { key }) => sum + filterState[key].size, 0);
    document.querySelector("#rules-filter-count").textContent = activeCount ? String(activeCount) : "";
    document.querySelector("#filter-mode-include").setAttribute("aria-pressed", String(!excludeClicks));
    document.querySelector("#filter-mode-exclude").setAttribute("aria-pressed", String(excludeClicks));
    chips.innerHTML = renderFilterChips(filterState, options);
    chips.hidden = !activeCount;
    for (const button of filterPanel.querySelectorAll("[data-filter-group]")) {
      const { filterGroup: group, filterValue: value } = button.dataset;
      const state = filterState[group].get(value) || 0;
      const label = options[group].find(option => option.value === value).label;
      const count = counts[group].get(value) || 0;
      button.setAttribute("data-state", state === 1 ? "include" : state === -1 ? "exclude" : "neutral");
      button.setAttribute("aria-pressed", state ? "true" : "false");
      const clickState = excludeClicks ? -1 : 1;
      button.setAttribute("aria-label", `${label}: ${state === 1 ? "included" : state === -1 ? "excluded" : "any"}. ${count} matching rules. Click to ${state === clickState ? "clear" : excludeClicks ? "exclude" : "include"}; Shift-click to ${state === -1 ? "clear" : "exclude"}.`);
      const symbol = state ? `<span class="filter-pill-symbol" aria-hidden="true">${state === 1 ? "+" : "−"}</span>` : "";
      button.innerHTML = `${symbol}<span class="filter-pill-label">${escapeHtml(label)}</span><span class="filter-pill-count">${count}</span>`;
    }
    for (const [key, button] of sortButtons) {
      const active = activeSort() === key;
      const direction = sort ? order : "asc";
      const next = nextSortOrder(key);
      const label = key[0].toUpperCase() + key.slice(1);
      button.setAttribute("aria-pressed", String(active));
      button.setAttribute("aria-label", `${label}${active ? `, sorted ${direction === "asc" ? "A to Z" : "Z to A"}` : ""}. Sort ${next === "asc" ? "A to Z" : "Z to A"}.`);
      if (active) button.setAttribute("data-direction", direction);
      else button.removeAttribute("data-direction");
    }
    renderSelection();
    if (save) saveState();
  };
  const selectRule = (id, { reveal = false } = {}) => {
    if (!library.get(id)) return false;
    const changed = selectedId !== id || Boolean(selectionError);
    selectedId = id;
    selectionError = "";
    if (!matches.some(rule => rule.id === id)) { resetFilters(); update({ save: false }); }
    else renderSelection();
    saveState(changed ? "push" : "replace");
    if (reveal || window.matchMedia?.("(max-width: 850px)").matches) {
      detail.focus({ preventScroll: true });
      if (window.matchMedia?.("(max-width: 850px)").matches) detail.scrollIntoView({ block: "start" });
    }
    return true;
  };
  const clear = () => { resetFilters(); selectionError = ""; update(); search.focus(); };
  const filterChanged = () => { selectionError = ""; update(); };
  search.addEventListener("input", filterChanged);
  document.querySelector("#rules-search-form").addEventListener("submit", event => { event.preventDefault(); filterChanged(); });
  document.querySelector("#clear-search").addEventListener("click", clear);
  const changePill = (event, exclude) => {
    const button = event.target.closest("[data-filter-group]");
    if (!button) return;
    event.preventDefault();
    const { filterGroup: group, filterValue: value } = button.dataset;
    toggleFilter(filterState, group, value, exclude);
    filterChanged();
  };
  filterPanel.addEventListener("click", event => {
    const clearGroup = event.target.closest("[data-clear-filter]");
    if (clearGroup) { filterState[clearGroup.dataset.clearFilter].clear(); return filterChanged(); }
    changePill(event, excludeClicks || Boolean(event.shiftKey));
  });
  filterPanel.addEventListener("contextmenu", event => changePill(event, true));
  for (const mode of ["include", "exclude"]) document.querySelector(`#filter-mode-${mode}`).addEventListener("click", () => {
    excludeClicks = mode === "exclude";
    update({ save: false });
  });
  document.querySelector("#rules-filter-reset").addEventListener("click", () => { filterState = emptyFilters(); filterChanged(); });
  chips.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-filter]");
    if (!button) return;
    filterState[button.dataset.removeFilter].delete(button.dataset.filterValue);
    filterChanged();
    filterSummary.focus({ preventScroll: true });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeOutline(document, true);
    if (event.key === "Escape" && filterMenu.open) { filterMenu.open = false; filterSummary.focus(); }
    if (event.key === "Escape" && savedOpen) {
      savedOpen = false;
      document.querySelector("#rules-saved-menu").open = false;
      document.querySelector("#rules-saved-menu > summary").focus();
    }
  });
  document.addEventListener("pointerdown", event => {
    dismissOutlineOutside(document, event);
    if (!filterMenu.contains(event.target)) filterMenu.open = false;
    if (!saved.contains(event.target)) {
      savedOpen = false;
      const menu = document.querySelector("#rules-saved-menu");
      if (menu) menu.open = false;
    }
  });
  for (const [key, button] of viewButtons) button.addEventListener("click", () => {
    if (view === key) return;
    view = key;
    update({ save: false });
    saveState("push");
    document.querySelector(".rules-results-scroll").scrollTop = 0;
  });
  results.addEventListener("toggle", event => {
    const branch = event.target;
    if (!branch.dataset?.ruleBranch || search.value.trim() || hasFilters()) return;
    if (branch.open) expanded.add(branch.dataset.ruleBranch);
    else expanded.delete(branch.dataset.ruleBranch);
  }, true);
  for (const [key, button] of sortButtons) button.addEventListener("click", () => {
    order = nextSortOrder(key);
    sort = key;
    update();
    document.querySelector(".rules-results-scroll").scrollTop = 0;
  });
  results.addEventListener("click", event => {
    if (event.target.closest("[data-clear-filters]")) return clear();
    const row = event.target.closest("[data-select-rule]");
    if (!row || !plainClick(event)) return;
    if (selectRule(row.dataset.selectRule)) event.preventDefault();
  });
  detail.addEventListener("click", event => {
    if (event.target.closest("[data-outline-link]")) { if (plainClick(event)) closeOutline(document); return; }
    const button = event.target.closest("[data-star-rule]");
    if (!button) return;
    const id = button.dataset.starRule;
    const rule = library.get(id);
    if (!rule) return;
    const active = memory.toggle(id);
    refreshMemory();
    status.textContent = `${rule.name} ${active ? "starred" : "removed from starred rules"}.`;
  });
  saved.addEventListener("toggle", event => {
    if (event.target.dataset?.savedMenu != null) savedOpen = event.target.open;
  }, true);
  saved.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-saved-view]");
    if (viewButton) {
      savedView = viewButton.dataset.savedView === "recent" ? "recent" : "starred";
      refreshMemory();
      document.querySelector(`#rules-saved-menu [data-saved-view="${savedView}"]`).focus({ preventScroll: true });
      return;
    }
    if (event.target.closest("[data-clear-recent]")) {
      memory.clearRecent();
      refreshMemory();
      document.querySelector('#rules-saved-menu [data-saved-view="recent"]').focus({ preventScroll: true });
      return;
    }
    const row = event.target.closest("[data-saved-rule]");
    if (row && plainClick(event)) {
      savedOpen = false;
      if (selectRule(row.dataset.savedRule, { reveal: true })) {
        event.preventDefault();
        refreshMemory();
      }
    }
  });
  window.addEventListener("storage", event => { if (memory.sync(event)) refreshMemory(); });
  document.addEventListener("click", event => {
    const reference = event.target?.closest?.("[data-rule-name]");
    if (!reference || !plainClick(event)) return;
    const found = library.registry.resolve(reference.dataset.ruleName, reference.dataset.ruleSource);
    if (found.status === "found" && selectRule(found.target.id, { reveal: true })) event.preventDefault();
  });
  window.addEventListener("popstate", () => { readState(); update({ save: false }); });
  readState();
  update({ save: false });
  saveState("replace", true);
  if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  return { selectRule, get selectedId() { return selectedId; } };
}

// Existing standalone URLs remain usable; new rule links use the split view.
export function mountRule(library, { document, window, attachPreviews = attachRulePreviews }) {
  const parameters = new URLSearchParams(window.location.search);
  let rule = library.get(parameters.get("id"));
  if (!rule && parameters.has("rule")) {
    const found = library.registry.resolve(parameters.get("rule"), parameters.get("source"));
    if (found.status === "found") rule = library.fromEntry(found.target.entry);
    else if (found.status === "ambiguous") throw new Error("More than one rule has this name. Choose the intended entry from the rules library.");
  }
  if (!rule) throw new Error("This rule could not be found. Search the library for its current name.");
  const memory = createRuleMemory(library, window);
  memory.visit(rule.id);
  document.title = `${rule.name} · Avalon Rules`;
  const browseUrl = `rules.html?${new URLSearchParams({ view: "browse", id: rule.id })}`;
  document.querySelector("#rule-breadcrumbs").innerHTML = `<a href="rules.html">Rules</a><span aria-hidden="true">/</span><a href="${escapeHtml(browseUrl)}">${escapeHtml(rule.sourceName)}</a>${rule.chapter ? `<span aria-hidden="true">/</span><span>${escapeHtml(rule.chapter)}</span>` : ""}`;
  const article = document.querySelector("#rule-article");
  article.innerHTML = ruleArticle(rule, library, false, memory.isStarred(rule.id));
  article.addEventListener("click", event => {
    if (event.target.closest("[data-outline-link]")) { if (plainClick(event)) closeOutline(document); return; }
    if (!event.target.closest("[data-star-rule]")) return;
    memory.toggle(rule.id);
    updateStarButton(document.querySelector("#rule-star"), rule, memory);
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeOutline(document, true); });
  document.addEventListener("pointerdown", event => dismissOutlineOutside(document, event));
  window.addEventListener("storage", event => {
    if (memory.sync(event)) updateStarButton(document.querySelector("#rule-star"), rule, memory);
  });
  const related = library.authoredRules.filter(other => other !== rule && other.sourceId === rule.sourceId && other.chapter === rule.chapter).slice(0, 12);
  document.querySelector("#rule-related").innerHTML = `<a class="back-to-rules" href="${escapeHtml(browseUrl)}">← Browse this ${rule.chapter ? "chapter" : "source"}</a>${related.length ? `<h2 class="rules-sidebar-label">${rule.chapter ? "In this chapter" : "From this source"}</h2><ul class="related-rules">${related.map(item => `<li>${link(item)}</li>`).join("")}</ul>` : ""}`;
  attachPreviews({ document, window, registry: library.registry });
  if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
}

export async function startRules(context) {
  const { document, window } = context;
  const main = document.querySelector("#main");
  try {
    const library = await loadLibrary();
    if (document.body.dataset.page === "rule") mountRule(library, context);
    else mountCatalog(library, context);
  } catch (error) {
    main.innerHTML = `<section class="rules-load-error" role="alert"><p class="eyebrow">Avalon reference</p><h1>Unable to open rules</h1><p>${escapeHtml(error.message)}</p><a href="rules.html">Back to the rules library</a></section>`;
  } finally { main.removeAttribute("aria-busy"); }
}

if (typeof document !== "undefined") startRules({ document, window });
