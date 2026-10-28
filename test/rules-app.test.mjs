import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createRuleLibrary } from "../js/rule-library.js";
import { loadLibrary, mountRuleBrowser, mountRule, startRules } from "../js/rule-browser.js";
import { READER_STATE_KEY } from "../js/reader-state.js";
import { renderReferenceCitation } from "../js/reference-data.js";

function environment(search = "", page = "rules", { mobile = false, storage = new Map() } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const history = [new URL(`http://localhost/project/${page === "rule" ? "rule" : "rules"}.html${search}`)];
  let index = 0;
  const window = {
    location: new URL(history[0]),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
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
        let chapterRows = [];
        let branches = [];
        let pills = [];
        let anchors = new Map();
        const handlers = new Map();
        const attributes = new Map();
        const element = {
          textContent: "", value: "", focused: false, busy: true, scrollTop: 0, scrolled: false, writes: 0,
          get anchors() { return anchors; },
          get innerHTML() { return markup; },
          set innerHTML(value) {
            markup = value;
            this.writes++;
            anchors = new Map([...value.matchAll(/<h[2-6][^>]*id="([^"]+)"[^>]*>/g)].map(match => [match[1], { scrolled: false, scrollIntoView() { this.scrolled = true; } }]));
            pills = [...value.matchAll(/<button [^>]*id="([^"]+)"[^>]*data-filter-group="([^"]+)"[^>]*data-filter-value="([^"]*)"[^>]*>/g)].map(match => {
              const attributes = new Map();
              return {
                id: match[1], dataset: { filterGroup: match[2], filterValue: match[3] }, innerHTML: "",
                setAttribute(name, value) { attributes.set(name, value); },
                getAttribute(name) { return attributes.get(name) ?? null; },
                closest(selector) { return selector === "[data-filter-group]" ? this : null; },
              };
            });
            branches = [...value.matchAll(/<details [^>]*data-rule-branch="([^"]+)"[^>]*>/g)].map(match => ({
              dataset: { ruleBranch: match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&") }, open: /\sopen(?:>|\s)/.test(match[0]),
            }));
            chapterRows = [...value.matchAll(/<a [^>]*data-select-chapter="([^"]+)"[^>]*>/g)].map(match => {
              const attributes = new Map();
              if (match[0].includes('aria-current="true"')) attributes.set("aria-current", "true");
              return {
                dataset: { selectChapter: match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&") }, attributes,
                setAttribute(name, value) { attributes.set(name, value); }, removeAttribute(name) { attributes.delete(name); },
                closest(selector) { return selector === "[data-select-chapter]" ? this : null; },
              };
            });
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
          querySelectorAll(selector) { return selector === "[data-select-chapter]" ? chapterRows : selector === "[data-rule-branch]" ? branches : selector === "[data-filter-group]" ? pills : rows; },
          contains(target) { return target === this; },
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
    getElementById(id) { for (const element of elements.values()) if (element.anchors.has(id)) return element.anchors.get(id); return null; },
  };
  const previews = { attached: 0, hidden: 0, validated: [] };
  return {
    document, window, storage, get: selector => document.querySelector(selector), listeners, previews,
    row: id => document.querySelector("#rules-results").querySelectorAll().find(row => row.dataset.selectRule === id),
    attachPreviews() { previews.attached++; return { hide() { previews.hidden++; }, validateActions(root) { previews.validated.push(root); } }; },
  };
}

const fixture = () => createRuleLibrary({ rules: [
  { id: "actions", name: "Actions", source: "PC1", page: 10, entries: ["Spend three actions.", { type: "h3", name: "Stride", rule: false, entries: ["Move your Speed."] }] },
  { id: "camp", name: "Camp", source: "Avalon", setting: "original", entries: ["Rest and recover. See {@rule Actions}."] },
  { id: "stride", name: "Stride", source: "PC1", kind: "optional", entries: ["Move your Speed."] },
] });

const resultIds = ui => ui.get("#rules-results").querySelectorAll().map(row => row.dataset.selectRule);
const filterPill = (ui, group, value) => ui.get("#rules-filter-groups").querySelectorAll("[data-filter-group]").find(pill => pill.dataset.filterGroup === group && pill.dataset.filterValue === value);
const clickFilter = (ui, group, value, extra = {}) => ui.get("#rules-filter-groups").emit("click", { target: filterPill(ui, group, value), ...extra });
const clearFilterGroup = (ui, group) => ui.get("#rules-filter-groups").emit("click", { target: { closest: selector => selector === "[data-clear-filter]" ? { dataset: { clearFilter: group } } : null } });
const savedView = (ui, view) => ui.get("#rules-saved").emit("click", { target: { closest: selector => selector === "[data-saved-view]" ? { dataset: { savedView: view } } : null } });

test("Rules always browses, ignores old Index URLs, and starts without a selection or recent visit", () => {
  for (const query of ["", "?view=browse", "?view=index"]) {
    const ui = environment(query);
    const controller = mountRuleBrowser(fixture(), ui);
    assert.equal(controller.selectedId, null);
    assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
    assert.doesNotMatch(ui.get("#rules-results").innerHTML, /aria-current="true"/);
    assert.equal(ui.window.location.searchParams.has("id"), false);
    assert.equal(ui.storage.get(READER_STATE_KEY), undefined);
    assert.match(ui.get("#rules-results").innerHTML, /aria-label="Rules by source and chapter"/);
    assert.equal(ui.window.location.searchParams.has("view"), false);
    controller.selectRule("PC1:actions");
    assert.match(ui.get("#rule-detail").innerHTML, /Spend three actions/);
    assert.deepEqual(ui.previews.validated, [ui.get("#rule-detail")]);
    assert.deepEqual(JSON.parse(ui.storage.get(READER_STATE_KEY)).recent, ["PC1:actions"]);
  }
});

