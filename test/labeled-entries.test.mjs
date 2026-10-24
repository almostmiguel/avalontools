import assert from "node:assert/strict";
import { test } from "node:test";
import { renderChapter } from "../js/book-renderer.js";

test("hanging labeled items support translated labels and formatted content without changing ordinary items", () => {
  const { html } = renderChapter({ entries: [
    { type: "item", style: "hanging", name: "Éditos", entry: "Protect {@i nature} & friends." },
    { type: "item", style: "hanging", name: "<Anátema>", entries: ["First line.", "Second line."] },
    { type: "item", name: "Ordinary", entry: "Unchanged." },
    "Normal paragraph.",
  ] });
  assert.match(html, /<p class="hanging-entry"><strong>Éditos<\/strong> Protect <em>nature<\/em> &amp; friends\.<\/p>/);
  assert.match(html, /<div class="hanging-entry"><strong>&lt;Anátema&gt;<\/strong> <p>First line\.<\/p>\n<p>Second line\.<\/p><\/div>/);
  assert.match(html, /<p><strong>Ordinary<\/strong> Unchanged\.<\/p>\n<p>Normal paragraph\.<\/p>/);
});
