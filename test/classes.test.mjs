import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createClassCatalog, createClassOverviewCatalog, classMatches, classOptions, mountClassReader, renderClassDetail, renderClassResults, sortClasses } from "../js/class-reader.js";
import { renderInline } from "../js/content-renderer.js";
import { createFeatCatalog, renderFeatBody } from "../js/feat-library.js";
import { renderCatalogPreview } from "../js/reference-previews.js";

const data = JSON.parse(await readFile(new URL("../data/classes.json", import.meta.url), "utf8"));
const featData = JSON.parse(await readFile(new URL("../data/feats.json", import.meta.url), "utf8"));
const featLibrary = createFeatCatalog(featData);
const catalog = createClassCatalog(data, { featLibrary });

function environment(query = "") {
  class Element {
    dataset = {}; attributes = new Map(); handlers = new Map(); parts = new Map(); innerHTML = ""; value = "";
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(type, handler) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(handler); }
    removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
    matches(selector) {
      const attribute = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1];
      return attribute ? Object.hasOwn(this.dataset, attribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())) : false;
    }
    closest(selector) { return this.matches(selector) ? this : null; }
    querySelector(selector) {
      const tab = /^\[data-class-tab="([^"]+)"\]$/.exec(selector)?.[1];
      if (tab) return tabs.find(element => element.dataset.classTab === tab);
      if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector);
    }
    querySelectorAll() { return tabs; }
    scrollIntoView() { this.scrolled = true; }
    focus() { this.focused = true; }
    emit(type, target = this, extra = {}) {
      const event = { target, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const handler of this.handlers.get(type) || []) handler(event);
      return event;
    }
  }
  const tabs = ["overview", "features", "options", "feats"].map(name => { const el = new Element(); el.dataset.classTab = name; return el; });
  const root = new Element(), panel = root.querySelector("#class-panel");
  const window = { location: new URL(`http://localhost/classes.html${query}`), history: {} };
  for (const method of ["pushState", "replaceState"]) window.history[method] = (_state, _title, href) => { window.location = new URL(href, window.location); };
  const clickTab = name => root.emit("click", tabs.find(tab => tab.dataset.classTab === name));
  return { root, panel, window, clickTab, tabs, Element };
}

test("classes contain exactly the eight PC1 classes and their PC1 features, options and feats", () => {
  assert.deepEqual(catalog.records.map(record => record.name), ["Bard", "Cleric", "Druid", "Fighter", "Ranger", "Rogue", "Witch", "Wizard"]);
  assert.equal(catalog.records.reduce((count, record) => count + record.entry.features.length, 0), 199);
  assert.equal(catalog.records.reduce((count, record) => count + record.entry.subclasses.length, 0), 36);
  assert.equal(catalog.feats.length, 517);
  assert.equal(data.feats, undefined, "class data must not duplicate the shared feat collection");
  assert.equal(new Set(catalog.feats.map(feat => feat.id)).size, catalog.feats.length);
  const walk = value => {
    if (!value || typeof value !== "object") return;
    if (value.source) assert.equal(value.source, "PC1");
    assert.notEqual(value.type, "data", "embedded abilities must be expanded");
    assert.notEqual(value.type, "successDegree", "outcomes must be converted to supported lists");
    if (value.type === "table") assert.ok(value.colLabels?.length);
    Object.values(value).forEach(walk);
  };
  walk(data);
  for (const record of catalog.records) {
    assert.ok(catalog.featsByClass.get(record.id).length > 0);
    assert.ok(catalog.featsByClass.get(record.id).every(feat => feat.traits.includes(record.name.toLowerCase())));
    for (const feat of catalog.featsByClass.get(record.id)) assert.equal(feat, featLibrary.get(feat.id), "class tabs must use shared feat records");
  }
});

