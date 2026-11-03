import { escapeHtml, renderContent, renderInline, renderTraitBadge } from "./content-renderer.js";
import { createReferenceCatalog, encounterValues, encounterMatchesFilters, sortCatalog, renderCatalogResults } from "./reference-library.js";
import { renderReaderHeading, renderReaderFooter } from "./reference-data.js";

const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
export const CREATURE_FILTERS = [{ key: "source", label: "Sources" }, { key: "category", label: "Types" }, { key: "level", label: "Levels" }, { key: "size", label: "Sizes" }, { key: "rarity", label: "Rarity" }, { key: "family", label: "Families" }, { key: "trait", label: "Traits" }];

export function createCreatureCatalog(payload) {
  const families = new Map((payload.families || []).map(family => [family.id, family]));
  const catalog = createReferenceCatalog({ ...payload, creatures: [...payload.creatures, ...(payload.abilities || [])] }, {
    collection: "creatures", href: "creatures.html",
    validate(entry) {
      if (entry.kind === "ability") {
        if (!Array.isArray(entry.entries) || !entry.entries.length) throw new Error(`Invalid creature ability: ${entry.name}`);
        return;
      }
      if (!Number.isInteger(entry.level) || entry.level < -1 || !Array.isArray(entry.entries) || !entry.entries.length || !Array.isArray(entry.traits)
        || entry.traits.some(trait => typeof trait !== "string") || typeof entry.size !== "string" || typeof entry.rarity !== "string") throw new Error(`Invalid creature: ${entry.name}`);
    },
    decorate: entry => ({ kind: entry.kind || "creature", abilityType: entry.kind === "ability" ? entry.category : "", level: entry.level ?? null, traits: entry.traits || [], size: entry.size || "", rarity: entry.rarity || "", family: entry.family || "", familyRules: families.get(entry.familyId) }),
  });
  catalog.renderPreview = record => renderCreaturePreview(record, catalog);
  return catalog;
}

export const creatureOptions = catalog => Object.fromEntries(CREATURE_FILTERS.map(({ key }) => [key,
  [...new Set(catalog.records.flatMap(record => encounterValues(record, key)))].filter(Boolean).sort(compare).map(value => ({ value, label: key === "trait" ? value.charAt(0).toUpperCase() + value.slice(1) : value })),
]));

export function renderCreatureBody(record, library, rules, { anchorPrefix = "creature-section" } = {}) {
  const options = { source: record.source, resolveCreature: library?.registry.resolve, resolveCreatureAbility: library?.registry.resolve, resolveRule: rules?.registry.resolve, anchorPrefix };
  if (record.kind === "ability") return renderContent({ entries: record.entry.entries }, options).html;
  const description = record.entry.description?.length ? `<div class="creature-description">${renderContent({ entries: record.entry.description }, { ...options, anchorPrefix: `${anchorPrefix}-description` }).html}</div>` : "";
  const family = record.familyRules;
  const familyBody = family ? renderContent({ entries: family.entries }, { ...options, source: family.source, anchorPrefix: `${anchorPrefix}-family` }).html : "";
  const lore = description || familyBody ? `<details class="creature-family"><summary>${escapeHtml(family?.name || record.name)} rules and lore</summary>${description}${familyBody}</details>` : "";
  return `${renderCreatureTraits(record)}<div class="creature-statblock">${renderContent({ entries: record.entry.entries }, options).html}</div>${lore}`;
}

function renderCreatureTraits(record) {
  const rarity = trait => ["uncommon", "rare", "unique"].includes(trait.toLowerCase());
  return `<div class="creature-traits ability-traits" role="list" aria-label="Traits">${record.traits.filter(rarity).map(trait => renderTraitBadge(trait)).join("")}<span class="ability-trait creature-size" role="listitem" data-trait-badge="size">${escapeHtml(record.size)}</span>${record.traits.filter(trait => !rarity(trait)).map(trait => renderTraitBadge(trait)).join("")}</div>`;
}

export function renderCreatureDetail(record, library, rules) {
  return `${renderReaderHeading(record, { kind: record.kind === "ability" ? "Creature Ability" : `Creature ${record.level}`, titleHtml: creatureTitle(record) })}<article class="rich-content rule-page-content">${renderCreatureBody(record, library, rules)}</article>${renderReaderFooter(record)}`;
}
export function renderCreaturePreview(record, library) {
  return `<header class="rule-preview-heading"><h2 id="rule-preview-title">${creatureTitle(record)}</h2><span>${record.kind === "ability" ? "Creature Ability" : `Creature ${record.level}`}</span></header><div class="rule-preview-body">${renderCreatureBody(record, library, null, { anchorPrefix: "creature-preview-section" })}</div>${renderReaderFooter(record)}`;
}
const creatureTitle = record => escapeHtml(record.name) + (record.entry.actions ? ` ${renderInline(`{@as ${record.entry.actions}}`)}` : "");

