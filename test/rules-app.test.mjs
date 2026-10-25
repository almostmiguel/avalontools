import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLibrary } from "../js/rules-library.js";
import { loadLibrary, mountCatalog, mountRule, startRules } from "../js/rules-app.js";

function environment(search = "", page = "rules", { mobile = false } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const history = [new URL(`http://localhost/project/${page === "rule" ? "rule" : "rules"}.html${search}`)];
  let index = 0;
  const window = {
    location: new URL(history[0]),
    history: {
      replaceState(_state, _title, href) { window.location = new URL(href, window.location); history[index] = new URL(window.location); },
      pushState(_state, _title, href) { window.location = new URL(href, window.location); history.splice(++index); history.push(new URL(window.location)); },
      back() { if (index > 0) { window.location = new URL(history[--index]); listeners.get("popstate")?.(); } },
      forward() { if (index < history.length - 1) { window.location = new URL(history[++index]); listeners.get("popstate")?.(); } },
    },
    addEventListener(name, fn) { listeners.set(name, fn); },
    matchMedia() { return { matches: mobile }; },
  };
  const eventFor = (target, extra = {}) => ({
    target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra,
  });
  const document = {
    body: { dataset: { page } }, title: "", activeElement: null,
    addEventListener(name, fn) { listeners.set(`document:${name}`, fn); },
    emit(name, event) { const e = eventFor(document, event); listeners.get(`document:${name}`)?.(e); return e; },
    querySelector(selector) {
      if (!elements.has(selector)) {
        let markup = "";
        let rows = [];
        const handlers = new Map();
        const attributes = new Map();
        const element = {
          textContent: "", value: "", focused: false, busy: true, scrollTop: 0, scrolled: false,
          get innerHTML() { return markup; },
          set innerHTML(value) {
            markup = value;
            rows = [...value.matchAll(/<a [^>]*data-select-rule="([^"]+)"[^>]*>/g)].map(match => {
              const attributes = new Map();
              if (match[0].includes('aria-current="true"')) attributes.set("aria-current", "true");
              return {
                dataset: { selectRule: match[1] }, attributes,
                setAttribute(name, value) { attributes.set(name, value); },
                removeAttribute(name) { attributes.delete(name); },
                closest(selector) { return selector === "[data-select-rule]" ? this : null; },
              };
            });
          },
          querySelectorAll() { return rows; },
          addEventListener(name, fn) { handlers.set(name, fn); },
          emit(name, event = {}) { const e = eventFor(this, event); handlers.get(name)?.(e); return e; },
          focus() { this.focused = true; document.activeElement = this; },
          scrollIntoView() { this.scrolled = true; },
          setAttribute(name, value) { attributes.set(name, value); },
          getAttribute(name) { return attributes.get(name) ?? null; },
          removeAttribute(name) { attributes.delete(name); if (name === "aria-busy") this.busy = false; },
        };
        elements.set(selector, element);
      }
      return elements.get(selector);
    },
    getElementById() { return null; },
  };
  const previews = { attached: 0, hidden: 0 };
  return {
    document, window, get: selector => document.querySelector(selector), listeners, previews,
    row: id => document.querySelector("#rules-results").querySelectorAll().find(row => row.dataset.selectRule === id),
    attachPreviews() { previews.attached++; return { hide() { previews.hidden++; } }; },
  };
}

const fixture = () => createLibrary({ rules: [
  { id: "actions", name: "Actions", source: "PC1", topic: "Encounters", page: 10, entries: ["Spend three actions.", { type: "h3", name: "Stride", entries: ["Move your Speed."] }] },
  { id: "camp", name: "Camp", source: "Avalon", topic: "Exploration", setting: "original", entries: ["Rest and recover. See {@rule Actions|PC1}."] },
  { id: "stride", name: "Stride", source: "PC1", topic: "Encounters", kind: "optional", entries: ["Move your Speed."] },
] });

const resultIds = ui => ui.get("#rules-results").querySelectorAll().map(row => row.dataset.selectRule);

