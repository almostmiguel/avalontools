import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { getChapters, inlineText, renderChapter, renderInline } from "../js/book-renderer.js";
import { attachRulePreviews, createBookRegistry, createRuleRegistry, previewPosition, renderBookPreview, renderRulePreview } from "../js/rule-links.js";

const book = { id: "PC1", source: "PC1", name: "Player Core" };
const action = { type: "h4", name: "Action", aliases: ["actions"], entries: ["Use {@b three actions}. See {@rule Ancestry|PC1}."] };
const chapters = [
  { name: "Introduction", page: 10, entries: [
    { type: "box", name: "First rule", entries: ["Have fun."] },
    { type: "h2", name: "Key Terms", entries: [action, { type: "h4", name: "Ancestry", entries: ["A family of people."] }] },
  ] },
  { name: "More rules", entries: [{ type: "h6", name: "A distant rule", page: 25, entries: ["Found in another chapter."] }] },
];
const registry = createRuleRegistry([{ book, chapters }]);
const options = { source: "PC1", resolveRule: registry.resolve };
const coverBook = { ...book, cover: "img/books/pc1-cover.jpg" };
const bookRegistry = createBookRegistry([coverBook]);

test("book references match titles, ids, and sources and open the actual book", () => {
  for (const [name, source] of [["Player Core", ""], ["pc1", ""], ["Custom label", "PC1"]]) {
    const result = bookRegistry.resolve(name, source);
    assert.equal(result.status, "found");
    assert.equal(result.target.book, coverBook);
    assert.equal(result.target.href, "book.html?book=PC1");
  }
  const opts = { resolveBook: bookRegistry.resolve };
  const html = renderInline("{@b {@book Player Core|PC1|the book}}", opts);
  assert.match(html, /href="book.html\?book=PC1"/);
  assert.match(html, /data-book-name="Player Core" data-book-source="PC1"/);
  assert.match(html, />the book<\/a><\/strong>$/);
  assert.match(renderInline("{@book Player Core}", opts), /class="book-reference"/);
  assert.equal(renderInline("{@code {@book Player Core|PC1}}", opts), "<code>{@book Player Core|PC1}</code>");
});

test("book hover previews contain the uncropped cover and a working reader link", () => {
  const html = renderBookPreview("Player Core", "PC1", bookRegistry);
  assert.match(html, /<h2 id="rule-preview-title">Player Core<\/h2>/);
  assert.match(html, /class="book-preview-cover" src="img\/books\/pc1-cover.jpg"/);
  assert.match(html, /alt="Player Core book cover"/);
  assert.match(html, /class="book-preview-open" href="book.html\?book=PC1"/);
  const noCover = createBookRegistry([book]);
  const noCoverHtml = renderBookPreview("Player Core", "", noCover);
  assert.match(noCoverHtml, /No cover has been added/);
  assert.match(noCoverHtml, /href="book.html\?book=PC1"/);
});

test("unregistered or ambiguous books show useful feedback instead of broken links", () => {
  const opts = { resolveBook: bookRegistry.resolve };
  const missing = renderInline("{@book GM Core}", opts);
  assert.match(missing, /book-reference-unresolved/);
  assert.doesNotMatch(missing, /href=/);
  assert.match(renderBookPreview("GM Core", "", bookRegistry), /not been added to data\/books.json/);
  const duplicateNames = createBookRegistry([book, { ...book, id: "OTHER", source: "OTHER" }]);
  assert.equal(duplicateNames.resolve("Player Core").status, "ambiguous");
  assert.equal(duplicateNames.resolve("Player Core", "PC1").status, "found");
  assert.match(renderBookPreview("Player Core", "", duplicateNames), /Specify its id/);
  const unsafe = createBookRegistry([{ ...book, cover: "javascript:alert(1)" }]);
  assert.doesNotMatch(renderBookPreview("Player Core", "", unsafe), /<img|javascript:/);
  assert.doesNotMatch(renderBookPreview("<script>bad()</script>", "", bookRegistry), /<script>/);
});

