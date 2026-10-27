import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";

test("clarifications start collapsed with a native disclosure, default title and formatted body without creating headings", () => {
  const { html, headings } = renderContent({ entries: [{
    type: "clarification", entries: ["A {@b clarification}.", { type: "list", items: ["An example."] }],
  }] });
  assert.match(html, /^<details class="paizo-clarification"><summary>/);
  assert.match(html, /<span>Paizo Clarification<\/span>/);
  assert.match(html, /class="clarification-body"><p>A <strong>clarification<\/strong>\.<\/p>/);
  assert.match(html, /<ul><li><p>An example\.<\/p><\/li><\/ul>/);
  assert.match(html, /<\/div><\/details>$/);
  assert.equal(headings.length, 0);
  assert.doesNotMatch(html, /<a |source-link/);
});

test("clarifications can start expanded and safely render custom titles and text", () => {
  const { html } = renderContent({ entries: [{
    type: "clarification", open: true, name: "An {@i official} note <script>",
    entry: '<img src=x onerror="bad()"> {@link Unsafe|javascript:bad()}',
  }] });
  assert.match(html, /^<details class="paizo-clarification" open><summary>/);
  assert.match(html, /An <em>official<\/em> note &lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; Unsafe/);
  assert.doesNotMatch(html, /<script>|<img|href=|javascript:/);
});