test("Name, Type and Source sort in both directions without changing the open rule", () => {
  const orders = {
    name: [["PC1:stride", "Avalon:camp", "PC1:actions"], ["PC1:actions", "Avalon:camp", "PC1:stride"]],
    type: [["PC1:actions", "PC1:stride", "Avalon:camp"], ["Avalon:camp", "PC1:stride", "PC1:actions"]],
    source: [["Avalon:camp", "PC1:actions", "PC1:stride"], ["PC1:actions", "PC1:stride", "Avalon:camp"]],
  };
  for (const [key, expected] of Object.entries(orders)) {
    const ui = environment();
    const controller = mountCatalog(fixture(), ui);
    const button = ui.get(`#sort-${key}`);
    const detail = ui.get("#rule-detail");
    detail.scrollTop = 95;
    const markup = detail.innerHTML;
    for (let click = 0; click < 2; click++) {
      button.emit("click");
      assert.deepEqual(resultIds(ui), expected[click], `${key}, click ${click + 1}`);
      assert.equal(controller.selectedId, "PC1:actions");
      assert.equal(detail.innerHTML, markup);
      assert.equal(detail.scrollTop, 95);
      assert.equal(button.getAttribute("aria-pressed"), "true");
      const order = (key === "name") === (click === 0) ? "desc" : "asc";
      assert.equal(button.getAttribute("data-direction"), order);
      assert.equal(ui.window.location.searchParams.get("sort"), key);
      assert.equal(ui.window.location.searchParams.get("order"), order);
      assert.match(button.getAttribute("aria-label"), /sorted (A to Z|Z to A)\. Sort (A to Z|Z to A)\./);
    }
  }
});

test("switching from another sort to Name starts A to Z before toggling to Z to A", () => {
  for (const previous of ["type", "source"]) {
    for (const reverse of [false, true]) {
      const ui = environment();
      mountCatalog(fixture(), ui);
      assert.equal(ui.get("#sort-name").getAttribute("data-direction"), "asc");
      ui.get(`#sort-${previous}`).emit("click");
      if (reverse) ui.get(`#sort-${previous}`).emit("click");
      assert.match(ui.get("#sort-name").getAttribute("aria-label"), /Sort A to Z\./);
      ui.get("#sort-name").emit("click");
      assert.deepEqual(resultIds(ui), ["PC1:actions", "Avalon:camp", "PC1:stride"]);
      assert.equal(ui.get("#sort-name").getAttribute("data-direction"), "asc");
      ui.get("#sort-name").emit("click");
      assert.deepEqual(resultIds(ui), ["PC1:stride", "Avalon:camp", "PC1:actions"]);
      assert.equal(ui.get("#sort-name").getAttribute("data-direction"), "desc");
    }
  }
});

test("sorting survives filtering, reload and history navigation, and inactive controls lose their arrow", () => {
  const ui = environment("?sort=source&order=asc");
  mountCatalog(fixture(), ui);
  assert.deepEqual(resultIds(ui), ["Avalon:camp", "PC1:actions", "PC1:stride"]);
  assert.equal(ui.get("#sort-source").getAttribute("data-direction"), "asc");
  ui.get("#rules-topic").value = "Encounters";
  ui.get("#rules-topic").emit("change");
  ui.get("#rules-search").value = "s";
  ui.get("#rules-search").emit("input");
  ui.get("#sort-name").emit("click");
  assert.deepEqual(resultIds(ui), ["PC1:actions", "PC1:stride"]);
  assert.equal(ui.get("#sort-source").getAttribute("aria-pressed"), "false");
  assert.equal(ui.get("#sort-source").getAttribute("data-direction"), null);
  const reloaded = environment(ui.window.location.search);
  mountCatalog(fixture(), reloaded);
  assert.deepEqual(resultIds(reloaded), resultIds(ui));
  assert.equal(reloaded.get("#sort-name").getAttribute("data-direction"), "asc");
  ui.get("#rules-results").emit("click", { target: ui.row("PC1:stride") });
  ui.get("#sort-type").emit("click");
  ui.window.history.back();
  assert.equal(ui.get("#sort-name").getAttribute("data-direction"), "asc");
  ui.window.history.forward();
  assert.equal(ui.get("#sort-type").getAttribute("data-direction"), "asc");
});