test("book references inside rule descriptions use the same book catalog", () => {
  const rules = createRuleRegistry([{ book, chapters: [{ name: "Rules", entries: [{ type: "h4", name: "A rule", entries: ["Read {@book Player Core|PC1}."] }] }] }]);
  const html = renderRulePreview("A rule", "PC1", rules, bookRegistry);
  assert.match(html, /class="book-reference" href="book.html\?book=PC1"/);
});

test("rule targets use the exact rendered anchor and inherit page/source metadata", () => {
  const { target, status } = registry.resolve("  ACTION  ", "pc1");
  assert.equal(status, "found");
  assert.equal(target.entry, action);
  assert.equal(target.page, 10);
  assert.equal(target.chapter, 0);
  assert.equal(target.anchor, renderChapter(chapters[0]).headings.find(heading => heading.entry === action).id);
  const url = new URL(target.href, "https://example.com/avalontools/");
  assert.equal(url.pathname, "/avalontools/book.html");
  assert.equal(url.searchParams.get("rule"), "Action");
  assert.equal(url.hash, `#${target.anchor}`);
  assert.equal(registry.resolve("actions", "PC1").target, target);
  assert.equal(registry.resolve("A distant rule", "PC1").target.chapter, 1);
  assert.equal(registry.resolve("Introduction", "PC1").target.anchor, "chapter-title");
});

test("rule tags render links, custom labels, default sources, and nested formatting", () => {
  const html = renderInline("{@b {@rule Action|PC1|actions}}", options);
  assert.match(html, /^<strong><a class="rule-link"/);
  assert.match(html, />actions<\/a><\/strong>$/);
  assert.match(html, /data-rule-name="Action" data-rule-source="PC1"/);
  assert.ok(html.includes(registry.resolve("Action", "PC1").target.href.replaceAll("&", "&amp;")));
  assert.match(renderInline("{@rule Action}", options), /class="rule-link"/);
  assert.match(renderInline("{@rule Action|PC1}"), /book=PC1&amp;rule=Action/);
  assert.equal(renderInline("{@code {@rule Action|PC1}}", options), "<code>{@rule Action|PC1}</code>");
  const rendered = renderChapter({ entries: ["{@rule Action|PC1}", { type: "list", items: ["{@rule Action|PC1}"] }] }, options);
  assert.equal((rendered.html.match(/class="rule-link"/g) || []).length, 2);
});

test("source-qualified matches, aliases, and explicit ids avoid incorrect destinations", () => {
  const otherBook = { id: "PC2", source: "PC2", name: "Player Core 2" };
  const multi = createRuleRegistry([
    { book, chapters: [{ name: "Rules", entries: [
      { type: "h4", name: "Shared name", id: "first", entries: ["First."] },
      { type: "h4", name: "Shared name", id: "second", entries: ["Second."] },
      { type: "h4", name: "Armor Class (AC)", aliases: ["Armor Class", "AC"], entries: ["Defense."] },
      { type: "h4", name: "Água & Fire", entries: ["Unicode and punctuation."] },
    ] }] },
    { book: otherBook, chapters: [{ name: "Rules", entries: [{ type: "h4", name: "Action", entries: ["Different source."] }] }] },
  ]);
  assert.equal(multi.resolve("Shared name", "PC1").status, "ambiguous");
  assert.equal(multi.resolve("first", "PC1").target.entry.entries[0], "First.");
  assert.equal(multi.resolve("second", "PC1").target.entry.entries[0], "Second.");
  assert.equal(multi.resolve("AC", "PC1").target.name, "Armor Class (AC)");
  assert.equal(multi.resolve("A\u0301gua & Fire", "PC1").status, "found");
  assert.equal(multi.resolve("Action", "PC2").target.sourceName, "Player Core 2");
  assert.equal(multi.resolve("Action", "UNKNOWN").status, "missing");
  const ambiguous = renderInline("{@rule Shared name|PC1}", { resolveRule: multi.resolve });
  assert.match(ambiguous, /rule-link-unresolved/);
  assert.doesNotMatch(ambiguous, /href=/);
  assert.match(renderRulePreview("Shared name", "PC1", multi), /unique id/);
});