test("rules expose section navigation with working reload anchors and omit it for short rules", () => {
  const ui = environment("?id=PC1%3Aactions#rule-section-1");
  const controller = mountRuleBrowser(fixture(), ui);
  assert.match(ui.get("#rule-detail").innerHTML, /On this page/);
  assert.match(ui.get("#rule-detail").innerHTML, /href="#rule-section-1">Stride<\/a>/);
  assert.equal(ui.document.getElementById("rule-section-1").scrolled, true);
  assert.equal(ui.window.location.hash, "#rule-section-1");
  controller.selectRule("Avalon:camp");
  assert.doesNotMatch(ui.get("#rule-detail").innerHTML, /class="rule-outline"/);
});

test("reader metadata shares the preview citation and avoids duplicate source badges", () => {
  const library = fixture();
  const ui = environment("?id=PC1%3Aactions");
  const controller = mountRuleBrowser(library, ui);
  const html = ui.get("#rule-detail").innerHTML;
  const metadata = html.match(/<p class="rule-page-source">([\s\S]*?)<\/p>/)[1];
  assert.ok(metadata.startsWith(renderReferenceCitation(library.get(controller.selectedId))));
  assert.match(metadata, /class="rule-meta-kind rule-kind--core">Core rule/);
  assert.equal((metadata.match(/>PC1</g) || []).length, 1);
  assert.doesNotMatch(metadata, /class="rule-kind /);
});

test("section navigation stays in the reader tools and closes after a jump, Escape or outside click", () => {
  const ui = environment("?id=PC1%3Aactions");
  mountRuleBrowser(fixture(), ui);
  const html = ui.get("#rule-detail").innerHTML;
  assert.ok(html.indexOf('class="rule-reader-tools"') < html.indexOf('class="rule-outline"'));
  assert.ok(html.indexOf('class="rule-outline"') < html.indexOf("</header>"));
  const outline = ui.get("#rule-outline");
  outline.open = true;
  const target = { closest: selector => selector === "[data-outline-link]" ? {} : null };
  const jump = ui.get("#rule-detail").emit("click", { target });
  assert.equal(jump.defaultPrevented, false);
  assert.equal(outline.open, false);
  outline.open = true;
  ui.document.emit("keydown", { key: "Escape" });
  assert.equal(outline.open, false);
  assert.equal(ui.get("#rule-outline > summary").focused, true);
  outline.open = true;
  ui.document.emit("pointerdown", { target: {} });
  assert.equal(outline.open, false);
});

test("starring preserves the current content and reloads by stable rule id", () => {
  const ui = environment("?id=PC1%3Aactions");
  const controller = mountRuleBrowser(fixture(), ui);
  const detail = ui.get("#rule-detail");
  detail.scrollTop = 120;
  const writes = detail.writes;
  ui.get("#rules-saved").emit("toggle", { target: { dataset: { savedMenu: "" }, open: true } });
  const star = { closest: selector => selector === "[data-star-rule]" ? { dataset: { starRule: "PC1:actions" } } : null };
  detail.emit("click", { target: star });
  assert.equal(controller.selectedId, "PC1:actions");
  assert.equal(detail.scrollTop, 120);
  assert.equal(detail.writes, writes);
  assert.equal(ui.get("#rule-star").getAttribute("aria-pressed"), "true");
  assert.equal(ui.get("#rule-star").getAttribute("aria-label"), "Unstar Actions");
  assert.equal(ui.get("#rule-star").getAttribute("title"), "Unstar Actions");
  assert.doesNotMatch(ui.get("#rule-star").innerHTML, /<span>/);
  assert.deepEqual(JSON.parse(ui.storage.get(READER_STATE_KEY)).starred, ["PC1:actions"]);
  assert.match(ui.get("#rules-saved").innerHTML, /data-saved-menu open/);
  const reloaded = environment(ui.window.location.search, "rules", { storage: ui.storage });
  mountRuleBrowser(fixture(), reloaded);
  assert.equal(reloaded.get("#rule-star").getAttribute("aria-pressed"), "true");
  detail.emit("click", { target: star });
  assert.equal(ui.get("#rule-star").getAttribute("aria-pressed"), "false");
});

test("recent shortcuts navigate in place, deduplicate, clear and synchronize across tabs", () => {
  const ui = environment("?id=PC1%3Aactions");
  const controller = mountRuleBrowser(fixture(), ui);
  controller.selectRule("PC1:stride");
  controller.selectRule("Avalon:camp");
  controller.selectRule("PC1:stride");
  assert.deepEqual(JSON.parse(ui.storage.get(READER_STATE_KEY)).recent, ["PC1:stride", "Avalon:camp", "PC1:actions"]);
  clickFilter(ui, "source", "Avalon");
  const shortcut = { closest: selector => selector === "[data-saved-rule]" ? { dataset: { savedRule: "PC1:actions" } } : null };
  const modified = ui.get("#rules-saved").emit("click", { target: shortcut, ctrlKey: true });
  assert.equal(modified.defaultPrevented, false);
  assert.equal(controller.selectedId, "Avalon:camp");
  const click = ui.get("#rules-saved").emit("click", { target: shortcut });
  assert.equal(click.defaultPrevented, true);
  assert.equal(controller.selectedId, "PC1:actions");
  assert.equal(ui.window.location.searchParams.get("source"), null);
  savedView(ui, "recent");
  const clear = { closest: selector => selector === "[data-clear-recent]" ? {} : null };
  ui.get("#rules-saved").emit("click", { target: clear });
  assert.deepEqual(JSON.parse(ui.storage.get(READER_STATE_KEY)).recent, []);
  assert.equal(controller.selectedId, "PC1:actions");
  const before = ui.storage.get(READER_STATE_KEY);
  ui.listeners.get("storage")({ key: READER_STATE_KEY, newValue: JSON.stringify({ starred: ["PC1:actions"], recent: ["Avalon:camp"] }) });
  assert.equal(ui.get("#rule-star").getAttribute("aria-pressed"), "true");
  assert.match(ui.get("#rules-saved").innerHTML, /data-saved-rule="Avalon:camp"/);
  assert.equal(ui.storage.get(READER_STATE_KEY), before);
});

test("saved rules show one list at a time and dismiss on selection, Escape or outside click", () => {
  const ui = environment();
  const controller = mountRuleBrowser(fixture(), ui);
  const star = { closest: selector => selector === "[data-star-rule]" ? { dataset: { starRule: "PC1:actions" } } : null };
  ui.get("#rule-detail").emit("click", { target: star });
  controller.selectRule("Avalon:camp");
  const menu = ui.get("#rules-saved-menu");
  const open = () => {
    menu.open = true;
    ui.get("#rules-saved").emit("toggle", { target: { dataset: { savedMenu: "" }, open: true } });
  };
  open();
  savedView(ui, "starred");
  assert.match(ui.get("#rules-saved").innerHTML, /aria-label="Starred rules"/);
  assert.doesNotMatch(ui.get("#rules-saved").innerHTML, /data-saved-rule="Avalon:camp"/);
  savedView(ui, "recent");
  assert.match(ui.get("#rules-saved").innerHTML, /aria-label="Recently viewed rules"/);
  assert.equal((ui.get("#rules-saved").innerHTML.match(/<ul /g) || []).length, 1);
  const shortcut = { closest: selector => selector === "[data-saved-rule]" ? { dataset: { savedRule: "PC1:actions" } } : null };
  ui.get("#rules-saved").emit("click", { target: shortcut });
  assert.equal(controller.selectedId, "PC1:actions");
  assert.doesNotMatch(ui.get("#rules-saved").innerHTML, /data-saved-menu open/);
  open();
  ui.document.emit("keydown", { key: "Escape" });
  assert.equal(menu.open, false);
  assert.equal(ui.get("#rules-saved-menu > summary").focused, true);
  open();
  ui.document.emit("pointerdown", { target: {} });
  assert.equal(menu.open, false);
});

test("standalone rule links expose the same outline and save stars and visits", () => {
  const ui = environment("?id=PC1%3Aactions", "rule");
  mountRule(fixture(), ui);
  assert.match(ui.get("#rule-article").innerHTML, /On this page/);
  assert.deepEqual(JSON.parse(ui.storage.get(READER_STATE_KEY)).recent, ["PC1:actions"]);
  const star = { closest: selector => selector === "[data-star-rule]" ? {} : null };
  ui.get("#rule-article").emit("click", { target: star });
  assert.equal(ui.get("#rule-star").getAttribute("aria-pressed"), "true");
});

test("filter pills support multiple includes, exclusions, live counts and resetting without losing name search", () => {
  const ui = environment();
  mountRuleBrowser(fixture(), ui);
  const pc1 = filterPill(ui, "source", "PC1");
  assert.match(pc1.innerHTML, /filter-pill-count">2<\/span>/);
  ui.get("#rule-detail").scrollTop = 60;
  clickFilter(ui, "source", "PC1");
  assert.deepEqual(resultIds(ui), ["PC1:actions", "PC1:stride"]);
  assert.equal(ui.get("#rule-detail").scrollTop, 60);
  assert.equal(filterPill(ui, "source", "PC1"), pc1);
  assert.equal(pc1.getAttribute("data-state"), "include");
  assert.match(pc1.getAttribute("aria-label"), /PC1: included/);
  assert.match(filterPill(ui, "source", "Avalon").innerHTML, /filter-pill-count">1<\/span>/);
  clickFilter(ui, "source", "Avalon");
  assert.equal(ui.get("#rules-count").textContent, "3 rules");
  assert.deepEqual(ui.window.location.searchParams.getAll("source").sort(), ["Avalon", "PC1"]);
  clickFilter(ui, "kind", "optional");
  assert.deepEqual(resultIds(ui), ["PC1:stride"]);
  clickFilter(ui, "source", "PC1", { shiftKey: true });
  assert.equal(pc1.getAttribute("data-state"), "exclude");
  assert.match(pc1.getAttribute("aria-label"), /excluded/);
  assert.equal(ui.window.location.searchParams.get("not-source"), "PC1");
  assert.equal(ui.get("#rules-count").textContent, "0 rules");
  assert.match(ui.get("#rules-active-filters").innerHTML, /Source: − PC1/);
  const rightClick = ui.get("#rules-filter-groups").emit("contextmenu", { target: pc1 });
  assert.equal(rightClick.defaultPrevented, true);
  assert.equal(pc1.getAttribute("data-state"), "neutral");
  clearFilterGroup(ui, "source");
  assert.deepEqual(resultIds(ui), ["PC1:stride"]);
  ui.get("#rules-search").value = "str";
  ui.get("#rules-search").emit("input");
  ui.get("#rules-filter-reset").emit("click");
  assert.equal(ui.get("#rules-search").value, "str");
  assert.deepEqual(resultIds(ui), ["PC1:stride"]);
  assert.equal(ui.get("#rules-active-filters").hidden, true);
  assert.equal(ui.get("#rules-filter-count").textContent, "");
});

test("Include and Exclude modes allow touch and keyboard filtering without right-click", () => {
  const ui = environment();
  mountRuleBrowser(fixture(), ui);
  ui.get("#filter-mode-exclude").emit("click");
  assert.equal(ui.get("#filter-mode-exclude").getAttribute("aria-pressed"), "true");
  assert.equal(ui.get("#filter-mode-include").getAttribute("aria-pressed"), "false");
  assert.match(filterPill(ui, "kind", "optional").getAttribute("aria-label"), /Click to exclude/);
  clickFilter(ui, "kind", "optional");
  assert.equal(filterPill(ui, "kind", "optional").getAttribute("data-state"), "exclude");
  assert.deepEqual(new Set(resultIds(ui)), new Set(["PC1:actions", "Avalon:camp"]));
  clickFilter(ui, "kind", "optional");
  assert.equal(filterPill(ui, "kind", "optional").getAttribute("data-state"), "neutral");
  ui.get("#filter-mode-include").emit("click");
  clickFilter(ui, "kind", "optional");
  assert.deepEqual(resultIds(ui), ["PC1:stride"]);
});

test("multi-select filters and excluded chips restore with reload and Back/Forward", () => {
  const ui = environment("?source=PC1&source=Avalon&not-kind=optional&id=PC1%3Aactions");
  mountRuleBrowser(fixture(), ui);
  assert.deepEqual(new Set(resultIds(ui)), new Set(["PC1:actions", "Avalon:camp"]));
  assert.equal(ui.get("#rules-filter-count").textContent, "3");
  assert.equal(filterPill(ui, "kind", "optional").getAttribute("data-state"), "exclude");
  ui.get("#rules-results").emit("click", { target: ui.row("Avalon:camp") });
  const target = { closest: selector => selector === "[data-remove-filter]" ? { dataset: { removeFilter: "source", filterValue: "PC1" } } : null };
  ui.get("#rules-active-filters").emit("click", { target });
  assert.deepEqual(resultIds(ui), ["Avalon:camp"]);
  assert.equal(ui.get("#rules-filter-summary").focused, true);
  const reloaded = environment(ui.window.location.search);
  mountRuleBrowser(fixture(), reloaded);
  assert.deepEqual(resultIds(reloaded), ["Avalon:camp"]);
  assert.equal(filterPill(reloaded, "source", "Avalon").getAttribute("data-state"), "include");
  assert.equal(filterPill(reloaded, "kind", "optional").getAttribute("data-state"), "exclude");
  ui.window.history.back();
  assert.deepEqual(new Set(resultIds(ui)), new Set(["PC1:actions", "Avalon:camp"]));
  assert.equal(filterPill(ui, "source", "PC1").getAttribute("data-state"), "include");
  ui.window.history.forward();
  assert.deepEqual(resultIds(ui), ["Avalon:camp"]);
});

test("the filter panel dismisses on Escape or outside interaction without clearing selections", () => {
  const ui = environment();
  mountRuleBrowser(fixture(), ui);
  clickFilter(ui, "source", "PC1");
  const menu = ui.get("#rules-filter-menu");
  menu.open = true;
  ui.document.emit("keydown", { key: "Escape" });
  assert.equal(menu.open, false);
  assert.equal(ui.get("#rules-filter-summary").focused, true);
  menu.open = true;
  ui.document.emit("pointerdown", { target: menu });
  assert.equal(menu.open, true);
  ui.document.emit("pointerdown", { target: {} });
  assert.equal(menu.open, false);
  assert.equal(filterPill(ui, "source", "PC1").getAttribute("data-state"), "include");
});

test("multi-select filters work in Browse while retaining nonmatching parents as context", () => {
  const library = createRuleLibrary({ rules: [{ id: "checks", name: "Checks", source: "PC1", entries: [
    { type: "h2", id: "child", name: "Optional Check", kind: "optional", rule: true, entries: ["Text."] },
  ] }] });
  const ui = environment("?view=browse&kind=optional");
  mountRuleBrowser(library, ui);
  assert.deepEqual(resultIds(ui), ["PC1:checks", "PC1:child"]);
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.equal(browseBranch(ui, "PC1:checks").open, true);
  assert.match(ui.get("#rules-results").innerHTML, /rule-branch-link--context/);
});

const browseFixture = () => createRuleLibrary({ rules: [
  { id: "checks", name: "Checks", source: "PC1", entries: [
    { type: "h2", id: "attack", name: "Attack Rolls", rule: true, entries: [
      { type: "h3", id: "map", name: "Multiple Attack Penalty", rule: true, entries: ["Attack again."] },
    ] },
  ] },
  { id: "damage", name: "Damage", source: "PC1", entries: [
    { type: "h2", id: "damage-types", name: "Damage Types", rule: true, entries: ["Choose a type."] },
  ] },
] });
const browseBranch = (ui, id) => ui.get("#rules-results").querySelectorAll("[data-rule-branch]").find(branch => branch.dataset.ruleBranch === id);

test("Browse reveals and remembers source and chapter groups for direct links and in-page rule links", () => {
  const library = createRuleLibrary({ sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [
    { id: "checks", name: "Checks", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: [
      { type: "h2", id: "attack", name: "Attack Rolls", rule: true, entries: ["Attack."] },
    ] },
    { id: "dc", name: "Difficulty Classes", source: "GMC", chapter: "Chapter 1: Running the Game", entries: ["DCs."] },
  ] });
  const ui = environment("?view=browse&id=PC1%3Aattack");
  const controller = mountRuleBrowser(library, ui);
  const pc1 = JSON.stringify(["source", "PC1"]);
  const pc1Chapter = JSON.stringify(["chapter", "PC1", "Chapter 8: Playing the Game"]);
  const gmc = JSON.stringify(["source", "GMC"]);
  const gmcChapter = JSON.stringify(["chapter", "GMC", "Chapter 1: Running the Game"]);
  assert.equal(browseBranch(ui, pc1).open, true);
  assert.equal(browseBranch(ui, pc1Chapter).open, true);
  assert.equal(browseBranch(ui, "PC1:checks").open, true);
  assert.equal(browseBranch(ui, gmc).open, false);
  const group = browseBranch(ui, gmc);
  group.open = true;
  ui.get("#rules-results").emit("toggle", { target: group });
  assert.equal(controller.selectedId, "PC1:attack");
  ui.get("#rules-filter-reset").emit("click");
  assert.equal(browseBranch(ui, gmc).open, true);
  assert.equal(browseBranch(ui, gmcChapter).open, false);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "dc", ruleSource: "GMC" } } : null };
  ui.document.emit("click", { target });
  assert.equal(controller.selectedId, "GMC:dc");
  assert.equal(browseBranch(ui, gmcChapter).open, true);
  assert.equal(ui.get("#rules-count").textContent, "3 rules");
  const searched = environment("?view=browse&q=Attack");
  mountRuleBrowser(library, searched);
  assert.equal(browseBranch(searched, pc1).open, true);
  assert.equal(browseBranch(searched, pc1Chapter).open, true);
  assert.equal(browseBranch(searched, gmc), undefined);
  assert.equal(searched.get("#rules-count").textContent, "1 rule");
});

