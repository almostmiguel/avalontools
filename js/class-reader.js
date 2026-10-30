import { escapeHtml, renderContent, renderIcon, renderInline, safeHref } from "./content-renderer.js";
import { createFeatCatalog, renderFeatBody, renderFeatTitle, resolveRelatedFeat } from "./feat-library.js";
import { createReferenceCatalog, searchCatalog } from "./reference-library.js";
import { renderReferenceCitation, renderReaderHeading, renderReaderFooter, sourceTone } from "./reference-data.js";

const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ranks = { u: "Untrained", t: "Trained", e: "Expert", m: "Master", l: "Legendary" };
const attributes = { Strength: "STR", Dexterity: "DEX", Constitution: "CON", Intelligence: "INT", Wisdom: "WIS", Charisma: "CHA", Other: "Other" };
export const CLASS_FILTERS = [{ key: "keyAbility", label: "Key attribute" }, { key: "hp", label: "Hit Points per level" }];
const tabs = { overview: "Overview", features: "Class Features", options: "Class Options", feats: "Class Feats" };
const featureId = feature => `class-feature-${slug(feature.name)}${feature.subclassShortName ? `-${slug(feature.subclassShortName)}` : ""}-${feature.level}`;
const optionId = option => `${slug(option.type)}:${slug(option.shortName)}`;

// Overview references need only class data, without loading the feat collection.
export function createClassOverviewCatalog(payload) {
  if (!Array.isArray(payload?.classes)) throw new Error("Class data needs a classes array.");
  const catalog = createReferenceCatalog({ ...payload, classes: payload.classes.filter(record => record.source === "PC1") }, {
    collection: "classes", href: "classes.html",
    validate(entry) {
      if (!Number.isInteger(entry.hp) || !entry.keyAbility || !Array.isArray(entry.features) || !Array.isArray(entry.subclasses)) throw new Error(`Incomplete class: ${entry.name}`);
      if (entry.features.some(feature => feature.source !== "PC1") || entry.subclasses.some(option => option.source !== "PC1" || option.features.some(feature => feature.source !== "PC1"))) throw new Error("Classes must contain only PC1 content.");
      for (const feature of [...entry.features, ...entry.subclasses.flatMap(option => option.features)]) {
        if (!Number.isInteger(feature.level) || feature.level < 1 || feature.level > 20 || !Array.isArray(feature.entries)) throw new Error(`Invalid class feature: ${feature.name}`);
      }
    },
      decorate: entry => ({ keyAbility: entry.keyAbility, keyAttributes: new Set(entry.keyAbility.split(/\s+or\s+/i)), hp: String(entry.hp), sourceTone: sourceTone(entry.source) }),
  });
  catalog.renderPreview = renderClassPreview;
  return catalog;
}

export function createClassCatalog(payload, { dependencies = {}, featLibrary = createFeatCatalog(dependencies.feats) } = {}) {
  const catalog = createClassOverviewCatalog(payload);
  catalog.featLibrary = featLibrary;
  const names = new Set(catalog.records.map(record => record.name.toLowerCase()));
  catalog.feats = featLibrary.records.filter(feat => feat.traits.some(trait => names.has(trait)));
  catalog.featsByClass = new Map(catalog.records.map(record => [record.id, catalog.feats.filter(feat => feat.traits.includes(record.name.toLowerCase())).sort((a, b) => a.level - b.level || compare(a.name, b.name))]));
  return catalog;
}