test("a default definition makes ordinary names and aliases resolve to the full rules regardless of order", () => {
  const summary = { type: "h4", name: "Perception", id: "perception-summary", aliases: ["Awareness"], entries: ["Brief summary."] };
  const full = { type: "h1", name: "Perception", ruleDefault: true, aliases: ["Awareness"], entries: ["Complete rules."] };
  for (const entries of [[summary, full], [full, summary]]) {
    const rules = createRuleRegistry([{ book, chapters: entries.map(entry => ({ name: entry === full ? "Playing" : "Introduction", entries: [entry] })) }]);
    for (const name of ["Perception", "  perception ", "Awareness"]) {
      assert.equal(rules.resolve(name, "pc1").target.entry, full);
    }
    assert.equal(rules.resolve("perception-summary", "PC1").target.entry, summary);
    assert.match(renderRulePreview("Perception", "PC1", rules), /Complete rules/);
    assert.doesNotMatch(renderRulePreview("Perception", "PC1", rules), /Brief summary/);
    const html = renderInline("{@rule Perception|PC1}", { resolveRule: rules.resolve });
    assert.match(html, new RegExp(`chapter=${entries.indexOf(full)}&amp;rule=Perception#section-1`));
    assert.match(html, />Perception<\/a>/);
  }
});

test("defaults remain source-scoped, explicit ids win collisions, and conflicting defaults stay ambiguous", () => {
  const full = { type: "h1", name: "Perception", ruleDefault: true, entries: ["Complete."] };
  const summary = { type: "h4", name: "Perception", entries: ["Short."] };
  const records = entries => [{ book, chapters: [{ entries }] }];
  const collision = createRuleRegistry(records([full, { ...summary, id: "Perception" }]));
  assert.equal(collision.resolve("Perception").target.entry.id, "Perception");
  const duplicateId = createRuleRegistry(records([{ ...full, id: "same-id" }, { ...summary, id: "same-id" }]));
  assert.equal(duplicateId.resolve("same-id").status, "ambiguous");
  const conflicting = createRuleRegistry(records([full, { ...summary, ruleDefault: true }]));
  assert.equal(conflicting.resolve("Perception").status, "ambiguous");
  assert.match(renderRulePreview("Perception", "PC1", conflicting), /Mark only the main definition with ruleDefault: true/);
  const invalid = createRuleRegistry(records([summary, { ...full, ruleDefault: "true" }]));
  assert.equal(invalid.resolve("Perception").status, "ambiguous");
  const other = { ...book, id: "PC2", source: "PC2" };
  const scoped = createRuleRegistry([...records([full, summary]), { book: other, chapters: [{ entries: [summary] }] }]);
  assert.equal(scoped.resolve("Perception", "PC2").target.entry, summary);
  assert.equal(scoped.resolve("Missing", "PC1").status, "missing");
});

test("preview cards show full descriptions and source pages without duplicating main anchors", () => {
  const html = renderRulePreview("Action", "PC1", registry);
  assert.match(html, /<h2 id="rule-preview-title">Action<\/h2>/);
  assert.match(html, /Player Core/);
  assert.match(html, /pg\. 10/);
  assert.match(html, /Use <strong>three actions<\/strong>/);
  assert.match(html, /data-rule-name="Ancestry"/);
  assert.match(html, /data-close-rule-preview/);
  const nested = createRuleRegistry([{ book, chapters: [{ entries: [{ type: "h4", name: "Nested", entries: [{ type: "box", name: "Subheading", entries: ["More text."] }] }] }] }]);
  const preview = renderRulePreview("Nested", "PC1", nested);
  assert.match(preview, /id="rule-preview-section-1"/);
  assert.match(preview, /aria-labelledby="rule-preview-section-1"/);
  assert.doesNotMatch(preview, /id="section-1"/);
  assert.doesNotMatch(preview, /pg\./);
  const missing = renderRulePreview('<script>bad()</script>', "PC1", registry);
  assert.match(missing, /No matching entry/);
  assert.doesNotMatch(missing, /<script>/);
});

test("rule previews preserve unbulleted lists and their formatted items", () => {
  const rules = createRuleRegistry([{ book, chapters: [{ entries: [{
    type: "list", name: "Example", style: "list-no-bullets", items: [
      "{@b Erik:} Read {@book Player Core|PC1}.", "{@b Kyra:} Cast {@i light}.",
    ],
  }] }] }]);
  const preview = renderRulePreview("Example", "PC1", rules, bookRegistry);
  assert.match(preview, /<ul class="list-no-bullets" role="list"><li><p><strong>Erik:<\/strong>/);
  assert.match(preview, /class="book-reference"/);
  assert.match(preview, /Cast <em>light<\/em>/);
});

