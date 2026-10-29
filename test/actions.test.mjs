import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inlineText, renderContent, renderInline } from "../js/content-renderer.js";
import { ACTION_CATEGORIES, ACTION_TIMES, createActionLibrary, createCatalog, emptyActionFilters, emptyCatalogFilters, actionMatchesFilters, catalogMatchesFilters, catalogOptions, searchActions, searchCatalog, sortActions, actionTimeHtml, renderActionDetail, renderActionResults } from "../js/reference-library.js";
import { mountActions, mountReferenceBrowser, REFERENCE_TYPES, startActions, startReferenceBrowser } from "../js/reference-browser.js";
import { createFeatCatalog, FEAT_BROWSER_DEFINITION } from "../js/feat-library.js";
import { CLASS_BROWSER_DEFINITION } from "../js/class-reader.js";
import { ARCHETYPE_BROWSER_DEFINITION, BACKGROUND_BROWSER_DEFINITION } from "../js/character-library.js";
import { ANCESTRY_BROWSER_DEFINITION } from "../js/ancestry-reader.js";

const fixture = () => createActionLibrary({ sources: [{ id: "PC1", name: "Player Core" }], actions: [
  { name: "Stride", source: "PC1", page: 418, category: "basic", time: { unit: "action", value: 1 }, aliases: ["Walk"], entries: ["Move your Speed. See {@action Aid|PC1}."] },
  { name: "Aid", source: "PC1", category: "basic", time: { unit: "reaction" }, trigger: "An ally acts.", entries: ["Help an ally."] },
  { name: "Cast a Spell", source: "PC1", category: "general", time: { unit: "varies", options: ["action-1", "action-2", "action-3"] }, entries: ["Use the spell's casting time."] },
  { name: "Coerce", source: "PC1", category: "skill", skills: ["Intimidation"], time: { unit: "minute", value: 1, label: "At least 1 minute" }, entries: ["Threaten someone."] },
  { name: "Ancestry Ability", source: "PC1", category: "ancestry", ancestries: ["Dwarf"], time: { unit: "free" }, entries: ["An ancestral gift."] },
  { name: "Class Ability", source: "PC1", category: "class", classes: ["Fighter"], level: 2, time: { unit: "action", value: 2 }, entries: ["A class technique."] },
  { name: "Fly", source: "PC1", category: "specialty", time: { unit: "action", value: 1 }, entries: ["Fly using your fly Speed."] },
] });

test("action records generate ids, preserve sources and distinguish categories and variable costs", () => {
  const library = fixture();
  assert.equal(library.get("PC1:stride").sourceName, "Player Core");
  assert.equal(library.get("PC1:stride").page, 418);
  assert.equal(library.registry.resolve("Walk", "PC1").target.id, "PC1:stride");
  assert.equal(library.registry.resolve("Stride", "").target.href, "actions.html?id=PC1%3Astride");
  assert.equal(library.get("PC1:coerce").timeLabel, "At least 1 minute");
  const filters = emptyActionFilters();
  filters.time.set("action-1", 1);
  assert.deepEqual(library.actions.filter(action => actionMatchesFilters(action, filters)).map(action => action.name), ["Cast a Spell", "Fly", "Stride"]);
  filters.category.set("basic", 1);
  assert.deepEqual(library.actions.filter(action => actionMatchesFilters(action, filters)).map(action => action.name), ["Stride"]);
  filters.time.set("action-1", -1);
  assert.deepEqual(library.actions.filter(action => actionMatchesFilters(action, filters)).map(action => action.name), ["Aid"]);
  assert.equal(searchActions(library, "Speed").length, 0);
  assert.deepEqual(searchActions(library, "walk"), []);
});

test("action timing renders the actual glyphs and accepts rounds, minutes, hours and days", () => {
  const units = ["free", "reaction", "action", "varies", "round", "minute", "hour", "day"];
  const library = createActionLibrary({ actions: units.map(unit => ({ name: unit, category: "general", time: { unit, ...(unit === "action" ? { value: 3 } : {}) }, entries: [] })) });
  assert.match(actionTimeHtml(library.get("Avalon:free")), /data-symbol="f"/);
  assert.match(actionTimeHtml(library.get("Avalon:reaction")), /data-symbol="r"/);
  assert.match(actionTimeHtml(library.get("Avalon:action")), /data-symbol="3"/);
  for (const unit of ["round", "minute", "hour", "day"]) assert.ok(actionTimeHtml(library.get(`Avalon:${unit}`)).includes(ACTION_TIMES[unit]));
  const ascending = sortActions(library.actions, "time").map(action => action.timeKey);
  assert.deepEqual(ascending, ["free", "reaction", "action-3", "varies", "round", "minute", "hour", "day"]);
  assert.deepEqual(sortActions(library.actions, "time", "desc").map(action => action.timeKey), [...ascending].reverse());
});