test("Browse remembers disclosures, clicking a name opens its rule and links reveal collapsed parents", () => {
  const ui = environment("?view=browse&id=PC1%3Achecks");
  const controller = mountRuleBrowser(browseFixture(), ui);
  const branch = browseBranch(ui, "PC1:damage");
  assert.equal(branch.open, false);
  branch.open = true;
  ui.get("#rules-results").emit("toggle", { target: branch });
  assert.equal(controller.selectedId, "PC1:checks");
  ui.get("#rules-filter-reset").emit("click");
  assert.equal(browseBranch(ui, "PC1:damage").open, true);
  const row = ui.row("PC1:attack");
  const clicked = ui.get("#rules-results").emit("click", { target: row });
  assert.equal(clicked.defaultPrevented, true);
  assert.equal(controller.selectedId, "PC1:attack");
  assert.match(ui.get("#rule-detail").innerHTML, /<nav class="rule-path"/);
  assert.equal(browseBranch(ui, "PC1:checks").open, true);
  const ref = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "map", ruleSource: "PC1" } } : null };
  ui.document.emit("click", { target: ref });
  assert.equal(controller.selectedId, "PC1:map");
  assert.equal(browseBranch(ui, "PC1:attack").open, true);
  assert.equal(ui.row("PC1:map").attributes.get("aria-current"), "true");
  assert.match(ui.get("#rule-detail").innerHTML, /data-rule-name="PC1:checks".*data-rule-name="PC1:attack".*aria-current="page">Multiple Attack Penalty/);
  const parentRef = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "checks", ruleSource: "PC1" } } : null };
  ui.document.emit("click", { target: parentRef });
  assert.equal(controller.selectedId, "PC1:checks");
});

