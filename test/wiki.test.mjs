import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { createWiki, loadWiki, renderWikiHome, renderWikiIndex, searchWiki } from "../scripts/wiki-build.mjs";
import { filterWikiCards, legacyWikiUrl, mountWiki } from "../js/wiki.js";

const wiki = await loadWiki();
const output = new URL("../_site/", import.meta.url);
const read = path => readFile(new URL(path, output), "utf8");
const metadata = { categories: [{ id: "world", name: "World", icon: "map" }] };
const document = (id, title, content, facts = []) => ({ id, data: { title, category: "world", facts }, content });

test("Markdown articles resolve forward links, derive backlinks from text and facts, and preserve code examples", () => {
  const model = createWiki(metadata, [document("one", "One", "See [[Two|the next page]]. Again [[two]].\n\n[Also visit](two.md#overview).\n\n## Overview\n\n`[[Missing]]`\n\n```\n[[Missing]]\n```", [{ label: "Related", value: "**Visit** [Two](two.md)" }]), document("two", "Two", "## Overview\n\nText.")]);
  assert.equal(model.resolve("two").target, model.resolve("TWO").target);
  assert.equal(model.backlinks.get("two").size, 1);
  assert.equal([...model.backlinks.get("two")][0].id, "one");
  assert.match(model.byId.get("one").html, /href="setting\/two.html"[^>]*>.*the<\/span> next page<\/a>/);
  assert.match(model.byId.get("one").html, /<code>\[\[Missing\]\]<\/code>/);
  assert.match(model.byId.get("one").facts[0].html, /<strong>Visit<\/strong>/);
  assert.match(model.byId.get("one").html, /href="setting\/two.html#overview"/);
  assert.equal(model.resolve("Unknown").status, "missing");
});

test("the build catches missing wiki links, duplicate titles, colliding URLs, invalid categories and body H1s", () => {
  for (const documents of [
    [document("one", "One", "[[Missing]]")],
    [document("one", "One", "[Missing](missing.md)")],
    [document("one", "Same", "Text"), document("two", "SAME", "Text")],
    [document("one", "One", "Text"), document("one", "Two", "Text")],
    [document("../bad", "One", "Text")],
    [document("articles", "One", "Text")],
    [document("category-world", "One", "Text")],
    [document("one", "One", "# A second title")],
    [{ ...document("one", "One", "Text"), data: { title: "One", category: "missing" } }],
  ]) assert.throws(() => createWiki(metadata, documents));
});

test("Markdown headings get unique anchors and native game links keep their data for hover previews", () => {
  const model = createWiki(metadata, [document("one", "One", 'Use {@action Stride|PC1}, {@trait move}, and {@rule Actions}.\n\n## **Repeat**\n\n### Repeat\n\n## `Repeat`\n\n<script>alert("raw")</script>')]);
  const article = model.byId.get("one");
  assert.deepEqual(article.headings.map(heading => heading.id), ["repeat", "repeat-2", "repeat-3"]);
  assert.deepEqual(article.headings.map(heading => heading.level), [2, 3, 2]);
  assert.match(article.html, /data-action-name="Stride"/);
  assert.match(article.html, /data-trait-name="move"/);
  assert.match(article.html, /data-rule-name="Actions"/);
  assert.match(article.html, /<h2 id="repeat" data-heading-level="2">/);
  assert.match(article.html, /id="wiki-one-1"/);
  assert.doesNotMatch(article.html, /<script>/);
  const collisions = createWiki(metadata, [document("one", "One", "## Name\n\n## Name\n\n## Name-2\n\n## Wiki Content\n\n## Wiki One 1")]).byId.get("one");
  assert.equal(new Set(collisions.headings.map(heading => heading.id)).size, 5);
  assert.ok(collisions.headings.every(heading => !["wiki-content", "wiki-one-1"].includes(heading.id)));
});

test("the atlas emits complete readable pages, categories and backlinks without client-side rendering", async () => {
  for (const page of wiki.pages) {
    const html = await read(page.output);
    assert.match(html, /id="wiki-content"[^>]*>\s*<(?:article|header)/);
    assert.match(html, /<nav id="wiki-navigation"[^>]*><a href="setting.html"/);
    assert.doesNotMatch(html, /Opening the atlas|data\/wiki.json|undefined|\[object Object\]/);
    if (page.type === "article") {
      assert.match(html, /At a glance/);
      assert.match(html, /What links here/);
      for (const heading of wiki.byId.get(page.article).headings) {
        assert.ok(html.includes(`href="${page.output}#${heading.id}"`));
        assert.ok(html.includes(`id="${heading.id}" data-heading-level="${heading.level}"`));
      }
    }
  }
  await assert.rejects(stat(new URL("data/wiki.json", output)), { code: "ENOENT" });
  await assert.rejects(stat(new URL("content/setting/articles/avalon.md", output)), { code: "ENOENT" });
});

