import { escapeHtml, renderContent, renderInline } from "./content-renderer.js";
import { createReferenceCatalog, sortCatalog } from "./reference-library.js";
import { renderReaderHeading, renderReaderFooter, sourceTone } from "./reference-data.js";

const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const classes = new Set(["bard", "cleric", "druid", "fighter", "ranger", "rogue", "witch", "wizard"]);
const ancestries = new Set(["aiuvarin", "changeling", "dromaar", "dwarf", "elf", "gnome", "goblin", "halfling", "human", "leshy", "nephilim", "orc"]);
const typeTraits = new Set(["general", "skill", "archetype", ...classes]);
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const title = value => value.charAt(0).toUpperCase() + value.slice(1);
export const FEAT_FILTERS = [{ key: "level", label: "Levels" }, { key: "category", label: "Types" }, { key: "archetype", label: "Archetypes" }, { key: "trait", label: "Traits" }];

export function createFeatCatalog(payload, { dependencies = {} } = {}) {
  if (!Array.isArray(payload?.feats)) throw new Error("Feat data needs a feats array.");
  const feats = payload.feats.map(entry => {
    if (entry.source !== "PC1" || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 20 || !Array.isArray(entry.entries) || !Array.isArray(entry.traits) || entry.traits.some(trait => typeof trait !== "string")) throw new Error(`Invalid PC1 feat: ${entry.name}`);
    const traits = new Set(entry.traits);
    const owners = entry.traits.filter(trait => classes.has(trait)).map(title);
    const ancestryOwners = entry.traits.filter(trait => ancestries.has(trait)).map(title);
    const categories = [
      ...(traits.has("general") ? ["General"] : []), ...(traits.has("skill") ? ["Skill"] : []),
      ...(traits.has("archetype") ? ["Archetype"] : []), ...(owners.length ? ["Class"] : []), ...(ancestryOwners.length ? ["Ancestry"] : []),
    ];
    if (!categories.length) categories.push("General");
    return { ...entry, category: categories.join(" · "), categories, filterTraits: entry.traits.filter(trait => !typeTraits.has(trait.toLowerCase())), ancestryOwner: ancestryOwners.join(" / "),
      id: entry.id?.replace(/^PC1:/, "") || `${slug(entry.name)}-${slug(entry.add_hash || "feat")}-${entry.page}`,
      aliases: [...new Set([...(entry.aliases || []), ...[entry.add_hash, ...owners].filter(Boolean).map(owner => `${entry.name} (${owner})`)])],
    };
  });
  const catalog = createReferenceCatalog({ ...payload, feats }, {
    collection: "feats", href: "feats.html",
    decorate: entry => ({ level: entry.level, traits: entry.traits, filterTraits: entry.filterTraits, categories: entry.categories, archetypes: [...(entry.featType?.archetype || [])], ancestryOwner: entry.ancestryOwner, sourceTone: sourceTone(entry.source),
      qualifier: entry.add_hash || entry.traits.filter(trait => classes.has(trait)).map(title).join(" / "),
    }),
  });
  // Reuse the Archetypes page's membership, including historical feats without featType metadata.
  for (const archetype of dependencies.archetypes?.archetypes || []) for (const id of archetype.feats || []) {
    const feat = catalog.get(id);
    if (feat && feat.source === archetype.source && !feat.archetypes.includes(archetype.name)) feat.archetypes.push(archetype.name);
  }
  catalog.renderPreview = record => renderFeatPreview(record, catalog);
  return catalog;
}

export const featValues = (record, key) => key === "archetype" ? record.archetypes : ["trait", "category"].includes(key) ? record[key === "trait" ? "filterTraits" : "categories"] : [String(record[key])];
export const featOptions = library => Object.fromEntries(FEAT_FILTERS.map(({ key }) => [key,
  [...new Set(library.records.flatMap(record => featValues(record, key)))].sort(compare).map(value => ({ value, label: key === "trait" ? title(value) : value })),
]));
export const featMatches = (record, filters, omit = "") => FEAT_FILTERS.every(({ key }) => {
  if (key === omit) return true;
  const values = new Set(featValues(record, key)), states = [...filters[key]];
  return !states.some(([value, state]) => state === -1 && values.has(value))
    && (!states.some(([, state]) => state === 1) || states.some(([value, state]) => state === 1 && values.has(value)));
});