test("action content shares formatting and citations, escapes authors' text and resolves action tags", () => {
  const library = fixture(), action = library.get("PC1:stride");
  const html = renderActionDetail(action, library);
  assert.match(html, /Player Core<\/span> · p\. 418/);
  assert.match(html, /href="actions.html\?id=PC1%3Aaid"/);
  assert.match(renderActionDetail(library.get("PC1:aid"), library), /<dt>Trigger<\/dt>/);
  assert.match(renderInline("{@action Stride|PC1|move}"), /href="actions.html\?action=Stride&amp;source=PC1"/);
  const unsafe = createActionLibrary({ actions: [{ name: '<script>Bad</script>', category: "class", classes: ['<img src=x>'], time: { unit: "varies", label: '<img src=x>' }, entries: ['<script>bad()</script>'] }] });
  const rendered = renderActionResults(unsafe.actions) + renderActionDetail(unsafe.actions[0], unsafe);
  assert.doesNotMatch(rendered, /<script>|<img /);
  assert.match(rendered, /&lt;script&gt;/);
});

test("only confirmed action references receive the marker used to show the action icon", () => {
  const resolveAction = fixture().registry.resolve;
  const found = renderInline("{@action Stride|PC1|move}", { resolveAction });
  assert.match(found, /data-action-resolved="true"/);
  assert.match(found, />move<\/span><\/a>/);
  assert.match(renderInline("{@action Walk}", { resolveAction }), /data-action-resolved="true"/);
  for (const tag of ["{@action Quick Draw|PC1}", "{@action Stride|GMC}"]) {
    const html = renderInline(tag, { resolveAction });
    assert.match(html, /rule-link-unresolved/);
    assert.doesNotMatch(html, /<a |data-action-resolved="true"/);
  }
  const unchecked = renderInline("{@action Stride|PC1}");
  assert.match(unchecked, /href="actions.html/);
  assert.doesNotMatch(unchecked, /data-action-resolved="true"/);
});

test("action symbols render accessibly and the bundled font provides each glyph", async () => {
  const labels = { "1": "One action", "2": "Two actions", "3": "Three actions", r: "Reaction", f: "Free action" };
  for (const [symbol, label] of Object.entries(labels)) {
    const html = renderInline(`{@as ${symbol}}`);
    assert.ok(html.includes(`data-symbol="${symbol}"`));
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.match(html, /role="img"/);
    assert.equal(renderInline(`{@actionsymbol ${symbol}}`), html);
    assert.equal(renderInline(`{@as ${symbol.toUpperCase()} }`), html);
  }
  assert.equal(renderInline("{@as unknown}"), "unknown");
  assert.equal(renderInline("{@code {@as 1}}"), "<code>{@as 1}</code>");
  assert.doesNotMatch(renderInline('{@as <script>bad</script>}'), /<script>/);
  assert.equal(inlineText("{@as 1} Single Actions").trim(), "Single Actions");
  const html = renderContent({ entries: [
    { type: "h4", name: "{@as 1} Single Actions", entries: ["Use {@as 2}, {@as 3}, {@as r}, or {@as f}."] },
  ] }).html;
  assert.equal((html.match(/class="action-symbol"/g) || []).length, 5);

  const font = await readFile(new URL("../fonts/Pathfinder2eActions.ttf", import.meta.url));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  const tables = new Map();
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const offset = 12 + index * 16;
    tables.set(font.toString("ascii", offset, offset + 4), font.readUInt32BE(offset + 8));
  }
  const cmap = tables.get("cmap");
  assert.ok(cmap);
  const glyphs = new Map();
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const record = cmap + 4 + index * 8;
    const offset = cmap + font.readUInt32BE(record + 4);
    if (font.readUInt16BE(offset) !== 4) continue;
    const count = font.readUInt16BE(offset + 6) / 2;
    const end = offset + 14, start = end + count * 2 + 2;
    const delta = start + count * 2, range = delta + count * 2;
    for (const symbol of "123rf") {
      const code = symbol.charCodeAt(0);
      for (let segment = 0; segment < count; segment++) {
        if (code < font.readUInt16BE(start + segment * 2) || code > font.readUInt16BE(end + segment * 2)) continue;
        const distance = font.readUInt16BE(range + segment * 2);
        let glyph = distance ? font.readUInt16BE(range + segment * 2 + distance + 2 * (code - font.readUInt16BE(start + segment * 2))) : code;
        if (!distance || glyph) glyph = (glyph + font.readInt16BE(delta + segment * 2)) & 0xffff;
        glyphs.set(symbol, glyph);
        break;
      }
    }
  }
  assert.equal(glyphs.size, 5);
  assert.ok([...glyphs.values()].every(glyph => glyph > 0));
  assert.equal(new Set(glyphs.values()).size, 5);
});

test("malformed action records report usable errors and name variants can pick a primary definition", () => {
  assert.throws(() => createActionLibrary({}), /actions.*array/);
  const entry = { name: "Example", category: "basic", time: { unit: "action", value: 1 }, entries: [] };
  assert.throws(() => createActionLibrary({ actions: [{ ...entry, category: "wrong" }] }), /unknown category/);
  assert.throws(() => createActionLibrary({ actions: [{ ...entry, classes: "Fighter" }] }), /array of strings for classes/);
  assert.throws(() => createActionLibrary({ actions: [{ ...entry, time: { unit: "action", value: 4 } }] }), /1, 2 or 3/);
  assert.throws(() => createActionLibrary({ actions: [{ ...entry, time: { unit: "hour", value: -1 } }] }), /positive time/);
  assert.throws(() => createActionLibrary({ actions: [{ ...entry, time: { unit: "invalid" } }] }), /valid time unit/);
  const variants = createActionLibrary({ actions: [{ ...entry, id: "first", primary: true }, { ...entry, id: "second" }] });
  assert.equal(variants.registry.resolve("Example", "Avalon").target.id, "Avalon:first");
  assert.equal(variants.registry.resolve("second", "Avalon").target.id, "Avalon:second");
});