test("invalid sort URL values are ignored and search relevance stays the default", () => {
  const ui = environment("?q=Stride&sort=unknown&order=desc");
  mountCatalog(fixture(), ui);
  assert.deepEqual(resultIds(ui), ["PC1:stride"]);
  assert.equal(ui.window.location.searchParams.get("sort"), null);
  assert.equal(ui.window.location.searchParams.get("order"), null);
  assert.equal(ui.get("#sort-name").getAttribute("aria-pressed"), "false");
  const invalidOrder = environment("?sort=name&order=unknown");
  mountCatalog(fixture(), invalidOrder);
  assert.deepEqual(resultIds(invalidOrder), ["PC1:actions", "Avalon:camp", "PC1:stride"]);
  assert.equal(invalidOrder.get("#sort-name").getAttribute("data-direction"), "asc");
});

test("the first matching rule opens beside the list and search updates the selection without navigation", () => {
  const ui = environment("?q=act&topic=Encounters&source=PC1");
  mountCatalog(fixture(), ui);
  assert.equal(ui.get("#rules-search").value, "act");
  assert.equal(ui.get("#results-title").textContent, "Encounters");
  assert.match(ui.get("#rule-detail").innerHTML, /Spend three actions/);
  assert.equal(ui.row("PC1:actions").attributes.get("aria-current"), "true");
  ui.get("#rules-search").value = "nothing matches";
  ui.get("#rules-search").emit("input");
  assert.match(ui.get("#rules-results").innerHTML, /No matching rules/);
  assert.match(ui.get("#rule-detail").innerHTML, /No matching rules/);
  assert.equal(ui.window.location.searchParams.get("id"), null);
  ui.get("#clear-search").emit("click");
  assert.equal(ui.window.location.pathname, "/project/rules.html");
  assert.equal(ui.window.location.searchParams.get("q"), null);
  assert.equal(ui.window.location.searchParams.get("topic"), null);
  assert.equal(ui.get("#rules-search").focused, true);
  assert.match(ui.get("#rule-detail").innerHTML, /Spend three actions/);
});

test("clicking a list entry updates only the detail pane and supports Back and Forward", () => {
  const ui = environment();
  const controller = mountCatalog(fixture(), ui);
  const row = ui.row("Avalon:camp");
  const event = ui.get("#rules-results").emit("click", { target: row });
  assert.equal(event.defaultPrevented, true);
  assert.equal(controller.selectedId, "Avalon:camp");
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
  assert.equal(ui.window.location.pathname, "/project/rules.html");
  assert.equal(ui.window.location.searchParams.get("id"), "Avalon:camp");
  assert.equal(ui.row("Avalon:camp"), row);
  assert.equal(row.attributes.get("aria-current"), "true");
  assert.equal(ui.row("PC1:actions").attributes.has("aria-current"), false);
  assert.equal(ui.previews.attached, 1);
  ui.window.history.back();
  assert.match(ui.get("#rule-detail").innerHTML, /Spend three actions/);
  ui.window.history.forward();
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
});

test("modified list clicks keep native new-tab navigation and do not change selection", () => {
  const ui = environment();
  const controller = mountCatalog(fixture(), ui);
  const event = ui.get("#rules-results").emit("click", { target: ui.row("Avalon:camp"), ctrlKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(controller.selectedId, "PC1:actions");
  assert.match(ui.get("#rules-results").innerHTML, /href="rules.html\?id=Avalon%3Acamp"/);
});

test("topic, source and type filters combine with search and retain the current rule when possible", () => {
  const ui = environment();
  mountCatalog(fixture(), ui);
  ui.get("#rule-detail").scrollTop = 75;
  ui.get("#rules-kind").value = "core";
  ui.get("#rules-kind").emit("change");
  assert.equal(ui.get("#rule-detail").scrollTop, 75);
  ui.get("#rules-topic").value = "Exploration";
  ui.get("#rules-topic").emit("change");
  assert.equal(ui.get("#rules-count").textContent, "0 rules");
  ui.get("#rules-kind").value = "";
  ui.get("#rules-kind").emit("change");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
  ui.get("#rules-source").value = "PC1";
  ui.get("#rules-source").emit("change");
  assert.equal(ui.get("#rules-count").textContent, "0 rules");
});

test("rule references in details or hover cards open in place and reveal rules excluded by filters", () => {
  const ui = environment("?topic=Exploration&id=Avalon%3Acamp");
  mountCatalog(fixture(), ui);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "Actions", ruleSource: "PC1" } } : null };
  const event = ui.document.emit("click", { target });
  assert.equal(event.defaultPrevented, true);
  assert.match(ui.get("#rule-detail").innerHTML, /Spend three actions/);
  assert.equal(ui.get("#rules-topic").value, "");
  assert.equal(ui.window.location.searchParams.get("id"), "PC1:actions");
  assert.equal(ui.get("#rule-detail").focused, true);
  const modified = ui.document.emit("click", { target, metaKey: true });
  assert.equal(modified.defaultPrevented, false);
});

