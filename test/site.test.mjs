import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { escapeHtml, renderContent, renderInline, safeHref } from "../js/content-renderer.js";
import { createServer } from "../scripts/serve.mjs";
const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

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
  assert.equal(renderInline("{@book Player Core|PC1|the core book}"), "the core book");
  assert.ok(renderInline("{@rule Checks|PC1}").includes('href="rules.html?rule=Checks&amp;source=PC1"'));
  assert.ok(renderInline("{@rule Difficulty Classes}").includes('href="rules.html?rule=Difficulty+Classes"'));
  assert.doesNotMatch(renderInline("{@rule Difficulty Classes}"), /source=PC1/);
  assert.equal(escapeHtml('<script>"&'), "&lt;script&gt;&quot;&amp;");
  assert.doesNotMatch(renderInline('{@link Click|javascript:alert(1)}'), /href/);
  assert.match(renderInline('{@link Read|https://example.com/book}'), /href="https:\/\/example.com\/book"/);
  for (const href of ["javascript:alert(1)", "data:text/html,test", "//example.com", "\\example.com", "java\nscript:bad"]) assert.equal(safeHref(href), null);
});

test("nested inline formatting resolves each rule link once", () => {
  let resolutions = 0;
  const html = renderInline("{@b {@i {@rule Checks|PC1}}}", {
    resolveRule(name, source) {
      resolutions++;
      assert.equal(name, "Checks");
      assert.equal(source, "PC1");
      return { status: "found", target: { href: "rules.html?id=PC1%3Achecks" } };
    },
  });
  assert.equal(resolutions, 1);
  assert.match(html, /^<strong><em><a /);
  assert.match(html, /href="rules.html\?id=PC1%3Achecks"/);
  assert.match(html, /<\/a><\/em><\/strong>$/);
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
  const { html } = renderContent({ entries: [
    "Cast {@spell light}.",
    { type: "list", style: "list-no-bullets", items: ["Cast {@spell light|PC1}."] },
    { type: "table", rows: [["{@spell light|PC1|Light}"]] },
  ] });
  assert.equal((html.match(/<em>/g) || []).length, 3);
});

