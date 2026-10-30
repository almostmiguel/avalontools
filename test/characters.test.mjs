import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { ARCHETYPE_BROWSER_DEFINITION, BACKGROUND_BROWSER_DEFINITION } from "../js/character-library.js";
import { REFERENCE_TYPES } from "../js/reference-browser.js";
import { renderInline } from "../js/content-renderer.js";
import { renderCatalogPreview } from "../js/reference-previews.js";
import { ANCESTRY_BROWSER_DEFINITION, createAncestryCatalog, mountAncestryReader, renderAncestryDetail } from "../js/ancestry-reader.js";
import { renderContent } from "../js/content-renderer.js";

const read = async name => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
const [backgrounds, archetypes, feats] = await Promise.all([read("backgrounds"), read("archetypes"), read("feats")]);
const backgroundConfig = { ...REFERENCE_TYPES.backgrounds, ...BACKGROUND_BROWSER_DEFINITION };
const archetypeConfig = { ...REFERENCE_TYPES.archetypes, ...ARCHETYPE_BROWSER_DEFINITION, dependencies: { feats } };
const backgroundLibrary = backgroundConfig.create(backgrounds, backgroundConfig);
const archetypeLibrary = archetypeConfig.create(archetypes, archetypeConfig);
const ancestryData = await read("ancestries");
const ancestryLibrary = createAncestryCatalog(ancestryData, { dependencies: { feats } });

test("historical PC1 character options contain 40 backgrounds and all eight multiclass archetypes", () => {
  assert.equal(backgroundLibrary.records.length, 40);
  assert.deepEqual(archetypeLibrary.records.map(record => record.name), ["Bard", "Cleric", "Druid", "Fighter", "Ranger", "Rogue", "Witch", "Wizard"]);
  for (const library of [backgroundLibrary, archetypeLibrary]) {
    assert.equal(new Set(library.records.map(record => record.id)).size, library.records.length);
    assert.ok(library.records.every(record => record.source === "PC1" && Number.isInteger(record.page)));
  }
  assert.equal(backgroundLibrary.registry.resolve("Acolyte", "PC1").target.id, "PC1:acolyte");
});

