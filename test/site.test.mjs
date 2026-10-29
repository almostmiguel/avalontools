import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { escapeHtml, inlineText, renderContent, renderInline, safeHref } from "../js/content-renderer.js";
import { createServer } from "../scripts/serve.mjs";
const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("inline formatting is nested, escaped, and has no dead entity links", () => {
  assert.equal(renderInline("A {@b bold {@i word}}."), "A <strong>bold <em>word</em></strong>.");
  assert.equal(renderInline("{@spell fireball|PC1|Fireball}"), "<em>Fireball</em>");
  assert.match(renderInline("{@trait fire|PC1}"), /href="traits.html\?trait=fire&amp;source=PC1"/);
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
  assert.ok(renderInline("{@condition Blinded|PC1}").includes('href="conditions.html?condition=Blinded&amp;source=PC1"'));
  assert.ok(renderInline("{@skill Acrobatics|PC1|Acrobatics checks}").includes('href="skills.html?skill=Acrobatics&amp;source=PC1"'));
  assert.equal(escapeHtml('<script>"&'), "&lt;script&gt;&quot;&amp;");
  assert.doesNotMatch(renderInline('{@link Click|javascript:alert(1)}'), /href/);
  assert.match(renderInline('{@link Read|https://example.com/book}'), /href="https:\/\/example.com\/book"/);
  for (const href of ["javascript:alert(1)", "data:text/html,test", "//example.com", "\\example.com", "java\nscript:bad"]) assert.equal(safeHref(href), null);
});

test("reference icons stay with the first word without changing names, labels or nested formatting", () => {
  const rule = renderInline("{@rule Exploration Mode|PC1|exploration mode}");
  assert.match(rule, /<span class="reference-link-start">exploration<\/span> mode<\/a>/);
  assert.match(rule, /data-rule-name="Exploration Mode"/);
  assert.equal(inlineText("{@rule Exploration Mode|PC1|exploration mode}"), "exploration mode");
  const action = renderInline("{@i {@action Treat Wounds|PC1}}", {
    resolveAction: () => ({ status: "found", target: { href: "actions.html?id=PC1%3Atreat-wounds" } }),
  });
  assert.match(action, /<em><a [^>]+data-action-resolved="true"><span class="reference-link-start">Treat<\/span> Wounds<\/a><\/em>/);
  assert.equal(inlineText("{@i {@action Treat Wounds|PC1}}"), "Treat Wounds");
  assert.match(renderInline("{@rule Example||<unsafe> & text}"), /<span class="reference-link-start">&lt;unsafe&gt;<\/span> &amp; text/);
  const missing = renderInline("{@action Missing Action}", { resolveAction: () => ({ status: "missing" }) });
  assert.match(missing, />Missing Action<\/span>/);
  assert.doesNotMatch(missing, /reference-link-start/);
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
  assert.match(renderInline("{@trait fire|PC1}"), /href="traits.html\?trait=fire&amp;source=PC1"/);
  const { html } = renderContent({ entries: [
    "Cast {@spell light}.",
    { type: "list", style: "list-no-bullets", items: ["Cast {@spell light|PC1}."] },
    { type: "table", rows: [["{@spell light|PC1|Light}"]] },
  ] });
  assert.equal((html.match(/<em>/g) || []).length, 3);
});