test("deep links and missing rule ids keep the list usable", () => {
  const ui = environment("?id=Avalon%3Acamp&q=unrelated");
  mountCatalog(fixture(), ui);
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
  assert.equal(ui.get("#rules-search").value, "");
  const missing = environment("?id=missing");
  const controller = mountCatalog(fixture(), missing);
  assert.match(missing.get("#rule-detail").innerHTML, /Rule not found/);
  assert.ok(missing.row("PC1:actions"));
  controller.selectRule("PC1:actions");
  assert.match(missing.get("#rule-detail").innerHTML, /Spend three actions/);
  const named = environment("?rule=Actions&source=PC1");
  mountCatalog(fixture(), named);
  assert.equal(named.window.location.searchParams.get("id"), "PC1:actions");
});

test("source-less tags and name-based URLs open GM-only rules in place", () => {
  const library = createLibrary({ rules: [
    { id: "checks", name: "Checks", source: "PC1", entries: ["See {@rule Difficulty Classes}."] },
    { id: "dc", name: "Difficulty Classes", source: "GMC", entries: ["GM difficulty rules."] },
  ] });
  const ui = environment("?id=PC1%3Achecks");
  mountCatalog(library, ui);
  assert.match(ui.get("#rule-detail").innerHTML, /href="rules.html\?id=GMC%3Adc"/);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "Difficulty Classes", ruleSource: "" } } : null };
  const event = ui.document.emit("click", { target });
  assert.equal(event.defaultPrevented, true);
  assert.match(ui.get("#rule-detail").innerHTML, /GM difficulty rules/);
  const named = environment("?rule=Difficulty+Classes");
  mountCatalog(library, named);
  assert.equal(named.window.location.searchParams.get("id"), "GMC:dc");
  const explicit = environment("?rule=Difficulty+Classes&source=PC1");
  mountCatalog(library, explicit);
  assert.match(explicit.get("#rule-detail").innerHTML, /Rule not found/);
  const standalone = environment("?rule=Difficulty+Classes", "rule");
  mountRule(library, standalone);
  assert.match(standalone.get("#rule-article").innerHTML, /GM difficulty rules/);
});

test("promoted sections select independently and link back to their containing rule", () => {
  const library = createLibrary({ rules: [{ id: "checks", name: "Checks", source: "PC1", page: 400, topic: "Playing the Game", entries: [
    "Parent introduction. See {@rule Modifier}.",
    { type: "h4", id: "modifier", name: "Modifier", rule: true, entries: ["Modifier description."] },
  ] }] });
  const ui = environment("?id=PC1%3Achecks");
  mountCatalog(library, ui);
  assert.ok(ui.row("PC1:modifier"));
  assert.match(ui.get("#rule-detail").innerHTML, /href="rules.html\?id=PC1%3Amodifier"/);
  ui.get("#rules-results").emit("click", { target: ui.row("PC1:modifier") });
  assert.match(ui.get("#rule-detail").innerHTML, /Modifier description/);
  assert.doesNotMatch(ui.get("#rule-detail").innerHTML, /Parent introduction/);
  assert.match(ui.get("#rule-detail").innerHTML, /Part of <a[^>]+data-rule-name="checks"[^>]*>Checks<\/a>/);
  assert.match(ui.get("#rule-detail").innerHTML, /p\. 400/);
  ui.get("#rules-topic").value = "Checks";
  ui.get("#rules-topic").emit("change");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.equal(ui.row("PC1:checks"), undefined);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "checks", ruleSource: "PC1" } } : null };
  ui.document.emit("click", { target });
  assert.match(ui.get("#rule-detail").innerHTML, /Parent introduction/);
});

test("mobile selection reveals the rule and the back-to-list control returns focus to search", () => {
  const ui = environment("", "rules", { mobile: true });
  mountCatalog(fixture(), ui);
  ui.get("#rules-results").emit("click", { target: ui.row("Avalon:camp") });
  assert.equal(ui.get("#rule-detail").scrolled, true);
  assert.equal(ui.get("#rule-detail").focused, true);
  ui.get("#rule-detail").emit("click", { target: { closest: selector => selector === "[data-back-to-list]" ? {} : null } });
  assert.equal(ui.get("#rules-list-pane").scrolled, true);
  assert.equal(ui.get("#rules-search").focused, true);
});