test("box sections remain rule destinations and retain their structure in outer-box previews", () => {
  const rules = createRuleRegistry([{ book, chapters: [{ entries: [{ type: "box", name: "Outer Box", entries: [
    { type: "box-section", name: "Inner Title", entries: ["Inner text with {@spell light}."] },
  ] }] }] }]);
  assert.equal(rules.resolve("Inner Title", "PC1").target.anchor, "section-2");
  const preview = renderRulePreview("Outer Box", "PC1", rules);
  assert.match(preview, /class="box-section" aria-labelledby="rule-preview-section-1"/);
  assert.match(preview, /Inner text with <em>light<\/em>/);
  assert.doesNotMatch(preview, /id="section-1"/);
  assert.match(renderRulePreview("Inner Title", "PC1", rules), /Inner text with <em>light<\/em>/);
});

test("hover cards stay inside the viewport and move above the link when needed", () => {
  assert.deepEqual(previewPosition({ left: 50, top: 100, bottom: 120 }, { width: 300, height: 100 }, { width: 800, height: 600 }), { left: 50, top: 128 });
  assert.deepEqual(previewPosition({ left: 750, top: 500, bottom: 520 }, { width: 500, height: 200 }, { width: 800, height: 600 }), { left: 288, top: 292 });
  assert.deepEqual(previewPosition({ left: 0, top: 0, bottom: 10 }, { width: 296, height: 176 }, { width: 320, height: 200 }), { left: 12, top: 12 });
});