test("class filters match alternative key attributes, exclusions and hit points", () => {
  const filters = { keyAbility: new Map([["Dexterity", 1]]), hp: new Map([["10", 1]]) };
  assert.deepEqual(catalog.records.filter(record => classMatches(record, filters)).map(record => record.name), ["Fighter", "Ranger"]);
  filters.keyAbility.set("Strength", -1);
  assert.equal(catalog.records.filter(record => classMatches(record, filters)).length, 0);
  assert.deepEqual(classOptions(catalog).hp.map(option => option.value), ["6", "8", "10"]);
  assert.equal(sortClasses(catalog.records, "hp", "desc")[0].name, "Fighter");
  assert.equal(catalog.registry.resolve("wizard", "PC1").target.href, "classes.html?id=PC1%3Awizard");
  assert.match(renderInline("{@class Wizard|PC1}"), /classes.html\?class=Wizard&amp;source=PC1/);
});

test("every PC1 class has a concise overview preview without loading feat data", () => {
  const overviews = createClassOverviewCatalog(data);
  assert.equal(overviews.featLibrary, undefined);
  for (const record of overviews.records) {
    const html = renderCatalogPreview(record.name, "PC1", overviews, { singular: "class", plural: "Classes" });
    assert.equal((html.match(/<h2\b/g) || []).length, 1);
    assert.match(html, /id="rule-preview-title"/);
    assert.ok(html.includes(record.entry.summary));
    assert.ok(html.includes(record.keyAbility));
    assert.ok(html.includes(`${record.hp} + Constitution per level`));
    assert.ok(html.includes(record.entry.image));
    assert.match(renderClassDetail(record), /Player Core/);
    assert.match(html, /loading="lazy"/);
    assert.doesNotMatch(html, /class-tabs|class-feat|\[object Object\]|undefined/);
  }
  assert.match(renderClassResults(overviews.records), /data-select-catalog="PC1:wizard"/);
  assert.match(renderCatalogPreview("Invented", "PC1", overviews, { singular: "class", plural: "Classes" }), /No matching class/);
});

test("class tabs render proficiencies, twenty levels, embedded actions and independent wizard options", () => {
  const record = catalog.get("PC1:wizard"), ui = environment("?id=PC1%3Awizard");
  assert.match(renderClassDetail(record), /role="tablist"/);
  const reader = mountClassReader(record, ui.root, { library: catalog, window: ui.window });
  assert.match(ui.panel.innerHTML, /<dt>Perception<\/dt>/);
  assert.doesNotMatch(ui.panel.innerHTML, /Initial Proficiencies/);
  assert.match(ui.panel.innerHTML, /src="img\/classes\/wizard.webp"/);
  assert.match(ui.panel.innerHTML, /data-image-viewer/);
  assert.match(ui.panel.innerHTML, /Trained.*Fortitude/);
  ui.clickTab("features");
  assert.equal((ui.panel.innerHTML.match(/<th scope="row">/g) || []).length, 20);
  assert.match(ui.panel.innerHTML, /data-class-jump-feature=/);
  ui.clickTab("features");
  const features = ui.panel.querySelector("#class-features-list").innerHTML;
  assert.match(features, /Drain Bonded Item/);
  assert.match(features, /data-symbol="f"/);
  assert.match(features, /Wizard Spells per Day/);
  assert.match(features, /<thead>/);
  ui.clickTab("options");
  assert.match(ui.panel.innerHTML, /class-option-group--separated/);
  assert.doesNotMatch(ui.panel.innerHTML, /<select/);
  const thesis = ui.panel.querySelector('[data-class-options-list="arcane-thesis"]').innerHTML;
  const schools = ui.panel.querySelector('[data-class-options-list="arcane-school"]').innerHTML;
  const ids = [...`${thesis}${schools}`.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids.filter((id, index) => ids.indexOf(id) !== index)));
  assert.match(schools, /School of Battle Magic/);
  assert.match(schools, /School of Civic Wizardry/);
  assert.match(ui.panel.querySelector('[data-class-options-list="arcane-thesis"]').innerHTML, /Spell Blending/);
  reader.destroy();
  assert.ok([...ui.root.handlers.values(), ...ui.panel.handlers.values()].every(handlers => handlers.size === 0));
});

