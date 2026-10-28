// Hierarchical rule browsing, chapter reading and standalone rule views.
import { escapeHtml } from "./content-renderer.js";
import { loadJson, renderReferenceCitation } from "./reference-data.js";
import { findChapter, renderChapter } from "./chapter-reader.js";
import { attachReferencePreviews } from "./reference-previews.js";
import { createRuleLibrary, chapterHref, renderBrowse, renderRulePath, browseBranchIds, renderRuleContent, renderRuleOutline, RULE_KINDS, searchRules } from "./rule-library.js";
import { FILTER_GROUPS, emptyFilters, filterOptions, readFilters, writeFilters, toggleFilter, matchesFilters, filterCounts, renderFilterGroups, renderFilterChips } from "./rule-filters.js";
import { createReaderState, renderStarButton, updateStarButton, renderSavedMenu } from "./reader-state.js";

export async function loadLibrary() {
  return createRuleLibrary(await loadJson("data/rules.json"));
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
  return `<header class="rule-page-heading">${renderRulePath(rule, library)}<div class="rule-title-row"><${tag}${embedded ? ' id="rule-detail-title"' : ""}>${escapeHtml(rule.name)}</${tag}></div><div class="rule-meta-row"><p class="rule-page-source">${renderReferenceCitation(rule)}<span class="rule-meta-kind rule-kind--${rule.kind}">${RULE_KINDS[rule.kind]}</span></p><div class="rule-reader-tools">${renderRuleOutline(content.headings)}${renderStarButton(rule, starred)}</div></div></header><article class="rich-content rule-page-content">${content.html}</article>`;
}

