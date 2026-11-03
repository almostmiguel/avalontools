import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createFeatCatalog, renderFeatDetail, renderFeatTitle, resolveRelatedFeat } from "../js/feat-library.js";
import { createClassCatalog, mountClassReader } from "../js/class-reader.js";
import { createAncestryCatalog } from "../js/ancestry-reader.js";
import { ARCHETYPE_BROWSER_DEFINITION as archetypes, BACKGROUND_BROWSER_DEFINITION as backgrounds } from "../js/character-library.js";
import { createSpellCatalog, renderSpellDetail } from "../js/spell-library.js";
import { createEquipmentCatalog, renderEquipmentDetail } from "../js/equipment-library.js";
import { createCompanionCatalog, COMPANION_BROWSER_DEFINITION } from "../js/creature-library.js";
import { createCatalog, createActionLibrary, renderActionDetail } from "../js/reference-library.js";
import { createRuleLibrary } from "../js/rule-library.js";
import { renderContent, renderInline } from "../js/content-renderer.js";
import { parsePC2Feat } from "../scripts/import-pc2.mjs";

const names = ["actions", "ancestries", "archetypes", "backgrounds", "classes", "companions", "equipment", "feats", "rules", "spells", "traits"];
const data = Object.fromEntries(await Promise.all(names.map(async name => [name, JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"))])));
const pc2 = records => records.filter(record => record.source === "PC2");
const feats = createFeatCatalog(data.feats, { dependencies: { archetypes: data.archetypes } });
const classes = createClassCatalog(data.classes, { featLibrary: feats });
const ancestries = createAncestryCatalog(data.ancestries, { dependencies: { feats: data.feats } });
const archetypeConfig = { ...archetypes, collection: "archetypes", href: "archetypes.html", kind: "archetype", dependencies: { feats: data.feats } };
const archetypeCatalog = archetypes.create(data.archetypes, archetypeConfig);

function clean(html, label) {
  assert.doesNotMatch(html, /\{@|\[object Object\]|undefined|PFS Note|Site Owner:|<script|nethys-search/, label);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, `Duplicate anchors: ${label}`);
}

test("PC2 covers the complete indexed catalogs, preserving separate PC1 identities", () => {
  for (const [name, expected] of Object.entries({ ancestries: 11, archetypes: 43, backgrounds: 24, classes: 8, companions: 7, equipment: 381, feats: 1002, spells: 158, traits: 33 })) {
    assert.equal(pc2(data[name][name]).length, expected, name);
    assert.equal(data[name].sources.filter(source => source.id === "PC2").length, 1);
  }
  assert.equal(pc2(data.companions.familiarAbilities).length, 18);
  assert.equal(feats.records.length, 1887);
  assert.equal(new Set(feats.records.map(record => record.id)).size, 1887);
  assert.equal(feats.registry.resolve("Sudden Charge", "PC1").target.id, "PC1:sudden-charge-feat-141");
  assert.equal(feats.registry.resolve("Sudden Charge", "PC2").target.sourceName, "Player Core 2");
  assert.notEqual(feats.registry.resolve("Sudden Charge", "PC1").target.id, feats.registry.resolve("Sudden Charge", "PC2").target.id);
});

test("every new standalone reader renders complete native content with a PC2 footer", () => {
  const config = { ...backgrounds, collection: "backgrounds", href: "backgrounds.html", kind: "background" };
  const catalogs = [
    [feats, renderFeatDetail], [createSpellCatalog(data.spells), renderSpellDetail],
    [createEquipmentCatalog(data.equipment), renderEquipmentDetail],
    [createCompanionCatalog(data.companions), COMPANION_BROWSER_DEFINITION.renderDetail],
    [archetypeCatalog, (record, library) => archetypes.renderDetail(record, library, null, archetypeConfig)],
    [backgrounds.create(data.backgrounds, config), (record, library) => backgrounds.renderDetail(record, library, null, config)],
    [createActionLibrary(data.actions), renderActionDetail],
  ];
  for (const [catalog, render] of catalogs) for (const record of pc2(catalog.records)) {
    const html = render(record, catalog);
    clean(html, record.name);
    assert.match(html, /<footer class="reader-footer">[\s\S]*Player Core 2[\s\S]*<\/footer>$/);
    assert.ok(record.entry.entries.length, record.name);
    assert.ok(record.page >= 1 && record.page <= 320, record.name);
  }
});

test("PC2 ancestries include 54 ordinary heritages and three complete versatile heritages", () => {
  const records = pc2(ancestries.records);
  assert.equal(records.filter(record => !record.entry.versatile).length, 8);
  assert.equal(records.reduce((count, record) => count + record.entry.heritages.length, 0), 54);
  assert.deepEqual(records.filter(record => record.entry.versatile).map(record => record.name), ["Dhampir", "Dragonblood", "Duskwalker"]);
  for (const record of records) {
    assert.ok(ancestries.featsByAncestry.get(record.id).length > 0, record.name);
    const html = renderContent({ entries: [...record.entry.entries, ...record.entry.features.flatMap(feature => feature.entries), ...record.entry.heritages.flatMap(heritage => heritage.entries)] }).html;
    clean(html, record.name);
    assert.doesNotMatch(html, /Ancestry Page|<strong>Source<\/strong>/);
  }
  const catfolk = ancestries.get("PC2:catfolk");
  assert.equal(catfolk.entry.hp, 8);
  assert.equal(catfolk.entry.speed, "25 feet");
  assert.ok(catfolk.entry.heritages.some(heritage => heritage.name === "Nine Lives Catfolk"));
});

test("PC2 class readers retain advancement, proficiencies, all 45 options, and shared feat identities", () => {
  assert.deepEqual(pc2(classes.records).map(record => record.name), ["Alchemist", "Barbarian", "Champion", "Investigator", "Monk", "Oracle", "Sorcerer", "Swashbuckler"]);
  assert.equal(pc2(classes.records).reduce((count, record) => count + record.entry.subclasses.length, 0), 45);
  for (const record of pc2(classes.records)) {
    assert.ok(record.entry.summary.length > 15);
    assert.ok(record.entry.features.some(feature => feature.level === 19));
    assert.ok(record.entry.advancement.ancestryFeats.includes(17));
    assert.ok(classes.featsByClass.get(record.id).length > 20);
    for (const feat of classes.featsByClass.get(record.id)) { assert.equal(feat.source, "PC2"); assert.equal(feat, feats.get(feat.id)); }
    for (const feature of [...record.entry.features, ...record.entry.subclasses.flatMap(option => option.features)]) clean(renderContent({ entries: feature.entries }, { source: record.source }).html, `${record.name}: ${feature.name}`);
  }
  assert.equal(classes.get("PC2:barbarian").entry.hp, 12);
  assert.equal(classes.get("PC2:monk").entry.keyAbility, "Strength or Dexterity");
  assert.ok(classes.get("PC2:sorcerer").entry.subclasses.some(option => option.name === "Draconic"));
});

test("class overview, features and options tabs work for every PC2 class", () => {
  class Element {
    dataset = {}; innerHTML = ""; handlers = new Map(); parts = new Map();
    setAttribute() {} addEventListener(type, handler) { this.handlers.set(type, handler); } removeEventListener() {}
    querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
    querySelectorAll() { return []; }
    closest(selector) { return selector === "[data-class-tab]" && this.dataset.classTab ? this : null; }
  }
  for (const record of pc2(classes.records)) {
    const root = new Element(), panel = root.querySelector("#class-panel");
    const window = { location: new URL(`http://localhost/classes.html?id=${encodeURIComponent(record.id)}`), history: { pushState() {}, replaceState() {} } };
    const reader = mountClassReader(record, root, { library: classes, window });
    assert.match(panel.innerHTML, /class-proficiencies/); clean(panel.innerHTML, record.name);
    for (const tab of ["features", "options", "feats"]) {
      const target = new Element(); target.dataset.classTab = tab;
      root.handlers.get("click")({ target, preventDefault() {} });
      clean(panel.innerHTML, `${record.name} ${tab}`);
      if (tab === "features") assert.match(panel.innerHTML, /Advancement/);
    }
    reader.destroy();
  }
});

test("PC2 archetypes use shared feats and preserve additional feat levels", () => {
  for (const record of pc2(archetypeCatalog.records)) {
    const members = archetypeCatalog.featsByArchetype.get(record.id);
    assert.ok(members.some(feat => feat.name === `${record.name} Dedication`), record.name);
    assert.equal(new Set(members.map(feat => feat.id)).size, members.length);
    for (const feat of members) assert.equal(feat, archetypeCatalog.featLibrary.get(feat.id));
    for (const level of Object.values(record.entry.featLevels || {})) assert.ok(level >= 1 && level <= 20);
  }
});

test("PC2 snare rules and class actions are reachable", () => {
  const rules = createRuleLibrary(data.rules);
  const chapter = pc2(data.rules.rules).find(entry => entry.name === "Snares");
  assert.ok(chapter);
  for (const name of ["Crafting Snares", "Detecting Snares", "Triggering Snares", "Disabling Snares"]) {
    const entry = rules.registry.resolve(name, "PC2");
    assert.equal(entry.status, "found", name);
    clean(renderContent({ entries: entry.target.entry.entries || [entry.target.entry.entry] }).html, name);
  }
  const actions = createActionLibrary(data.actions);
  const devise = actions.registry.resolve("Devise a Stratagem", "PC2").target;
  assert.ok(devise.costKeys.has("free") && devise.costKeys.has("action-1"));
  assert.equal(actions.registry.resolve("Rage", "PC2").target.time.value, 1);
});

test("every internal PC2 cross-reference resolves in the combined catalogs", async () => {
  const catalogs = { feat: feats, class: classes, ancestry: ancestries, archetype: archetypeCatalog, spell: createSpellCatalog(data.spells), equipment: createEquipmentCatalog(data.equipment), companion: createCompanionCatalog(data.companions), action: createActionLibrary(data.actions), rule: createRuleLibrary(data.rules) };
  for (const [kind, name] of [["trait", "traits"], ["skill", "skills"], ["condition", "conditions"], ["background", "backgrounds"]]) {
    const payload = data[name] || JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
    catalogs[kind] = createCatalog(payload, { collection: name, href: `${name}.html` });
  }
  const issues = new Set(); let checked = 0;
  for (const catalog of Object.values(catalogs)) for (const record of pc2(catalog.records || catalog.rules)) {
    const entry = record.entry || record, options = { source: "PC2" };
    for (const [kind, target] of Object.entries(catalogs)) options[`resolve${kind.charAt(0).toUpperCase()}${kind.slice(1)}`] = (name, source) => {
      const result = kind === "feat" ? resolveRelatedFeat(target, entry.traits || [], name, source) : target.registry.resolve(name, source);
      checked++;
      if (result.status !== "found") issues.add(`${record.name}: ${kind} ${name}|${source} is ${result.status}`);
      return result;
    };
    const walk = value => {
      if (typeof value === "string" && value.includes("{@")) renderInline(value, options);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(entry);
  }
  assert.ok(checked > 4000);
  assert.deepEqual([...issues], []);
});

test("variable feat costs retain both action options and omit Nethys's unrelated appendices", () => {
  for (const name of ["Doctor's Visitation", "One-inch Punch", "To Battle!"]) {
    const feat = feats.registry.resolve(name, "PC2").target;
    assert.ok(feat, name); assert.equal(feat.entry.activity.options.length, 2);
    assert.equal((renderFeatTitle(feat).match(/class="action-symbol"/g) || []).length, 2);
    assert.match(renderFeatTitle(feat), / or /);
  }
  for (const feat of pc2(feats.records)) assert.doesNotMatch(JSON.stringify(feat.entry.entries), /Leads To\.\.\.|"name":"Traits"/);
});

test("feat imports verify PC2 citations and keep action costs, prerequisites and complete outcomes", () => {
  const html = '<h1 class="title">Test Feat <span class="action">[reaction]</span><span style="margin-left:auto">Feat 4</span></h1><span class="trait">Monk</span><b>Source</b> Player Core 2 pg. 119<br><b>Prerequisites</b> expert in Athletics<br><b>Trigger</b> An enemy moves.<br><hr>Complete effect.<br><b>Critical Success</b> Full outcome.<div class="clear"></div>Footer';
  const feat = parsePC2Feat(html, { name: "Test Feat", path: "Feats.aspx?ID=1" });
  assert.equal(feat.name, "Test Feat"); assert.equal(feat.level, 4); assert.equal(feat.page, 119);
  assert.equal(feat.activity.unit, "reaction"); assert.equal(feat.prerequisites, "expert in Athletics");
  assert.match(JSON.stringify(feat.entries), /Full outcome/); assert.doesNotMatch(JSON.stringify(feat), /Footer/);
  assert.throws(() => parsePC2Feat(html.replace("Player Core 2", "Core Rulebook"), { name: "Test Feat", path: "Feats.aspx?ID=1" }), /Missing PC2 citation/);
});