test("content renders headings, lists, tables, sidebars, images, and flavor", () => {
  const { html, headings } = renderContent({ entries: [
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
  const dialogue = renderContent({ entries: [{ ...table, style: "table-dialogue" }] }).html;
  assert.match(dialogue, /<table class="dialogue-table"><caption>Example conversation<\/caption><colgroup><col class="dialogue-speaker-column"><col><\/colgroup>/);
  assert.match(dialogue, /<th scope="col">Speaker<\/th>/);
  assert.match(dialogue, /<th scope="row"><strong>Merisiel \(Shay\):<\/strong><\/th><td>I cast <em>light<\/em>/);
  assert.match(dialogue, /<th scope="row"><strong>Valeros \(Luis\):<\/strong><\/th>/);
  const normal = renderContent({ entries: [table] }).html;
  assert.match(normal, /<table><caption>/);
  assert.doesNotMatch(normal, /dialogue-table|colgroup|scope="row"/);
  const unsafe = renderContent({ entries: [{ ...table, style: 'bad" onclick="bad()' }] }).html;
  assert.doesNotMatch(unsafe, /onclick|dialogue-table/);
});

test("dialogue tables reserve speaker width, top-align rows and stack on narrow screens", async () => {
  const css = await read("css/site.css");
  assert.match(css, /\.dialogue-table \{ table-layout: fixed; font: \.9rem\/1\.7 var\(--font-ui\)/);
  assert.match(css, /\.dialogue-speaker-column \{ width: 10rem; \}/);
  assert.match(css, /\.dialogue-table :is\(th, td\) \{ vertical-align: top;/);
  assert.match(css, /\.dialogue-table tbody th \{[^}]*overflow-wrap: normal; word-break: normal; white-space: normal/);
  assert.match(css, /\.dialogue-table tbody tr:nth-child\(even\) \{ background: transparent/);
  assert.match(css, /@media \(max-width: 550px\) \{[\s\S]*?\.dialogue-table colgroup \{ display: none; \}/);
  assert.match(css, /\.dialogue-table :is\(th, td\) \{ display: block; width: auto; padding: \.1rem 0; border: 0/);
});

test("unbulleted lists keep separate items without altering normal paragraph spacing", async () => {
  const chapter = { entries: ["Before.", { type: "list", style: "list-no-bullets", items: [
    "{@b Kyra (Jessica):} Cast {@i light}.", "{@b Erik:} The ladder is lit.", "<script>unsafe</script>",
  ] }, "After."] };
  {
    const { html, headings } = renderContent(chapter);
    assert.match(html, /<p>Before\.<\/p>\n<ul class="list-no-bullets" role="list"><li><p><strong>Kyra \(Jessica\):<\/strong> Cast <em>light<\/em>\.<\/p><\/li><li><p><strong>Erik:<\/strong>/);
    assert.match(html, /<\/ul>\n<p>After\.<\/p>$/);
    assert.doesNotMatch(html, /<script>|<br>/);
    assert.equal(headings.length, 0);
  }
  const css = await read("css/site.css");
  assert.match(css, /:is\(\.rich-content, \.rule-preview-body\) \.list-no-bullets > li > p \{ margin: 0; \}/);
  assert.match(css, /\.list-no-bullets > li \{ margin: 0; \}/);
  assert.match(css, /:is\(\.rich-content, \.rule-preview-body\) p \{ margin: 0 0 1rem; \}/);
});

test("list variants retain bullet defaults, numbering, and nested items without arbitrary CSS injection", () => {
  const html = renderContent({ entries: [
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
    const { html, headings } = renderContent({ entries: [{ type: `h${level}`, name: "A heading", entries: ["Text."] }] });
    const renderedLevel = Math.min(6, level + 1);
    const extra = level === 6 ? ' data-heading-level="6"' : "";
    assert.match(html, new RegExp(`<h${renderedLevel} id="section-1"${extra}>A heading</h${renderedLevel}>`));
    assert.equal(headings[0].entry.type, `h${level}`);
    assert.equal(headings[0].level, renderedLevel);
  }
  const sidebar = renderContent({ entries: [{ type: "sidebar", name: "A note", entries: ["Sidebar text."] }] });
  assert.match(sidebar.html, /^<aside>/);
  assert.match(sidebar.html, /Sidebar text/);
});

test("decorative rule boxes support titles and nested entries", () => {
  const { html, headings } = renderContent({ entries: [
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
  const escaped = renderContent({ entries: [{ type: "box", name: '<img src=x onerror="bad()">', entries: ["<script>bad()</script>"] }] });
  assert.doesNotMatch(escaped.html, /<img|<script/);
  const simpleNote = renderContent({ entries: [{ type: "inset", name: "Note", entries: ["A note."] }] });
  assert.match(simpleNote.html, /^<aside>/);
  assert.doesNotMatch(simpleNote.html, /class="rule-box"/);
});



test("public pages load only existing assets and use relative URLs", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  for (const path of ["index.html", "rules.html", "rule.html", "actions.html"]) {
    const html = await read(path);
    assert.match(html, /<html lang="en" data-theme="dark">/);
    const navigation = html.match(/<nav aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation, `${path}: main navigation exists`);
    const reference = navigation.match(/<details class="reference-menu" id="reference-menu">([\s\S]*?)<\/details>/)?.[1];
    assert.ok(reference, `${path}: Reference is a native disclosure`);
    assert.match(reference, /<summary[^>]*>Reference/);
    assert.match(reference, /href="rules.html"/);
    assert.match(reference, /href="actions.html"/);
    assert.match(navigation, /href="index.html"/);
    const currentPage = path === "rule.html" ? "rules.html" : path;
    assert.match(navigation, new RegExp(`href="${currentPage.replace(".", "\\.")}" aria-current="page"`));
    assert.doesNotMatch(navigation, /The Avalon setting/i);
    assert.match(html, /<footer class="site-footer"><span>Avalon · 2026<\/span><span>Pathfinder · Second Edition<\/span><\/footer>/);
    assert.doesNotMatch(html, /(?:src|href)="\//);
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const asset = match[1].split(/[?#]/)[0];
      if (asset) await readFile(new URL(asset, root));
    }
  }
});

test("the local server serves current pages, data and fonts while blocking private files", async t => {
  const server = createServer(fileURLToPath(root));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/", "/rules.html", "/actions.html", "/actions.html?id=PC1:stride", "/rules.html?id=PC1:rolling-checks", "/css/site.css", "/css/home.css", "/css/rules.css", "/css/actions.css",
    "/js/theme.js", "/js/content-renderer.js", "/js/rules-app.js", "/js/rules-library.js", "/js/rule-links.js", "/js/data-loader.js", "/js/actions-app.js", "/js/actions-library.js", "/data/rules.json", "/data/actions.json", "/data/actions.schema.json"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
    await response.arrayBuffer();
  }
  const font = await fetch(`${base}/fonts/Pathfinder2eActions.ttf`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/ttf");
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), await readFile(new URL("fonts/Pathfinder2eActions.ttf", root)));
  const css = await read("css/site.css");
  const fontPaths = [...new Set([...css.matchAll(/url\("\.\.\/(fonts\/[^"\)]+)"\)/g)].map(match => match[1]))];
  assert.ok(fontPaths.length >= 6);
  for (const path of fontPaths) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("content-type"), path.endsWith(".woff2") ? "font/woff2" : "font/ttf");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 1000, path);
    if (path.endsWith(".woff2")) assert.equal(bytes.toString("ascii", 0, 4), "wOF2", path);
    else assert.equal(bytes.readUInt32BE(0), 0x00010000, path);
  }
  for (const path of ["/.git/config", "/package.json", "/scripts/serve.mjs", "/data/%2e%2e%2f.git/config", "/data/%5c..%5c.git/config",
    "/book.html", "/books.html", "/js/site.js", "/js/reader-controls.js", "/js/book-renderer.js"]) {
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
    client.once("error", reject); client.end();
  });
  assert.equal(malformed, 400);
});
