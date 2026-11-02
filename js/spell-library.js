import { escapeHtml, renderContent, renderInline } from "./content-renderer.js";
import { createReferenceCatalog, sortCatalog } from "./reference-library.js";
import { renderReaderHeading, renderReaderFooter, sourceTone } from "./reference-data.js";

const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const title = value => value.charAt(0).toUpperCase() + value.slice(1);
const kinds = { spell: "Spell", cantrip: "Cantrip", focus: "Focus" };
export const SPELL_FILTERS = [
  { key: "level", label: "Ranks" }, { key: "tradition", label: "Traditions" },
  { key: "category", label: "Types" }, { key: "time", label: "Casting time" }, { key: "trait", label: "Traits" },
];

function castingKeys(cast) {
  const symbols = [...cast.matchAll(/\{@as ([123rf])\}/g)].map(match => match[1]);
  if (symbols.length) {
    if (symbols.length > 1 && /\bto\b/.test(cast)) return Array.from({ length: Number(symbols.at(-1)) - Number(symbols[0]) + 1 }, (_, index) => `action-${Number(symbols[0]) + index}`);
    return symbols.map(symbol => symbol === "r" ? "reaction" : symbol === "f" ? "free" : `action-${symbol}`);
  }
  return [cast.includes("minute") ? "minute" : cast.includes("hour") ? "hour" : "varies"];
}

export function createSpellCatalog(payload) {
  const catalog = createReferenceCatalog(payload, {
    collection: "spells", href: "spells.html",
    validate(entry) {
      if (!Number.isInteger(entry.level) || entry.level < 1 || entry.level > 10 || !Object.hasOwn(kinds, entry.spellType)
        || !Array.isArray(entry.entries) || !Array.isArray(entry.traits) || entry.traits.some(trait => typeof trait !== "string")
        || typeof entry.cast !== "string" || !entry.cast.trim()
        || (entry.traditions != null && (!Array.isArray(entry.traditions) || entry.traditions.some(value => !["arcane", "divine", "occult", "primal"].includes(value))))) throw new Error(`Invalid spell: ${entry.name}`);
    },
    decorate: entry => ({ level: entry.level, category: kinds[entry.spellType], categories: [kinds[entry.spellType]],
      traits: entry.traits, traditions: entry.traditions || [], costKeys: castingKeys(entry.cast),
    }),
  });
  catalog.renderPreview = record => renderSpellPreview(record, catalog);
  return catalog;
}

export const spellValues = (record, key) => key === "trait" ? record.traits : key === "tradition" ? record.traditions : key === "time" ? record.costKeys : [String(record[key])];
const timeLabels = { "action-1": "1 action", "action-2": "2 actions", "action-3": "3 actions", reaction: "Reaction", free: "Free action", minute: "Minutes", hour: "Hours", varies: "Varies" };
export const spellOptions = catalog => Object.fromEntries(SPELL_FILTERS.map(({ key }) => [key,
  [...new Set(catalog.records.flatMap(record => spellValues(record, key)))].sort(compare)
    .map(value => ({ value, label: key === "time" ? timeLabels[value] || value : ["trait", "tradition"].includes(key) ? title(value) : value })),
]));
export const spellMatchesFilters = (record, filters, omit = "") => SPELL_FILTERS.every(({ key }) => {
  if (key === omit || !filters[key]) return true;
  const states = filters[key], values = spellValues(record, key);
  return !values.some(value => states.get(value) === -1)
    && (![...states.values()].includes(1) || values.some(value => states.get(value) === 1));
});

function castingHtml(record) {
  return `<span class="action-time">${renderInline(record.entry.cast)}</span>`;
}

export function renderSpellBody(record, library, rules, { anchorPrefix = "spell-section" } = {}) {
  return renderContent({ entries: [{ ...record.entry, type: "spell", heading: false }] }, {
    source: record.source, resolveSpell: library?.registry.resolve, resolveRule: rules?.registry.resolve, anchorPrefix,
  }).html;
}

export function renderSpellResults(records, selectedId) {
  if (!records.length) return '<div class="rules-empty"><h2>No matching spells</h2><p>Try another name or clear the filters.</p><button type="button" data-clear-catalog>Clear search and filters</button></div>';
  return `<ul class="rules-results">${records.map(record => `<li><a class="catalog-result" href="${escapeHtml(record.href)}" data-select-catalog="${escapeHtml(record.id)}"${record.id === selectedId ? ' aria-current="true"' : ""}><strong class="rule-result-name">${escapeHtml(record.name)}</strong><span class="catalog-result-category">${record.category}</span><span class="catalog-result-level">${record.level}</span><span class="catalog-result-source source-color" data-source-tone="${sourceTone(record.sourceId)}" title="${escapeHtml(record.sourceName)}, page ${record.page}">${escapeHtml(record.source)}</span></a></li>`).join("")}</ul>`;
}

export function renderSpellDetail(record, library, rules) {
  return `${renderReaderHeading(record, { titleHtml: `${escapeHtml(record.name)} ${castingHtml(record)}`, kind: `${record.category} ${record.level}` })}<article class="rich-content rule-page-content">${renderSpellBody(record, library, rules)}</article>${renderReaderFooter(record)}`;
}

export function renderSpellPreview(record, library) {
  return `<header class="rule-preview-heading"><h2 id="rule-preview-title">${escapeHtml(record.name)} ${castingHtml(record)}</h2><span>${record.category} ${record.level}</span></header><div class="rule-preview-body">${renderSpellBody(record, library, null, { anchorPrefix: "spell-preview-section" })}</div>${renderReaderFooter(record)}`;
}

export const SPELL_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters: SPELL_FILTERS,
  sortKeys: ["name", "category", "level", "source"], create: createSpellCatalog,
  values: spellValues, options: spellOptions, matches: spellMatchesFilters, sort: sortCatalog,
  renderResults: renderSpellResults, renderDetail: renderSpellDetail,
};