test("class feat bodies render on expansion and searches and levels update only the results", () => {
  const record = catalog.get("PC1:fighter"), ui = environment("?id=PC1%3Afighter&tab=feats");
  mountClassReader(record, ui.root, { library: catalog, window: ui.window });
  const results = ui.panel.querySelector("#class-feat-results");
  assert.match(ui.panel.querySelector("#class-feat-count").textContent, /92 feats/);
  assert.doesNotMatch(results.innerHTML, /With a quick sprint/);
  const feat = catalog.featsByClass.get(record.id).find(feat => feat.name === "Sudden Charge");
  const details = new ui.Element(); details.dataset.classFeat = feat.id; details.open = true;
  ui.panel.emit("toggle", details);
  assert.match(details.querySelector(".class-feat-content").innerHTML, /With a quick sprint/);
  assert.match(results.innerHTML, /<strong>Sudden Charge .*data-symbol="2"/);
  assert.equal(details.querySelector(".class-feat-content").innerHTML.replace(/^[\s\S]*?(?=<section class="ability-block")/, ""), renderFeatBody(feat, featLibrary, null, { showHeading: false, anchorPrefix: `class-feat-${feat.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` }));
  assert.equal(ui.window.location.searchParams.get("feat"), feat.id);
  const toolbar = ui.panel.innerHTML;
  const input = new ui.Element(); input.dataset.classFeatSearch = ""; input.value = "sudden";
  ui.panel.emit("input", input);
  assert.equal(ui.panel.innerHTML, toolbar, "typing must not rebuild the focused search input");
  assert.match(results.innerHTML, /Sudden Charge/);
  assert.doesNotMatch(results.innerHTML, /Double Slice/);
  const level = new ui.Element(); level.dataset.classFeatLevel = ""; level.value = "20";
  ui.panel.emit("change", level);
  assert.match(results.innerHTML, /No matching feats/);
});

test("class reader restores a feat deep link, feature level and keyboard tab navigation", () => {
  const record = catalog.get("PC1:bard"), feat = catalog.featsByClass.get(record.id)[0];
  const ui = environment(`?id=PC1%3Abard&feat=${encodeURIComponent(feat.id)}`);
  const reader = mountClassReader(record, ui.root, { library: catalog, window: ui.window });
  assert.match(ui.panel.querySelector("#class-feat-results").innerHTML, / open>/);
  ui.root.emit("keydown", ui.tabs.at(-1), { key: "Home" });
  assert.equal(ui.tabs[0].focused, true);
  assert.match(ui.panel.innerHTML, /<dt>Perception<\/dt>/);
  assert.doesNotMatch(ui.panel.innerHTML, /Initial Proficiencies/);
  ui.window.location = new URL("http://localhost/classes.html?id=PC1%3Abard&tab=features&feature-level=19");
  reader.sync();
  assert.match(ui.panel.querySelector("#class-features-list").innerHTML, /Magnum Opus/);
  assert.doesNotMatch(ui.panel.querySelector("#class-features-list").innerHTML, /Ancestry and Background/);
});

test("every imported class feature, subclass and class feat renders without missing blocks or duplicate anchors", () => {
  for (const record of catalog.records) {
    const ui = environment(`?id=${encodeURIComponent(record.id)}`);
    mountClassReader(record, ui.root, { library: catalog, window: ui.window });
    ui.clickTab("features");
    const features = ui.panel.querySelector("#class-features-list").innerHTML;
    assert.doesNotMatch(features, /\[object Object\]|undefined|\{@|type="data"/);
    ui.clickTab("options");
    const options = [...new Set(record.entry.subclasses.map(option => option.type))].map(type => ui.panel.querySelector(`[data-class-options-list="${type.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}"]`).innerHTML).join("");
    const ids = [...options.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${record.name} options must have unique anchors`);
    assert.doesNotMatch(options, /\[object Object\]|undefined|\{@/);
    ui.clickTab("feats");
    for (const feat of catalog.featsByClass.get(record.id)) {
      const details = new ui.Element(); details.dataset.classFeat = feat.id; details.open = true;
      ui.panel.emit("toggle", details);
      const body = details.querySelector(".class-feat-content").innerHTML;
      assert.ok(body.length > 100, `${record.name}: ${feat.name} must have a description`);
      assert.doesNotMatch(body, /\[object Object\]|undefined|\{@/);
    }
  }
});