test("clarifications, formulas and labeled entries retain structure and escape authored content", () => {
  const clarification = renderContent({ entries: [{
    type: "clarification", entries: ["A {@b clarification}.", { type: "list", items: ["An example."] }],
  }] });
  assert.match(clarification.html, /^<details class="paizo-clarification"><summary>/);
  assert.match(clarification.html, /<span>Paizo Clarification<\/span>/);
  assert.match(clarification.html, /class="clarification-body"><p>A <strong>clarification<\/strong>\.<\/p>/);
  assert.match(clarification.html, /<ul><li><p>An example\.<\/p><\/li><\/ul>/);
  assert.equal(clarification.headings.length, 0);

  const expanded = renderContent({ entries: [{
    type: "clarification", open: true, name: "An {@i official} note <script>", entry: '<img src=x onerror="bad()"> {@link Unsafe|javascript:bad()}',
  }] }).html;
  assert.match(expanded, /^<details class="paizo-clarification" open><summary>/);
  assert.match(expanded, /An <em>official<\/em> note &lt;script&gt;/);
  assert.match(expanded, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; Unsafe/);
  assert.doesNotMatch(expanded, /<script>|<img|<a\b|javascript:/);

  const formula = renderContent({ entries: [
    { type: "formula", name: "Attack <roll>", entry: "{@b d20} + modifier" },
    { type: "formula", entries: ["First calculation.", "Second calculation."] },
  ] });
  for (const text of ["Attack &lt;roll&gt;", "<strong>d20</strong> + modifier", "First calculation.", "Second calculation."]) assert.ok(formula.html.includes(text));
  assert.equal(formula.headings.length, 0);

  const labeled = renderContent({ entries: [
    { type: "item", style: "hanging", name: "Éditos", entry: "Protect {@i nature} & friends." },
    { type: "item", style: "hanging", name: "<Anátema>", entries: ["First line.", "Second line."] },
    { type: "item", name: "Ordinary", entry: "Unchanged." }, "Normal paragraph.",
  ] }).html;
  assert.match(labeled, /<p class="hanging-entry"><strong>Éditos<\/strong> Protect <em>nature<\/em> &amp; friends\.<\/p>/);
  assert.match(labeled, /<div class="hanging-entry"><strong>&lt;Anátema&gt;<\/strong> <p>First line\.<\/p>\n<p>Second line\.<\/p><\/div>/);
  assert.match(labeled, /<p><strong>Ordinary<\/strong> Unchanged\.<\/p>\n<p>Normal paragraph\.<\/p>/);
});

test("list columns retain list semantics and reject invalid style values", () => {
  const render = block => renderContent({ entries: [{ type: "list", columns: 3, items: ["{@b First}", "Second", "Third"], ...block }] }).html;
  assert.match(render({}), /<ul class="list-columns" style="--list-columns: 3"><li><p><strong>First<\/strong><\/p><\/li>/);
  assert.match(render({ style: "list-decimal" }), /<ol class="list-columns" style="--list-columns: 3">/);
  assert.match(render({ ordered: true }), /<ol class="list-columns" style="--list-columns: 3">/);
  assert.match(render({ style: "list-no-bullets" }), /<ul class="list-no-bullets list-columns" role="list" style="--list-columns: 3">/);
  assert.match(render({ columns: 4 }), /--list-columns: 4/);
  for (const columns of [undefined, null, 0, 1, -2, 2.5, "3", "2; color: red", Number.MAX_SAFE_INTEGER + 1]) {
    const { html } = renderContent({ entries: [{ type: "list", columns, items: ["One", "Two"] }] });
    assert.equal((html.match(/<li\b/g) || []).length, 2);
    assert.match(html, /One/);
    assert.match(html, /Two/);
    assert.doesNotMatch(html, /list-columns|style=/);
  }
});