export const classOptions = library => ({
  keyAbility: [...new Set(library.records.flatMap(record => [...record.keyAttributes]))].sort(compare).map(value => ({ value, label: value })),
  hp: [...new Set(library.records.map(record => record.hp))].sort((a, b) => Number(a) - Number(b)).map(value => ({ value, label: `${value} HP` })),
});
export const classValues = (record, key) => key === "keyAbility" ? record.keyAttributes : [record.hp];
export function classMatches(record, filters, omit = "") {
  return CLASS_FILTERS.every(({ key }) => {
    if (key === omit) return true;
    const values = new Set(classValues(record, key)), states = filters[key];
    if ([...states].some(([value, state]) => state === -1 && values.has(value))) return false;
    const included = [...states].filter(([, state]) => state === 1);
    return !included.length || included.some(([value]) => values.has(value));
  });
}
export function sortClasses(records, key, order) {
  const direction = order === "desc" ? -1 : 1;
  const value = record => record[key];
  return [...records].sort((a, b) => direction * (key === "hp" ? Number(a.hp) - Number(b.hp) : compare(value(a), value(b))) || compare(a.name, b.name));
}
export function renderClassResults(records, selectedId) {
  if (!records.length) return '<div class="rules-empty"><h2>No matching classes</h2><p>Try another name or clear the filters.</p><button type="button" data-clear-catalog>Clear search and filters</button></div>';
  return `<ul class="rules-results">${records.map(record => `<li><a class="class-result" href="${escapeHtml(record.href)}" data-select-catalog="${escapeHtml(record.id)}"${record.id === selectedId ? ' aria-current="true"' : ""}><span><strong class="rule-result-name">${escapeHtml(record.name)}</strong></span><span class="class-result-attribute" title="${escapeHtml(record.keyAbility)}">${[...record.keyAttributes].map(value => attributes[value] || escapeHtml(value)).join(" / ")}</span><span class="class-result-hp">${record.hp}</span><span class="class-result-publication source-color" data-source-tone="${record.sourceTone}">${escapeHtml(record.source)}</span></a></li>`).join("")}</ul>`;
}

const citation = entry => renderReferenceCitation({ ...entry, page: Number.isInteger(entry.page) ? entry.page : null, sourceId: "PC1", sourceName: "Player Core" });
export function renderClassPreview(record) {
  const image = safeHref(record.entry.image);
  return `<header class="rule-preview-heading"><h2 id="rule-preview-title">${escapeHtml(record.name)}</h2><span>Class</span></header><div class="rule-preview-body"><div class="class-preview-overview${image ? " class-preview-overview--illustrated" : ""}"><div><p class="class-preview-summary">${escapeHtml(record.entry.summary)}</p><dl class="class-preview-stats"><div><dt>Key attribute</dt><dd>${escapeHtml(record.keyAbility)}</dd></div><div><dt>Hit Points</dt><dd>${escapeHtml(record.hp)} + Constitution per level</dd></div></dl></div>${image ? `<img class="class-preview-image" src="${escapeHtml(image)}" alt="${escapeHtml(record.name)} class illustration" width="120" height="180" loading="lazy" decoding="async">` : ""}</div></div>${renderReaderFooter(record)}`;
}
const rank = value => ranks[String(value || "u").toLowerCase()] || "Untrained";
const plainClick = event => !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && (event.button == null || event.button === 0);

function contentOptions(record, library, rules, anchorPrefix) {
  return {
    // Match authored h2–h6 blocks to their HTML levels alongside the native h3 feature titles.
    source: "PC1", anchorPrefix, headingOffset: -1, resolveRule: rules?.registry.resolve,
    resolveFeat(name, source) {
      const result = resolveRelatedFeat(library.featLibrary, [record.name.toLowerCase()], name, source);
      return result.target && library.featsByClass.get(record.id).includes(result.target)
        ? { ...result, target: { ...result.target, href: `${record.href}&tab=feats&feat=${encodeURIComponent(result.target.id)}` } } : result;
    },
  };
}
const rich = (entries, record, library, rules, prefix) => renderContent({ entries }, contentOptions(record, library, rules, prefix)).html;