test("catalogs create stable records, search names, filter inclusions and exclusions, and sort", () => {
  const catalog = createCatalog({
    sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }],
    conditions: [
      { name: "Blinded", source: "PC1", category: "Sense", entries: ["You cannot see."] },
      { name: "Dying", source: "GMC", category: "Health", entries: ["You are close to death."] },
      { name: "Drained", source: "PC1", category: "Health", aliases: ["Exhausted"], entries: ["Your vitality is reduced."] },
    ],
  }, { collection: "conditions", href: "conditions.html" });
  const filters = emptyCatalogFilters();
  assert.equal(catalog.get("PC1:blinded").href, "conditions.html?id=PC1%3Ablinded");
  assert.equal(catalog.registry.resolve("Blinded", "PC1").target.id, "PC1:blinded");
  assert.deepEqual(catalogOptions(catalog).category.map(option => option.value), ["Health", "Sense"]);
  assert.deepEqual(searchCatalog(catalog, "exhausted"), []);
  assert.deepEqual(searchCatalog(catalog, "drain").map(record => record.name), ["Drained"]);
  assert.deepEqual(searchCatalog(catalog, "health"), []);
  filters.category.set("Health", 1);
  assert.deepEqual(catalog.records.filter(record => catalogMatchesFilters(record, filters)).map(record => record.name), ["Drained", "Dying"]);
  filters.source.set("PC1", -1);
  assert.deepEqual(catalog.records.filter(record => catalogMatchesFilters(record, filters)).map(record => record.name), ["Dying"]);
});

test("catalogs reject missing collections, entries, and invalid categories", () => {
  assert.throws(() => createCatalog({}, { collection: "skills", href: "skills.html" }), /skills/);
  assert.throws(() => createCatalog({ skills: [{ name: "Acrobatics", entries: "not an array" }] }, { collection: "skills", href: "skills.html" }), /entries array/);
  assert.throws(() => createCatalog({ skills: [{ name: "Acrobatics", category: {}, entries: [] }] }, { collection: "skills", href: "skills.html" }), /text category/);
});

function environment(query = "", definition = REFERENCE_TYPES.actions) {
  const elements = new Map(), handlers = new Map(), history = [new URL(`http://localhost/avalon/actions.html${query}`)];
  let cursor = 0;
  const window = { location: new URL(history[0]), matchMedia: () => ({ matches: false }), addEventListener: (type, handler) => handlers.set(type, handler), history: {
    replaceState(_state, _title, href) { window.location = new URL(href, window.location); history[cursor] = new URL(window.location); },
    pushState(_state, _title, href) { window.location = new URL(href, window.location); history.splice(++cursor); history.push(new URL(window.location)); },
    back() { if (cursor) { window.location = new URL(history[--cursor]); handlers.get("popstate")?.(); } },
    forward() { if (cursor < history.length - 1) { window.location = new URL(history[++cursor]); handlers.get("popstate")?.(); } },
  } };
  class Element {
    constructor(selector = "") { this.selector = selector; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.value = ""; this.open = false; this.writes = 0; this.children = []; }
    set innerHTML(html) {
      this.html = html; this.writes++;
      if (this.selector === `#${definition.prefix}-lists`) this.children = [...html.matchAll(new RegExp(`data-${definition.attribute}-list="([^"]+)"`, "g"))].map(([, id]) => { const el = new Element(); el.dataset[`${definition.attribute}List`] = id; return el; });
      if (this.selector === `#${definition.prefix}-filter-groups`) this.children = [...html.matchAll(new RegExp(`data-${definition.attribute}-filter="([^"]+)" data-filter-value="([^"]+)"`, "g"))].map(([, group, value]) => { const el = new Element(); el.dataset = { [`${definition.attribute}Filter`]: group, filterValue: value }; return el; });
    }
    get innerHTML() { return this.html || ""; }
    querySelectorAll() {
      if (this.selector === `#${definition.prefix}-sort` && !this.children.length) this.children = ["name", ...definition.filters.map(({ key }) => key)].map(key => { const el = new Element(); el.dataset[`${definition.attribute}Sort`] = key; return el; });
      return this.children;
    }
    closest(selector) {
      const attribute = /^\[data-([a-z-]+)\]$/.exec(selector)?.[1];
      const field = attribute?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return field && this.dataset[field] != null ? this : null;
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? (key.startsWith("data-") ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : undefined); }
    removeAttribute(key) { this.attributes.delete(key); }
    contains(target) { return target === this || this.children.includes(target); }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolled = true; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type) { this.listeners.delete(type); }
    emit(type, extra = {}) { const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; this.listeners.get(type)?.(event); return event; }
  }
  window.removeEventListener = type => handlers.delete(type);
  const document = { title: "", querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element(selector)); return elements.get(selector); }, addEventListener: (type, handler) => handlers.set(`document:${type}`, handler), removeEventListener: type => handlers.delete(`document:${type}`) };
  const previewCalls = [];
  return { document, window, handlers, previewCalls, attachPreviews(options) { previewCalls.push(options); return { hide() {} }; }, get: selector => document.querySelector(selector), target(dataset) { const el = new Element(); el.dataset = dataset; return el; } };
}