test("Browse ancestor navigation clears excluding filters and modified clicks retain native navigation", () => {
  const ui = environment("?view=browse&q=Multiple+Attack+Penalty&id=PC1%3Amap");
  const controller = mountRuleBrowser(browseFixture(), ui);
  const event = ui.get("#rules-results").emit("click", { target: ui.row("PC1:checks"), ctrlKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(controller.selectedId, "PC1:map");
  ui.get("#rules-results").emit("click", { target: ui.row("PC1:checks") });
  assert.equal(controller.selectedId, "PC1:checks");
  assert.equal(ui.get("#rules-search").value, "");
  assert.equal(ui.get("#rules-count").textContent, "5 rules");
  ui.get("#rules-search").value = "not a rule";
  ui.get("#rules-search").emit("input");
  assert.match(ui.get("#rules-results").innerHTML, /No matching rules/);
  const missing = environment("?view=unknown");
  mountRuleBrowser(browseFixture(), missing);
  assert.match(missing.get("#rules-results").innerHTML, /aria-label="Rules by source and chapter"/);
  assert.equal(missing.window.location.searchParams.get("view"), null);
});

test("search and clearing filters leave the reader unselected until a rule is chosen", () => {
  const ui = environment("?q=act&source=PC1");
  mountRuleBrowser(fixture(), ui);
  assert.equal(ui.get("#rules-search").value, "act");
  assert.equal(ui.get("#results-title").textContent, "Search results");
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
  assert.equal(ui.row("PC1:actions").attributes.has("aria-current"), false);
  ui.get("#rules-search").value = "nothing matches";
  ui.get("#rules-search").emit("input");
  assert.match(ui.get("#rules-results").innerHTML, /No matching rules/);
  assert.match(ui.get("#rule-detail").innerHTML, /No matching rules/);
  assert.equal(ui.window.location.searchParams.get("id"), null);
  ui.get("#clear-search").emit("click");
  assert.equal(ui.window.location.pathname, "/project/rules.html");
  assert.equal(ui.window.location.searchParams.get("q"), null);
  assert.equal(ui.window.location.searchParams.get("source"), null);
  assert.equal(ui.get("#rules-search").focused, true);
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
});

test("clicking a list entry updates only the detail pane and supports Back and Forward", () => {
  const ui = environment();
  const controller = mountRuleBrowser(fixture(), ui);
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
  assert.equal(controller.selectedId, null);
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
  ui.window.history.forward();
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
});

test("modified list clicks keep native new-tab navigation and do not change selection", () => {
  const ui = environment();
  const controller = mountRuleBrowser(fixture(), ui);
  const event = ui.get("#rules-results").emit("click", { target: ui.row("Avalon:camp"), ctrlKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(controller.selectedId, null);
  assert.match(ui.get("#rules-results").innerHTML, /href="rules.html\?id=Avalon%3Acamp"/);
});

test("obsolete category URL parameters are discarded while selection and Browse remain usable", () => {
  const ui = environment("?topic=Checks&not-topic=Other&id=PC1%3Aactions&view=browse");
  const controller = mountRuleBrowser(fixture(), ui);
  assert.equal(controller.selectedId, "PC1:actions");
  assert.equal(ui.window.location.searchParams.get("topic"), null);
  assert.equal(ui.window.location.searchParams.get("not-topic"), null);
  assert.equal(ui.window.location.searchParams.get("view"), null);
  assert.equal(ui.get("#rules-count").textContent, "3 rules");
  assert.doesNotMatch(ui.get("#rules-filter-groups").innerHTML, /Topics|data-filter-group="topic"/);
  assert.doesNotMatch(ui.get("#library-summary").textContent, /topics/i);
});

test("source and type filters combine with search and retain the current rule when possible", () => {
  const ui = environment("?id=PC1%3Aactions");
  mountRuleBrowser(fixture(), ui);
  ui.get("#rule-detail").scrollTop = 75;
  clickFilter(ui, "kind", "core");
  assert.equal(ui.get("#rule-detail").scrollTop, 75);
  clickFilter(ui, "source", "Avalon");
  assert.equal(ui.get("#rules-count").textContent, "0 rules");
  clickFilter(ui, "kind", "core");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
  clickFilter(ui, "kind", "optional");
  assert.equal(ui.get("#rules-count").textContent, "0 rules");
});

test("rule references in details or hover cards open in place and reveal rules excluded by filters", () => {
  const ui = environment("?source=Avalon&id=Avalon%3Acamp");
  mountRuleBrowser(fixture(), ui);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "Actions", ruleSource: "PC1" } } : null };
  const event = ui.document.emit("click", { target });
  assert.equal(event.defaultPrevented, true);
  assert.match(ui.get("#rule-detail").innerHTML, /Spend three actions/);
  assert.equal(ui.window.location.searchParams.get("source"), null);
  assert.equal(ui.window.location.searchParams.get("id"), "PC1:actions");
  assert.equal(ui.get("#rule-detail").focused, true);
  const modified = ui.document.emit("click", { target, metaKey: true });
  assert.equal(modified.defaultPrevented, false);
});

test("deep links and missing rule ids keep the list usable", () => {
  const ui = environment("?id=Avalon%3Acamp&q=unrelated");
  mountRuleBrowser(fixture(), ui);
  assert.match(ui.get("#rule-detail").innerHTML, /Rest and recover/);
  assert.equal(ui.get("#rules-search").value, "");
  const missing = environment("?id=missing");
  const controller = mountRuleBrowser(fixture(), missing);
  assert.match(missing.get("#rule-detail").innerHTML, /Rule not found/);
  assert.ok(missing.row("PC1:actions"));
  controller.selectRule("PC1:actions");
  assert.match(missing.get("#rule-detail").innerHTML, /Spend three actions/);
  const named = environment("?rule=Actions&source=PC1");
  mountRuleBrowser(fixture(), named);
  assert.equal(named.window.location.searchParams.get("id"), "PC1:actions");
});

test("source-less tags and name-based URLs open GM-only rules in place", () => {
  const library = createRuleLibrary({ rules: [
    { id: "checks", name: "Checks", source: "PC1", entries: ["See {@rule Difficulty Classes}."] },
    { id: "dc", name: "Difficulty Classes", source: "GMC", entries: ["GM difficulty rules."] },
  ] });
  const ui = environment("?id=PC1%3Achecks");
  mountRuleBrowser(library, ui);
  assert.match(ui.get("#rule-detail").innerHTML, /href="rules.html\?id=GMC%3Adc"/);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "Difficulty Classes", ruleSource: "" } } : null };
  const event = ui.document.emit("click", { target });
  assert.equal(event.defaultPrevented, true);
  assert.match(ui.get("#rule-detail").innerHTML, /GM difficulty rules/);
  const named = environment("?rule=Difficulty+Classes");
  mountRuleBrowser(library, named);
  assert.equal(named.window.location.searchParams.get("id"), "GMC:dc");
  const explicit = environment("?rule=Difficulty+Classes&source=PC1");
  mountRuleBrowser(library, explicit);
  assert.match(explicit.get("#rule-detail").innerHTML, /Rule not found/);
  const standalone = environment("?rule=Difficulty+Classes", "rule");
  mountRule(library, standalone);
  assert.match(standalone.get("#rule-article").innerHTML, /GM difficulty rules/);
});

