import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";

test("list columns work with bullet, numbered and plain lists without changing item formatting", () => {
  const render = block => renderContent({ entries: [{ type: "list", columns: 3, items: ["{@b First}", "Second", "Third"], ...block }] }).html;
  assert.match(render({}), /<ul class="list-columns" style="--list-columns: 3"><li><p><strong>First<\/strong><\/p><\/li>/);
  assert.match(render({ style: "list-decimal" }), /<ol class="list-columns" style="--list-columns: 3">/);
  assert.match(render({ ordered: true }), /<ol class="list-columns" style="--list-columns: 3">/);
  assert.match(render({ style: "list-no-bullets" }), /<ul class="list-no-bullets list-columns" role="list" style="--list-columns: 3">/);
  assert.match(render({ columns: 4 }), /--list-columns: 4/);
});

test("omitted or invalid column counts leave ordinary lists intact and cannot inject styles", () => {
  for (const columns of [undefined, null, 0, 1, -2, 2.5, "3", "2; color: red", Number.MAX_SAFE_INTEGER + 1]) {
    const { html } = renderContent({ entries: [{ type: "list", columns, items: ["One", "Two"] }] });
    assert.equal((html.match(/<li\b/g) || []).length, 2);
    assert.match(html, /One/);
    assert.match(html, /Two/);
    assert.doesNotMatch(html, /list-columns|style=/);
  }
});
