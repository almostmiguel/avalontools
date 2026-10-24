import assert from "node:assert/strict";
import { test } from "node:test";
import { renderChapter } from "../js/book-renderer.js";
import { createRuleRegistry, renderRulePreview } from "../js/rule-links.js";

const book = { id: "PC1", source: "PC1", name: "Player Core" };

test("marked entries distinguish adaptations and originals without changing headings or anchors", () => {
  for (const setting of ["modified", "original"]) {
    const entry = { type: "h2", name: "Avalon", entries: ["A {@b new} world."] };
    const plain = renderChapter({ entries: [entry] });
    const marked = renderChapter({ entries: [{ ...entry, setting, settingNote: "Written for {@i our campaign}." }] });
    assert.match(marked.html, new RegExp(`class="setting-content setting-content--${setting}"`));
    assert.match(marked.html, new RegExp(`Avalon <span aria-hidden="true">·</span> ${setting === "original" ? "Original" : "Adapted"}`));
    assert.match(marked.html, /<details class="setting-provenance"><summary>/);
    assert.match(marked.html, /Written for <em>our campaign<\/em>/);
    assert.match(marked.html, /<h3 id="section-1">Avalon<\/h3>/);
    assert.match(marked.html, /A <strong>new<\/strong> world/);
    assert.equal(marked.headings.length, 1);
    assert.equal(marked.headings[0].id, plain.headings[0].id);
    assert.equal(marked.headings[0].tocLevel, plain.headings[0].tocLevel);
    assert.match(marked.html, setting === "original" ? /Not part of the published sourcebook/ : /differs from the published sourcebook/);
  }
});

test("markers work on paragraphs, lists, boxes and sections but never appear automatically", () => {
  for (const entry of [
    { entries: ["A paragraph."] },
    { type: "list", items: ["A list item."] },
    { type: "box", name: "House rule", entries: ["A rule."] },
    { type: "h1", name: "Setting section", entries: [{ type: "h4", name: "Nested", entries: ["Description."] }] },
  ]) {
    const plain = renderChapter({ entries: [entry] });
    const marked = renderChapter({ entries: [{ ...entry, setting: "original" }] });
    assert.ok(marked.html.includes(plain.html));
    assert.equal((marked.html.match(/class="setting-provenance"/g) || []).length, 1);
    assert.doesNotMatch(plain.html, /setting-provenance/);
  }
  assert.doesNotMatch(renderChapter({ entries: [{ setting: "unrecognized", entries: ["Text."] }] }).html, /setting-provenance/);
});

test("notes escape author text and unsafe links and cannot inject markup", () => {
  const html = renderChapter({ entries: [{ setting: "modified", settingNote: '<script>bad()</script> {@link Click|javascript:bad()}', entries: ["Text."] }] }).html;
  assert.doesNotMatch(html, /<script>|href=/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotThrow(() => renderChapter({ entries: [{ setting: "original", settingNote: {}, entries: ["Text."] }] }));
});

test("rule previews preserve markers and do not attribute setting originals to published pages", () => {
  for (const setting of ["modified", "original"]) {
    const entry = { type: "h4", name: "Avalon", page: 10, setting, settingNote: "Campaign-specific text.", entries: ["A world."] };
    const registry = createRuleRegistry([{ book, chapters: [{ name: "Chapter", entries: [entry] }] }]);
    const preview = renderRulePreview("Avalon", "PC1", registry);
    assert.match(preview, new RegExp(`setting-content--${setting}`));
    assert.match(preview, /Campaign-specific text/);
    assert.match(preview, /A world/);
    assert.equal((preview.match(/class="setting-provenance"/g) || []).length, 1);
    assert.match(preview, setting === "original" ? /Reference book/ : /Adapted from/);
    if (setting === "original") assert.doesNotMatch(preview, /pg\. 10|>Source /);
    else assert.match(preview, /pg\. 10/);
  }
});

test("linked rules inherit provenance from a marked parent, with explicit child overrides", () => {
  const registry = createRuleRegistry([{ book, chapters: [{ name: "Chapter", entries: [{
    type: "h1", name: "Avalon lore", setting: "modified", settingNote: "Parent adaptation.", entries: [
      { type: "h4", name: "Inherited", entries: ["Changed lore."] },
      { type: "h4", name: "New lore", setting: "original", entries: ["Entirely new lore."] },
      { type: "list", name: "Marked list", setting: "original", items: ["First."] },
    ],
  }] }] }]);
  const inherited = renderRulePreview("Inherited", "PC1", registry);
  assert.match(inherited, /setting-content--modified/);
  assert.match(inherited, /Parent adaptation/);
  const override = renderRulePreview("New lore", "PC1", registry);
  assert.match(override, /setting-content--original/);
  assert.doesNotMatch(override, /Parent adaptation/);
  const list = renderRulePreview("Marked list", "PC1", registry);
  assert.match(list, /<ul>/);
  assert.equal((list.match(/class="setting-provenance"/g) || []).length, 1);
});
