import { escapeHtml, renderContent, renderIcon, renderInline, renderTraitBadges } from "./content-renderer.js";
import { createCatalog, catalogOptions, catalogValues, renderCatalogResults, searchCatalog, sortCatalog } from "./reference-library.js";
import { renderReaderHeading, renderReaderFooter } from "./reference-data.js";
import { createFeatCatalog } from "./feat-library.js";
import { renderCharacterFeatCards } from "./character-library.js";

const title = value => value.charAt(0).toUpperCase() + value.slice(1);
const hasLineages = record => ["Changeling", "Nephilim"].includes(record.name);
const tabs = record => ({ overview: "Overview", ...(!record.entry.versatile ? { heritages: "Heritages" } : {}), ...(hasLineages(record) ? { lineages: "Lineages" } : {}), feats: "Ancestry Feats" });
const filters = [{ key: "size", label: "Sizes" }, { key: "boost", label: "Attribute Boosts" }, { key: "rarity", label: "Rarity" }];
const values = (record, key) => key === "size" ? record.entry.size || [] : key === "boost" ? (record.entry.boosts || []).map(value => /two free/i.test(value) ? "Two free boosts" : value) : key === "rarity" ? [title(record.entry.rarity)] : catalogValues(record, key);

export function createAncestryCatalog(payload, config = {}) {
  const catalog = createCatalog(payload, { collection: "ancestries", href: "ancestries.html" });
  for (const record of catalog.records) {
    if (record.source !== "PC1" || !Array.isArray(record.entry.heritages) || !Array.isArray(record.entry.features)) throw new Error(`Invalid PC1 ancestry: ${record.name}`);
    if (!record.entry.versatile && (!Number.isInteger(record.entry.hp) || !record.entry.size?.length || !record.entry.speed)) throw new Error(`Missing ancestry statistics: ${record.name}`);
    // Nethys includes the heritage rules again after the cultural overview.
    // Keep those rules in features so every view renders them exactly once.
    record.overviewEntries = record.entry.entries.filter(entry => !record.entry.versatile || !(
      /^h[1-6]$/.test(entry?.type) && (entry.name === "Versatile Heritage" && !entry.entries?.length
        || entry.name === record.name && entry.entries?.some(value => typeof value === "string" && value.startsWith("{@b Ancestry Page}")))
    ));
  }
  catalog.versatileHeritages = catalog.records.filter(record => record.entry.versatile);
  if (config.dependencies?.feats) {
    catalog.featLibrary = createFeatCatalog(config.dependencies.feats);
    catalog.featsByAncestry = new Map(catalog.records.map(record => [record.id, catalog.featLibrary.records.filter(feat => feat.traits.includes(record.name.toLowerCase())).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))]));
  }
  catalog.renderPreview = renderAncestryPreview;
  return catalog;
}

function stats(record, preview = false, badges = "") {
  const entry = record.entry;
  const traits = badges ? `<div class="ancestry-traits"><dt>Traits</dt><dd>${badges}</dd></div>` : "";
  const fields = entry.versatile ? [] : [["Hit Points", String(entry.hp)], ["Size", entry.size.join(" or ")], ["Speed", entry.speed], ["Attribute Boosts", entry.boosts.join(", ")], ...(entry.flaws.length ? [["Attribute Flaws", entry.flaws.join(", ")]] : [])];
  if (!fields.length) return !preview && traits ? `<dl class="ancestry-attributes ancestry-attributes--standalone">${traits}</dl>` : "";
  if (preview) return `<dl class="ability-fields">${fields.slice(0, 3).map(([label, value]) => `<div class="ability-field"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
  const attributes = [["Attribute Boosts", entry.boosts], ...(entry.flaws.length ? [["Attribute Flaws", entry.flaws]] : [])];
  return `<div class="ancestry-stat-block"><dl class="reader-facts ancestry-stats">${fields.slice(0, 3).map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><dl class="ancestry-attributes">${attributes.map(([label, values]) => `<div><dt>${label}</dt><dd>${escapeHtml(values.join(", "))}</dd></div>`).join("")}${traits}</dl></div>`;
}

export function renderAncestryPreview(record) {
  const intro = record.overviewEntries.find(entry => entry?.type === "flavor") || record.overviewEntries[0];
  return `<header class="rule-preview-heading"><h2 id="rule-preview-title">${escapeHtml(record.name)}</h2><span>${record.entry.versatile ? "Versatile Heritage" : "Ancestry"}</span></header><div class="rule-preview-body">${renderTraitBadges([...(record.entry.rarity === "common" ? [] : [record.entry.rarity]), ...record.entry.traits])}${renderContent({ entries: [intro] }, { source: record.source, anchorPrefix: "ancestry-preview" }).html}${stats(record, true)}</div>${renderReaderFooter(record)}`;
}

