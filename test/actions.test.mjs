import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inlineText, renderContent, renderInline } from "../js/content-renderer.js";
import { ACTION_CATEGORIES, ACTION_TIMES, createActionLibrary, createCatalog, emptyActionFilters, emptyCatalogFilters, actionMatchesFilters, catalogMatchesFilters, catalogOptions, searchActions, searchCatalog, sortActions, actionTimeHtml, renderActionDetail, renderActionResults } from "../js/reference-library.js";
import { mountActions, mountReferenceBrowser, REFERENCE_TYPES, startActions } from "../js/reference-browser.js";

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
  assert.equal(searchActions(library, "walk")[0].name, "Stride");
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

test("catalogs create stable records, search aliases, filter inclusions and exclusions, and sort", () => {
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
  assert.deepEqual(searchCatalog(catalog, "exhausted").map(record => record.name), ["Drained"]);
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

test("custom reference definitions reuse filter counts and release their event handlers", () => {
  let visits = 0;
  const config = { ...REFERENCE_TYPES.skills, collection: "equipment", singular: "Item", plural: "Equipment", kind: "item", href: "equipment.html",
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
  browser.destroy();
  assert.equal(ui.get("#catalog-search").listeners.size, 0);
  assert.equal(ui.handlers.size, 0);
  assert.equal(browser.select(catalog.records[0].id), false);
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
