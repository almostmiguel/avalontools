import { escapeHtml } from "./content-renderer.js";

export const RULE_MEMORY_KEY = "avalon-rule-memory-v1";
export const RECENT_RULE_LIMIT = 6;
const compareNames = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;

export function createRuleMemory(library, window) {
  const normalize = raw => {
    let value;
    try { value = JSON.parse(raw); } catch { value = null; }
    const ids = (items, limit) => [...new Set((Array.isArray(items) ? items : [])
      .filter(id => typeof id === "string" && library.get(id)))].slice(0, limit);
    return { starred: ids(value?.starred, 500), recent: ids(value?.recent, RECENT_RULE_LIMIT) };
  };
  let state;
  try { state = normalize(window.localStorage.getItem(RULE_MEMORY_KEY)); }
  catch { state = normalize(null); }
  const save = () => { try { window.localStorage.setItem(RULE_MEMORY_KEY, JSON.stringify(state)); } catch { /* Keep working for this visit. */ } };
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
      state.recent = [id, ...state.recent.filter(value => value !== id)].slice(0, RECENT_RULE_LIMIT);
      save();
    },
    clearRecent() { state.recent = []; save(); },
    sync(event) {
      if (event.key !== RULE_MEMORY_KEY && event.key !== null) return false;
      state = normalize(event.key === null ? null : event.newValue);
      return true;
    },
  };
}

const starIcon = active => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${active ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg>`;
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
