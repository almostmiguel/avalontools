import { escapeHtml } from "./content-renderer.js";
import { attachRulePreviews } from "./rule-links.js";
import { createLibrary, renderResults, renderRuleBody, RULE_KINDS, searchRules, sortRules } from "./rules-library.js";

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  try { return await response.json(); }
  catch { throw new Error(`${path} is not valid JSON. Check its commas and brackets.`); }
}

export async function loadLibrary() {
  return createLibrary(await loadJson("data/rules.json"));
}

const topicUrl = topic => `rules.html?${new URLSearchParams({ topic })}`;
const link = rule => `<a href="${escapeHtml(rule.href)}">${escapeHtml(rule.name)}</a>`;
const plainClick = event => !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.button == null || event.button === 0);

function ruleArticle(rule, library, embedded = false) {
  const tag = embedded ? "h2" : "h1";
  const topics = rule.topics.map(escapeHtml).join(" · ");
  const parent = library.get(rule.parentId);
  const parentLink = parent ? `<p class="rule-parent">Part of <a class="rule-link" href="${escapeHtml(parent.href)}" data-rule-name="${escapeHtml(parent.entry.id)}" data-rule-source="${escapeHtml(parent.source)}">${escapeHtml(parent.name)}</a></p>` : "";
  const sourceLabel = rule.setting === "original" ? "Avalon original" : `${rule.setting === "modified" ? "Adapted from " : ""}${rule.sourceName}${rule.page ? ` · p. ${rule.page}` : ""}`;
  return `<header class="rule-page-heading"><p class="eyebrow">${topics} <span class="rule-kind rule-kind--${rule.kind}">${RULE_KINDS[rule.kind]}</span></p><${tag}${embedded ? ' id="rule-detail-title"' : ""}>${escapeHtml(rule.name)}</${tag}><p class="rule-page-source">${escapeHtml(sourceLabel)}<span>${escapeHtml(rule.source)}</span></p>${parentLink}</header><article class="rich-content rule-page-content">${renderRuleBody(rule, library)}</article>`;
}

export function mountCatalog(library, { document, window, attachPreviews = attachRulePreviews }) {
  const search = document.querySelector("#rules-search");
  const source = document.querySelector("#rules-source");
  const kind = document.querySelector("#rules-kind");
  const topics = document.querySelector("#rules-topic");
  const results = document.querySelector("#rules-results");
  const count = document.querySelector("#rules-count");
  const heading = document.querySelector("#results-title");
  const detail = document.querySelector("#rule-detail");
  const status = document.querySelector("#rule-selection-status");
  const sortButtons = ["name", "type", "source"].map(key => [key, document.querySelector(`#sort-${key}`)]);
  let sort = "";
  let order = "asc";
  let selectedId = null;
  let selectionError = "";
  let renderedKey;
  let matches = [];
  const previews = attachPreviews({ document, window, registry: library.registry });

  source.innerHTML = '<option value="">All sources</option>' + library.sources.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  topics.innerHTML = '<option value="">All topics</option>' + library.topics.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  document.querySelector("#library-summary").textContent = `${library.rules.length} rules · ${library.topics.length} topics`;
  const filters = () => ({ query: search.value, source: source.value, topic: topics.value, kind: kind.value });
  const activeSort = () => sort || (search.value.trim() ? "" : "name");
  const nextSortOrder = key => activeSort() === key && order === "asc" ? "desc" : "asc";
  const resetFilters = () => { search.value = ""; source.value = ""; kind.value = ""; topics.value = ""; };
  const readState = () => {
    const params = new URLSearchParams(window.location.search);
    search.value = params.get("q") || "";
    source.value = library.sources.includes(params.get("source")) ? params.get("source") : "";
    kind.value = Object.hasOwn(RULE_KINDS, params.get("kind")) ? params.get("kind") : "";
    topics.value = library.topics.includes(params.get("topic")) ? params.get("topic") : "";
    sort = ["name", "type", "source"].includes(params.get("sort")) ? params.get("sort") : "";
    order = sort && params.get("order") === "desc" ? "desc" : "asc";
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
    for (const [key, value] of [["q", search.value.trim()], ["topic", topics.value], ["source", source.value], ["kind", kind.value], ["id", selectedId], ["sort", sort], ["order", sort ? order : ""]]) {
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
    const key = selectionError || rule?.id || (matches.length ? "choose" : "empty");
    if (renderedKey === key) return;
    renderedKey = key;
    previews?.hide();
    detail.scrollTop = 0;
    if (rule && !selectionError) {
      detail.innerHTML = `<button type="button" class="back-to-list" data-back-to-list>← Rule list</button>${ruleArticle(rule, library, true)}`;
      document.title = `${rule.name} · Avalon Rules`;
      status.textContent = `${rule.name} selected. ${RULE_KINDS[rule.kind]}.`;
    } else {
      const title = selectionError ? "Rule not found" : !library.rules.length ? "Your rules belong here" : !matches.length ? "No matching rules" : "Choose a rule";
      const message = selectionError || (!library.rules.length ? "Add your first rule to begin building the reference." : !matches.length ? "Adjust your search or filters to see rules." : "Select a rule from the list to read it here.");
      detail.innerHTML = `<div class="rules-detail-empty"><span class="empty-sigil" aria-hidden="true">✧</span><h2 id="rule-detail-title">${title}</h2><p>${escapeHtml(message)}</p></div>`;
      document.title = "Rules · Avalon";
      status.textContent = title;
    }
  };
  const update = ({ save = true } = {}) => {
    matches = sortRules(searchRules(library, filters()), { sort, order });
    if (!selectionError && !matches.some(rule => rule.id === selectedId)) selectedId = matches[0]?.id || null;
    results.innerHTML = renderResults(matches, { hasRules: library.rules.length > 0, selectedId });
    count.textContent = `${matches.length} ${matches.length === 1 ? "rule" : "rules"}`;
    heading.textContent = topics.value || (search.value.trim() ? "Search results" : "All rules");
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
  for (const control of [source, kind, topics]) control.addEventListener("change", filterChanged);
  document.querySelector("#rules-search-form").addEventListener("submit", event => { event.preventDefault(); filterChanged(); });
  document.querySelector("#clear-search").addEventListener("click", clear);
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
    if (!event.target.closest("[data-back-to-list]")) return;
    document.querySelector("#rules-list-pane").scrollIntoView({ block: "start" });
    search.focus({ preventScroll: true });
  });
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
  document.title = `${rule.name} · Avalon Rules`;
  document.querySelector("#rule-breadcrumbs").innerHTML = `<a href="rules.html">Rules</a><span aria-hidden="true">/</span>${rule.topics.map(topic => `<a href="${escapeHtml(topicUrl(topic))}">${escapeHtml(topic)}</a>`).join('<span aria-hidden="true">·</span>')}`;
  document.querySelector("#rule-article").innerHTML = ruleArticle(rule, library);
  const related = library.rules.filter(other => other !== rule && other.topics.some(topic => rule.topics.includes(topic))).slice(0, 12);
  document.querySelector("#rule-related").innerHTML = `<a class="back-to-rules" href="${escapeHtml(topicUrl(rule.topic))}">← Browse this topic</a>${related.length ? `<h2 class="rules-sidebar-label">In this topic</h2><ul class="related-rules">${related.map(item => `<li>${link(item)}</li>`).join("")}</ul>` : ""}`;
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
