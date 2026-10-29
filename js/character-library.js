import { renderContent, renderIcon, safeHref } from "./content-renderer.js";
import { createCatalog, catalogMatchesFilters, catalogOptions, catalogValues, renderCatalogResults, sortCatalog } from "./reference-library.js";
import { renderReaderHeading, renderReaderFooter } from "./reference-data.js";
import { createFeatCatalog, renderFeatBody, renderFeatTitle } from "./feat-library.js";

const title = text => text.charAt(0).toUpperCase() + text.slice(1);
const common = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", sortKeys: ["name", "category", "source"],
  sort: sortCatalog, renderResults: (records, selectedId, _library, config) => renderCatalogResults(records, selectedId, config),
};

function createCharacterCatalog(payload, config) {
  const catalog = createCatalog(payload, config);
  for (const record of catalog.records) {
    if (record.source !== "PC1") throw new Error(`Only PC1 character options are supported: ${record.name}`);
    record.skills = (record.entry.skills || []).map(title);
  }
  if (config.dependencies?.feats) {
    catalog.featLibrary = createFeatCatalog(config.dependencies.feats);
    catalog.featsByArchetype = new Map(catalog.records.map(record => [record.id, (record.entry.feats || []).map(id => {
      const feat = catalog.featLibrary.get(id);
      if (!feat) throw new Error(`Missing archetype feat: ${id}`);
      return feat;
    }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))]));
  }
  return catalog;
}

export function renderCharacterFeatCards(feats, library, rules) {
  return feats.map(feat => `<details class="character-feat"><summary><strong>${renderFeatTitle(feat, { showQualifier: false })}</strong><span>Feat ${feat.level}</span>${renderIcon("chevron-down")}</summary><div class="rich-content">${renderFeatBody(feat, library, rules, { showHeading: false })}</div></details>`).join("");
}

function renderCharacterDetail(record, library, rules, config) {
  const options = { source: record.source, resolveRule: rules?.registry.resolve, anchorPrefix: `${config.kind}-section` };
  const [introduction, ...entries] = record.entry.entries;
  const image = safeHref(record.entry.image);
  let overview = "";
  let body;
  if (image && introduction?.type === "flavor") {
    const flavor = renderContent({ entries: [introduction] }, { ...options, anchorPrefix: `${options.anchorPrefix}-intro` }).html;
    const art = renderContent({ entries: [{ type: "image", href: image, alt: `${record.name} archetype illustration` }] }).html;
    overview = `<div class="reader-overview reader-overview--illustrated"><div class="rich-content reader-introduction">${flavor}</div><div class="reader-portrait">${art}</div></div>`;
    body = renderContent({ entries }, options).html;
  } else {
    body = renderContent({ entries: record.entry.entries }, options).html;
  }
  const feats = library.featsByArchetype?.get(record.id);
  const featList = feats ? `<section class="character-feats"><h2>Archetype Feats</h2>${renderCharacterFeatCards(feats, library.featLibrary, rules)}</section>` : "";
  return `${renderReaderHeading(record, { kind: config.singular })}${overview}<article class="rich-content rule-page-content">${body}</article>${featList}${renderReaderFooter(record)}`;
}

function backgroundMatches(record, filters, omit) {
  if (!catalogMatchesFilters(record, filters, omit)) return false;
  if (omit === "skill") return true;
  const skills = [...filters.skill];
  if (skills.some(([value, state]) => state === -1 && record.skills.includes(value))) return false;
  return !skills.some(([, state]) => state === 1) || skills.some(([value, state]) => state === 1 && record.skills.includes(value));
}

export const BACKGROUND_BROWSER_DEFINITION = {
  ...common, create: createCharacterCatalog,
  filters: [{ key: "category", label: "Attributes" }, { key: "skill", label: "Skills" }],
  options: library => ({ ...catalogOptions(library), skill: [...new Set(library.records.flatMap(record => record.skills))].sort().map(value => ({ value, label: value })) }),
  values: (record, key) => key === "skill" ? record.skills : catalogValues(record, key),
  matches: backgroundMatches,
  renderDetail: renderCharacterDetail,
};

export const ARCHETYPE_BROWSER_DEFINITION = {
  ...common, create: createCharacterCatalog, filters: [], showCategory: false, sortKeys: ["name", "source"],
  options: catalogOptions, values: catalogValues, matches: catalogMatchesFilters,
  renderDetail: renderCharacterDetail,
};