test("existing standalone URLs still render the chosen rule", () => {
  const library = fixture();
  const ui = environment("?id=Avalon%3Acamp", "rule");
  mountRule(library, ui);
  assert.equal(ui.document.title, "Camp · Avalon Rules");
  assert.match(ui.get("#rule-article").innerHTML, /Avalon original/);
  assert.match(ui.get("#rule-article").innerHTML, /href="rules.html\?id=PC1%3Aactions"/);
  const source = environment("?rule=Actions&source=PC1", "rule");
  mountRule(library, source);
  assert.match(source.get("#rule-article").innerHTML, /PC1 · p\. 10/);
  assert.match(source.get("#rule-related").innerHTML, /Stride/);
  assert.throws(() => mountRule(library, environment("?id=missing", "rule")), /could not be found/);
});

test("loader validates rule data and shows failures with a recovery link", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rules: [{ name: "Missing id" }] }) });
  await assert.rejects(loadLibrary(), /unique id/);
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const ui = environment();
  await startRules(ui);
  assert.match(ui.get("#main").innerHTML, /role="alert"/);
  assert.match(ui.get("#main").innerHTML, /HTTP 404/);
  assert.match(ui.get("#main").innerHTML, /href="rules.html"/);
  assert.equal(ui.get("#main").busy, false);
});

test("Rules fetches its JSON once and shows an honest empty collection", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const fetched = [];
  globalThis.fetch = async path => {
    fetched.push(path);
    return { ok: true, json: async () => ({ sources: [{ id: "PC1", name: "Player Core", file: "data/book/book-pc1.json" }], rules: [] }) };
  };
  const ui = environment("?q=actions");
  await startRules(ui);
  assert.match(ui.get("#rules-results").innerHTML, /No rules have been added yet/);
  assert.match(ui.get("#rule-detail").innerHTML, /Your rules belong here/);
  assert.deepEqual(fetched, ["data/rules.json"]);
  assert.equal(ui.get("#main").busy, false);
  const html = await readFile(new URL("../rules.html", import.meta.url), "utf8");
  assert.match(html, /id="rule-detail"/);
  assert.match(html, /id="rules-list-pane"/);
});

test("a secondary topic deep link retains selection and both topics display in the detail header", () => {
  const library = createLibrary({ rules: [
    { id: "dual", name: "Dual Rule", source: "PC1", topic: ["Playing the Game", "Checks"], entries: ["Shared rule text."] },
    { id: "related", name: "Related Rule", source: "PC1", topic: "Checks", entries: ["Related text."] },
  ] });
  const ui = environment("?topic=Checks&id=PC1%3Adual");
  mountCatalog(library, ui);
  assert.equal(ui.get("#rules-topic").value, "Checks");
  assert.match(ui.get("#rule-detail").innerHTML, /Playing the Game · Checks/);
  assert.equal(ui.get("#rules-count").textContent, "2 rules");
  ui.get("#rules-topic").value = "Playing the Game";
  ui.get("#rules-topic").emit("change");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.equal(ui.window.location.searchParams.get("id"), "PC1:dual");
  const standalone = environment("?id=PC1%3Adual", "rule");
  mountRule(library, standalone);
  assert.match(standalone.get("#rule-related").innerHTML, /Related Rule/);
  assert.match(standalone.get("#rule-breadcrumbs").innerHTML, /topic=Checks/);
});

test("type filters are restored from the URL and cleared together", () => {
  const ui = environment("?kind=optional");
  mountCatalog(fixture(), ui);
  assert.equal(ui.get("#rules-kind").value, "optional");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.match(ui.get("#rule-detail").innerHTML, /Move your Speed/);
  ui.get("#rules-kind").value = "setting";
  ui.get("#rules-kind").emit("change");
  assert.equal(ui.window.location.searchParams.get("kind"), "setting");
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
  ui.get("#clear-search").emit("click");
  assert.equal(ui.get("#rules-kind").value, "");
  assert.equal(ui.get("#rules-count").textContent, "3 rules");
});