test("promoted sections select independently and link back to their containing rule", () => {
  const library = createRuleLibrary({ rules: [{ id: "checks", name: "Checks", source: "PC1", page: 400, entries: [
    "Parent introduction. See {@rule Modifier}.",
    { type: "h3", id: "modifier", name: "Modifier", rule: true, entries: ["Modifier description."] },
  ] }] });
  const ui = environment("?id=PC1%3Achecks");
  mountRuleBrowser(library, ui);
  assert.ok(ui.row("PC1:modifier"));
  assert.match(ui.get("#rule-detail").innerHTML, /href="rules.html\?id=PC1%3Amodifier"/);
  ui.get("#rules-results").emit("click", { target: ui.row("PC1:modifier") });
  assert.match(ui.get("#rule-detail").innerHTML, /Modifier description/);
  assert.doesNotMatch(ui.get("#rule-detail").innerHTML, /Parent introduction/);
  assert.match(ui.get("#rule-detail").innerHTML, /<nav class="rule-path"[^>]*>.*data-rule-name="PC1:checks"[^>]*>Checks<\/a>/);
  assert.match(ui.get("#rule-detail").innerHTML, /p\. 400/);
  ui.get("#rules-search").value = "Modifier";
  ui.get("#rules-search").emit("input");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.match(ui.get("#rules-results").innerHTML, /rule-branch-link--context/);
  const target = { closest: selector => selector === "[data-rule-name]" ? { dataset: { ruleName: "checks", ruleSource: "PC1" } } : null };
  ui.document.emit("click", { target });
  assert.match(ui.get("#rule-detail").innerHTML, /Parent introduction/);
});