test("entering Actions stays unselected through search and sorting and Back restores the empty reader", () => {
  const ui = environment(), controller = mountActions(fixture(), ui);
  assert.equal(controller.selectedId, null);
  assert.match(ui.get("#action-detail").innerHTML, /Choose an action/);
  assert.doesNotMatch(ui.get("#actions-results").innerHTML, /aria-current="true"/);
  assert.equal(ui.window.location.searchParams.has("id"), false);
  const sort = ui.get("#actions-sort").querySelectorAll().find(el => el.dataset.actionSort === "name");
  ui.get("#actions-sort").emit("click", { target: sort });
  assert.equal(controller.selectedId, null);
  ui.get("#actions-search").value = "no match";
  ui.get("#actions-search").emit("input");
  assert.match(ui.get("#action-detail").innerHTML, /No matching actions/);
  ui.get("#actions-clear").emit("click");
  assert.match(ui.get("#action-detail").innerHTML, /Choose an action/);
  assert.equal(controller.selectedId, null);
  controller.selectAction("PC1:stride");
  assert.match(ui.get("#action-detail").innerHTML, /Move your Speed/);
  ui.window.history.back();
  assert.equal(controller.selectedId, null);
  assert.match(ui.get("#action-detail").innerHTML, /Choose an action/);
  ui.window.history.forward();
  assert.equal(controller.selectedId, "PC1:stride");
});

test("actions select in place, preserve open content, restore history and retain native modified clicks", () => {
  const ui = environment("?action=Stride&source=PC1"), controller = mountActions(fixture(), ui);
  assert.equal(controller.selectedId, "PC1:stride");
  assert.equal(ui.previewCalls[0].actions.get("PC1:stride").name, "Stride");
  assert.match(ui.get("#action-detail").innerHTML, /Move your Speed/);
  assert.equal(ui.window.location.searchParams.get("id"), "PC1:stride");
  const writes = ui.get("#action-detail").writes;
  ui.get("#actions-include").emit("click");
  assert.equal(ui.get("#action-detail").writes, writes);
  const row = ui.target({ selectAction: "PC1:aid" });
  assert.equal(ui.get("#actions-results").emit("click", { target: row, ctrlKey: true }).defaultPrevented, false);
  assert.equal(controller.selectedId, "PC1:stride");
  assert.equal(ui.get("#actions-results").emit("click", { target: row }).defaultPrevented, true);
  assert.equal(controller.selectedId, "PC1:aid");
  ui.window.history.back(); assert.equal(controller.selectedId, "PC1:stride");
  ui.window.history.forward(); assert.equal(controller.selectedId, "PC1:aid");
});

test("action filters, exclusion mode, name search, sort and reference links work together", () => {
  const library = fixture(), ui = environment("?id=PC1%3Aaid"), controller = mountActions(library, ui);
  const category = ui.get("#actions-filter-groups").children.find(el => el.dataset.actionFilter === "category" && el.dataset.filterValue === "skill");
  ui.get("#actions-filter-groups").emit("click", { target: category });
  assert.equal(controller.selectedId, "PC1:coerce");
  assert.equal(ui.window.location.searchParams.get("category"), "skill");
  assert.match(ui.get("#actions-active-filters").innerHTML, /Skill/);
  const reference = ui.target({ actionName: "Stride", actionSource: "PC1" });
  const event = { target: reference, preventDefault() { this.defaultPrevented = true; } };
  ui.handlers.get("document:click")(event);
  assert.equal(event.defaultPrevented, true); assert.equal(controller.selectedId, "PC1:stride");
  assert.equal(ui.window.location.searchParams.has("category"), false);
  ui.get("#actions-search").value = "Threaten"; ui.get("#actions-search").emit("input");
  assert.equal(ui.get("#actions-count").textContent, "0 actions");
  ui.get("#actions-clear").emit("click");
  const name = ui.get("#actions-sort").querySelectorAll().find(el => el.dataset.actionSort === "name");
  ui.get("#actions-sort").emit("click", { target: name });
  assert.equal(ui.window.location.searchParams.get("order"), "desc");
  ui.get("#actions-exclude").emit("click");
  ui.get("#actions-filter-groups").emit("click", { target: category });
  assert.equal(ui.window.location.searchParams.get("not-category"), "skill");
  assert.doesNotMatch(ui.get("#actions-results").innerHTML, />Coerce</);
});

test("action filters restore from URLs and dismiss without changing selections", () => {
  const ui = environment("?category=skill&time=minute&sort=source&order=desc"), controller = mountActions(fixture(), ui);
  assert.equal(controller.selectedId, null);
  assert.match(ui.get("#action-detail").innerHTML, /Choose an action/);
  const menu = ui.get("#actions-filter-menu"); menu.open = true;
  ui.handlers.get("document:keydown")({ key: "Escape" });
  assert.equal(menu.open, false); assert.equal(ui.get("#actions-filter-summary").focused, true);
  menu.open = true; ui.handlers.get("document:pointerdown")({ target: {} }); assert.equal(menu.open, false);
  const missing = environment("?id=missing"); mountActions(fixture(), missing);
  assert.match(missing.get("#action-detail").innerHTML, /Action not found/);
});

