import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import vm from "node:vm";
import { escapeHtml, getChapters, renderChapter, renderHeadingControls, renderInline, safeHref } from "../js/book-renderer.js";
import { renderContents } from "../js/reader-controls.js";
import { createServer } from "../scripts/serve.mjs";
import { createBookRegistry, createRuleRegistry } from "../js/rule-links.js";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const catalog = JSON.parse(await read("data/books.json"));

test("the site contains only Player Core and its JSON chapters render", async () => {
  assert.equal(catalog.book.length, 1);
  assert.equal(catalog.book[0].id, "PC1");
  const payload = JSON.parse(await read(catalog.book[0].file));
  for (const chapter of getChapters(payload)) {
    const { html } = renderChapter(chapter);
    assert.doesNotMatch(html, /\[object Object\]/);
  }
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  for (const page of ["index.html", "books.html", "book.html"]) {
    const html = await read(page);
    assert.match(html, /<html lang="en" data-theme="dark">/);
    assert.match(html, /type="module" src="js\/site.js"/);
    assert.doesNotMatch(html, /(?:src|href)="\//);
  }
});

test("book JSON accepts chapters, data, and legacy bookData wrappers", () => {
  const chapters = [{ name: "Introduction", entries: ["Text"] }];
  assert.equal(getChapters(chapters), chapters);
  assert.equal(getChapters({ data: chapters }), chapters);
  assert.equal(getChapters({ bookData: [{ id: "pc1", data: chapters }] }), chapters);
  assert.deepEqual(getChapters(chapters[0]), chapters);
  assert.throws(() => getChapters({}), /data/);
  assert.throws(() => getChapters({ data: ["not a chapter"] }), /Each chapter/);
});

test("inline formatting is nested, escaped, and has no dead entity links", () => {
  assert.equal(renderInline("A {@b bold {@i word}}."), "A <strong>bold <em>word</em></strong>.");
  assert.equal(renderInline("{@spell fireball|PC1|Fireball}"), "<em>Fireball</em>");
  assert.equal(renderInline("{@trait fire|PC1}"), "fire");
  assert.equal(renderInline("{@dice 1d20|a check}"), "a check");
  assert.equal(renderInline("{@dc 15}"), "DC 15");
  assert.equal(renderInline("{@hit 3}"), "+3");
  assert.match(renderInline("{@as 2} {@as r} {@as f}"), /Two actions/);
  assert.match(renderInline("{@as r}"), /Reaction/);
  assert.equal(renderInline("broken {@b <tag>"), "broken {@b &lt;tag&gt;");
  assert.equal(escapeHtml('<script>"&'), "&lt;script&gt;&quot;&amp;");
  assert.doesNotMatch(renderInline('{@link Click|javascript:alert(1)}'), /href/);
  assert.match(renderInline('{@link Read|https://example.com/book}'), /href="https:\/\/example.com\/book"/);
  for (const href of ["javascript:alert(1)", "data:text/html,test", "//example.com", "\\example.com", "java\nscript:bad"]) assert.equal(safeHref(href), null);
});

test("spell tags automatically italicize names and custom labels without changing other tags", () => {
  assert.equal(renderInline("{@spell light}"), "<em>light</em>");
  assert.equal(renderInline("{@spell light|PC1}"), "<em>light</em>");
  assert.equal(renderInline("{@spell light|PC1|a golden light}"), "<em>a golden light</em>");
  assert.equal(renderInline("{@b {@spell light|PC1}}"), "<strong><em>light</em></strong>");
  assert.equal(renderInline("{@spell light|PC1|{@b Light}}"), "<em><strong>Light</strong></em>");
  assert.equal(renderInline("{@spell <script>unsafe</script>}"), "<em>&lt;script&gt;unsafe&lt;/script&gt;</em>");
  assert.equal(renderInline("{@code {@spell light}}"), "<code>{@spell light}</code>");
  assert.equal(renderInline("{@trait fire|PC1}"), "fire");
  const { html } = renderChapter({ entries: [
    "Cast {@spell light}.",
    { type: "list", style: "list-no-bullets", items: ["Cast {@spell light|PC1}."] },
    { type: "table", rows: [["{@spell light|PC1|Light}"]] },
  ] });
  assert.equal((html.match(/<em>/g) || []).length, 3);
});

test("chapters render headings, lists, tables, sidebars, images, and flavor", () => {
  const { html, headings } = renderChapter({ entries: [
    "A paragraph.",
    { type: "h2", name: "Basics", entries: [
      { type: "entries", name: "Details", entries: ["Nested text."] },
      { type: "list", items: ["One", { type: "item", name: "Two", entry: "More text" }] },
    ] },
    { type: "table", caption: "Example", colLabels: ["Roll", "Result"], rows: [[{ roll: { min: 1, max: 4 } }, "Text"], { row: [5, "Other"] }] },
    { type: "inset", name: "Sidebar", entries: ["A note."] },
    { type: "flavor", entries: ["A story."] },
    { type: "quote", entries: ["Quoted."], by: "Author" },
    { type: "image", href: { type: "internal", path: "img/book.webp" }, title: 'Art "title"' },
    { type: "image", href: { url: "javascript:alert(1)" } },
  ] });
  assert.match(html, /<h3 id="section-1">Basics<\/h3>/);
  assert.match(html, /<h4 id="section-2">Details<\/h4>/);
  assert.equal(headings[0].name, "Basics");
  assert.equal(new Set(headings.map(heading => heading.id)).size, headings.length);
  for (const fragment of ["<ul>", "<table>", "<thead>", "1–4", "<aside>", 'class="flavor"', "<blockquote>", 'src="img/book.webp"']) assert.ok(html.includes(fragment), fragment);
  assert.doesNotMatch(html, /javascript:|\[object Object\]/);
});

test("dialogue table styling gives speakers semantic row headers without changing ordinary tables", () => {
  const table = { type: "table", caption: "Example conversation", colLabels: ["Speaker", "Speech"], rows: [
    ["{@b Merisiel (Shay):}", "I cast {@spell light}."],
    ["{@b Valeros (Luis):}", "A longer sentence that should wrap in the speech column."],
  ] };
  const dialogue = renderChapter({ entries: [{ ...table, style: "table-dialogue" }] }).html;
  assert.match(dialogue, /<table class="dialogue-table"><caption>Example conversation<\/caption><colgroup><col class="dialogue-speaker-column"><col><\/colgroup>/);
  assert.match(dialogue, /<th scope="col">Speaker<\/th>/);
  assert.match(dialogue, /<th scope="row"><strong>Merisiel \(Shay\):<\/strong><\/th><td>I cast <em>light<\/em>/);
  assert.match(dialogue, /<th scope="row"><strong>Valeros \(Luis\):<\/strong><\/th>/);
  const normal = renderChapter({ entries: [table] }).html;
  assert.match(normal, /<table><caption>/);
  assert.doesNotMatch(normal, /dialogue-table|colgroup|scope="row"/);
  const unsafe = renderChapter({ entries: [{ ...table, style: 'bad" onclick="bad()' }] }).html;
  assert.doesNotMatch(unsafe, /onclick|dialogue-table/);
});

test("dialogue tables reserve speaker width, top-align rows and stack on narrow screens", async () => {
  const css = await read("css/site.css");
  assert.match(css, /\.dialogue-table \{ table-layout: fixed; font: \.9rem\/1\.7 system-ui, sans-serif/);
  assert.match(css, /\.dialogue-speaker-column \{ width: 10rem; \}/);
  assert.match(css, /\.dialogue-table :is\(th, td\) \{ vertical-align: top;/);
  assert.match(css, /\.dialogue-table tbody th \{[^}]*overflow-wrap: normal; word-break: normal; white-space: normal/);
  assert.match(css, /\.dialogue-table tbody tr:nth-child\(even\) \{ background: transparent/);
  assert.match(css, /@media \(max-width: 550px\) \{[\s\S]*?\.dialogue-table colgroup \{ display: none; \}/);
  assert.match(css, /\.dialogue-table :is\(th, td\) \{ display: block; width: auto; padding: \.1rem 0; border: 0/);
});

test("flavor ornaments use the lower divider and only chapter-opening flavor loses the upper divider", async () => {
  const flavor = { type: "flavor", entries: ["Opening flavor."] };
  const opening = await runPage({ chapters: [{ name: "Chapter", entries: [flavor, "Normal text."] }] });
  assert.match(opening.html("#reader"), /<\/header><article[^>]*><div class="flavor"><p>Opening flavor\.<\/p>/);
  const later = await runPage({ chapters: [{ name: "Chapter", entries: ["Normal text.", flavor] }] });
  assert.match(later.html("#reader"), /<p>Normal text\.<\/p>\n<div class="flavor">/);
  const css = await read("css/site.css");
  assert.match(css, /\.book-heading \+ \.book-content > \.flavor:first-child \{ border-top: 0; padding-top: 0; margin-top: 0; \}/);
  const ornament = css.match(/\.book-content \.flavor::before \{([^}]+)\}/)[1];
  assert.match(ornament, /bottom: -\.5em/);
  assert.match(ornament, /line-height: 1/);
  assert.doesNotMatch(ornament, /\btop:/);
  assert.match(css, /\.book-content \.flavor \{[^}]+border-block: 1px solid var\(--reader-line\)/);
});

test("flavor immediately under a JSON h1 shares the heading divider in folded and plain rendering", async () => {
  const chapter = { entries: [{ type: "h1", name: "Main Section", entries: [
    { type: "flavor", entries: ["Opening flavor."] }, "Normal text.",
  ] }] };
  const interactive = renderChapter(chapter, { interactive: true }).html;
  assert.match(interactive, /<\/h2><div class="section-body" id="section-1-content"><div class="flavor">/);
  assert.match(renderChapter(chapter).html, /<\/h2><div class="flavor">/);
  const lowerHeading = renderChapter({ entries: [{ type: "h2", name: "Subsection", entries: [
    { type: "flavor", entries: ["Other flavor."] },
  ] }] }, { interactive: true }).html;
  assert.match(lowerHeading, /<\/h3><div class="section-body"/);
  const css = await read("css/site.css");
  assert.match(css, /\.book-content h2 \+ \.section-body > \.flavor:first-child, \.book-content h2 \+ \.flavor \{ border-top: 0; padding-top: 0; margin-top: 0; \}/);
  assert.match(css, /\.book-content \.flavor \{[^}]+border-block: 1px solid var\(--reader-line\)/);
});

test("unbulleted lists keep separate items without altering normal paragraph spacing", async () => {
  const chapter = { entries: ["Before.", { type: "list", style: "list-no-bullets", items: [
    "{@b Kyra (Jessica):} Cast {@i light}.", "{@b Erik:} The ladder is lit.", "<script>unsafe</script>",
  ] }, "After."] };
  for (const interactive of [false, true]) {
    const { html, headings } = renderChapter(chapter, { interactive });
    assert.match(html, /<p>Before\.<\/p>\n<ul class="list-no-bullets" role="list"><li><p><strong>Kyra \(Jessica\):<\/strong> Cast <em>light<\/em>\.<\/p><\/li><li><p><strong>Erik:<\/strong>/);
    assert.match(html, /<\/ul>\n<p>After\.<\/p>$/);
    assert.doesNotMatch(html, /<script>|<br>/);
    assert.equal(headings.length, 0);
  }
  const css = await read("css/site.css");
  assert.match(css, /:is\(\.book-content, \.rule-preview-body\) \.list-no-bullets > li > p \{ margin: 0; \}/);
  assert.match(css, /\.list-no-bullets > li \{ margin: 0; \}/);
  assert.match(css, /\.book-content p \{ margin: 0 0 1rem; \}/);
});

test("list variants retain bullet defaults, numbering, and nested items without arbitrary CSS injection", () => {
  const html = renderChapter({ entries: [
    { type: "list", items: ["A bullet."] },
    { type: "list", style: "list-decimal", items: ["A number."] },
    { type: "list", ordered: true, items: ["Also numbered."] },
    { type: "list", style: 'bad" onclick="unsafe()', items: ["Safe."] },
    { type: "list", style: "list-no-bullets", items: [
      { type: "item", name: "Speaker:", entry: "Text." },
      { type: "list", items: ["A nested bullet."] },
    ] },
  ] }).html;
  assert.match(html, /<ul><li><p>A bullet\.<\/p>/);
  assert.match(html, /<ol><li><p>A number\.<\/p>/);
  assert.match(html, /<ol><li><p>Also numbered\.<\/p>/);
  assert.match(html, /<li><p><strong>Speaker:<\/strong> Text\.<\/p><\/li>/);
  assert.match(html, /<li><ul><li><p>A nested bullet/);
  assert.doesNotMatch(html, /onclick|unsafe/);
});

test("generic heading levels and sidebars keep their structure", () => {
  for (let level = 1; level <= 6; level++) {
    const { html, headings } = renderChapter({ entries: [{ type: `h${level}`, name: "A heading", entries: ["Text."] }] });
    const renderedLevel = Math.min(6, level + 1);
    assert.match(html, new RegExp(`<h${renderedLevel} id="section-1">A heading</h${renderedLevel}>`));
    assert.equal(headings[0].level, renderedLevel);
    assert.equal(headings[0].tocLevel, level);
  }
  const sidebar = renderChapter({ entries: [{ type: "sidebar", name: "A note", entries: ["Sidebar text."] }] });
  assert.match(sidebar.html, /^<aside>/);
  assert.match(sidebar.html, /Sidebar text/);
});

test("decorative rule boxes support titles and nested entries", () => {
  const { html, headings } = renderChapter({ entries: [
    { type: "box", name: "The {@i First} Rule", entries: ["Your {@b story}.", { type: "list", items: ["Have fun."] }] },
    { type: "box", name: "Another rule", entry: "Another paragraph." },
    { type: "box", entries: ["A box without a title."] },
  ] });
  assert.match(html, /<aside class="rule-box" aria-labelledby="section-1">/);
  assert.match(html, /<h2 id="section-1">The <em>First<\/em> Rule<\/h2>/);
  assert.match(html, /Your <strong>story<\/strong>/);
  assert.match(html, /<ul>/);
  assert.match(html, /aria-labelledby="section-2"/);
  assert.match(html, /<aside class="rule-box"><div class="rule-box-content">/);
  assert.equal(headings.length, 2);
  assert.doesNotMatch(html, /rule-box-ornament/);
  const escaped = renderChapter({ entries: [{ type: "box", name: '<img src=x onerror="bad()">', entries: ["<script>bad()</script>"] }] });
  assert.doesNotMatch(escaped.html, /<img|<script/);
  const simpleNote = renderChapter({ entries: [{ type: "inset", name: "Note", entries: ["A note."] }] });
  assert.match(simpleNote.html, /^<aside>/);
  assert.doesNotMatch(simpleNote.html, /class="rule-box"/);
});

// Exercise the actual page controller without installing a browser dependency.
async function runPage({ page = "book", chapters = [], query = "?book=PC1", failBook = false, catalogData = catalog, bookData } = {}) {
  const elements = new Map();
  const scrolled = [];
  const menu = { open: false, contains: () => false, querySelector: () => ({ focus() {} }) };
  const document = {
    body: { dataset: { page } }, title: "",
    querySelector(selector) {
      if ((selector === "#reader" || selector === "#contents") && page !== "book") return null;
      if (selector === "#book-list" && page !== "books") return null;
      if (!elements.has(selector)) elements.set(selector, { innerHTML: "", childElementCount: 0, removeAttribute() {}, querySelector: () => menu });
      return elements.get(selector);
    },
    addEventListener() {}, getElementById: id => ({ scrollIntoView() { scrolled.push(id); } }),
  };
  const context = vm.createContext({
    document, location: { search: query, href: "http://localhost/avalontools/book.html", hash: "" },
    navigator: {}, URL, URLSearchParams,
    escapeHtml, getChapters, renderChapter, renderHeadingControls, renderInline, safeHref, renderContents,
    attachReaderControls() { return { reveal() {} }; },
    createBookRegistry, createRuleRegistry, attachRulePreviews() {}, window: {},
    fetch: async path => ({ ok: !(failBook && path !== "data/books.json"), status: 404, json: async () => path === "data/books.json" ? catalogData : bookData ?? { data: chapters } }),
  });
  const source = (await read("js/site.js")).replace(/^import[^\n]+\n/gm, "").replace(/start\(\);\s*$/, "globalThis.finished = start();");
  vm.runInContext(source, context);
  await context.finished;
  return { document, scrolled, html: selector => elements.get(selector)?.innerHTML ?? "" };
}

test("home, catalog, empty PC1, and failed loads have useful UI", async () => {
  const home = await runPage({ page: "home" });
  assert.match(home.html("#navigation"), /<summary>Books<\/summary>/);
  assert.match(home.html("#navigation"), /2023/);
  assert.match(home.html("#navigation"), /--book-color:#d4a64a/);
  const library = await runPage({ page: "books" });
  assert.match(library.html("#book-list"), /Player Core/);
  assert.match(library.html("#book-list"), /class="catalog-book"/);
  assert.match(library.html("#book-list"), /2023/);
  const empty = await runPage();
  assert.match(empty.html("#reader"), /no chapters yet/);
  assert.match(empty.html("#reader"), /data\/book\/book-pc1.json/);
  const failed = await runPage({ failBook: true });
  assert.match(failed.html("#reader"), /HTTP 404/);
  const malformed = await runPage({ catalogData: { book: [null] } });
  assert.match(malformed.html("#reader"), /needs a/);
  const duplicate = await runPage({ catalogData: { book: [catalog.book[0], catalog.book[0]] } });
  assert.match(duplicate.html("#reader"), /unique id/);
});

test("book cards show local cover art and keep a safe fallback", async () => {
  const library = await runPage({ page: "books" });
  assert.match(library.html("#book-list"), /class="catalog-cover" src="img\/books\/pc1-cover.jpg"/);
  assert.doesNotMatch(library.html("#book-list"), /class="mini-volume"/);
  const cover = await readFile(new URL(catalog.book[0].cover, root));
  assert.equal(cover[0], 0xff);
  assert.equal(cover[1], 0xd8);
  const withoutCover = await runPage({ page: "books", catalogData: { book: [{ ...catalog.book[0], cover: undefined }] } });
  assert.match(withoutCover.html("#book-list"), /class="mini-volume"/);
  const invalidCover = await runPage({ page: "books", catalogData: { book: [{ ...catalog.book[0], cover: "javascript:alert(1)" }] } });
  assert.match(invalidCover.html("#book-list"), /class="mini-volume"/);
  assert.doesNotMatch(invalidCover.html("#book-list"), /javascript:/);
});

test("chapter navigation and section links come from the JSON", async () => {
  const chapters = [
    { name: "Introduction", entries: [{ type: "h1", name: "Start here", entries: ["Hello."] }] },
    { name: "Second chapter", entries: ["Next."] },
  ];
  const first = await runPage({ chapters });
  assert.match(first.html("#reader"), /<h1 id="chapter-title">Introduction<\/h1>/);
  assert.match(first.html("#reader"), /rel="next"/);
  assert.doesNotMatch(first.html("#reader"), /rel="prev"/);
  assert.match(first.html("#contents"), /href="#section-1"/);
  assert.match(first.html("#contents"), /aria-current="page"/);
  const last = await runPage({ chapters, query: "?book=pc1&chapter=1" });
  assert.match(last.html("#reader"), /rel="prev"/);
  assert.doesNotMatch(last.html("#reader"), /rel="next"/);
  const invalid = await runPage({ chapters, query: "?book=PC1&chapter=-1" });
  assert.match(invalid.html("#reader"), /chapter does not exist/);
  const unknown = await runPage({ chapters, query: "?book=unknown" });
  assert.match(unknown.html("#reader"), /not in the book index/);
  const linkedHeading = await runPage({ chapters: [{ name: "Chapter", entries: [{ type: "h1", name: "{@link Heading|https://example.com}", entries: ["Text"] }] }] });
  assert.match(linkedHeading.html("#contents"), /href="#section-1">Heading<\/a>/);
});

test("the reader includes chapter and section page controls plus collapsible overview groups", async () => {
  const chapters = [{ name: "Chapter", page: 5, entries: [
    { type: "h1", name: "Main section", page: 10, entries: [
      { type: "h2", name: "Subsection", entries: ["Text."] },
    ] },
  ] }];
  const page = await runPage({ chapters });
  const reader = page.html("#reader"), contents = page.html("#contents");
  assert.match(reader, /aria-controls="chapter-title-content"/);
  assert.match(reader, /class="heading-page" aria-label="Page 5">p\. 5/);
  assert.match(reader, /aria-controls="section-1-content"/);
  assert.match(reader, /id="section-1-content"/);
  assert.equal((reader.match(/aria-label="Page 10"/g) || []).length, 2);
  assert.match(contents, /data-toc-action="collapse"/);
  assert.match(contents, /data-toc-action="expand"/);
  assert.match(contents, /class="toc-chapter" open/);
  assert.match(contents, /class="toc-branch" open/);
  assert.match(contents, /<h2 class="contents-title" id="contents-title">Player Core<\/h2>/);
  assert.doesNotMatch(contents, /<details class="contents-tree"/);
});

test("the overview folds h2 sections under Introduction and all h1 groups under the chapter", async () => {
  const chapters = [{ name: "Chapter 1: Introduction", entries: [
    { type: "h1", name: "Introduction", entries: [
      { type: "h2", name: "What is a Roleplaying Game?", entries: ["First section."] },
      { type: "h2", name: "Basics of Play", entries: ["Second section."] },
    ] },
    { type: "h1", name: "Character Creation", entries: [
      { type: "h2", name: "Create a Concept", entries: ["A concept."] },
    ] },
    { type: "h1", name: "Leveling Up", entries: ["Level text."] },
  ] }];
  const page = await runPage({ chapters });
  const contents = page.html("#contents");
  assert.match(contents, /<details class="toc-chapter" open><summary><a[^>]+>Chapter 1: Introduction<\/a><\/summary><ol class="section-links">/);
  assert.match(contents, /<li class="toc-h1"><details class="toc-branch" open><summary><a href="#section-1">Introduction<\/a><\/summary><ol class="section-links"><li class="toc-h2">/);
  assert.match(contents, /Basics of Play<\/a><\/li><\/ol><\/details><\/li><li class="toc-h1"><details class="toc-branch" open><summary><a href="#section-4">Character Creation/);
  assert.match(contents, /<li class="toc-h1"><a href="#section-6">Leveling Up<\/a><\/li><\/ol><\/details>/);
  assert.match(page.html("#reader"), /aria-controls="chapter-title-content"/);
  assert.match(page.html("#reader"), /aria-controls="section-1-content"/);
  const linked = await runPage({ chapters, query: "?book=PC1&rule=Basics+of+Play" });
  assert.ok(linked.scrolled.includes("section-3"));
});

test("the sidebar lists only h1 and h2 and preserves all book content", async () => {
  const chapters = [{ name: "Chapter", entries: [
    { type: "box", name: "Box title", entries: ["Important text."] },
    { type: "inset", name: "Note title", entries: ["A note."] },
    { type: "entries", name: "Generic title", entries: ["Other text."] },
    { type: "list", name: "List title", items: ["Item."] },
    ...Array.from({ length: 6 }, (_, index) => ({ type: `h${index + 1}`, name: `Heading ${index + 1}`, entries: ["Body text."] })),
  ] }];
  const page = await runPage({ chapters });
  const contents = page.html("#contents");
  const reader = page.html("#reader");
  for (let level = 1; level <= 6; level++) {
    assert.ok(reader.includes(`Heading ${level}`));
    if (level <= 2) assert.match(contents, new RegExp(`class="toc-h${level}">(?:<details[^>]*><summary>)?<a href="#section-\\d+">Heading ${level}</a>`));
    else assert.ok(!contents.includes(`Heading ${level}`));
  }
  for (const title of ["Box title", "Note title", "Generic title", "List title"]) {
    assert.ok(reader.includes(title));
    assert.ok(!contents.includes(title));
  }
  for (const [, id] of contents.matchAll(/href="#([^"]+)"/g)) assert.ok(reader.includes(`id="${id}"`));
  const notesOnly = await runPage({ chapters: [{ name: "Notes", entries: [{ type: "box", name: "A box", entries: ["Text."] }] }] });
  assert.doesNotMatch(notesOnly.html("#contents"), /class="section-links"/);
  const css = await read("css/site.css");
  const sizes = new Map([...css.matchAll(/\.toc-h([123]) > a \{[^}]*font-size: ([\d.]+)rem/g)].map(([, level, size]) => [Number(level), Number(size)]));
  assert.ok(sizes.get(1) > sizes.get(2) && sizes.get(2) > sizes.get(3));
});

test("boxes omit the ornament and folding controls no longer reserve extra space at the right", async () => {
  for (const interactive of [false, true]) {
    const { html } = renderChapter({ entries: [
      { type: "box", name: "Titled Box", entries: ["Text."] },
      { type: "box", entries: ["Untitled text."] },
    ] }, { interactive });
    assert.doesNotMatch(html, /rule-box-ornament/);
    if (interactive) assert.match(html, /data-section-toggle/);
  }
  const css = await read("css/site.css");
  assert.doesNotMatch(css, /rule-box-ornament/);
  assert.doesNotMatch(css, /\.rule-box:not\(\[aria-labelledby\]\) \.rule-box-content/);
  assert.match(css, /\.book-content \.rule-box > :is\(h2, h3, h4, h5, h6\) \{[^}]*padding: 0 0 \.7rem/);
});

test("box sections add multiple matching titles inside one outer box without extra panels", async () => {
  const chapter = { name: "Chapter", entries: [{ type: "box", name: "Main Box", page: 15, entries: [
    "First text.",
    { type: "box-section", name: "Second {@i Title}", entries: ["Second text.", { type: "list", items: ["An item."] }] },
    { type: "box-section", name: "Third Title", entries: ["Third text."] },
  ] }] };
  for (const interactive of [false, true]) {
    const { html, headings } = renderChapter(chapter, { interactive });
    assert.equal((html.match(/class="rule-box"/g) || []).length, 1);
    assert.equal((html.match(/class="box-section"/g) || []).length, 2);
    assert.match(html, /class="box-section" aria-labelledby="section-2"/);
    assert.match(html, /Second <em>Title<\/em>/);
    assert.match(html, /<ul><li><p>An item\.<\/p>/);
    assert.deepEqual(headings.map(heading => heading.id), ["section-1", "section-2", "section-3"]);
    assert.ok(headings.every(heading => heading.tocLevel === null && heading.page === 15));
    if (interactive) assert.match(html, /aria-controls="section-2-content"/);
  }
  const page = await runPage({ chapters: [chapter], query: "?book=PC1&rule=Second+Title" });
  assert.ok(page.scrolled.includes("section-2"));
  assert.doesNotMatch(page.html("#contents"), /Second|Third/);
  const escaped = renderChapter({ entries: [{ type: "box-section", name: "<script>bad()</script>", entries: ["<img src=x>"] }] }).html;
  assert.doesNotMatch(escaped, /<script>|<img/);
});

test("headings inside boxes stay visible and linkable but are excluded from the overview", async () => {
  for (const type of ["box", "inset", "insetReadaloud", "sidebar"]) {
    const chapters = [{ name: "Chapter", entries: [
      { type: "h1", name: "Before", entries: ["Text."] },
      { type, name: "A box", entries: [
        { type: "h1", name: "Box Heading", entries: [
          { type: "h2", name: "Box Subheading", entries: [
            { type: "list", items: [{ type: "h3", name: "Deep Heading", entries: ["Deep text."] }] },
          ] },
        ] },
        { type: "box", entries: [{ type: "h1", name: "Nested Box Heading", entries: ["Nested."] }] },
      ] },
      { type: "h1", name: "After", entries: ["Text."] },
    ] }];
    const page = await runPage({ chapters });
    for (const title of ["Box Heading", "Box Subheading", "Deep Heading", "Nested Box Heading"]) {
      assert.ok(page.html("#reader").includes(title), `${type}: ${title}`);
      assert.ok(!page.html("#contents").includes(title), `${type}: ${title} must not be in overview`);
    }
    assert.match(page.html("#contents"), />Before<\/a>/);
    assert.match(page.html("#contents"), />After<\/a>/);
    const headings = renderChapter(chapters[0]).headings;
    assert.deepEqual(headings.filter(heading => heading.tocLevel).map(heading => heading.name), ["Before", "After"]);
    const linked = await runPage({ chapters, query: "?book=PC1&rule=Box+Heading" });
    const destination = headings.find(heading => heading.name === "Box Heading");
    assert.ok(linked.scrolled.includes(destination.id));
    assert.match(linked.html("#reader"), /Deep text/);
  }
});

test("rule links navigate to the right chapter and resolve again after headings move", async () => {
  const chapters = [
    { name: "Opening", entries: ["Read {@rule Action|PC1|about actions}."] },
    { name: "Glossary", entries: [
      { type: "box", name: "A box before the rule", entries: ["Text."] },
      { type: "h4", name: "Action", page: 10, entries: ["Three actions."] },
    ] },
  ];
  const opening = await runPage({ chapters });
  assert.match(opening.html("#reader"), /book=PC1&amp;chapter=1&amp;rule=Action#section-2/);
  assert.match(opening.html("#reader"), />about actions<\/a>/);
  const linked = await runPage({ chapters, query: "?book=PC1&chapter=0&rule=Action" });
  assert.match(linked.html("#reader"), /<h1 id="chapter-title">Glossary<\/h1>/);
  assert.ok(linked.scrolled.includes("section-2"));
  chapters[1].entries.unshift({ type: "h2", name: "A new heading", entries: ["Added later."] });
  const moved = await runPage({ chapters, query: "?book=PC1&chapter=99&rule=Action" });
  assert.ok(moved.scrolled.includes("section-3"));
  assert.match(moved.html("#reader"), /Three actions/);
  const missing = await runPage({ chapters, query: "?book=PC1&rule=NotHere" });
  assert.match(missing.html("#reader"), /was not found/);
  const chapterReference = await runPage({ chapters, query: "?book=PC1&rule=Glossary" });
  assert.ok(chapterReference.scrolled.includes("chapter-title"));
});

test("ability blocks render in the reader and rule links reach their stable heading", async () => {
  const chapters = [{ name: "Rules", entries: [
    "Use {@rule Sample Ability|PC1}.",
    { type: "ability", name: "Sample Ability", kind: "Feat", level: 1, actions: "r", page: 15,
      traits: ["General"], trigger: "A trigger.", requirements: "A requirement.", entries: ["The effect."] },
  ] }];
  const page = await runPage({ chapters, query: "?book=PC1&rule=Sample+Ability" });
  const reader = page.html("#reader");
  assert.match(reader, /class="ability-block" aria-labelledby="section-1"/);
  assert.match(reader, /class="ability-level">Feat 1/);
  assert.match(reader, /data-symbol="r"/);
  assert.match(reader, /<dt>Trigger<\/dt>/);
  assert.doesNotMatch(reader, /aria-controls="section-1-content"/);
  assert.match(reader, /aria-controls="chapter-title-content"/);
  assert.ok(page.scrolled.includes("section-1"));
  assert.doesNotMatch(page.html("#contents"), /Sample Ability/);
});

test("plain rule links open the default full definition rather than its introductory summary", async () => {
  const chapters = [
    { name: "Introduction", entries: [
      "See {@rule Perception|PC1}.",
      { type: "h4", name: "Perception", id: "perception-summary", entries: ["Brief summary."] },
    ] },
    { name: "Playing the Game", entries: [
      { type: "h1", name: "Perception", ruleDefault: true, entries: ["Complete Perception rules."] },
    ] },
  ];
  const intro = await runPage({ chapters });
  assert.match(intro.html("#reader"), /chapter=1&amp;rule=Perception#section-1/);
  const full = await runPage({ chapters, query: "?book=PC1&rule=Perception" });
  assert.match(full.html("#reader"), /Complete Perception rules/);
  assert.doesNotMatch(full.html("#reader"), /Brief summary/);
  assert.ok(full.scrolled.includes("section-1"));
  const summary = await runPage({ chapters, query: "?book=PC1&rule=perception-summary" });
  assert.match(summary.html("#reader"), /Brief summary/);
});

test("book tags in actual reader pages use the catalog and open a book rather than a rule", async () => {
  const chapters = [{ name: "Introduction", entries: ["Read {@book Player Core|PC1|the core book} and {@book GM Core}."] }];
  const page = await runPage({ chapters });
  assert.match(page.html("#reader"), /class="book-reference" href="book.html\?book=PC1"/);
  assert.match(page.html("#reader"), />the core book<\/a>/);
  assert.match(page.html("#reader"), /book-reference-unresolved[^>]+data-book-name="GM Core"/);
  assert.doesNotMatch(page.html("#reader"), /rule=Player/);
  const opened = await runPage({ chapters, query: "?book=PC1" });
  assert.match(opened.html("#reader"), /<h1 id="chapter-title">Introduction<\/h1>/);
});

test("examples are labeled, and the README's JSON examples can be copied", async () => {
  const example = await runPage({ bookData: { _meta: { example: true }, data: [{ name: "Sample", entries: ["An example."] }] } });
  assert.match(example.html("#reader"), /not Player Core text/);
  const normal = await runPage({ chapters: [{ name: "A real chapter", entries: ["Text."] }] });
  assert.doesNotMatch(normal.html("#reader"), /class="example-note"/);
  const readme = await read("README.md");
  const examples = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.ok(examples.length >= 3);
  for (const match of examples) assert.doesNotThrow(() => JSON.parse(match[1]));
  const sample = JSON.parse(await read(catalog.book[0].file));
  const rendered = await runPage({ bookData: sample });
  assert.doesNotMatch(rendered.html("#reader"), /Unable to load books/);
  if (sample._meta?.example) {
    assert.match(rendered.html("#reader"), /JSON writing example/);
    assert.ok(rendered.html("#reader").includes(renderChapter(getChapters(sample)[0]).html));
    const last = await runPage({ bookData: sample, query: "?book=PC1&chapter=1" });
    assert.match(last.html("#reader"), /<table>/);
    assert.match(last.html("#reader"), /<aside>/);
    assert.match(last.html("#reader"), /<blockquote>/);
  }
});

test("the local server serves every page and keeps private files inaccessible", async t => {
  const server = createServer(fileURLToPath(root));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const coverResponse = await fetch(`${base}/${catalog.book[0].cover}`);
  assert.equal(coverResponse.status, 200);
  assert.equal(coverResponse.headers.get("content-type"), "image/jpeg");
  assert.ok((await coverResponse.arrayBuffer()).byteLength > 1000);
  const fontResponse = await fetch(`${base}/fonts/Pathfinder2eActions.ttf`);
  assert.equal(fontResponse.status, 200);
  assert.equal(fontResponse.headers.get("content-type"), "font/ttf");
  const fontBytes = Buffer.from(await fontResponse.arrayBuffer());
  assert.deepEqual(fontBytes, await readFile(new URL("fonts/Pathfinder2eActions.ttf", root)));
  for (const path of ["/", "/books.html", "/book.html?book=PC1", "/css/site.css", "/js/site.js", "/js/theme.js", "/js/book-renderer.js", "/js/rule-links.js", "/js/reader-controls.js", "/data/books.json", "/data/book/book-pc1.json"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.arrayBuffer();
  }
  for (const path of ["/.git/config", "/package.json", "/scripts/serve.mjs", "/data/%2e%2e%2f.git/config", "/data/%5c..%5c.git/config", "/spells.html"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404, path);
    await response.arrayBuffer();
  }
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
  const head = await fetch(base, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const malformed = await new Promise((resolve, reject) => {
    const client = request(`${base}/%ZZ`, response => { response.resume(); resolve(response.statusCode); });
    client.once("error", reject);
    client.end();
  });
  assert.equal(malformed, 400);
});