test("PC1 ancestries include eight ancestries, four versatile heritages and all 45 English heritages", () => {
  assert.equal(ancestryLibrary.records.filter(record => !record.entry.versatile).length, 8);
  assert.equal(ancestryLibrary.records.filter(record => record.entry.versatile).length, 4);
  assert.equal(ancestryLibrary.records.reduce((count, record) => count + record.entry.heritages.length, 0), 45);
  assert.equal(ancestryLibrary.registry.resolve("Dwarf", "PC1").target.name, "Dwarf");
  assert.equal(ancestryLibrary.registry.resolve("Halfling", "PC1").target.name, "Halfling");
  assert.equal(ancestryLibrary.registry.resolve("Changeling", "PC1").target.name, "Changeling");
  for (const record of ancestryLibrary.records) {
    assert.equal(record.source, "PC1");
    assert.equal(record.entry.entries[0].type, "flavor");
    assert.equal(record.entry.referenceUrl, undefined);
    assert.equal(record.entry.aliases, undefined);
    if (!record.entry.versatile) {
      assert.ok(record.entry.hp > 0);
      assert.match(record.entry.speed, /^\d+ feet$/);
    }
    const entries = [...record.entry.entries, ...record.entry.features.flatMap(feature => feature.entries), ...record.entry.heritages.flatMap(heritage => heritage.entries)];
    const html = renderContent({ entries }).html;
    assert.doesNotMatch(html, /Você|Visão|Anão|BLOCK_\d|PFS Note|Site Owner|\[object Object\]|undefined|\{@/, record.name);
    assert.ok(ancestryLibrary.featsByAncestry.get(record.id).length > 0);
    assert.ok(ancestryLibrary.featsByAncestry.get(record.id).every(feat => feat === ancestryLibrary.featLibrary.get(feat.id)));
    assert.match(renderAncestryDetail(record), /reader-footer/);
    assert.match(renderCatalogPreview(record.name, "PC1", ancestryLibrary, { singular: "ancestry", plural: "Ancestries" }), /rule-preview-title/);
  }
  const dwarf = ancestryLibrary.get("PC1:dwarf");
  assert.deepEqual(dwarf.entry.boosts, ["Constitution", "Wisdom", "Free"]);
  assert.match(renderContent({ entries: dwarf.entry.heritages.find(heritage => heritage.name === "Ancient-Blooded Dwarf").entries }).html, /data-action-name="Call on Ancient Blood"/);
  const uncommon = ancestryLibrary.get("PC1:halfling").entry.heritages.find(heritage => heritage.name === "Jinxed Halfling");
  assert.ok(uncommon.traits.includes("uncommon"));
});

test("ancestry filters combine size, boosts and rarity, and links use the ancestry page", () => {
  const config = ANCESTRY_BROWSER_DEFINITION;
  const states = Object.fromEntries(config.filters.map(({ key }) => [key, new Map()]));
  states.size.set("Small", 1);
  states.boost.set("Wisdom", 1);
  assert.deepEqual(ancestryLibrary.records.filter(record => config.matches(record, states)).map(record => record.name), ["Halfling", "Leshy"]);
  states.boost.set("Constitution", -1);
  assert.deepEqual(ancestryLibrary.records.filter(record => config.matches(record, states)).map(record => record.name), ["Halfling"]);
  for (const statesForGroup of Object.values(states)) statesForGroup.clear();
  states.rarity.set("Uncommon", 1);
  assert.deepEqual(ancestryLibrary.records.filter(record => config.matches(record, states)).map(record => record.name), ["Changeling", "Nephilim"]);
  assert.match(renderInline("{@ancestry Elf|PC1}"), /href="ancestries.html\?ancestry=Elf&amp;source=PC1"/);
});

function ancestryEnvironment(query) {
  class Element {
    dataset = {}; handlers = new Map(); parts = new Map(); attributes = new Map(); innerHTML = "";
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    addEventListener(type, handler) { this.handlers.set(type, handler); }
    removeEventListener(type) { this.handlers.delete(type); }
    matches(selector) { return Object.hasOwn(this.dataset, selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())); }
    closest(selector) { return this.matches(selector) ? this : null; }
    querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
    querySelectorAll() { return buttons; }
    focus() { this.focused = true; }
    emit(type, target = this, extra = {}) { this.handlers.get(type)?.({ target, preventDefault() {}, ...extra }); }
  }
  const record = ancestryLibrary.get(new URL(`http://localhost/ancestries.html${query}`).searchParams.get("id"));
  const keys = record ? [...renderAncestryDetail(record).matchAll(/data-ancestry-tab="([^"]+)"/g)].map(match => match[1]) : ["overview", "heritages", "feats"];
  const buttons = keys.map(key => { const button = new Element(); button.dataset.ancestryTab = key; return button; });
  const root = new Element();
  const window = { location: new URL(`http://localhost/ancestries.html${query}`), history: {} };
  for (const method of ["pushState", "replaceState"]) window.history[method] = (_state, _title, href) => { window.location = new URL(href, window.location); };
  return { root, panel: root.querySelector("#ancestry-panel"), window, buttons, Element };
}

test("ancestry tabs restore URLs, render all heritages and share searchable feats without rebuilding the input", () => {
  const record = ancestryLibrary.get("PC1:dwarf"), ui = ancestryEnvironment("?id=PC1%3Adwarf");
  const reader = mountAncestryReader(record, ui.root, { library: ancestryLibrary, window: ui.window });
  assert.match(ui.panel.innerHTML, /Hit Points/);
  assert.match(ui.panel.innerHTML, /Darkvision/);
  assert.match(ui.panel.innerHTML, /<h3\b[^>]*data-heading-level="3">You Might\.\.\.<\/h3>/);
  assert.match(ui.panel.innerHTML, /<h3\b[^>]*data-heading-level="3">Others Probably\.\.\.<\/h3>/);
  assert.match(ui.panel.innerHTML, /Clan Dagger/);
  ui.root.emit("click", ui.buttons[1]);
  assert.equal(ui.window.location.searchParams.get("tab"), "heritages");
  assert.match(ui.panel.innerHTML, /<h2>Heritages<\/h2>/);
  assert.equal((ui.panel.innerHTML.match(/<details class="character-feat">/g) || []).length, 5);
  assert.match(ui.panel.innerHTML, /Ancient-Blooded Dwarf/);
  assert.match(ui.panel.innerHTML, /data-action-name="Call on Ancient Blood"/);
  ui.root.emit("click", ui.buttons[2]);
  const toolbar = ui.panel.innerHTML;
  assert.match(toolbar, /<h2>Ancestry Feats<\/h2>/);
  assert.match(ui.panel.querySelector("#ancestry-feat-results").innerHTML, /Dwarven Doughtiness/);
  const input = new ui.Element(); input.dataset.ancestryFeatSearch = ""; input.value = "doughtiness";
  ui.panel.emit("input", input);
  assert.equal(ui.panel.innerHTML, toolbar);
  assert.equal(ui.panel.querySelector("#ancestry-feat-count").textContent, "1 feat");
  assert.equal(ui.window.location.searchParams.get("feat-q"), "doughtiness");
  ui.window.location = new URL("http://localhost/ancestries.html?id=PC1%3Adwarf&tab=overview");
  reader.sync();
  assert.match(ui.panel.innerHTML, /Clan Dagger/);
  ui.root.emit("keydown", ui.buttons[0], { key: "End" });
  assert.equal(ui.window.location.searchParams.get("tab"), "feats");
  reader.destroy();
  assert.equal(ui.root.handlers.size, 0); assert.equal(ui.panel.handlers.size, 0);
  assert.doesNotMatch(renderAncestryDetail(ancestryLibrary.get("PC1:nephilim")), /data-ancestry-tab="heritages"/);
});