test("Actions remains usable if optional rule-reference data is unavailable and reports action-data failures", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const data = { actions: [{ name: "Stride", category: "basic", time: { unit: "action", value: 1 }, entries: ["Move."] }] };
  globalThis.fetch = async path => ({ ok: path === "data/actions.json", status: 404, json: async () => data });
  const ui = environment("?action=Stride"); await startActions(ui);
  assert.match(ui.get("#action-detail").innerHTML, /Move\./);
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const failed = environment(); await startActions(failed);
  assert.match(failed.get("#main").innerHTML, /Unable to open actions/);
  assert.match(failed.get("#main").innerHTML, /HTTP 404/);
});

test("the shared browser handles condition and skill deep links, references and history", () => {
  for (const collection of ["conditions", "skills"]) {
    const config = REFERENCE_TYPES[collection], first = collection === "conditions" ? "Blinded" : "Acrobatics";
    const second = collection === "conditions" ? "Dying" : "Athletics";
    const catalog = createCatalog({ [collection]: [
      { name: first, source: "PC1", category: "First", entries: ["First description."] },
      { name: second, source: "PC1", category: "Second", entries: ["Second description."] },
    ] }, config);
    const ui = environment(`?${config.kind}=${first}&q=excluded&category=Second`, config);
    const browser = mountReferenceBrowser(catalog, { ...ui, config });
    assert.equal(browser.selectedId, `PC1:${first.toLowerCase()}`);
    assert.match(ui.get("#catalog-detail").innerHTML, /First description/);
    assert.equal(ui.get("#catalog-search").value, "");
    assert.equal(ui.window.location.searchParams.has(config.kind), false);
    assert.equal(ui.window.location.searchParams.has("category"), false);
    const ref = ui.target({ [`${config.kind}Name`]: second, [`${config.kind}Source`]: "PC1" });
    const click = { target: ref, preventDefault() { this.defaultPrevented = true; } };
    ui.handlers.get("document:click")(click);
    assert.equal(click.defaultPrevented, true);
    assert.match(ui.get("#catalog-detail").innerHTML, /Second description/);
    ui.window.history.back();
    assert.equal(browser.selectedId, `PC1:${first.toLowerCase()}`);
    assert.match(ui.get("#catalog-detail").innerHTML, /First description/);
  }
});

test("Traits loads PC1 data, filters individual types, sorts and opens descriptions", async () => {
  const config = REFERENCE_TYPES.traits;
  const payload = JSON.parse(await readFile(new URL("../data/traits.json", import.meta.url), "utf8"));
  const catalog = config.create(payload, config);
  assert.equal(catalog.records.length, 141);
  assert.ok(catalog.records.every(record => record.source === "PC1" && Number.isInteger(record.page)));
  assert.ok(!catalog.records.some(record => record.name === "Oil"));
  for (const record of catalog.records) assert.ok(config.renderDetail(record, catalog, null, config).includes(record.name));
  const acid = catalog.registry.resolve("Acid", "PC1").target;
  assert.equal(config.matches(acid, { category: new Map([["Energy", 1]]) }), true);
  assert.equal(config.matches(acid, { category: new Map([["Energy", 1], ["Monster", -1]]) }), false);
  const ui = environment("?category=Energy", config);
  const browser = mountReferenceBrowser(catalog, { ...ui, config });
  assert.match(ui.get("#catalog-results").innerHTML, />Acid</);
  assert.match(ui.get("#catalog-results").innerHTML, /catalog-result-source[^>]*>PC1<\/span><\/a>/);
  const typeSort = ui.get("#catalog-sort").querySelectorAll().find(el => el.dataset.catalogSort === "category");
  ui.get("#catalog-sort").emit("click", { target: typeSort });
  assert.equal(ui.window.location.searchParams.get("sort"), "category");
  ui.get("#catalog-sort").emit("click", { target: ui.target({ catalogSort: "source" }) });
  assert.equal(ui.window.location.searchParams.get("sort"), "source");
  ui.handlers.get("popstate")();
  assert.equal(ui.window.location.searchParams.get("sort"), "source");
  ui.get("#catalog-filter-reset").emit("click");
  browser.select("PC1:summon");
  assert.match(ui.get("#catalog-detail").innerHTML, /<table/);
  assert.match(ui.get("#catalog-detail").innerHTML, /Maximum Creature Level/);
  browser.destroy();
});

test("Feats restores filters, selects named references in place and preserves Back navigation", () => {
  const config = { ...REFERENCE_TYPES.feats, ...FEAT_BROWSER_DEFINITION };
  const library = createFeatCatalog({ feats: [
    { name: "Reach Spell", add_hash: "Wizard", source: "PC1", page: 201, level: 1, traits: ["wizard", "spellshape", "concentrate"], entries: ["Wizard variant."] },
    { name: "Reach Spell", add_hash: "Cleric", source: "PC1", page: 123, level: 1, traits: ["cleric", "spellshape"], entries: ["Cleric variant."] },
  ] });
  const ui = environment("?trait=concentrate&level=1", config);
  const browser = mountReferenceBrowser(library, { ...ui, config });
  assert.equal(ui.get("#catalog-count").textContent, "1 feat");
  assert.equal(browser.selectedId, null);
  const ref = ui.target({ featName: "Reach Spell (Cleric)", featSource: "PC1" });
  const click = { target: ref, preventDefault() { this.defaultPrevented = true; } };
  ui.handlers.get("document:click")(click);
  assert.equal(click.defaultPrevented, true);
  assert.match(ui.get("#catalog-detail").innerHTML, /Cleric variant/);
  assert.equal(ui.window.location.searchParams.has("trait"), false);
  ui.window.history.back();
  assert.equal(browser.selectedId, null);
  assert.equal(ui.get("#catalog-count").textContent, "1 feat");
  assert.equal(ui.previewCalls[0].feats, library);
  browser.destroy();
});

