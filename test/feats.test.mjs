import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createFeatCatalog, FEAT_FILTERS, featMatches, featOptions, renderFeatBody, renderFeatDetail, resolveRelatedFeat } from "../js/feat-library.js";
import { searchCatalog, sortCatalog } from "../js/reference-library.js";
import { renderInline } from "../js/content-renderer.js";
import { renderCatalogPreview } from "../js/reference-previews.js";

const data = JSON.parse(await readFile(new URL("../data/feats.json", import.meta.url), "utf8"));
const library = createFeatCatalog(data);

test("shared feats cover every PC1 category with unique stable identities", () => {
  assert.equal(library.records.length, 885);
  assert.equal(new Set(library.records.map(record => record.id)).size, 885);
  assert.ok(library.records.every(record => record.source === "PC1" && record.href.startsWith("feats.html?id=")));
  assert.deepEqual([...new Set(library.records.flatMap(record => record.categories))].sort(), ["Ancestry", "Archetype", "Class", "General", "Skill"]);
  assert.equal(library.registry.resolve("Sudden Charge", "PC1").target.id, "PC1:sudden-charge-feat-141");
  assert.equal(library.registry.resolve("Reach Spell", "PC1").status, "ambiguous");
  assert.equal(library.registry.resolve("Reach Spell (Wizard)", "PC1").target.qualifier, "Wizard");
  assert.equal(library.registry.resolve("Reach Spell (Cleric)", "PC1").target.qualifier, "Cleric");
  assert.equal(resolveRelatedFeat(library, ["wizard"], "Reach Spell", "PC1").target.qualifier, "Wizard");
  assert.equal(resolveRelatedFeat(library, [], "Reach Spell", "PC1").status, "ambiguous");
  assert.equal(resolveRelatedFeat(library, ["wizard"], "Reach Spell", "PC2").status, "missing");
  assert.match(renderInline("{@feat Toughness|PC1}"), /feats.html\?feat=Toughness&amp;source=PC1/);
});

test("feat search and combined level, type and trait filters select the right variants", () => {
  const filters = Object.fromEntries(FEAT_FILTERS.map(({ key }) => [key, new Map()]));
  filters.trait.set("dwarf", 1); filters.level.set("1", 1);
  const matches = library.records.filter(record => featMatches(record, filters));
  assert.ok(matches.length > 0);
  assert.ok(matches.every(record => record.level === 1 && record.traits.includes("dwarf")));
  filters.trait.set("spellshape", -1);
  assert.ok(library.records.filter(record => featMatches(record, filters)).every(record => !record.traits.includes("spellshape")));
  filters.category.set("Skill", 1);
  assert.equal(library.records.filter(record => featMatches(record, filters)).length, 0);
  assert.ok(library.records.some(record => featMatches(record, filters, "category")));
  assert.ok(searchCatalog(library, "Toughness").some(record => record.name === "Toughness"));
  assert.deepEqual(searchCatalog(library, "Reach Spell Wizard"), []);
  assert.ok(searchCatalog(library, "Reach Spell").some(record => record.qualifier === "Wizard"));
  assert.ok(searchCatalog(library, "Reach Spell").some(record => record.qualifier === "Cleric"));
  assert.deepEqual(featOptions(library).level.slice(0, 3).map(option => option.value), ["1", "2", "3"]);
  assert.equal(sortCatalog(library.records, "level", "desc")[0].level, 20);
});

test("familiar searches return only feat names and exclude descriptions, prerequisites and traits", () => {
  const matches = searchCatalog(library, "familiar");
  assert.ok(matches.length > 0);
  assert.ok(matches.every(record => record.name.toLowerCase().includes("familiar")));
  assert.deepEqual(searchCatalog(library, "FAMILIÁR").map(record => record.id), matches.map(record => record.id));
  const fixture = createFeatCatalog({ feats: [
    { name: "Familiar", source: "PC1", page: 1, level: 1, traits: ["witch"], entries: [] },
    { name: "Magic Training", source: "PC1", page: 2, level: 1, traits: ["wizard", "spellshape"], prerequisites: "You have a familiar", entries: ["Your familiar learns a new trick."] },
  ] });
  assert.deepEqual(searchCatalog(fixture, "familiar").map(record => record.name), ["Familiar"]);
  assert.deepEqual(searchCatalog(fixture, "wizard"), []);
  assert.deepEqual(searchCatalog(fixture, "spellshape"), []);
  assert.deepEqual(searchCatalog(fixture, "trick"), []);
});