test("each ancestry lists its own heritages and offers a switch to the versatile list", () => {
  for (const record of ancestryLibrary.records.filter(record => !record.entry.versatile)) {
    const ui = ancestryEnvironment(`?id=${encodeURIComponent(record.id)}&tab=heritages`);
    const reader = mountAncestryReader(record, ui.root, { library: ancestryLibrary, window: ui.window });
    assert.equal((ui.panel.innerHTML.match(/<details class="character-feat">/g) || []).length, record.entry.heritages.length);
    assert.doesNotMatch(ui.panel.innerHTML, /data-heritage-group="versatile"|ancestry-heritage-overview/);
    assert.match(ui.panel.innerHTML, /You can also choose a versatile heritage/);
    assert.match(ui.panel.innerHTML, /data-catalog-list="versatile-heritages"/);
    reader.destroy();
  }
});

test("standalone versatile overviews retain culture and benefits without duplicate imported rules", () => {
  const record = ancestryLibrary.get("PC1:aiuvarin");
  const ui = ancestryEnvironment("?id=PC1%3Aaiuvarin");
  const reader = mountAncestryReader(record, ui.root, { library: ancestryLibrary, window: ui.window });
  assert.match(ui.panel.innerHTML, /Aiuvarin Heritage/);
  assert.match(ui.panel.innerHTML, /<h3\b[^>]*data-heading-level="3">You Might\.\.\.<\/h3>/);
  assert.match(ui.panel.innerHTML, /<h3\b[^>]*data-heading-level="3">Others Probably\.\.\.<\/h3>/);
  assert.equal((ui.panel.innerHTML.match(/You have elves, or possibly other aiuvarins, in your family tree\./g) || []).length, 1);
  assert.doesNotMatch(ui.panel.innerHTML, /Ancestry Page/);
  reader.destroy();
});

test("Changeling and Nephilim separate mutually exclusive lineage feats from their other feats", () => {
  for (const [name, expected] of [["Changeling", 4], ["Nephilim", 6]]) {
    const record = ancestryLibrary.registry.resolve(name, "PC1").target;
    const lineages = ancestryLibrary.featsByAncestry.get(record.id).filter(feat => feat.traits.includes("lineage"));
    const ui = ancestryEnvironment(`?id=${encodeURIComponent(record.id)}&tab=lineages`);
    const reader = mountAncestryReader(record, ui.root, { library: ancestryLibrary, window: ui.window });
    assert.equal(lineages.length, expected);
    assert.match(ui.panel.innerHTML, /<h2>Lineages<\/h2>/);
    assert.equal((ui.panel.innerHTML.match(/<details class="character-feat">/g) || []).length, expected);
    ui.root.emit("click", ui.buttons.find(button => button.dataset.ancestryTab === "feats"));
    assert.match(ui.panel.innerHTML, /<h2>Ancestry Feats<\/h2>/);
    const results = ui.panel.querySelector("#ancestry-feat-results").innerHTML;
    for (const lineage of lineages) assert.ok(!results.includes(`<summary><strong>${lineage.name}</strong>`));
    const count = Number(ui.panel.querySelector("#ancestry-feat-count").textContent.split(" ")[0]);
    assert.equal(count + expected, ancestryLibrary.featsByAncestry.get(record.id).length);
    reader.destroy();
  }
});