// A class-specific prerequisite can share its name with other classes' feats.
export function resolveRelatedFeat(library, traits, name, source) {
  const result = library.registry.resolve(name, source);
  if (result.status !== "ambiguous") return result;
  const owners = traits.filter(trait => classes.has(trait));
  const matches = result.matches.map(match => library.get(match.id)).filter(candidate => owners.some(owner => candidate.traits.includes(owner)));
  return matches.length === 1 ? { status: "found", target: matches[0] } : result;
}

export function renderFeatResults(records, selectedId) {
  if (!records.length) return '<div class="rules-empty"><h2>No matching feats</h2><p>Try another name or clear the filters.</p><button type="button" data-clear-catalog>Clear search and filters</button></div>';
  return `<ul class="rules-results">${records.map(record => `<li><a class="catalog-result feat-result" href="${escapeHtml(record.href)}" data-select-catalog="${escapeHtml(record.id)}"${record.id === selectedId ? ' aria-current="true"' : ""}><span class="feat-result-name"><strong class="rule-result-name">${escapeHtml(record.name)}</strong>${record.qualifier ? `<small class="feat-result-qualifier">${escapeHtml(record.qualifier)}</small>` : ""}${record.ancestryOwner && record.ancestryOwner !== record.qualifier ? `<small class="feat-result-qualifier">${escapeHtml(record.ancestryOwner)}</small>` : ""}</span><span class="catalog-result-category">${escapeHtml(record.category)}</span><span class="catalog-result-source">${record.level}</span><span class="feat-result-source source-color" data-source-tone="${record.sourceTone}">${escapeHtml(record.source)}</span></a></li>`).join("")}</ul>`;
}

// Both the standalone browser and class tabs render the very same record.
export function renderFeatBody(record, library, rules, { showHeading = true, ...options } = {}) {
  return renderContent({ entries: [{ ...record.entry, type: "ability", kind: "Feat", actions: featActions(record), heading: showHeading }] }, {
    source: record.source, anchorPrefix: `feat-${slug(record.id)}`, resolveRule: rules?.registry.resolve,
    resolveFeat: (name, source) => resolveRelatedFeat(library, record.traits, name, source), ...options,
  }).html;
}

function featActions(record) {
  const activity = record.entry.activity;
  return activity?.unit === "action" ? String(activity.number) : activity?.unit === "reaction" ? "r" : activity?.unit === "free" ? "f" : undefined;
}

export function renderFeatTitle(record, { showQualifier = true } = {}) {
  const actions = featActions(record);
  return `${escapeHtml(record.name)}${showQualifier && record.qualifier ? ` <small class="feat-heading-qualifier">(${escapeHtml(record.qualifier)})</small>` : ""}${actions ? ` ${renderInline(`{@as ${actions}}`)}` : ""}`;
}

export function renderFeatPreview(record, library) {
  return `<header class="rule-preview-heading"><h2 id="rule-preview-title">${renderFeatTitle(record, { showQualifier: false })}</h2><span>Feat ${record.level}</span></header><div class="rule-preview-body">${renderFeatBody(record, library, null, { showHeading: false, anchorPrefix: "feat-preview-section" })}</div>${renderReaderFooter(record)}`;
}

export function renderFeatDetail(record, library, rules) {
  return `${renderReaderHeading(record, { titleHtml: renderFeatTitle(record, { showQualifier: false }), kind: `Feat ${record.level}` })}<article class="rich-content rule-page-content">${renderFeatBody(record, library, rules, { showHeading: false })}</article>${renderReaderFooter(record)}`;
}

export const FEAT_BROWSER_DEFINITION = {
  prefix: "catalog", detailPrefix: "catalog", attribute: "catalog", filters: FEAT_FILTERS,
  sortKeys: ["name", "source", "category", "level"],
  create: createFeatCatalog, options: featOptions, matches: featMatches, values: featValues, sort: sortCatalog,
  renderResults: renderFeatResults, renderDetail: renderFeatDetail,
};