export function mountRuleBrowser(library, { document, window, attachPreviews = attachReferencePreviews }) {
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
  const memory = createReaderState(library, window);
  let savedOpen = false;
  let savedView = "starred";
  const expanded = new Set();
  let selectedId = null;
  let selectedChapter = null;
  let selectionError = "";
  let renderedKey;
  let matches = [];
  let searchFrame = null;
  const previews = attachPreviews({ document, window, registry: library.registry });
  const refreshMemory = () => {
    saved.innerHTML = renderSavedMenu(memory, savedOpen, savedView);
    updateStarButton(document.querySelector("#rule-star"), library.get(selectedId), memory);
  };

  filterPanel.innerHTML = renderFilterGroups(options);
  document.querySelector("#library-summary").textContent = `${library.rules.length} rules · ${library.sources.length} ${library.sources.length === 1 ? "source" : "sources"}`;
  const filters = () => ({ query: search.value, filters: filterState });
  const hasFilters = () => FILTER_GROUPS.some(({ key }) => filterState[key].size);
  const resetFilters = () => { search.value = ""; filterState = emptyFilters(); };
  const readState = () => {
    const params = new URLSearchParams(window.location.search);
    search.value = params.get("q") || "";
    filterState = readFilters(params, options);
    selectedId = params.get("id");
    selectedChapter = null;
    selectionError = "";
    if (!selectedId && params.has("rule")) {
      const found = library.registry.resolve(params.get("rule"), params.get("source"));
      if (found.status === "found") selectedId = found.target.id;
      else if (found.status === "ambiguous") selectionError = "This reference matches more than one rule. Open a specific rule from the list.";
      else selectionError = "This rule could not be found. Search the list for its current name.";
    }
    if (!selectedId && !params.has("rule") && params.has("chapter")) {
      const title = params.get("chapter"), sourceId = params.get("chapter-source");
      selectedChapter = findChapter(library, sourceId, title) || { sourceId, title, invalid: true };
      if (selectedChapter.invalid) selectionError = "This chapter could not be found. Choose a chapter from the list.";
    }
    if (selectedId && !library.get(selectedId)) {
      const target = library.registry.resolve(selectedId).target;
      if (target?.isChapter) { selectedChapter = findChapter(library, target.sourceId, target.title); selectedId = null; }
      else selectionError = "This rule could not be found. Search the list for its current name.";
    }
    if (selectedId && !selectionError && !searchRules(library, filters()).some(rule => rule.id === selectedId)) resetFilters();
  };
  const saveState = (mode = "replace", keepHash = false) => {
    const url = new URL(window.location.href);
    writeFilters(url.searchParams, filterState);
    for (const key of ["sort", "order", "view", "chapter", "chapter-source"]) url.searchParams.delete(key);
    for (const [key, value] of [["q", search.value.trim()], ["id", selectedId]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    if (selectedChapter) {
      url.searchParams.set("chapter", selectedChapter.title);
      if (selectedChapter.sourceId) url.searchParams.set("chapter-source", selectedChapter.sourceId);
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
    for (const row of results.querySelectorAll("[data-select-chapter]")) {
      if (row.dataset.selectChapter === selectedChapter?.key) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    }
    const ancestors = new Set(selectedChapter ? [
      JSON.stringify(["source", selectedChapter.sourceId]),
      JSON.stringify(["chapter", selectedChapter.sourceId, selectedChapter.title]),
    ] : browseBranchIds(library, rule));
    for (const branch of results.querySelectorAll("[data-rule-branch]")) {
      if (ancestors.has(branch.dataset.ruleBranch)) branch.open = true;
    }
    const browsable = matches.length || (library.chapters.length && !search.value.trim() && !hasFilters());
    const key = selectionError || selectedChapter?.key || rule?.id || (browsable ? "choose" : "empty");
    if (renderedKey === key) return;
    renderedKey = key;
    previews?.hide();
    detail.scrollTop = 0;
    if (selectedChapter && !selectedChapter.invalid && !selectionError) {
      detail.innerHTML = renderChapter(selectedChapter, library);
      void previews?.validateActions?.(detail);
      document.title = selectedChapter.title + " · Avalon Rules";
      status.textContent = selectedChapter.title + ". Full chapter selected.";
    } else if (rule && !selectionError) {
      memory.visit(rule.id);
      detail.innerHTML = ruleArticle(rule, library, true, memory.isStarred(rule.id));
      void previews?.validateActions?.(detail);
      document.title = `${rule.name} · Avalon Rules`;
      status.textContent = `${rule.name} selected. ${RULE_KINDS[rule.kind]}.`;
    } else {
      const emptyCollection = !library.rules.length && !library.chapters.length;
      const title = selectionError ? selectionError.startsWith("This reference matches") ? "Ambiguous rule link" : selectedChapter ? "Chapter not found" : "Rule not found" : emptyCollection ? "Your rules belong here" : !browsable ? "No matching rules" : "Choose a rule or chapter";
      const message = selectionError || (emptyCollection ? "Add your first rule to begin building the reference." : !browsable ? "Adjust your search or filters to see rules." : "Select a chapter to read it in full, or choose an individual rule.");
      detail.innerHTML = `<div class="rules-detail-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2 id="rule-detail-title">${title}</h2><p>${escapeHtml(message)}</p></div>`;
      document.title = "Rules · Avalon";
      status.textContent = title;
    }
    refreshMemory();
  };
  const update = ({ save = true } = {}) => {
    const searched = searchRules(library, { query: search.value });
    matches = searched.filter(rule => matchesFilters(rule, filterState));
    if (selectedId && !selectionError && !matches.some(rule => rule.id === selectedId)) selectedId = matches[0]?.id || null;
    results.innerHTML = renderBrowse(library, matches, { selectedId, selectedChapter, expanded, includeEmptyChapters: !search.value.trim() && !hasFilters() });
    count.textContent = matches.length + (matches.length === 1 ? " rule" : " rules");
    heading.textContent = search.value.trim() ? "Search results" : hasFilters() ? "Filtered rules" : "Browse rules";
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
    renderSelection();
    if (save) saveState();
  };
  const selectRule = (id, { reveal = false } = {}) => {
    if (!library.get(id)) {
      const chapter = library.chapters.find(chapter => chapter.id === id);
      return chapter ? selectChapter(chapter.sourceId, chapter.title, { reveal }) : false;
    }
    const changed = selectedId !== id || Boolean(selectionError) || Boolean(selectedChapter);
    selectedChapter = null;
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
  const selectChapter = (sourceId, title, { reveal = false } = {}) => {
    const chapter = findChapter(library, sourceId, title);
    if (!chapter) return false;
    const changed = selectedChapter?.key !== chapter.key || Boolean(selectionError);
    selectedChapter = chapter;
    selectedId = null;
    selectionError = "";
    resetFilters();
    update({ save: false });
    saveState(changed ? "push" : "replace");
    if (reveal || window.matchMedia?.("(max-width: 850px)").matches) {
      detail.focus({ preventScroll: true });
      if (window.matchMedia?.("(max-width: 850px)").matches) detail.scrollIntoView({ block: "start" });
    }
    return true;
  };
  const clear = () => { resetFilters(); if (selectedChapter?.invalid) selectedChapter = null; selectionError = ""; update(); search.focus(); };
  const filterChanged = () => {
    if (searchFrame != null) {
      window.cancelAnimationFrame?.(searchFrame);
      searchFrame = null;
    }
    if (selectedChapter?.invalid) selectedChapter = null;
    selectionError = "";
    update();
  };
  // Typing can produce input events faster than the browser can paint. Rendering at
  // most once per frame keeps the search field responsive on large rule libraries.
  const scheduleFilterChanged = () => {
    if (typeof window.requestAnimationFrame !== "function") return filterChanged();
    if (searchFrame != null) window.cancelAnimationFrame?.(searchFrame);
    searchFrame = window.requestAnimationFrame(() => {
      searchFrame = null;
      filterChanged();
    });
  };
  search.addEventListener("input", scheduleFilterChanged);
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
  results.addEventListener("toggle", event => {
    const branch = event.target;
    if (!branch.dataset?.ruleBranch || search.value.trim() || hasFilters()) return;
    if (branch.open) expanded.add(branch.dataset.ruleBranch);
    else expanded.delete(branch.dataset.ruleBranch);
  }, true);
  results.addEventListener("click", event => {
    if (event.target.closest("[data-clear-filters]")) return clear();
    const chapter = event.target.closest("[data-select-chapter]");
    if (chapter && plainClick(event)) {
      try {
        const [sourceId, title] = JSON.parse(chapter.dataset.selectChapter);
        if (selectChapter(sourceId, title)) event.preventDefault();
      } catch { /* Ignore a malformed chapter target. */ }
      return;
    }
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
    const choice = event.target?.closest?.("[data-select-rule]");
    if (choice && plainClick(event)) {
      if (selectRule(choice.dataset.selectRule, { reveal: true })) event.preventDefault();
      return;
    }
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
  return { selectRule, selectChapter, get selectedId() { return selectedId; }, get selectedChapter() { return selectedChapter; } };
}

// Existing standalone URLs remain usable; new rule links use the split view.
export function mountRule(library, { document, window, attachPreviews = attachReferencePreviews }) {
  const parameters = new URLSearchParams(window.location.search);
  let rule = library.get(parameters.get("id"));
  if (!rule && parameters.has("rule")) {
    const found = library.registry.resolve(parameters.get("rule"), parameters.get("source"));
    if (found.status === "found") rule = library.fromEntry(found.target.entry);
    else if (found.status === "ambiguous") throw new Error("This rule reference is ambiguous. Use a specific rule link.");
  }
  if (!rule) throw new Error("This rule could not be found. Search the library for its current name.");
  const memory = createReaderState(library, window);
  memory.visit(rule.id);
  document.title = `${rule.name} · Avalon Rules`;
  const browseUrl = rule.chapter ? chapterHref(rule.sourceId, rule.chapter) : `rules.html?${new URLSearchParams({ id: rule.id })}`;
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
  const previews = attachPreviews({ document, window, registry: library.registry });
  void previews?.validateActions?.(article);
  if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
}

export async function startRules(context) {
  const { document, window } = context;
  const main = document.querySelector("#main");
  try {
    const library = await loadLibrary();
    if (document.body.dataset.page === "rule") mountRule(library, context);
    else mountRuleBrowser(library, context);
  } catch (error) {
    main.innerHTML = `<section class="rules-load-error" role="alert"><p class="eyebrow">Avalon reference</p><h1>Unable to open rules</h1><p>${escapeHtml(error.message)}</p><a href="rules.html">Back to the rules library</a></section>`;
  } finally { main.removeAttribute("aria-busy"); }
}

if (typeof document !== "undefined") startRules({ document, window });