test("Feats loads archetype membership and restores, excludes and clears archetype filters", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const payloads = Object.fromEntries(await Promise.all(["feats", "archetypes", "traits"].map(async name => [
    `data/${name}.json`, JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8")),
  ])));
  globalThis.fetch = async path => ({ ok: true, json: async () => payloads[path] || { rules: [] } });
  const config = { ...REFERENCE_TYPES.feats, ...FEAT_BROWSER_DEFINITION };
  const ui = environment("?archetype=bard", config);
  const browser = await startReferenceBrowser({ ...ui, config });
  assert.ok(browser);
  assert.equal(ui.get("#catalog-count").textContent, "9 feats");
  assert.match(ui.get("#catalog-results").innerHTML, /Basic Muse&#39;s Whispers/);
  assert.equal(ui.window.location.searchParams.get("archetype"), "Bard");
  const groups = ui.get("#catalog-filter-groups");
  const bard = groups.children.find(button => button.dataset.catalogFilter === "archetype" && button.dataset.filterValue === "Bard");
  assert.equal(bard.getAttribute("data-state"), "include");
  groups.emit("contextmenu", { target: bard });
  assert.equal(ui.window.location.searchParams.get("not-archetype"), "Bard");
  assert.equal(ui.get("#catalog-count").textContent, "876 feats");
  ui.handlers.get("popstate")();
  assert.equal(bard.getAttribute("data-state"), "exclude");
  ui.get("#catalog-filter-reset").emit("click");
  assert.equal(ui.get("#catalog-count").textContent, "885 feats");
  assert.equal(ui.window.location.searchParams.has("not-archetype"), false);
  browser.destroy();
});

test("Classes loads the shared feat JSON once and reports a missing dependency", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const config = { ...REFERENCE_TYPES.classes, ...CLASS_BROWSER_DEFINITION };
  const classData = JSON.parse(await readFile(new URL("../data/classes.json", import.meta.url), "utf8"));
  const featData = JSON.parse(await readFile(new URL("../data/feats.json", import.meta.url), "utf8"));
  const requests = [];
  globalThis.fetch = async path => { requests.push(path); return { ok: true, json: async () => path === "data/classes.json" ? classData : path === "data/feats.json" ? featData : { rules: [] } }; };
  const ui = environment("", config);
  const browser = await startReferenceBrowser({ ...ui, config });
  assert.ok(browser);
  assert.equal(ui.get("#catalog-count").textContent, "8 classes");
  assert.equal(requests.filter(path => path === "data/feats.json").length, 1);
  assert.equal(ui.previewCalls[0].feats.records.length, 885, "previews reuse the loaded collection");
  browser.destroy();
  globalThis.fetch = async path => ({ ok: path !== "data/feats.json", status: 404, json: async () => path === "data/classes.json" ? classData : { rules: [] } });
  const failed = environment("", config);
  await startReferenceBrowser({ ...failed, config });
  assert.match(failed.get("#main").innerHTML, /Unable to open classes/);
  assert.match(failed.get("#main").innerHTML, /HTTP 404/);
});

test("custom reference definitions reuse filter counts and release their event handlers", () => {
  let visits = 0;
  let mountedDetails = 0, disposedDetails = 0;
  const config = { ...REFERENCE_TYPES.conditions, collection: "equipment", singular: "Item", plural: "Equipment", kind: "item", href: "equipment.html",
    mountDetail() { mountedDetails++; return { destroy() { disposedDetails++; } }; },
    values(record, key) { visits++; return [record[key]]; } };
  const catalog = createCatalog({ equipment: Array.from({ length: 8 }, (_, index) => ({
    name: `Item ${index}`, source: "PC1", category: `Category ${index}`, entries: ["Equipment description."],
  })) }, config);
  let searchReads = 0;
  for (const record of catalog.records) {
    const text = record.searchText;
    Object.defineProperty(record, "searchText", { get() { searchReads++; return text; } });
  }
  const ui = environment("?q=item", config);
  const browser = mountReferenceBrowser(catalog, { ...ui, config });
  assert.equal(visits, catalog.records.length * config.filters.length);
  const category = ui.get("#catalog-filter-groups").children.find(el => el.dataset.catalogFilter === "category" && el.dataset.filterValue === "Category 0");
  ui.get("#catalog-filter-groups").emit("click", { target: category });
  assert.equal(ui.get("#catalog-count").textContent, "1 item");
  ui.get("#catalog-filter-groups").emit("contextmenu", { target: category });
  assert.equal(ui.get("#catalog-count").textContent, "7 equipment");
  assert.equal(searchReads, catalog.records.length, "changing filters reuses the previous name search");
  browser.select(catalog.records[0].id);
  browser.select(catalog.records[1].id);
  assert.equal(mountedDetails, 2);
  assert.equal(disposedDetails, 1, "changing selection releases the previous detail controller");
  browser.destroy();
  assert.equal(disposedDetails, 2);
  assert.equal(ui.get("#catalog-search").listeners.size, 0);
  assert.equal(ui.handlers.size, 0);
  assert.equal(browser.select(catalog.records[0].id), false);
});