test("archetype filters match the Archetypes page's full feat sets and combine with other filters", async () => {
  const archetypes = JSON.parse(await readFile(new URL("../data/archetypes.json", import.meta.url), "utf8"));
  const catalog = createFeatCatalog(data, { dependencies: { archetypes } });
  const filters = Object.fromEntries(FEAT_FILTERS.map(({ key }) => [key, new Map()]));
  assert.deepEqual(featOptions(catalog).archetype.map(option => option.value), archetypes.archetypes.map(entry => entry.name));
  for (const archetype of archetypes.archetypes) {
    filters.archetype = new Map([[archetype.name, 1]]);
    assert.deepEqual(catalog.records.filter(record => featMatches(record, filters)).map(record => record.id).sort(), archetype.feats.slice().sort());
  }
  filters.archetype = new Map([["Bard", 1]]);
  filters.level.set("4", 1);
  assert.ok(catalog.records.filter(record => featMatches(record, filters)).some(record => record.name === "Basic Muse's Whispers"));
  filters.level.clear();
  filters.archetype.set("Cleric", 1);
  filters.trait.set("dedication", 1);
  assert.deepEqual(catalog.records.filter(record => featMatches(record, filters)).map(record => record.name), ["Bard Dedication", "Cleric Dedication"]);
  filters.archetype.set("Cleric", -1);
  assert.deepEqual(catalog.records.filter(record => featMatches(record, filters)).map(record => record.name), ["Bard Dedication"]);
});

test("all feat descriptions render supported blocks, action costs and metadata", () => {
  for (const record of library.records) {
    const html = renderFeatDetail(record, library);
    assert.ok(html.length > 250, record.name);
    assert.doesNotMatch(html, /\[object Object\]|undefined|\{@|type="pf2-/, record.name);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, record.name);
    if (record.entry.prerequisites) assert.match(html, /<dt>Prerequisites<\/dt>/, record.name);
    if (record.entry.frequency) assert.match(html, /<dt>Frequency<\/dt>/, record.name);
    if (record.entry.special) assert.match(html, /<dt>Special<\/dt>/, record.name);
  }
  const charge = library.registry.resolve("Sudden Charge", "PC1").target;
  assert.match(renderFeatBody(charge, library), /data-symbol="2"/);
  const presence = library.registry.resolve("Heroic Presence", "PC1").target;
  assert.match(renderFeatBody(presence, library), /Once per day/);
  const defense = library.registry.resolve("Twinned Defense", "PC1").target;
  const parry = resolveRelatedFeat(library, defense.traits, "Twin Parry", "PC1").target;
  assert.ok(renderFeatBody(defense, library).includes(parry.href.replaceAll("&", "&amp;")), "prerequisites must point to the matching class's feat");
});

test("feat overviews show one title and level while retaining traits, source and rules", () => {
  const assurance = library.registry.resolve("Assurance", "PC1").target;
  const detail = renderFeatDetail(assurance, library);
  const preview = renderCatalogPreview("Assurance", "PC1", library, { plural: "Feats", singular: "feat" });
  for (const html of [detail, preview]) {
    assert.equal((html.match(/<h2\b[^>]*>Assurance<\/h2>/g) || []).length, 1);
    assert.equal((html.match(/Feat 1/g) || []).length, 1);
    assert.doesNotMatch(html, /class="ability-header"|action-preview-meta|catalog-category-label/);
    assert.match(html, /data-trait-name="fortune"/);
    assert.match(html, /data-trait-name="skill"/);
    assert.match(html, /Player Core/);
    assert.match(html, /<dt>Prerequisites<\/dt>/);
    assert.match(html, /<dt>Special<\/dt>/);
    assert.match(html, /Even in the worst circumstances/);
    assert.match(html, /ability-block--body/);
  }
  assert.match(preview, /id="rule-preview-title"/);
  assert.match(detail, /id="catalog-detail-title"/);
  const charge = library.registry.resolve("Sudden Charge", "PC1").target;
  assert.match(renderFeatDetail(charge, library), /<h2[^>]*>Sudden Charge .*data-symbol="2"/);
});
