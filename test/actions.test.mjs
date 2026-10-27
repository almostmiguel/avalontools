import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderInline } from "../js/content-renderer.js";
import { ACTION_CATEGORIES, ACTION_TIMES, createActionLibrary, emptyActionFilters, actionMatchesFilters, searchActions, sortActions, actionTimeHtml, renderActionDetail, renderActionResults } from "../js/actions-library.js";
import { mountActions, startActions } from "../js/actions-app.js";

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

function environment(query = "") {
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
      if (this.selector === "#actions-filter-groups") this.children = [...html.matchAll(/data-action-filter="([^"]+)" data-filter-value="([^"]+)"/g)].map(([, group, value]) => { const el = new Element(); el.dataset = { actionFilter: group, filterValue: value }; return el; });
    }
    get innerHTML() { return this.html || ""; }
    querySelectorAll() {
      if (this.selector === "#actions-sort" && !this.children.length) this.children = ["name", "category", "time", "source"].map(key => { const el = new Element(); el.dataset.actionSort = key; return el; });
      return this.children;
    }
    closest(selector) {
      const fields = { "[data-action-filter]": "actionFilter", "[data-action-sort]": "actionSort", "[data-select-action]": "selectAction", "[data-action-name]": "actionName", "[data-remove-action-filter]": "removeActionFilter" };
      return fields[selector] && this.dataset[fields[selector]] != null ? this : null;
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    contains(target) { return target === this || this.children.includes(target); }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolled = true; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    emit(type, extra = {}) { const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; this.listeners.get(type)?.(event); return event; }
  }
  const document = { title: "", querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element(selector)); return elements.get(selector); }, addEventListener: (type, handler) => handlers.set(`document:${type}`, handler) };
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