export const CREATURE_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters: [...CREATURE_FILTERS, { key: "abilityType", label: "Ability types" }],
  referenceKinds: ["creature", "creatureability"],
  lists: [
    { id: "creatures", label: "Creatures", singular: "Creature", filterKeys: CREATURE_FILTERS.map(filter => filter.key), matches: record => record.kind === "creature" },
    { id: "abilities", label: "Creature Abilities", singular: "Creature Ability", filterKeys: ["source", "abilityType"], sortKeys: ["name", "category", "source"], matches: record => record.kind === "ability" },
  ],
  sortKeys: ["name", "category", "level", "source"], create: createCreatureCatalog,
  options: library => ({ ...creatureOptions(library), category: [...new Set(library.records.filter(record => record.kind === "creature").map(record => record.category))].sort(compare).map(value => ({ value, label: value })), abilityType: [...new Set(library.records.filter(record => record.kind === "ability").map(record => record.category))].sort(compare).map(value => ({ value, label: value })) }),
  values: encounterValues, matches: encounterMatchesFilters, sort: sortCatalog,
  renderResults: (records, selectedId, _library, config) => renderCatalogResults(records, selectedId, { plural: config?.plural || "Creatures", showLevel: config?.singular !== "Creature Ability", showCategory: true }),
  renderDetail: renderCreatureDetail,
};

// Companions share creature formatting, trait facets and the reference browser.
// Their printed values are young-companion base statistics, not fixed levels.
export function createCompanionCatalog(payload) {
  const catalog = createReferenceCatalog({ ...payload, companions: [...payload.companions, ...(payload.familiarAbilities || [])] }, {
    collection: "companions", href: "companions.html",
    validate(entry) {
      if (["familiar", "specific-familiar"].includes(entry.kind)) {
        if (!Array.isArray(entry.entries) || !entry.entries.length || !(entry.kind === "specific-familiar" ? entry.category === "Specific Familiar" : ["Familiar", "Master"].includes(entry.category))) throw new Error(`Invalid familiar: ${entry.name}`);
      } else if (!Array.isArray(entry.entries) || !entry.entries.length || !Array.isArray(entry.traits) || entry.traits.some(trait => typeof trait !== "string")
        || typeof entry.size !== "string" || !entry.size.trim()) throw new Error(`Invalid companion: ${entry.name}`);
    },
    decorate: entry => ({ kind: entry.kind || "companion", abilityType: entry.kind === "familiar" ? entry.category : "", traits: entry.traits || [], size: entry.size || "" }),
  });
  catalog.companionRules = payload.rules;
  catalog.renderPreview = record => `<header class="rule-preview-heading"><h2 id="rule-preview-title">${escapeHtml(record.name)}</h2><span>${companionKind(record)}</span></header><div class="rule-preview-body">${renderCompanionBody(record, catalog, null, "companion-preview-section")}</div>${renderReaderFooter(record)}`;
  return catalog;
}

const companionKind = record => record.kind === "familiar" ? `${record.category} Ability` : record.kind === "specific-familiar" ? "Specific Familiar" : "Companion";

function renderCompanionBody(record, library, rules, anchorPrefix = "companion-section") {
  const options = { source: record.source, resolveCompanion: library?.registry.resolve, resolveRule: rules?.registry.resolve, anchorPrefix, headingOffset: -1 };
  if (["familiar", "specific-familiar"].includes(record.kind)) return renderContent({ entries: record.entry.entries }, options).html;
  const shared = library?.companionRules;
  const advancement = shared ? `<details class="creature-family"><summary>Companion rules and advancement</summary>${renderContent({ entries: shared.entries }, { ...options, anchorPrefix: `${anchorPrefix}-rules` }).html}</details>` : "";
  return `${renderCreatureTraits(record)}<div class="creature-statblock">${renderContent({ entries: record.entry.entries }, options).html}</div>${advancement}`;
}

export const COMPANION_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog",
  lists: [
    { id: "companions", label: "Companions", singular: "Companion", filterKeys: ["category", "size", "trait"], matches: record => record.kind === "companion" },
    { id: "familiar-abilities", label: "Familiar Abilities", singular: "Familiar Ability", filterKeys: ["abilityType"], matches: record => record.kind === "familiar" },
    { id: "specific-familiars", label: "Specific Familiars", singular: "Specific Familiar", filterKeys: ["trait"], matches: record => record.kind === "specific-familiar" },
  ],
  filters: [{ key: "category", label: "Types" }, { key: "size", label: "Sizes" }, { key: "trait", label: "Traits" }, { key: "abilityType", label: "Ability types" }],
  sortKeys: ["name", "category", "source"], create: createCompanionCatalog,
  options: library => ({ ...creatureOptions(library), category: [...new Set(library.records.filter(record => record.kind === "companion").map(record => record.category))].sort(compare).map(value => ({ value, label: value })), abilityType: ["Familiar", "Master"].map(value => ({ value, label: value })) }),
  values: encounterValues, matches: encounterMatchesFilters, sort: sortCatalog,
  renderResults: (records, selectedId, _library, config) => renderCatalogResults(records, selectedId, { plural: config?.plural || "Companions" }),
  renderDetail: (record, library, rules) => `${renderReaderHeading(record, { kind: companionKind(record) })}<article class="rich-content rule-page-content">${renderCompanionBody(record, library, rules)}</article>${renderReaderFooter(record)}`,
};