function proficiencies(record) {
  const entry = record.entry;
  const profs = entry.initialProficiencies;
  const group = (label, body) => `<div class="reader-detail-row class-proficiency-row"><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`;
  const proficiencyList = data => Object.entries(data || {}).filter(([key]) => ranks[key.toLowerCase()]).map(([key, entries]) => `<p><strong>${rank(key)}</strong> in ${entries.map(escapeHtml).join(", ")}.</p>`).join("");
  const skills = Object.entries(profs.skills || {}).filter(([key]) => ranks[key.toLowerCase()]).flatMap(([key, choices]) => choices.map(choice => `<p><strong>${rank(key)}</strong> in ${choice.entry ? renderInline(choice.entry) : choice.skill.map(name => renderInline(`{@skill ${name}|PC1}`)).join(" or ")}.</p>`)).join("");
  const saves = `<div class="class-saving-throws">${[["Fortitude", profs.fort], ["Reflex", profs.ref], ["Will", profs.will]].map(([name, value]) => `<p><strong>${rank(value)}</strong> in ${name}</p>`).join("")}</div>`;
  return `<dl class="class-proficiencies" aria-label="Class statistics and proficiencies">${group("Key attribute", escapeHtml(record.keyAbility))}${group("Hit Points", `${record.hp} + Constitution per level`)}${group("Perception", `<strong>${rank(profs.perception)}</strong>`)}${group("Saving throws", saves)}${group("Skills", `${skills}<p>Trained in ${profs.skills.add} additional skills plus your Intelligence modifier.</p>`)}${group("Attacks", proficiencyList(profs.attacks))}${group("Defenses", proficiencyList(profs.defenses))}${profs.spells ? group("Spellcasting", proficiencyList(profs.spells)) : ""}${profs.classDc ? group("Class DC", renderInline(profs.classDc.entry)) : ""}</dl>`;
}

export function renderClassDetail(record) {
  return `${renderReaderHeading(record, { kind: "Class" })}<div class="class-tabs" role="tablist" aria-label="Class information">${Object.entries(tabs).map(([key, label]) => `<button type="button" role="tab" id="class-tab-${key}" data-class-tab="${key}" aria-controls="class-panel" aria-selected="${key === "overview"}" tabindex="${key === "overview" ? "0" : "-1"}">${label}</button>`).join("")}</div><div id="class-panel" class="class-panel rich-content" role="tabpanel" aria-labelledby="class-tab-overview" tabindex="0"></div>${renderReaderFooter(record)}`;
}