test("mobile selection reveals the rule without adding a back-to-list button", () => {
  const ui = environment("", "rules", { mobile: true });
  mountRuleBrowser(fixture(), ui);
  ui.get("#rules-results").emit("click", { target: ui.row("Avalon:camp") });
  assert.equal(ui.get("#rule-detail").scrolled, true);
  assert.equal(ui.get("#rule-detail").focused, true);
  assert.doesNotMatch(ui.get("#rule-detail").innerHTML, /back-to-list|Rule list/);
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
  assert.match(source.get("#rule-article").innerHTML, /PC1<\/span> · p\. 10/);
  assert.match(source.get("#rule-related").innerHTML, /Stride/);
  assert.throws(() => mountRule(library, environment("?id=missing", "rule")), /could not be found/);
});

test("loader validates rule data and shows failures with a recovery link", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rules: [{ id: "missing-name" }] }) });
  await assert.rejects(loadLibrary(), /needs a name/);
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

test("source deep links retain selection and standalone related rules follow the chapter", () => {
  const library = createRuleLibrary({ sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [
    { id: "dual", name: "Main Rule", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: ["Main text."] },
    { id: "related", name: "Related Rule", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: ["Related text."] },
    { id: "other", name: "Other Chapter", source: "PC1", chapter: "Chapter 1: Introduction", entries: ["Other text."] },
    { id: "gm", name: "GM Rule", source: "GMC", chapter: "Chapter 8: Playing the Game", entries: ["GM text."] },
  ] });
  const ui = environment("?source=PC1&id=PC1%3Adual");
  mountRuleBrowser(library, ui);
  assert.equal(filterPill(ui, "source", "PC1").getAttribute("data-state"), "include");
  assert.equal(ui.get("#rules-count").textContent, "3 rules");
  assert.match(ui.get("#library-summary").textContent, /4 rules · 2 sources/);
  const standalone = environment("?id=PC1%3Adual", "rule");
  mountRule(library, standalone);
  assert.match(standalone.get("#rule-related").innerHTML, /Related Rule/);
  assert.doesNotMatch(standalone.get("#rule-related").innerHTML, /Other Chapter|GM Rule/);
  assert.match(standalone.get("#rule-related").innerHTML, /In this chapter/);
  assert.match(standalone.get("#rule-breadcrumbs").innerHTML, /Chapter 8: Playing the Game/);
});