test("Actions and Feats group trait filters by type and synchronize traits in multiple groups", () => {
  const traits = createCatalog({ traits: [
    { name: "Acid", source: "PC1", categories: ["Energy", "Monster"], entries: [] },
    { name: "Dwarf", source: "PC1", categories: ["Ancestry"], entries: [] },
  ] }, REFERENCE_TYPES.traits);
  for (const config of [REFERENCE_TYPES.actions, { ...REFERENCE_TYPES.feats, ...FEAT_BROWSER_DEFINITION }]) {
    const library = config.create({ [config.collection]: [
      { name: "Acid Example", source: "PC1", category: "basic", level: 1, traits: ["acid"], time: { unit: "action", value: 1 }, entries: [] },
      { name: "Dwarf Example", source: "PC1", category: "basic", level: 1, traits: ["dwarf"], time: { unit: "reaction" }, entries: [] },
      { name: "Custom Example", source: "PC1", category: "basic", level: 2, traits: ["custom"], time: { unit: "free" }, entries: [] },
    ] }, config);
    const ui = environment("", config);
    const browser = mountReferenceBrowser(library, { ...ui, config, traits });
    const groups = ui.get(`#${config.prefix}-filter-groups`);
    for (const type of ["Ancestry", "Energy", "Monster", "Other"]) assert.ok(groups.innerHTML.includes(`<legend>${type}</legend>`));
    const acid = groups.children.filter(button => button.dataset.filterValue === "acid");
    assert.equal(acid.length, 2);
    groups.emit("click", { target: acid[0] });
    assert.equal(ui.get(`#${config.prefix}-count`).textContent, `1 ${config.singular.toLowerCase()}`);
    assert.ok(acid.every(button => button.getAttribute("data-state") === "include"));
    assert.deepEqual(ui.window.location.searchParams.getAll("trait"), ["acid"]);
    assert.equal(ui.get(`#${config.prefix}-filter-count`).textContent, "1");
    groups.emit("contextmenu", { target: acid[1] });
    assert.ok(acid.every(button => button.getAttribute("data-state") === "exclude"));
    assert.equal(ui.get(`#${config.prefix}-count`).textContent, `2 ${config.plural.toLowerCase()}`);
    assert.deepEqual(ui.window.location.searchParams.getAll("not-trait"), ["acid"]);
    ui.handlers.get("popstate")();
    assert.ok(acid.every(button => button.getAttribute("data-state") === "exclude"));
    ui.get(`#${config.prefix}-filter-reset`).emit("click");
    assert.ok(acid.every(button => button.getAttribute("data-state") === "neutral"));
    assert.equal(ui.window.location.searchParams.has("not-trait"), false);
    browser.destroy();
  }
});

test("Skills works without filter controls and clears old filters while retaining search and source sorting", () => {
  const config = REFERENCE_TYPES.skills;
  const library = config.create({ skills: [
    { name: "Arcana", source: "PC1", category: "Intelligence", entries: ["Arcana description."] },
    { name: "Athletics", source: "PC1", category: "Strength", entries: [] },
  ] }, config);
  const ui = environment("?category=Intelligence&not-source=PC1&sort=category", config);
  const query = ui.document.querySelector;
  ui.document.querySelector = selector => /filter|include|exclude/.test(selector) ? null : query(selector);
  const browser = mountReferenceBrowser(library, { ...ui, config });
  assert.equal(ui.get("#catalog-count").textContent, "2 skills");
  assert.equal(ui.window.location.search, "");
  assert.doesNotMatch(ui.get("#catalog-results").innerHTML, /catalog-result-category/);
  ui.get("#catalog-search").value = "arcana";
  ui.get("#catalog-search").emit("input");
  assert.equal(ui.get("#catalog-count").textContent, "1 skill");
  ui.get("#catalog-sort").emit("click", { target: ui.target({ catalogSort: "source" }) });
  assert.equal(ui.window.location.searchParams.get("sort"), "source");
  browser.select("PC1:arcana");
  assert.match(ui.get("#catalog-detail").innerHTML, /<h2[^>]*>Arcana<\/h2><span class="reader-kind">Skill<\/span>/);
  ui.handlers.get("document:keydown")({ key: "Escape" });
  ui.handlers.get("document:pointerdown")({ target: ui.target({}) });
  browser.destroy();
});