test("content renders headings, lists, tables, sidebars, images, and flavor", () => {
  const { html, headings } = renderContent({ entries: [
    "A paragraph.", "Another paragraph.",
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
  assert.match(html, /<p\b[^>]*>Another paragraph\.<\/p>/);
  assert.equal(headings[0].name, "Basics");
  assert.equal(new Set(headings.map(heading => heading.id)).size, headings.length);
  for (const fragment of ["<ul>", "<table>", "<thead>", "1–4", "<aside>", 'class="flavor"', "<blockquote>", 'src="img/book.webp"']) assert.ok(html.includes(fragment), fragment);
  assert.doesNotMatch(html, /javascript:|\[object Object\]/);
});

test("table footnotes stay below the body, span all columns and support safe formatted text", () => {
  const entry = { type: "table", colLabels: ["First", "Second"], rows: [["A", "B", "C"]], footnotes: ["* A {@b table note}.", "<script>not HTML</script>"] };
  const html = renderContent({ entries: [entry] }).html;
  assert.match(html, /<tfoot><tr><td class="table-footnotes" colspan="3">/);
  assert.ok(html.indexOf("<tfoot>") > html.indexOf("</tbody>"));
  assert.match(html, /\* A <strong>table note<\/strong>/);
  assert.match(html, /&lt;script&gt;not HTML&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<\/tfoot><\/table><\/div>$/);
  for (const footnotes of [undefined, [], [" "], ""]) {
    assert.doesNotMatch(renderContent({ entries: [{ ...entry, footnotes }] }).html, /<tfoot>|table-footnotes/);
  }
  const single = renderContent({ entries: [{ type: "table", footnotes: "One note." }] }).html;
  assert.match(single, /colspan="1"/);
  assert.match(single, /One note/);
});

test("table cells merge rows and columns while keeping footnotes full-width and span attributes safe", () => {
  const { html } = renderContent({ entries: [{
    type: "table", colLabels: ["Animal", "Specific Animal", "Rental", "Purchase"],
    rows: [
      [{ entry: "Bird", rowSpan: 2, rowHeader: true }, "Messenger raven", "8 cp", "4 gp"],
      ["Hunting eagle", "8 sp", "8 gp"],
    ],
    footnotes: ["* Deposit may apply."],
  }] });
  assert.match(html, /<th scope="row" rowspan="2"><p>Bird<\/p><\/th>/);
  assert.match(html, /<tr><td>Hunting eagle<\/td><td>8 sp<\/td><td>8 gp<\/td><\/tr>/);
  assert.match(html, /class="table-footnotes" colspan="4"/);
  assert.equal(html.split(">Bird<").length - 1, 1);
  const columns = renderContent({ entries: [{
    type: "table",
    rows: [[{ entry: "Group", rowSpan: 2 }], [{ entry: "Wide", colSpan: 2 }]],
    footnotes: "A note.",
  }] }).html;
  assert.match(columns, /<td colspan="2">/);
  assert.match(columns, /class="table-footnotes" colspan="3"/);
  for (const span of ['2" onclick="bad()', -1, 0, 1.5, 1001]) {
    const safe = renderContent({ entries: [{ type: "table", rows: [[{ entry: "<script>text</script>", rowSpan: span, colSpan: span }]] }] }).html;
    assert.doesNotMatch(safe, /rowspan=|colspan=|onclick=|<script>/);
    assert.match(safe, /&lt;script&gt;text&lt;\/script&gt;/);
  }
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


test("heading levels produce usable outline metadata and sidebars retain their content", () => {
  for (let level = 1; level <= 6; level++) {
    const { html, headings } = renderContent({ entries: [{ type: "h" + level, name: "A heading", entries: ["Text."] }] });
    const renderedLevel = Math.min(6, level + 1);
    assert.match(html, new RegExp("<h" + renderedLevel + "\\b[^>]*>A heading</h" + renderedLevel + ">"));
    assert.equal(headings[0].entry.type, "h" + level);
    assert.equal(headings[0].level, renderedLevel);
    assert.ok(html.includes('id="' + headings[0].id + '"'));
  }
  const sidebar = renderContent({ entries: [{ type: "sidebar", name: "A note", entries: ["Sidebar text."] }] });
  assert.match(sidebar.html, /A note/);
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
  const escaped = renderContent({ entries: [{ type: "box", name: '<img src=x onerror="bad()">', entries: ["<script>bad()</script>"] }] });
  assert.doesNotMatch(escaped.html, /<img|<script/);
  const simpleNote = renderContent({ entries: [{ type: "inset", name: "Note", entries: ["A note."] }] });
  assert.match(simpleNote.html, /^<aside>/);
  assert.doesNotMatch(simpleNote.html, /class="rule-box"/);
});




test("public pages expose working navigation and load existing relative assets", async () => {
  for (const path of ["index.html", "rules.html", "rule.html", "actions.html", "conditions.html", "skills.html", "classes.html", "feats.html", "traits.html", "backgrounds.html", "archetypes.html", "ancestries.html"]) {
    const html = await read(path);
    assert.match(html, /<html\b[^>]*lang="en"/);
    const navigation = html.match(/<nav\b[^>]*aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
    assert.ok(navigation, path + ": main navigation exists");
    const groups = [...navigation.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)]
      .map(([, attributes, body]) => ({ id: attributes.match(/\bid="([^"]+)"/)?.[1], body }));
    assert.deepEqual(groups.map(group => group.id), ["player-menu", "game-master-menu", "reference-menu"]);
    const directRules = navigation.match(/^\s*<a\b([^>]*)>([\s\S]*?)<\/a>/);
    assert.ok(directRules, path + ": Rules is a direct link");
    assert.match(directRules[1], /\bhref="rules.html"/);
    assert.equal(directRules[2].replace(/<[^>]*>/g, "").trim(), "Rules");
    const expected = [
      ["Player", ["Ancestries", "Archetypes", "Backgrounds", "Classes", "Feats"]],
      ["Game Master", ["Afflictions", "Creatures", "Hazards"]],
      ["References", ["Actions", "Conditions", "Equipment", "Skills", "Traits"]],
    ];
    groups.forEach((group, index) => {
      const summary = group.body.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1];
      assert.equal(summary?.replace(/<[^>]*>/g, "").trim(), expected[index][0]);
      const entries = [...group.body.matchAll(/<(?:a|span)\b[^>]*data-reference-kind="[^"]+"[^>]*>([\s\S]*?)(?:<\/a>|<\/span>)/g)]
        .map(match => match[1].replace(/<[^>]*>/g, "").trim());
      assert.deepEqual(entries, expected[index][1], path + ": correct navigation grouping");
    });
    assert.match(html, /<a\b[^>]*href="index.html"/);
    const current = [...navigation.matchAll(/<a\b([^>]*)>/g)]
      .filter(match => /\baria-current="page"/.test(match[1]))
      .map(match => match[1].match(/\bhref="([^"]+)"/)?.[1]);
    assert.deepEqual(current, path === "index.html" ? [] : [path === "rule.html" ? "rules.html" : path]);
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
  for (const path of ["/", "/rules.html", "/actions.html", "/conditions.html", "/skills.html", "/classes.html", "/feats.html", "/backgrounds.html", "/archetypes.html", "/ancestries.html", "/data/ancestries.json", "/js/ancestry-reader.js", "/data/backgrounds.json", "/data/archetypes.json", "/js/character-library.js", "/feats.html?trait=wizard", "/data/feats.json", "/js/feat-library.js", ...["bard", "cleric", "druid", "fighter", "ranger", "rogue", "witch", "wizard"].map(name => `/img/classes/${name}.webp`), "/classes.html?id=PC1%3Awizard&tab=options", "/css/classes.css", "/js/class-reader.js", "/data/classes.json", "/actions.html?id=PC1:stride", "/rules.html?id=PC1:rolling-checks", "/css/site.css", "/css/home.css", "/css/rules.css", "/css/actions.css", "/css/catalog.css",
    "/js/site-shell.js", "/js/content-renderer.js", "/js/rule-browser.js", "/js/rule-library.js", "/js/reference-previews.js", "/js/reference-data.js", "/js/reference-browser.js", "/js/reference-library.js", "/data/rules.json", "/data/actions.json", "/data/actions.schema.json", "/data/conditions.json", "/data/skills.json"]) {
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