test("authored JSON omits aliases and reference URLs and heritage actions use the Actions catalog", async () => {
  const files = (await readdir(new URL("../data/", import.meta.url), { recursive: true })).filter(file => file.endsWith(".json"));
  const check = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!["aliases", "referenceurl"].includes(key.toLowerCase()), key);
      check(child);
    }
  };
  for (const file of files) check(JSON.parse(await readFile(new URL(`../data/${file}`, import.meta.url), "utf8")));
  const actions = (await read("actions")).actions;
  for (const ancestry of ancestryData.ancestries) for (const heritage of ancestry.heritages) {
    for (const entry of heritage.entries) if (entry && typeof entry === "object") {
      assert.notEqual(entry.type, "ability");
      assert.ok(!/\{@action|\{@as /.test(entry.name || ""));
    }
    for (const [, name] of JSON.stringify(heritage.entries).matchAll(/\{@action ([^}|]+)/g)) assert.ok(actions.some(action => action.name.toLowerCase() === name.toLowerCase()), name);
  }
});

test("background filters combine attribute choices and trained skills with inclusions and exclusions", () => {
  const filters = { category: new Map([["Wisdom", 1]]), skill: new Map([["Religion", 1]]) };
  const matches = backgroundLibrary.records.filter(record => backgroundConfig.matches(record, filters));
  assert.ok(matches.some(record => record.name === "Acolyte"));
  assert.ok(matches.every(record => record.categories.includes("Wisdom") && record.skills.includes("Religion")));
  filters.category.set("Intelligence", -1);
  assert.ok(!backgroundConfig.matches(backgroundLibrary.get("PC1:acolyte"), filters));
  assert.ok(backgroundConfig.matches(backgroundLibrary.get("PC1:acolyte"), filters, "category"));
  assert.ok(backgroundConfig.options(backgroundLibrary).skill.some(option => option.value === "Athletics"));
});

test("archetype readers use each of the 57 shared PC1 archetype feats exactly once", () => {
  const used = [...archetypeLibrary.featsByArchetype.values()].flat();
  const expected = archetypeLibrary.featLibrary.records.filter(record => record.traits.includes("archetype"));
  assert.equal(used.length, 57);
  assert.deepEqual(used.map(record => record.id).sort(), expected.map(record => record.id).sort());
  for (const feat of used) assert.equal(feat, archetypeLibrary.featLibrary.get(feat.id));
  assert.ok(archetypeLibrary.featsByArchetype.get("PC1:bard").some(feat => feat.name === "Basic Muse's Whispers"));
  const broken = { ...archetypes, archetypes: [{ ...archetypes.archetypes[0], feats: ["PC1:missing"] }] };
  assert.throws(() => archetypeConfig.create(broken, archetypeConfig), /Missing archetype feat/);
});

test("all character readers render native content, linked grants, unique anchors and source footers", () => {
  for (const [library, config] of [[backgroundLibrary, backgroundConfig], [archetypeLibrary, archetypeConfig]]) {
    for (const record of library.records) {
      const html = config.renderDetail(record, library, null, config);
      assert.doesNotMatch(html, /\{@|\[object Object\]|undefined|pf2-h/, record.name);
      assert.match(html, /<footer class="reader-footer">[\s\S]*Player Core[\s\S]*<\/footer>$/);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(ids).size, ids.length, record.name);
      if (config.kind === "archetype") {
        assert.match(html, /Archetype Feats/);
        assert.match(html, new RegExp(`${record.name} Dedication`));
        assert.match(html, /href="feats.html\?id=/);
      }
      const preview = renderCatalogPreview(record.name, "PC1", library, config);
      assert.match(preview, /reader-footer/);
    }
  }
  const acolyte = backgroundConfig.renderDetail(backgroundLibrary.get("PC1:acolyte"), backgroundLibrary, null, backgroundConfig);
  assert.match(acolyte, /data-skill-name="Religion"/);
  assert.match(acolyte, /data-feat-name="Student of the Canon"/);
  assert.match(renderInline("{@background Acolyte|PC1}"), /href="backgrounds.html\?background=Acolyte&amp;source=PC1"/);
  assert.match(renderInline("{@archetype Bard|PC1}"), /href="archetypes.html\?archetype=Bard&amp;source=PC1"/);
});