test("type filters are restored from the URL and cleared together", () => {
  const ui = environment("?kind=optional");
  mountRuleBrowser(fixture(), ui);
  assert.equal(filterPill(ui, "kind", "optional").getAttribute("data-state"), "include");
  assert.equal(ui.get("#rules-count").textContent, "1 rule");
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
  clearFilterGroup(ui, "kind");
  clickFilter(ui, "kind", "setting");
  assert.equal(ui.window.location.searchParams.get("kind"), "setting");
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule/);
  ui.get("#clear-search").emit("click");
  assert.equal(ui.window.location.searchParams.get("kind"), null);
  assert.equal(ui.get("#rules-count").textContent, "3 rules");
});


test("chapter clicks read the full authored chapter once, clear filters and support history without populating recent rules", () => {
  const library = createRuleLibrary({ sources: [{ id: "PC1", name: "Player Core" }], rules: [
    { type: "h1", name: "Chapter 8", source: "PC1", entries: [
      "Chapter introduction.",
      { type: "h2", name: "First", entries: ["First text.", { type: "h3", name: "Child", entries: ["Child text."] }] },
      { type: "h2", name: "Second", entries: ["Second text."] },
    ] },
  ] });
  const ui = environment("?q=Child");
  const controller = mountRuleBrowser(library, ui);
  const chapter = ui.get("#rules-results").querySelectorAll("[data-select-chapter]")[0];
  assert.equal(ui.get("#rules-results").emit("click", { target: chapter, ctrlKey: true }).defaultPrevented, false);
  assert.equal(controller.selectedChapter, null);
  assert.equal(ui.get("#rules-results").emit("click", { target: chapter }).defaultPrevented, true);
  assert.equal(controller.selectedId, null);
  assert.equal(controller.selectedChapter.title, "Chapter 8");
  assert.equal(ui.get("#rules-search").value, "");
  const html = ui.get("#rule-detail").innerHTML;
  for (const text of ["Chapter introduction.", "First text.", "Child text.", "Second text."]) assert.equal(html.split(text).length - 1, 1);
  assert.equal(ui.storage.get(READER_STATE_KEY), undefined);
  assert.equal(ui.window.location.searchParams.get("chapter-source"), "PC1");
  assert.equal(ui.window.location.searchParams.get("chapter"), "Chapter 8");
  assert.equal(ui.window.location.searchParams.has("id"), false);
  assert.equal(ui.previews.validated.at(-1), ui.get("#rule-detail"));
  const reloaded = environment(ui.window.location.search);
  assert.equal(mountRuleBrowser(library, reloaded).selectedChapter.title, "Chapter 8");
  controller.selectRule("PC1:child");
  assert.equal(ui.window.location.searchParams.has("chapter"), false);
  ui.window.history.back();
  assert.equal(controller.selectedChapter.title, "Chapter 8");
  ui.window.history.back();
  assert.equal(controller.selectedChapter, null);
  assert.equal(controller.selectedId, null);
  assert.equal(ui.get("#rules-search").value, "Child");
  ui.window.history.forward();
  assert.equal(controller.selectedChapter.title, "Chapter 8");
});