function progression(record) {
  const advancement = record.entry.advancement;
  const benefits = { classFeats: `${record.name} feat`, skillFeats: "Skill feat", generalFeats: "General feat", ancestryFeats: "Ancestry feat", skillIncrease: "Skill increase", abilityBoosts: "Attribute boosts" };
  const normalized = value => value.toLowerCase().replace(/s$/, "");
  const rows = Array.from({ length: 20 }, (_, index) => {
    const level = index + 1, features = record.entry.features.filter(feature => feature.level === level);
    const links = features.map(feature => `<button type="button" data-class-jump-feature="${featureId(feature)}">${escapeHtml(feature.name)}</button>`);
    for (const [key, label] of Object.entries(benefits)) if (advancement[key]?.includes(level) && !features.some(feature => normalized(feature.name) === normalized(label))) {
      links.push(key === "classFeats" ? `<button type="button" data-class-jump-feats="${level}">${escapeHtml(label)}</button>` : `<span>${escapeHtml(label)}</span>`);
    }
    return `<tr><th scope="row">${level}</th><td><div class="class-progression-benefits">${links.join('<span class="class-benefit-divider" aria-hidden="true">·</span>')}</div></td></tr>`;
  }).join("");
  return `<div class="rich-content"><div class="table-wrap class-progression"><table><caption>${escapeHtml(record.name)} Advancement</caption><thead><tr><th scope="col">Level</th><th scope="col">Class features</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function removeOptionHeadings(entries, optionName) {
  return (Array.isArray(entries) ? entries : [entries]).flatMap(entry => {
    if (!entry || typeof entry !== "object") return [entry];
    if (/^h[1-6]$/.test(entry.type) && entry.name?.trim().toLowerCase() === optionName.toLowerCase()) return removeOptionHeadings(entry.entries ?? entry.entry ?? [], optionName);
    return [{ ...entry, ...(Array.isArray(entry.entries) ? { entries: removeOptionHeadings(entry.entries, optionName) } : {}) }];
  });
}

function featureContent(feature, record, library, rules, option = null) {
  const entries = option ? removeOptionHeadings(feature.entries, option.name) : feature.entries;
  const body = rich(entries, record, library, rules, `${featureId(feature)}-section`);
  const featureCitation = "";
  return `<section class="class-feature" id="${featureId(feature)}"><header><h3>${escapeHtml(feature.name)}</h3><span>Level ${feature.level}</span></header>${featureCitation}<div class="rich-content">${body || '<p>See the benefits for your selected doctrine in Class Options.</p>'}</div></section>`;
}

function featContent(feat, record, library, rules) {
  return renderFeatBody(feat, library.featLibrary, rules, { ...contentOptions(record, library, rules, `class-feat-${slug(feat.id)}`), showHeading: false });
}

// Own only the selected class's reader controls; the shared browser owns the list.
export function mountClassReader(record, root, { library, window, rules, previews }) {
  const panel = root.querySelector("#class-panel");
  const feats = library.featsByClass.get(record.id), options = record.entry.subclasses;
  const listeners = [];
  let state, frame = null, version = 0, destroyed = false;
  const on = (target, type, handler, capture = false) => { target.addEventListener(type, handler, capture); listeners.push(() => target.removeEventListener(type, handler, capture)); };
  const readState = () => {
    const params = new URLSearchParams(window.location.search), selectedFeat = feats.find(feat => feat.id === params.get("feat"));
    return {
      tab: selectedFeat ? "feats" : params.get("tab") === "progression" ? "features" : Object.hasOwn(tabs, params.get("tab")) ? params.get("tab") : "overview",
      featureLevel: Math.max(0, Math.min(20, Number(params.get("feature-level")) || 0)),
      featLevel: selectedFeat ? 0 : Math.max(0, Math.min(20, Number(params.get("feat-level")) || 0)),
      query: selectedFeat ? "" : params.get("feat-q") || "", expandedFeats: new Set(selectedFeat ? [selectedFeat.id] : []),
    };
  };
  const saveState = (push = false) => {
    const url = new URL(window.location.href);
    for (const key of ["tab", "feature-level", "feat-level", "feat-q", "feat", "option"]) url.searchParams.delete(key);
    if (state.tab !== "overview") url.searchParams.set("tab", state.tab);
    if (state.featureLevel) url.searchParams.set("feature-level", state.featureLevel);
    if (state.featLevel) url.searchParams.set("feat-level", state.featLevel);
    if (state.query) url.searchParams.set("feat-q", state.query);
    if (state.expandedFeats.size === 1) url.searchParams.set("feat", [...state.expandedFeats][0]);
    url.searchParams.set("id", record.id);
    if (url.href !== window.location.href) window.history[push ? "pushState" : "replaceState"](null, "", `${url.pathname}${url.search}`);
  };
  const validateLinks = () => { void previews?.validateActions?.(panel); };
  const renderFeatures = () => {
    const features = record.entry.features.filter(feature => !state.featureLevel || feature.level === state.featureLevel).sort((a, b) => a.level - b.level);
    panel.querySelector("#class-features-list").innerHTML = features.map(feature => featureContent(feature, record, library, rules)).join("") || '<p class="class-panel-note">No new class features at this level.</p>';
    validateLinks();
  };
  const renderFeatResults = () => {
    const matches = searchCatalog({ records: feats }, state.query).filter(feat => !state.featLevel || feat.level === state.featLevel);
    panel.querySelector("#class-feat-count").textContent = `${matches.length} ${matches.length === 1 ? "feat" : "feats"}`;
    panel.querySelector("#class-feat-results").innerHTML = matches.map(feat => `<details class="class-feat" data-class-feat="${escapeHtml(feat.id)}"${state.expandedFeats.has(feat.id) ? " open" : ""}><summary><strong>${renderFeatTitle(feat, { showQualifier: false })}</strong><span>Level ${feat.level}</span>${renderIcon("chevron-down")}</summary><div class="class-feat-content rich-content">${state.expandedFeats.has(feat.id) ? featContent(feat, record, library, rules) : ""}</div></details>`).join("") || '<p class="class-panel-note">No matching feats. Try another name or level.</p>';
    validateLinks();
  };
  const renderOptions = () => {
    for (const type of new Set(options.map(option => option.type))) {
      const matches = options.filter(option => option.type === type);
      panel.querySelector(`[data-class-options-list="${slug(type)}"]`).innerHTML = matches.map(option => `<details class="class-option"><summary><strong>${escapeHtml(option.name)}</strong>${renderIcon("chevron-down")}</summary><div>${option.features.slice().sort((a, b) => a.level - b.level).map(feature => featureContent(feature, record, library, rules, option)).join("")}</div></details>`).join("");
    }
    validateLinks();
  };
  const render = () => {
    version++; if (frame != null) window.cancelAnimationFrame?.(frame); frame = null;
    for (const button of root.querySelectorAll("[data-class-tab]")) {
      const current = button.dataset.classTab === state.tab;
      button.setAttribute("aria-selected", String(current)); button.tabIndex = current ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", `class-tab-${state.tab}`);
    if (state.tab === "overview") {
      const art = record.entry.image ? renderContent({ entries: [{ type: "image", href: record.entry.image, alt: `${record.name} class illustration` }] }).html : "";
      panel.innerHTML = `<div class="rich-content class-overview-intro">${art ? `<div class="reader-art">${art}</div>` : ""}${rich(record.entry.entries, record, library, rules, "class-introduction")}</div><div class="reader-details">${proficiencies(record)}</div><div class="rich-content class-playstyle">${rich(record.entry.playstyle, record, library, rules, "class-playstyle")}</div>`;
    } else if (state.tab === "features") {
      panel.innerHTML = `<div class="class-panel-toolbar"><h2>Class Features</h2><label>Level <select id="class-feature-level" data-class-feature-level><option value="0">All levels</option>${Array.from({ length: 20 }, (_, index) => `<option value="${index + 1}"${state.featureLevel === index + 1 ? " selected" : ""}>${index + 1}</option>`).join("")}</select></label></div>${progression(record)}<div id="class-features-list"></div>`;
      renderFeatures();
    } else if (state.tab === "options") {
      const optionTypes = [...new Set(options.map(option => option.type))];
      panel.innerHTML = options.length ? `<div class="class-panel-toolbar"><h2>Class Options</h2></div>${optionTypes.map((type, index) => optionTypes.length > 1 ? `<section class="class-option-group${index ? " class-option-group--separated" : ""}"><div data-class-options-list="${slug(type)}"></div></section>` : `<div data-class-options-list="${slug(type)}"></div>`).join("")}` : `<h2>Class Options</h2><p class="class-panel-note">The ${escapeHtml(record.name.toLowerCase())} has no subclasses. Explore Class Feats to customize your character.</p>`;
      renderOptions();
    } else {
      panel.innerHTML = `<div class="class-panel-toolbar class-feat-toolbar"><h2>Class Feats</h2><label class="class-feat-search">${renderIcon("search")}<span class="sr-only">Search ${escapeHtml(record.name)} feats</span><input type="search" id="class-feat-search" data-class-feat-search placeholder="Search class feats…" value="${escapeHtml(state.query)}" autocomplete="off"></label><label>Level <select data-class-feat-level><option value="0">All levels</option>${[...new Set(feats.map(feat => feat.level))].sort((a, b) => a - b).map(level => `<option value="${level}"${state.featLevel === level ? " selected" : ""}>${level}</option>`).join("")}</select></label><p id="class-feat-count" role="status" aria-live="polite"></p></div><div id="class-feat-results"></div>`;
      renderFeatResults();
    }
    validateLinks();
  };
  const changeTab = (tab, push = true) => { if (!Object.hasOwn(tabs, tab)) return; state.tab = tab; state.expandedFeats.clear(); render(); saveState(push); };
  on(root, "click", event => {
    const tab = event.target.closest("[data-class-tab]");
    if (tab) { event.preventDefault(); changeTab(tab.dataset.classTab); return; }
    const feature = event.target.closest("[data-class-jump-feature]");
    if (feature) { state.featureLevel = 0; changeTab("features"); const target = panel.querySelector(`#${feature.dataset.classJumpFeature}`); target?.scrollIntoView({ block: "start" }); return; }
    const featLevel = event.target.closest("[data-class-jump-feats]");
    if (featLevel) { state.featLevel = Number(featLevel.dataset.classJumpFeats); state.query = ""; changeTab("feats"); return; }
    const featLink = event.target.closest("[data-feat-name]");
    if (featLink && plainClick(event)) {
      const { target } = resolveRelatedFeat(library.featLibrary, [record.name.toLowerCase()], featLink.dataset.featName, featLink.dataset.featSource);
      if (target && feats.includes(target)) { event.preventDefault(); state.tab = "feats"; state.query = ""; state.featLevel = 0; state.expandedFeats = new Set([target.id]); render(); saveState(true); panel.querySelector(`[data-class-feat="${target.id}"]`)?.scrollIntoView({ block: "nearest" }); }
    }
  });
  on(root, "keydown", event => {
    if (!event.target.matches("[data-class-tab]")) return;
    const keys = Object.keys(tabs), index = keys.indexOf(state.tab);
    const next = event.key === "ArrowRight" ? keys[(index + 1) % keys.length] : event.key === "ArrowLeft" ? keys[(index + keys.length - 1) % keys.length] : event.key === "Home" ? keys[0] : event.key === "End" ? keys.at(-1) : null;
    if (next) { event.preventDefault(); changeTab(next); root.querySelector(`[data-class-tab="${next}"]`).focus(); }
  });
  on(panel, "change", event => {
    if (event.target.matches("[data-class-feature-level]")) { state.featureLevel = Number(event.target.value); renderFeatures(); }
    if (event.target.matches("[data-class-feat-level]")) { state.featLevel = Number(event.target.value); state.expandedFeats.clear(); renderFeatResults(); }
    saveState();
  });
  on(panel, "input", event => {
    if (!event.target.matches("[data-class-feat-search]")) return;
    state.query = event.target.value; state.expandedFeats.clear();
    if (frame != null) window.cancelAnimationFrame?.(frame);
    const currentVersion = version;
    const update = () => { frame = null; if (!destroyed && version === currentVersion && state.tab === "feats") { renderFeatResults(); saveState(); } };
    if (window.requestAnimationFrame) frame = window.requestAnimationFrame(update); else update();
  });
  on(panel, "toggle", event => {
    const target = event.target;
    if (!target.matches("[data-class-feat]")) return;
    const feat = feats.find(feat => feat.id === target.dataset.classFeat); if (!feat) return;
    if (target.open) {
      state.expandedFeats.add(feat.id);
      const body = target.querySelector(".class-feat-content");
      if (!body.innerHTML) { body.innerHTML = featContent(feat, record, library, rules); validateLinks(); }
    } else state.expandedFeats.delete(feat.id);
    saveState();
  }, true);
  state = readState(); render();
  return {
    sync() { state = readState(); render(); },
    destroy() { destroyed = true; version++; if (frame != null) window.cancelAnimationFrame?.(frame); listeners.forEach(remove => remove()); },
  };
}

export const CLASS_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters: CLASS_FILTERS,
  sortKeys: ["name", "keyAbility", "hp", "source"],
  create: createClassCatalog, options: classOptions, matches: classMatches, values: classValues, sort: sortClasses,
  renderResults: renderClassResults, renderDetail: renderClassDetail, mountDetail: mountClassReader,
};
