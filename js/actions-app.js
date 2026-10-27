import { escapeHtml } from "./content-renderer.js";
import { loadJson } from "./data-loader.js";
import { createLibrary } from "./rules-library.js";
import { attachRulePreviews } from "./rule-links.js";
import { ACTION_CATEGORIES, ACTION_TIMES, ACTION_FILTERS, emptyActionFilters, createActionLibrary, actionMatchesFilters, searchActions, sortActions, renderActionResults, renderActionDetail } from "./actions-library.js";

const plainClick = event => !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.button == null || event.button === 0);

export function mountActions(library, { document, window, rules = null, attachPreviews = attachRulePreviews }) {
  const $ = selector => document.querySelector(selector);
  const search = $("#actions-search"), results = $("#actions-results"), detail = $("#action-detail"), menu = $("#actions-filter-menu"), groups = $("#actions-filter-groups");
  const options = {
    source: library.sources.map(value => ({ value, label: value })),
    category: Object.entries(ACTION_CATEGORIES).map(([value, label]) => ({ value, label })),
    time: Object.entries(ACTION_TIMES).map(([value, label]) => ({ value, label })),
  };
  const previews = attachPreviews({ document, window, registry: rules?.registry, actions: library });
  let filters = emptyActionFilters(), selectedId = null, renderedId, sort = "name", order = "asc", excludeMode = false, selectionError = "";
  let matches = [];
  groups.innerHTML = ACTION_FILTERS.map(({ key, label }) => `<fieldset class="rule-filter-group"><legend class="sr-only">${label}</legend><div class="filter-group-heading"><span aria-hidden="true">${label}</span><button class="filter-group-clear" type="button" data-clear-action-group="${key}">Clear</button></div><div class="filter-options">${options[key].map(({ value }) => `<button class="filter-pill" type="button" data-action-filter="${key}" data-filter-value="${escapeHtml(value)}"></button>`).join("")}</div></fieldset>`).join("");
  $("#actions-summary").textContent = `${library.actions.length} actions · ${library.sources.length} ${library.sources.length === 1 ? "source" : "sources"}`;

  const saveState = (mode = "replace") => {
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    for (const [key, value] of [["q", search.value.trim()], ["id", selectedId], ["sort", sort === "name" ? "" : sort], ["order", order === "desc" ? "desc" : ""]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    for (const { key } of ACTION_FILTERS) {
      url.searchParams.delete(key); url.searchParams.delete(`not-${key}`);
      for (const [value, state] of filters[key]) url.searchParams.append(state === -1 ? `not-${key}` : key, value);
    }
    url.hash = "";
    if (url.href !== window.location.href) window.history[mode === "push" ? "pushState" : "replaceState"](null, "", `${url.pathname}${url.search}`);
  };
  const readState = () => {
    const params = new URLSearchParams(window.location.search);
    search.value = params.get("q") || "";
    sort = ["name", "category", "time", "source"].includes(params.get("sort")) ? params.get("sort") : "name";
    order = params.get("order") === "desc" ? "desc" : "asc";
    filters = emptyActionFilters();
    for (const { key } of ACTION_FILTERS) for (const [parameter, state] of [[key, 1], [`not-${key}`, -1]]) {
      for (const value of params.getAll(parameter)) {
        const option = options[key].find(option => option.value.toLowerCase() === value.toLowerCase());
        if (option) filters[key].set(option.value, state);
      }
    }
    selectedId = params.get("id"); selectionError = "";
    if (!selectedId && params.has("action")) {
      const found = library.registry.resolve(params.get("action"), params.get("source"));
      if (found.status === "found") selectedId = found.target.id;
      else selectionError = found.status === "ambiguous" ? "More than one action has this name. Choose an entry from the list." : "This action has not been added yet. Search for another action.";
    }
    if (selectedId && !library.get(selectedId)) selectionError = "This action could not be found. Search the list for its current name.";
    const selected = library.get(selectedId);
    if (selected && (!actionMatchesFilters(selected, filters) || !searchActions(library, search.value).includes(selected))) {
      search.value = ""; filters = emptyActionFilters();
    }
  };

  const render = ({ save = true } = {}) => {
    const searched = searchActions(library, search.value);
    matches = sortActions(searched.filter(action => actionMatchesFilters(action, filters)), sort, order);
    if (selectedId && !selectionError && !matches.some(action => action.id === selectedId)) selectedId = matches[0]?.id || null;
    results.innerHTML = renderActionResults(matches, selectedId);
    $("#actions-count").textContent = `${matches.length} ${matches.length === 1 ? "action" : "actions"}`;
    const active = ACTION_FILTERS.reduce((sum, { key }) => sum + filters[key].size, 0);
    const chips = $("#actions-active-filters");
    chips.hidden = !active;
    chips.innerHTML = ACTION_FILTERS.flatMap(({ key, label }) => [...filters[key]].map(([value, state]) => `<button class="active-filter${state === -1 ? " active-filter--exclude" : ""}" type="button" data-remove-action-filter="${key}" data-filter-value="${escapeHtml(value)}" aria-label="Remove ${escapeHtml(label)} ${escapeHtml(options[key].find(option => option.value === value).label)}"><span>${state === -1 ? "−" : "+"} ${escapeHtml(options[key].find(option => option.value === value).label)}</span><span aria-hidden="true">×</span></button>`)).join("");
    $("#actions-filter-count").textContent = active ? String(active) : "";
    $("#actions-results-title").textContent = search.value.trim() ? "Search results" : active ? "Filtered actions" : "All actions";
    for (const button of groups.querySelectorAll("[data-action-filter]")) {
      const key = button.dataset.actionFilter, value = button.dataset.filterValue, state = filters[key].get(value) || 0;
      const label = options[key].find(option => option.value === value).label;
      const count = searched.filter(action => actionMatchesFilters(action, filters, key) && (key === "time" ? action.costKeys.has(value) : (key === "source" ? action.source : action.category) === value)).length;
      button.setAttribute("data-state", state === -1 ? "exclude" : state === 1 ? "include" : "neutral");
      button.setAttribute("aria-pressed", String(state !== 0));
      button.setAttribute("aria-label", `${label}: ${state === -1 ? "excluded" : state === 1 ? "included" : "any"}. ${count} matching actions.`);
      button.innerHTML = `${state ? `<span class="filter-pill-symbol" aria-hidden="true">${state === 1 ? "+" : "−"}</span>` : ""}<span class="filter-pill-label">${escapeHtml(label)}</span><span class="filter-pill-count">${count}</span>`;
    }
    $("#actions-include").setAttribute("aria-pressed", String(!excludeMode));
    $("#actions-exclude").setAttribute("aria-pressed", String(excludeMode));
    for (const button of $("#actions-sort").querySelectorAll("[data-action-sort]")) {
      const current = button.dataset.actionSort === sort;
      button.setAttribute("aria-pressed", String(current));
      if (current) button.setAttribute("data-direction", order); else button.removeAttribute("data-direction");
      button.setAttribute("aria-label", `Sort by ${button.dataset.actionSort}${current ? `, ${order === "asc" ? "ascending" : "descending"}` : ""}`);
    }
    const action = library.get(selectedId), key = selectionError || action?.id || (matches.length ? "choose" : "empty");
    if (key !== renderedId) {
      renderedId = key; previews?.hide(); detail.scrollTop = 0;
      detail.innerHTML = action && !selectionError ? renderActionDetail(action, library, rules)
        : `<div class="rules-detail-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2 id="action-detail-title">${selectionError ? "Action not found" : matches.length ? "Choose an action" : "No matching actions"}</h2><p>${escapeHtml(selectionError || (matches.length ? "Select an action from the list to read it here." : "Adjust the search or filters to see actions."))}</p></div>`;
      document.title = action && !selectionError ? `${action.name} · Avalon Actions` : "Actions · Avalon";
      $("#action-selection-status").textContent = action && !selectionError ? `${action.name} selected. ${action.timeLabel}.` : selectionError || (matches.length ? "Select an action from the list." : "No matching actions.");
    }
    if (save) saveState();
  };
  const selectAction = (id, reveal = false) => {
    if (!library.get(id)) return false;
    const changed = selectedId !== id || Boolean(selectionError);
    selectedId = id; selectionError = "";
    if (!matches.some(action => action.id === id)) { search.value = ""; filters = emptyActionFilters(); }
    render({ save: false }); saveState(changed ? "push" : "replace");
    const mobile = window.matchMedia?.("(max-width: 850px)").matches;
    if (reveal || mobile) { detail.focus({ preventScroll: true }); if (mobile) detail.scrollIntoView({ block: "start" }); }
    return true;
  };
  const clear = () => { search.value = ""; filters = emptyActionFilters(); selectionError = ""; render(); search.focus(); };
  search.addEventListener("input", () => { selectionError = ""; render(); });
  $("#actions-search-form").addEventListener("submit", event => { event.preventDefault(); selectionError = ""; render(); });
  $("#actions-clear").addEventListener("click", clear);
  $("#actions-filter-reset").addEventListener("click", () => { filters = emptyActionFilters(); selectionError = ""; render(); });
  $("#actions-active-filters").addEventListener("click", event => {
    const button = event.target.closest("[data-remove-action-filter]"); if (!button) return;
    filters[button.dataset.removeActionFilter].delete(button.dataset.filterValue); selectionError = ""; render(); $("#actions-filter-summary").focus({ preventScroll: true });
  });
  for (const [selector, mode] of [["#actions-include", false], ["#actions-exclude", true]]) $(selector).addEventListener("click", () => { excludeMode = mode; render({ save: false }); });
  const toggle = (event, exclude) => {
    const clearGroup = event.target.closest("[data-clear-action-group]");
    if (clearGroup) { filters[clearGroup.dataset.clearActionGroup].clear(); selectionError = ""; render(); return; }
    const button = event.target.closest("[data-action-filter]");
    if (!button) return;
    event.preventDefault();
    const group = filters[button.dataset.actionFilter], value = button.dataset.filterValue, state = exclude ? -1 : 1;
    if (group.get(value) === state) group.delete(value); else group.set(value, state);
    selectionError = ""; render();
  };
  groups.addEventListener("click", event => toggle(event, excludeMode || Boolean(event.shiftKey)));
  groups.addEventListener("contextmenu", event => toggle(event, true));
  $("#actions-sort").addEventListener("click", event => {
    const button = event.target.closest("[data-action-sort]"); if (!button) return;
    const key = button.dataset.actionSort; order = sort === key && order === "asc" ? "desc" : "asc"; sort = key; render();
    $(".rules-results-scroll").scrollTop = 0;
  });
  results.addEventListener("click", event => {
    if (event.target.closest("[data-clear-actions]")) return clear();
    const row = event.target.closest("[data-select-action]");
    if (row && plainClick(event) && selectAction(row.dataset.selectAction)) event.preventDefault();
  });
  document.addEventListener("click", event => {
    const ref = event.target.closest?.("[data-action-name]"); if (!ref || !plainClick(event)) return;
    const found = library.registry.resolve(ref.dataset.actionName, ref.dataset.actionSource);
    if (found.status === "found" && selectAction(found.target.id, true)) event.preventDefault();
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && menu.open) { menu.open = false; $("#actions-filter-summary").focus(); } });
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) menu.open = false; });
  window.addEventListener("popstate", () => { readState(); render({ save: false }); });
  readState(); render();
  return { selectAction, get selectedId() { return selectedId; } };
}

export async function startActions(context) {
  const { document, window } = context;
  const main = document.querySelector("#main");
  try {
    const [data, rules] = await Promise.all([loadJson("data/actions.json"), loadJson("data/rules.json").then(createLibrary).catch(() => null)]);
    mountActions(createActionLibrary(data), { ...context, rules });
  } catch (error) {
    main.innerHTML = `<section class="rules-load-error" role="alert"><h1>Unable to open actions</h1><p>${escapeHtml(error.message)}</p><a href="actions.html">Reload actions</a></section>`;
  } finally { main.removeAttribute("aria-busy"); }
}

if (typeof document !== "undefined" && document.body.dataset.page === "actions") startActions({ document, window });