test("intro-only chapters can be selected while empty searches and clear restore the right prompts", () => {
  const library = createRuleLibrary({ rules: [{ type: "h1", name: "Chapter 8", source: "PC1", entries: ["Chapter introduction."] }] });
  const ui = environment();
  const controller = mountRuleBrowser(library, ui);
  assert.equal(controller.selectedChapter, null);
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule or chapter/);
  ui.get("#rules-search").value = "missing";
  ui.get("#rules-search").emit("input");
  assert.match(ui.get("#rule-detail").innerHTML, /No matching rules/);
  ui.get("#clear-search").emit("click");
  assert.match(ui.get("#rule-detail").innerHTML, /Choose a rule or chapter/);
  const chapter = ui.get("#rules-results").querySelectorAll("[data-select-chapter]")[0];
  assert.equal(ui.get("#rules-results").emit("click", { target: chapter }).defaultPrevented, true);
  assert.equal(controller.selectedChapter.title, "Chapter 8");
  assert.match(ui.get("#rule-detail").innerHTML, /Chapter introduction/);
  for (const query of ["?rule=Chapter+8&source=PC1", "?id=PC1%3Achapter-8"]) {
    const direct = environment(query);
    assert.equal(mountRuleBrowser(library, direct).selectedChapter.title, "Chapter 8");
    assert.match(direct.get("#rule-detail").innerHTML, /Chapter introduction/);
    assert.equal(direct.window.location.searchParams.get("chapter"), "Chapter 8");
  }
  const fresh = environment();
  const freshController = mountRuleBrowser(library, fresh);
  assert.equal(freshController.selectRule("PC1:chapter-8"), true);
  assert.equal(freshController.selectedChapter.title, "Chapter 8");
});

test("chapter errors remain recoverable and individual-rule URLs take priority over chapter parameters", () => {
  const library = createRuleLibrary({ rules: [{ name: "First", source: "PC1", chapter: "Chapter 8", entries: ["First text."] }] });
  const missing = environment("?chapter-source=PC1&chapter=Unknown");
  const controller = mountRuleBrowser(library, missing);
  assert.match(missing.get("#rule-detail").innerHTML, /Chapter not found/);
  assert.equal(controller.selectChapter("PC1", "Unknown"), false);
  controller.selectRule("PC1:first");
  assert.match(missing.get("#rule-detail").innerHTML, /First text/);
  const direct = environment("?chapter-source=PC1&chapter=Unknown&id=PC1%3Afirst");
  assert.equal(mountRuleBrowser(library, direct).selectedId, "PC1:first");
  assert.equal(direct.window.location.searchParams.has("chapter"), false);
});

test("ambiguous rule URLs show an error without choosing a target, and recover through exact links and history", () => {
  const library = createRuleLibrary({ rules: [
    { name: "Areas", source: "PC1", page: 300, entries: ["Spell areas text."] },
    { name: "Areas", source: "PC1", page: 426, entries: ["General areas text."] },
  ] });
  const ui = environment("?rule=Areas");
  const controller = mountRuleBrowser(library, ui);
  assert.equal(controller.selectedId, null);
  const detail = ui.get("#rule-detail");
  assert.match(detail.innerHTML, /Ambiguous rule link/);
  assert.doesNotMatch(detail.innerHTML, /data-select-rule=|rule-match-options|Spell areas text|General areas text/);
  controller.selectRule("PC1:areas-426");
  assert.match(detail.innerHTML, /General areas text/);
  ui.window.history.back();
  assert.equal(controller.selectedId, null);
  assert.match(detail.innerHTML, /Ambiguous rule link/);
  ui.get("#clear-search").emit("click");
  assert.match(detail.innerHTML, /Choose a rule or chapter/);
});