test("Backgrounds and Archetypes load their PC1 catalogs and restore named selections and filters", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const payloads = Object.fromEntries(await Promise.all(["backgrounds", "archetypes", "feats"].map(async collection => [
    `data/${collection}.json`, JSON.parse(await readFile(new URL(`../data/${collection}.json`, import.meta.url), "utf8")),
  ])));
  const requests = [];
  globalThis.fetch = async path => {
    requests.push(path);
    return { ok: true, json: async () => payloads[path] || { rules: [] } };
  };
  const backgrounds = { ...REFERENCE_TYPES.backgrounds, ...BACKGROUND_BROWSER_DEFINITION };
  const ui = environment("?background=Acolyte&source=PC1&category=Wisdom&skill=Religion", backgrounds);
  const browser = await startReferenceBrowser({ ...ui, config: backgrounds });
  assert.equal(browser.selectedId, "PC1:acolyte");
  assert.match(ui.get("#catalog-detail").innerHTML, /Student of the Canon/);
  assert.equal(ui.window.location.searchParams.get("skill"), "Religion");
  const skill = ui.get("#catalog-filter-groups").children.find(button => button.dataset.catalogFilter === "skill" && button.dataset.filterValue === "Religion");
  ui.get("#catalog-filter-groups").emit("contextmenu", { target: skill });
  assert.equal(ui.window.location.searchParams.get("not-skill"), "Religion");
  browser.destroy();
  const archetypes = { ...REFERENCE_TYPES.archetypes, ...ARCHETYPE_BROWSER_DEFINITION };
  const other = environment("?archetype=Wizard&source=PC1", archetypes);
  const reader = await startReferenceBrowser({ ...other, config: archetypes });
  assert.equal(reader.selectedId, "PC1:wizard");
  assert.equal(other.get("#catalog-count").textContent, "8 archetypes");
  assert.match(other.get("#catalog-detail").innerHTML, /Wizard Dedication/);
  assert.match(other.get("#catalog-detail").innerHTML, /Master Wizard Spellcasting/);
  assert.equal(other.previewCalls[0].feats.records.length, 885);
  assert.equal(requests.filter(path => path === "data/feats.json").length, 1);
  reader.destroy();
});

test("Ancestries loads English PC1 data, switches lists and restores the selected reader with history", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const payloads = Object.fromEntries(await Promise.all(["ancestries", "feats"].map(async name => [
    `data/${name}.json`, JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8")),
  ])));
  const requests = [];
  globalThis.fetch = async path => { requests.push(path); return { ok: true, json: async () => payloads[path] || { rules: [] } }; };
  const config = { ...REFERENCE_TYPES.ancestries, ...ANCESTRY_BROWSER_DEFINITION, loadDefinition: undefined, mountDetail(record, _root, { library }) {
    assert.ok(library.featsByAncestry.get(record.id).length > 0);
    return { destroy() {} };
  } };
  const ui = environment("?ancestry=Dwarf&source=PC1", config);
  const browser = await startReferenceBrowser({ ...ui, config });
  assert.equal(browser.selectedId, "PC1:dwarf");
  assert.equal(ui.get("#catalog-count").textContent, "8 ancestries");
  assert.match(ui.get("#catalog-detail").innerHTML, /data-ancestry-tab="heritages"/);
  browser.select("PC1:nephilim");
  assert.doesNotMatch(ui.get("#catalog-detail").innerHTML, /data-ancestry-tab="heritages"/);
  assert.equal(requests.filter(path => path === "data/feats.json").length, 1);
  assert.equal(ui.previewCalls[0].ancestries.records.length, 12);
  assert.equal(browser.selectedList, "versatile-heritages");
  assert.equal(ui.get("#catalog-count").textContent, "4 versatile heritages");
  browser.switchList("ancestries");
  assert.equal(browser.selectedId, null);
  browser.select("PC1:dwarf");
  ui.window.history.replaceState(null, "", `${ui.window.location.pathname}${ui.window.location.search}&tab=heritages`);
  const click = { target: ui.target({ catalogList: "versatile-heritages" }), preventDefault() { this.defaultPrevented = true; } };
  ui.handlers.get("document:click")(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(browser.selectedId, null);
  assert.equal(ui.window.location.searchParams.get("list"), "versatile-heritages");
  assert.equal(ui.window.location.searchParams.has("tab"), false);
  assert.match(ui.get("#catalog-detail").innerHTML, /Choose a versatile heritage/);
  const listButtons = ui.get("#catalog-lists").children;
  assert.equal(listButtons.find(button => button.dataset.catalogList === "versatile-heritages").getAttribute("aria-pressed"), "true");
  ui.window.history.back();
  assert.equal(browser.selectedList, "ancestries");
  assert.equal(browser.selectedId, "PC1:dwarf");
  assert.equal(ui.window.location.searchParams.get("tab"), "heritages");
  assert.equal(ui.get("#catalog-count").textContent, "8 ancestries");
  browser.destroy();
});


test("authored actions load without optional import metadata and remain valid and renderable", async () => {
  const data = JSON.parse(await readFile(new URL("../data/actions.json", import.meta.url), "utf8"));
  const authored = { ...data };
  delete authored._meta;
  const library = createActionLibrary(authored);
  assert.equal(library.actions.length, data.actions.length);
  assert.deepEqual(createActionLibrary({ ...authored, _meta: { note: "Optional author notes" } }).actions.map(action => action.id), library.actions.map(action => action.id));
  for (const action of library.actions) {
    assert.ok(Object.hasOwn(ACTION_CATEGORIES, action.category));
    assert.ok(library.sources.includes(action.source));
    for (const key of action.costKeys) assert.ok(Object.hasOwn(ACTION_TIMES, key));
    if (action.entry.page != null) assert.ok(Number.isInteger(action.entry.page) && action.entry.page > 0);
    assert.ok(Array.isArray(action.entry.entries));
    assert.doesNotMatch(renderActionDetail(action, library), /\[object Object\]|undefined/);
  }
  for (const name of ["Reach Spell", "Boulder Roll", "Quick Draw"]) assert.equal(library.registry.resolve(name, "PC1").status, "missing");
});