export function renderAncestryDetail(record) {
  return `${renderReaderHeading(record, { kind: record.entry.versatile ? "Versatile Heritage" : "Ancestry" })}<div class="reader-tabs" role="tablist" aria-label="Ancestry information">${Object.entries(tabs(record)).map(([key, label]) => `<button type="button" role="tab" id="ancestry-tab-${key}" data-ancestry-tab="${key}" aria-controls="ancestry-panel" aria-selected="${key === "overview"}" tabindex="${key === "overview" ? "0" : "-1"}">${label}</button>`).join("")}</div><div id="ancestry-panel" class="ancestry-panel rich-content" role="tabpanel" aria-labelledby="ancestry-tab-overview" tabindex="0"></div>${renderReaderFooter(record)}`;
}

export function mountAncestryReader(record, root, { library, window, rules, previews }) {
  const panel = root.querySelector("#ancestry-panel");
  const availableTabs = tabs(record), allFeats = library.featsByAncestry?.get(record.id) || [];
  const lineages = hasLineages(record) ? allFeats.filter(feat => feat.traits.includes("lineage")) : [];
  const feats = hasLineages(record) ? allFeats.filter(feat => !feat.traits.includes("lineage")) : allFeats;
  const listeners = [];
  let state, frame = null, destroyed = false;
  const on = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
  const readState = () => {
    const params = new URLSearchParams(window.location.search);
    return { tab: Object.hasOwn(availableTabs, params.get("tab")) ? params.get("tab") : "overview", query: params.get("feat-q") || "", level: Number(params.get("feat-level")) || 0 };
  };
  const saveState = (push = false) => {
    const url = new URL(window.location.href);
    for (const key of ["tab", "feat-q", "feat-level"]) url.searchParams.delete(key);
    if (state.tab !== "overview") url.searchParams.set("tab", state.tab);
    if (state.query) url.searchParams.set("feat-q", state.query);
    if (state.level) url.searchParams.set("feat-level", String(state.level));
    if (url.href !== window.location.href) window.history[push ? "pushState" : "replaceState"](null, "", `${url.pathname}${url.search}`);
  };
  const rich = (entries, prefix) => renderContent({ entries }, { source: record.source, headingOffset: -1, resolveRule: rules?.registry.resolve, resolveFeat: library.featLibrary?.registry.resolve, anchorPrefix: prefix }).html;
  const validate = () => { void previews?.validateActions?.(panel); };
  const renderFeats = () => {
    const matches = searchCatalog({ records: feats }, state.query).filter(feat => !state.level || feat.level === state.level);
    panel.querySelector("#ancestry-feat-count").textContent = `${matches.length} ${matches.length === 1 ? "feat" : "feats"}`;
    panel.querySelector("#ancestry-feat-results").innerHTML = renderCharacterFeatCards(matches, library.featLibrary, rules) || '<p class="muted">No matching feats. Try another name or level.</p>';
    validate();
  };
  const render = () => {
    if (frame != null) window.cancelAnimationFrame?.(frame);
    frame = null;
    for (const button of root.querySelectorAll("[data-ancestry-tab]")) {
      const selected = button.dataset.ancestryTab === state.tab;
      button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", `ancestry-tab-${state.tab}`);
    if (state.tab === "overview") {
      const [first, ...rest] = record.overviewEntries;
      const hasFlavor = first?.type === "flavor";
      const artwork = record.entry.images?.length ? `<div class="reader-art">${renderContent({ entries: record.entry.images.map((href, index) => ({ type: "image", href, alt: `${record.name} ancestry illustration ${index + 1}` })) }).html}</div>` : "";
      const badges = renderTraitBadges([...(record.entry.rarity === "common" ? [] : [record.entry.rarity]), ...record.entry.traits]);
      const startingLanguages = (record.entry.languages || []).filter(value => !/^Additional languages/i.test(value));
      const additionalLanguages = (record.entry.languages || []).filter(value => /^Additional languages/i.test(value));
      const languages = record.entry.languages?.length ? `<section class="reader-detail-row ancestry-languages"><h3>Languages</h3><div><ul class="ancestry-language-list" aria-label="Starting languages">${startingLanguages.map(value => `<li>${renderInline(value)}</li>`).join("")}</ul>${additionalLanguages.map(value => `<p class="ancestry-language-note">${renderInline(value)}</p>`).join("")}</div></section>` : "";
      const features = record.entry.features.map((feature, index) => `<section class="reader-detail-row ancestry-feature"><h3>${escapeHtml(feature.name)}</h3><div>${rich(feature.entries, `ancestry-feature-${index}`)}</div></section>`).join("");
      panel.innerHTML = `<div class="rich-content">${artwork}${hasFlavor ? rich([first], "ancestry-intro") : ""}<div class="reader-details ancestry-details">${stats(record, false, badges)}${languages}${features}</div>${rich(hasFlavor ? rest : record.overviewEntries, "ancestry-info")}</div>`;
    } else if (state.tab === "heritages") {
      const ownHeritages = record.entry.heritages.map((heritage, index) => `<details class="character-feat"><summary><strong>${escapeHtml(heritage.name)}</strong>${renderIcon("chevron-down")}</summary><div class="rich-content">${renderTraitBadges(heritage.traits)}${rich(heritage.entries, `ancestry-heritage-${index}`)}</div></details>`).join("");
      panel.innerHTML = `<div class="character-toolbar"><h2>Heritages</h2></div><div class="rich-content ancestry-heritage-intro">${rich(record.entry.heritageInfo, "heritage-intro")}</div><section class="reader-option-group" data-heritage-group="ancestry" aria-label="${escapeHtml(record.name)} heritages">${ownHeritages}</section><div class="ancestry-versatile-prompt"><p>You can also choose a versatile heritage.</p><button type="button" data-catalog-list="versatile-heritages">Versatile Heritages</button></div>`;
    } else if (state.tab === "lineages") {
      panel.innerHTML = `<section class="character-feats"><div class="character-toolbar"><h2>Lineages</h2></div><p class="ancestry-lineage-note">Choose a lineage.</p>${renderCharacterFeatCards(lineages, library.featLibrary, rules)}</section>`;
    } else {
      panel.innerHTML = `<div class="character-toolbar"><h2>Ancestry Feats</h2><label class="character-search"><span class="sr-only">Search ${escapeHtml(record.name)} feats</span><input type="search" data-ancestry-feat-search placeholder="Search ancestry feats…" value="${escapeHtml(state.query)}" autocomplete="off"></label><label>Level <select data-ancestry-feat-level><option value="0">All levels</option>${[...new Set(feats.map(feat => feat.level))].sort((a, b) => a - b).map(level => `<option value="${level}"${state.level === level ? " selected" : ""}>${level}</option>`).join("")}</select></label><span id="ancestry-feat-count" role="status" aria-live="polite"></span></div><div id="ancestry-feat-results"></div>`;
      renderFeats();
    }
    validate();
  };
  const selectTab = tab => { state.tab = tab; render(); saveState(true); };
  on(root, "click", event => {
    const tab = event.target.closest?.("[data-ancestry-tab]");
    if (tab && Object.hasOwn(availableTabs, tab.dataset.ancestryTab)) selectTab(tab.dataset.ancestryTab);
  });
  on(root, "keydown", event => {
    const tab = event.target.closest?.("[data-ancestry-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const keys = Object.keys(availableTabs), index = keys.indexOf(tab.dataset.ancestryTab);
    const key = event.key === "Home" ? keys[0] : event.key === "End" ? keys.at(-1) : keys[(index + (event.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length];
    selectTab(key); root.querySelector(`[data-ancestry-tab="${key}"]`)?.focus();
  });
  on(panel, "input", event => {
    if (!event.target.matches("[data-ancestry-feat-search]")) return;
    state.query = event.target.value;
    const update = () => { frame = null; if (!destroyed && state.tab === "feats") { renderFeats(); saveState(); } };
    if (frame != null) window.cancelAnimationFrame?.(frame);
    if (window.requestAnimationFrame) frame = window.requestAnimationFrame(update); else update();
  });
  on(panel, "change", event => {
    if (event.target.matches("[data-ancestry-feat-level]")) { state.level = Number(event.target.value) || 0; renderFeats(); saveState(); }
  });
  state = readState(); render();
  return {
    sync() { state = readState(); render(); },
    destroy() { destroyed = true; if (frame != null) window.cancelAnimationFrame?.(frame); listeners.forEach(remove => remove()); },
  };
}

export const ANCESTRY_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters,
  lists: [
    { id: "ancestries", label: "Ancestries", singular: "Ancestry", matches: record => !record.entry.versatile },
    { id: "versatile-heritages", label: "Versatile Heritages", singular: "Versatile Heritage", filterKeys: ["rarity"], matches: record => record.entry.versatile },
  ],
  showCategory: false, sortKeys: ["name", "source"], create: createAncestryCatalog, sort: sortCatalog,
  obsoleteParams: ["category", "not-category"], detailStateParams: ["tab", "feat-q", "feat-level"],
  options: library => ({ ...catalogOptions(library), ...Object.fromEntries(filters.map(({ key }) => [key, [...new Set(library.records.flatMap(record => values(record, key)))].sort().map(value => ({ value, label: value }))])) }),
  values,
  matches: (record, states, omit) => filters.every(({ key }) => {
    if (key === omit) return true;
    const options = new Set(values(record, key)), selected = [...(states[key] || [])];
    return !selected.some(([value, state]) => state === -1 && options.has(value)) && (!selected.some(([, state]) => state === 1) || selected.some(([value, state]) => state === 1 && options.has(value)));
  }),
  renderResults: (records, selectedId, _library, config) => renderCatalogResults(records, selectedId, config),
  renderDetail: renderAncestryDetail, mountDetail: mountAncestryReader,
};