test("built wiki links and assets resolve under both domain roots and GitHub Pages project paths", async () => {
  for (const prefix of ["/", "/avalontools/"]) for (const page of wiki.pages) {
    const html = await read(page.output), pageURL = new URL(prefix + page.output, "https://example.test");
    const base = html.match(/<base href="([^"]+)"/);
    const documentBase = base ? new URL(base[1], pageURL) : pageURL;
    for (const match of html.matchAll(/<(?:a|script|link|img|use|form)\b[^>]*\b(?:href|src|action)="([^"]+)"/g)) {
      const url = new URL(match[1].replaceAll("&amp;", "&"), documentBase);
      if (url.origin !== pageURL.origin) continue;
      assert.ok(url.pathname.startsWith(prefix), url.href);
      const path = decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html";
      assert.ok((await stat(new URL(path, output))).isFile(), `${page.output}: ${path}`);
      if (url.hash) assert.ok((await read(path)).includes(`id="${decodeURIComponent(url.hash.slice(1))}"`), `${page.output}: ${url.href}`);
    }
  }
});

test("name search and collection browsing agree with the static atlas", () => {
  assert.deepEqual(searchWiki(wiki, "THE CROSS").map(article => article.id), ["the-crossroads"]);
  assert.equal(searchWiki(wiki, "crossroads", "people").length, 0);
  assert.equal(searchWiki(wiki, "caravan").length, 0);
  assert.match(renderWikiIndex(wiki, "places"), /<h1 id="wiki-results-title">Places<\/h1>/);
  assert.match(renderWikiHome(createWiki({ categories: [] }, [])), /setting\/articles.html/);
});

test("old query-string wiki URLs migrate to static pages while preserving search and fragments", () => {
  const routes = { "the crossroads": "setting/the-crossroads.html", "the-crossroads": "setting/the-crossroads.html" };
  const base = "https://example.test/avalontools/";
  for (const name of ["The Crossroads", "the-crossroads"]) {
    const result = legacyWikiUrl(new URL(`${base}setting.html?article=${encodeURIComponent(name)}#the-lantern`), base, routes);
    assert.equal(result.href, `${base}setting/the-crossroads.html#the-lantern`);
  }
  assert.equal(legacyWikiUrl(new URL(`${base}setting.html?category=places`), base).href, `${base}setting/category-places.html`);
  assert.equal(legacyWikiUrl(new URL(`${base}setting.html?view=all&q=The+Cross`), base).searchParams.get("q"), "The Cross");
  assert.equal(legacyWikiUrl(new URL(`${base}setting/articles.html?q=Mara`), base), null);
  assert.equal(legacyWikiUrl(new URL(`${base}setting.html?category=../../private`), base), null);
});

function environment(query = "", searchable = true) {
  class Target {
    handlers = new Map(); attrs = new Map(); value = ""; focused = false;
    addEventListener(type, handler) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(handler); }
    removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
    emit(type) { const event = { preventDefault() { this.defaultPrevented = true; } }; for (const handler of this.handlers.get(type) || []) handler(event); return event; }
    focus() { this.focused = true; }
  }
  const nodes = new Map(), document = new Target(), window = new Target(), viewport = new Target();
  const cards = wiki.articles.map(article => ({ dataset: { wikiName: article.name } }));
  document.querySelector = id => {
    if (id === '[data-wiki-searchable="true"]') return searchable ? document.querySelector("#wiki-results") : null;
    if (!nodes.has(id)) nodes.set(id, new Target()); return nodes.get(id);
  };
  document.querySelector("#wiki-results").querySelectorAll = () => cards;
  viewport.matches = true; window.matchMedia = () => viewport;
  window.location = new URL(`http://localhost/setting/articles.html${query}`);
  window.history = { replaceState(_a, _b, url) { window.location = new URL(url, window.location); } };
  const previews = { validated: 0, validateActions() { this.validated++; }, destroy() { this.destroyed = true; } };
  const reader = mountWiki({ document, window, previews });
  return { document, window, viewport, cards, previews, reader, node: id => document.querySelector(id) };
}

test("client enhancement filters existing cards, restores URL searches and keeps multiword input and focus", () => {
  const ui = environment("?q=Cross");
  assert.equal(ui.cards.filter(card => !card.hidden).length, 1);
  assert.equal(ui.node("#wiki-menu").open, false);
  const search = ui.node("#wiki-search"); search.focus(); search.value = "The "; search.emit("input");
  assert.equal(search.value, "The ");
  search.value = "The Cross"; search.emit("input");
  assert.equal(ui.window.location.searchParams.get("q"), "The Cross");
  assert.equal(ui.node("#wiki-result-count").textContent, "1 article");
  assert.equal(search.focused, true);
  search.value = "<script>"; search.emit("input");
  assert.equal(ui.node("#wiki-no-results").hidden, false);
  assert.equal(ui.node("#wiki-results").hidden, true);
  ui.window.location = new URL("http://localhost/setting/articles.html?q=Mara"); ui.window.emit("popstate");
  assert.equal(search.value, "Mara");
  search.value = ""; ui.node("#wiki-search-form").emit("submit");
  assert.equal(ui.cards.filter(card => !card.hidden).length, wiki.articles.length);
  assert.equal(ui.node("#wiki-content").focused, true);
  ui.viewport.matches = false; ui.viewport.emit("change"); assert.equal(ui.node("#wiki-menu").open, true);
  ui.reader.destroy();
  assert.ok([...ui.viewport.handlers.values(), ...ui.window.handlers.values()].every(set => set.size === 0));
  assert.equal(ui.previews.destroyed, true);
  const article = environment("", false);
  assert.equal(article.previews.validated, 1); article.reader.destroy();
  assert.equal(filterWikiCards([], "Anything"), 0);
});
