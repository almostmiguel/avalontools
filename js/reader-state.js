// Saved entries and reading history, scoped to a library and storage key.
import { escapeHtml, renderIcon } from "./content-renderer.js";

export const READER_STATE_KEY = "avalon-rule-memory-v1";
export const RECENT_ENTRY_LIMIT = 6;
const compareNames = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;

export function createReaderState(library, window, { storageKey = READER_STATE_KEY, recentLimit = RECENT_ENTRY_LIMIT } = {}) {
  if (!Number.isInteger(recentLimit) || recentLimit < 1) throw new Error("recentLimit must be a positive integer.");
  const normalize = raw => {
    let value;
    try { value = JSON.parse(raw); } catch { value = null; }
    const ids = (items, limit) => [...new Set((Array.isArray(items) ? items : [])
      .filter(id => typeof id === "string" && library.get(id)))].slice(0, limit);
    return { starred: ids(value?.starred, 500), recent: ids(value?.recent, recentLimit) };
  };
  let state;
  try { state = normalize(window.localStorage.getItem(storageKey)); }
  catch { state = normalize(null); }
  const save = () => { try { window.localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Keep working for this visit. */ } };
  return {
    get starred() { return state.starred.map(id => library.get(id)).sort((a, b) => compareNames(a.name, b.name)); },
    get recent() { return state.recent.map(id => library.get(id)); },
    isStarred: id => state.starred.includes(id),
    toggle(id) {
      if (!library.get(id)) return false;
      state.starred = state.starred.includes(id) ? state.starred.filter(value => value !== id) : [...state.starred, id];
      save();
      return state.starred.includes(id);
    },
    visit(id) {
      if (!library.get(id) || state.recent[0] === id) return;
      state.recent = [id, ...state.recent.filter(value => value !== id)].slice(0, recentLimit);
      save();
    },
    clearRecent() { state.recent = []; save(); },
    sync(event) {
      if (event.key !== storageKey && event.key !== null) return false;
      state = normalize(event.key === null ? null : event.newValue);
      return true;
    },
  };
}

const starIcon = active => renderIcon("star", "", { filled: active });
const starLabel = (rule, active) => `${active ? "Unstar" : "Star"} ${rule.name}`;

export function renderStarButton(rule, active) {
  return `<button id="rule-star" class="rule-star" type="button" data-star-rule="${escapeHtml(rule.id)}" aria-pressed="${active}" aria-label="${escapeHtml(starLabel(rule, active))}" title="${escapeHtml(starLabel(rule, active))}">${starIcon(active)}</button>`;
}

export function updateStarButton(button, rule, memory) {
  if (!button || !rule) return;
  const active = memory.isStarred(rule.id);
  button.setAttribute("aria-pressed", String(active));
  button.setAttribute("aria-label", starLabel(rule, active));
  button.setAttribute("title", starLabel(rule, active));
  button.innerHTML = starIcon(active);
}

export function renderSavedMenu(memory, open = false, view = "starred") {
  const recent = view === "recent";
  const starredRules = memory.starred;
  const recentRules = memory.recent;
  const rules = recent ? recentRules : starredRules;
  const label = recent ? "Recently viewed rules" : "Starred rules";
  const list = rules.length ? `<ul class="rule-shortcut-list" aria-label="${label}">${rules.map(rule => `<li><a href="${escapeHtml(rule.href)}" data-saved-rule="${escapeHtml(rule.id)}" title="${escapeHtml(rule.name)}"><span>${escapeHtml(rule.name)}</span><span class="rule-shortcut-source">${escapeHtml(rule.source)}</span></a></li>`).join("")}</ul>`
    : `<p class="rule-shortcut-empty">${recent ? "Rules you open appear here." : "Star a rule to keep it here."}</p>`;
  return `<details id="rules-saved-menu" class="rules-saved-menu" data-saved-menu${open ? " open" : ""}><summary>Your rules <span>${starredRules.length} starred · ${recentRules.length} recent</span></summary><div class="rule-shortcut-sections"><div class="saved-view-switch" role="group" aria-label="Saved rule list"><button type="button" data-saved-view="starred" aria-pressed="${!recent}">Starred <span>${starredRules.length}</span></button><button type="button" data-saved-view="recent" aria-pressed="${recent}">Recent <span>${recentRules.length}</span></button></div>${list}${recent && rules.length ? '<div class="saved-menu-footer"><button type="button" data-clear-recent>Clear history</button></div>' : ""}</div></details>`;
}
