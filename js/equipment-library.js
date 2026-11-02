import { escapeHtml, renderContent, renderInline, renderTraitBadges } from "./content-renderer.js";
import { createReferenceCatalog, sortCatalog } from "./reference-library.js";
import { renderReaderHeading, renderReaderFooter, sourceTone } from "./reference-data.js";

const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const title = value => value.charAt(0).toUpperCase() + value.slice(1);
export const EQUIPMENT_FILTERS = [
  { key: "category", label: "Types" }, { key: "subcategory", label: "Categories" }, { key: "level", label: "Levels" },
  { key: "price", label: "Price" }, { key: "group", label: "Groups" }, { key: "trait", label: "Traits" },
];

export function priceInCopper(value) {
  if (typeof value !== "string" || /(?:[–—-]|\bto\b)\s*\d/.test(value)) return null;
  const amounts = [...value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(cp|sp|gp|pp)\b/gi)];
  if (!amounts.length) return null;
  return Math.round(amounts.reduce((sum, [, number, coin]) => sum + Number(number.replaceAll(",", "")) * ({ cp: 1, sp: 10, gp: 100, pp: 1000 })[coin.toLowerCase()], 0));
}

function priceBand(value) {
  return value == null ? "Unpriced / varies" : value <= 100 ? "Up to 1 gp" : value <= 1000 ? "Over 1 to 10 gp" : value <= 5000 ? "Over 10 to 50 gp" : "Over 50 gp";
}

export function createEquipmentCatalog(payload) {
  const catalog = createReferenceCatalog(payload, {
    collection: "equipment", href: "equipment.html",
    validate(entry) {
      if (!Number.isInteger(entry.level) || entry.level < 0 || !Array.isArray(entry.entries) || !Array.isArray(entry.traits)
        || entry.traits.some(trait => typeof trait !== "string") || (entry.stats != null && (typeof entry.stats !== "object" || Array.isArray(entry.stats)))) throw new Error(`Invalid equipment: ${entry.name}`);
    },
    decorate: entry => ({ level: entry.level, traits: entry.traits, subcategory: entry.subcategory || "", group: entry.group || "", price: priceInCopper(entry.price), priceLabel: entry.price || "—" }),
  });
  catalog.renderPreview = record => renderEquipmentPreview(record, catalog);
  return catalog;
}

export const equipmentValues = (record, key) => key === "trait" ? record.traits : key === "price" ? [priceBand(record.price)] : record[key] == null || record[key] === "" ? [] : [String(record[key])];
export const equipmentOptions = catalog => Object.fromEntries(EQUIPMENT_FILTERS.map(({ key }) => [key,
  [...new Set(catalog.records.flatMap(record => equipmentValues(record, key)))].sort(compare).map(value => ({ value, label: key === "trait" ? title(value) : value })),
]));
export const equipmentMatchesFilters = (record, filters, omit = "") => EQUIPMENT_FILTERS.every(({ key }) => {
  if (key === omit || !filters[key]) return true;
  const states = filters[key], values = equipmentValues(record, key);
  return !values.some(value => states.get(value) === -1) && (![...states.values()].includes(1) || values.some(value => states.get(value) === 1));
});
export function sortEquipment(records, key = "name", order = "asc") {
  if (key !== "price") return sortCatalog(records, key, order);
  const direction = order === "desc" ? -1 : 1;
  return [...records].sort((a, b) => a.price == null && b.price != null ? 1 : b.price == null && a.price != null ? -1
    : direction * ((a.price ?? 0) - (b.price ?? 0)) || compare(a.name, b.name) || compare(a.id, b.id));
}

export function renderEquipmentBody(record, library, rules, { anchorPrefix = "equipment-section" } = {}) {
  const entry = record.entry;
  const options = { source: record.source, resolveEquipment: library?.registry.resolve, resolveRule: rules?.registry.resolve, anchorPrefix };
  const badges = renderTraitBadges(record.traits.map(trait => `{@trait ${trait}||${entry.traitLabels?.[trait] || title(trait)}}`));
  const fields = [["Price", entry.price], ["Bulk", entry.bulk], ["Hands", entry.hands], ["Usage", entry.usage], ["Category", entry.subcategory], ["Group", entry.group], ...Object.entries(entry.stats || {})]
    .filter(([, value]) => value != null && value !== "");
  const stats = fields.length ? `<dl class="equipment-fields">${fields.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${renderInline(value, options)}</dd></div>`).join("")}</dl>` : "";
  return `${badges}${stats}${renderContent({ entries: entry.entries }, options).html}`;
}

export function renderEquipmentResults(records, selectedId) {
  if (!records.length) return '<div class="rules-empty"><h2>No matching equipment</h2><p>Try another name or clear the filters.</p><button type="button" data-clear-catalog>Clear search and filters</button></div>';
  return `<ul class="rules-results">${records.map(record => `<li><a class="catalog-result equipment-result" href="${escapeHtml(record.href)}" data-select-catalog="${escapeHtml(record.id)}"${record.id === selectedId ? ' aria-current="true"' : ""}><strong class="rule-result-name">${escapeHtml(record.name)}</strong><span class="catalog-result-category">${escapeHtml(record.category)}</span><span class="catalog-result-level">${record.level}</span><span class="equipment-result-price" title="${escapeHtml(record.priceLabel)}">${escapeHtml(record.priceLabel)}</span><span class="catalog-result-source source-color" data-source-tone="${sourceTone(record.sourceId)}" title="${escapeHtml(record.sourceName)}, page ${record.page}">${escapeHtml(record.source)}</span></a></li>`).join("")}</ul>`;
}

export function renderEquipmentDetail(record, library, rules) {
  return `${renderReaderHeading(record, { kind: `Item ${record.level}` })}<article class="rich-content rule-page-content">${renderEquipmentBody(record, library, rules)}</article>${renderReaderFooter(record)}`;
}
export function renderEquipmentPreview(record, library) {
  return `<header class="rule-preview-heading"><h2 id="rule-preview-title">${escapeHtml(record.name)}</h2><span>Item ${record.level}</span></header><div class="rule-preview-body">${renderEquipmentBody(record, library, null, { anchorPrefix: "equipment-preview-section" })}</div>${renderReaderFooter(record)}`;
}

export const EQUIPMENT_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters: EQUIPMENT_FILTERS,
  sortKeys: ["name", "category", "level", "price", "source"], create: createEquipmentCatalog,
  options: equipmentOptions, values: equipmentValues, matches: equipmentMatchesFilters, sort: sortEquipment,
  renderResults: renderEquipmentResults, renderDetail: renderEquipmentDetail,
};