function environment({ bookReference = false } = {}) {
  class EventTarget {
    handlers = new Map();
    addEventListener(type, handler) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
    emit(type, event = {}) { for (const handler of this.handlers.get(type) || []) handler({ target: this, relatedTarget: null, ...event }); }
  }
  const document = new EventTarget();
  class Element extends EventTarget {
    attributes = new Map(); dataset = {}; style = {}; children = []; innerHTML = "";
    rect = { left: 100, top: 100, bottom: 125, width: 400, height: 200 };
    append(child) { child.parent = this; this.children.push(child); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(other) { for (let node = other; node; node = node.parent) if (node === this) return true; return false; }
    closest(selector) {
      const selectors = selector.split(",").map(value => value.trim());
      if (selectors.includes("[data-rule-name]") && this.dataset.ruleName) return this;
      if (selectors.includes("[data-book-name]") && this.dataset.bookName) return this;
      if (selector === "[data-close-rule-preview]" && this.isClose) return this;
      return this.parent?.closest(selector) || null;
    }
    getBoundingClientRect() { return this.rect; }
    focus() { document.activeElement = this; document.emit("focusin", { target: this }); }
  }
  document.body = new Element();
  document.activeElement = document.body;
  document.createElement = () => new Element();
  const timers = new Map();
  let timerId = 0;
  const window = new EventTarget();
  Object.assign(window, { innerWidth: 900, innerHeight: 700,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const flush = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(callback => callback()); };
  const link = new Element();
  link.dataset = bookReference ? { bookName: "Player Core", bookSource: "PC1" } : { ruleName: "Action", ruleSource: "PC1" };
  link.setAttribute("href", bookReference ? "book.html?book=PC1" : registry.resolve("Action", "PC1").target.href);
  document.body.append(link);
  const controller = attachRulePreviews({ document, window, registry, bookRegistry });
  return { document, window, flush, link, controller, Element };
}

test("pointer hover opens the preview, allows entering it, and closes on outside interaction", () => {
  const env = environment();
  const { document, flush, link, controller } = env;
  assert.equal(controller.panel.hidden, true);
  document.emit("pointerover", { target: link, pointerType: "mouse" });
  flush();
  assert.equal(controller.panel.hidden, false);
  assert.match(controller.panel.innerHTML, /Player Core/);
  assert.equal(link.attributes.get("aria-controls"), "rule-preview");
  document.emit("pointerout", { target: link });
  controller.panel.emit("pointerenter");
  flush();
  assert.equal(controller.panel.hidden, false);
  controller.panel.emit("pointerleave");
  flush();
  assert.equal(controller.panel.hidden, true);
  controller.show(link);
  document.emit("pointerdown", { target: document.body });
  assert.equal(controller.panel.hidden, true);
  controller.destroy();
  assert.equal(document.body.children.includes(controller.panel), false);
});

test("keyboard focus and Escape work without stealing focus or blocking navigation", () => {
  const { document, link, controller, Element } = environment();
  const href = link.attributes.get("href");
  link.focus();
  assert.equal(controller.panel.hidden, false);
  assert.equal(document.activeElement, link);
  let prevented = false;
  document.emit("keydown", { key: "ArrowDown", altKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(document.activeElement, controller.panel);
  document.emit("keydown", { key: "Escape" });
  assert.equal(controller.panel.hidden, true);
  assert.equal(document.activeElement, link);
  assert.equal(link.attributes.get("aria-describedby"), undefined);
  assert.equal(link.attributes.get("href"), href);
  controller.show(link);
  const closeButton = new Element();
  closeButton.isClose = true;
  controller.panel.append(closeButton);
  closeButton.focus();
  controller.panel.emit("click", { target: closeButton });
  assert.equal(controller.panel.hidden, true);
  assert.equal(document.activeElement, link);
});

test("touch hover is ignored, and resizing or scrolling cannot strand a preview off screen", () => {
  const { document, window, link, controller, flush } = environment();
  document.emit("pointerover", { target: link, pointerType: "touch" });
  flush();
  assert.equal(controller.panel.hidden, true);
  controller.show(link);
  window.innerWidth = 500;
  window.emit("resize");
  assert.ok(Number.parseFloat(controller.panel.style.left) >= 12);
  link.rect = { ...link.rect, top: -100, bottom: -80 };
  window.emit("scroll");
  assert.equal(controller.panel.hidden, true);
});

test("book hover and focus reuse the dismissible preview and reposition after the cover loads", () => {
  const { document, link, controller, flush, Element } = environment({ bookReference: true });
  document.emit("pointerover", { target: link, pointerType: "mouse" });
  flush();
  assert.equal(controller.panel.hidden, false);
  assert.equal(controller.panel.className, "rule-preview book-preview");
  assert.match(controller.panel.innerHTML, /book-preview-cover/);
  controller.panel.rect = { ...controller.panel.rect, height: 600 };
  controller.panel.emit("load");
  assert.equal(controller.panel.style.top, "12px");
  document.emit("keydown", { key: "Escape" });
  assert.equal(controller.panel.hidden, true);
  link.focus();
  assert.equal(controller.panel.hidden, false);
  assert.equal(link.attributes.get("href"), "book.html?book=PC1");
  const rule = new Element();
  rule.dataset = { ruleName: "Action", ruleSource: "PC1" };
  document.body.append(rule);
  rule.focus();
  assert.equal(controller.panel.className, "rule-preview");
  assert.doesNotMatch(controller.panel.innerHTML, /book-preview-cover/);
  controller.destroy();
});

test("the current book's named entries resolve to its actual rendered anchors", async () => {
  const payload = JSON.parse(await readFile(new URL("../data/book/book-pc1.json", import.meta.url), "utf8"));
  const currentChapters = getChapters(payload);
  const actual = createRuleRegistry([{ book, chapters: currentChapters }]);
  currentChapters.forEach(chapter => {
    for (const heading of renderChapter(chapter).headings) {
      const result = actual.resolve(heading.entry.id || inlineText(heading.name), "PC1");
      if (result.status === "ambiguous") continue;
      assert.equal(result.status, "found");
      const targetChapter = currentChapters[result.target.chapter];
      if (result.target.anchor === "chapter-title") {
        assert.equal(result.target.entry, targetChapter);
      } else {
        const targetHeading = renderChapter(targetChapter).headings.find(item => item.id === result.target.anchor);
        assert.ok(targetHeading);
        assert.equal(result.target.entry, targetHeading.entry);
      }
      if (result.target.entry !== heading.entry) assert.equal(result.target.entry.ruleDefault, true);
    }
  });
});
