import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderChapter } from "../js/book-renderer.js";
import { createRuleRegistry, renderRulePreview } from "../js/rule-links.js";
import { renderContents } from "../js/reader-controls.js";

const book = { id: "PC1", source: "PC1", name: "Player Core" };
const ability = {
  type: "ability", name: "Example Ability", kind: "Feat", level: 1, actions: 2,
  page: 15, traits: ["General", "Skill"], access: "Campaign permission.",
  prerequisites: "Trained in a skill.", frequency: "Once per day",
  trigger: "An enemy approaches.", requirements: "You are standing.", cost: "One charge.",
  entries: ["Cast {@spell light}.", { type: "list", items: ["First effect.", "Second effect."] }],
  special: "You can select this more than once.",
};

test("ability blocks render the header, action font, level, traits, labeled fields and effects", () => {
  const { html, headings } = renderChapter({ entries: [ability] });
  assert.match(html, /<section class="ability-block" aria-labelledby="section-1">/);
  assert.match(html, /Example Ability <span class="action-symbol" data-symbol="2"/);
  assert.match(html, /<span class="ability-level">Feat 1<\/span>/);
  assert.match(html, /class="ability-trait" role="listitem">General/);
  assert.match(html, /class="ability-trait" role="listitem">Skill/);
  for (const label of ["Access", "Prerequisites", "Frequency", "Trigger", "Requirements", "Cost", "Special"]) {
    assert.ok(html.includes(`<dt>${label}</dt><dd>`), label);
  }
  assert.match(html, /<em>light<\/em>/);
  assert.match(html, /<ul><li><p>First effect/);
  assert.equal(headings[0].name, "Example Ability");
  assert.equal(headings[0].page, 15);
  assert.equal(headings[0].tocLevel, null);
  assert.equal(renderContents(headings), "");
});

test("optional ability fields, passive feats and action variants do not produce placeholders", () => {
  const minimal = renderChapter({ entries: [{ type: "ability", name: "Passive Feature", entries: ["Always active."] }] }).html;
  assert.match(minimal, /Always active/);
  assert.doesNotMatch(minimal, /ability-level|ability-traits|ability-fields|action-symbol|undefined|\[object Object\]/);
  for (const actions of [1, 2, 3, "r", "f"]) {
    const html = renderChapter({ entries: [{ type: "ability", name: "Action", actions }] }).html;
    assert.ok(html.includes(`data-symbol="${actions}"`));
  }
  const empty = renderChapter({ entries: [{ type: "ability", name: "Empty", actions: "invalid", traits: [], prerequisites: " ", frequency: [], special: null }] }).html;
  assert.doesNotMatch(empty, /ability-traits|ability-fields|action-symbol/);
  assert.match(renderChapter({ entries: [{ type: "ability", name: "Zero", kind: "Feat", level: 0 }] }).html, /Feat 0/);
});

test("abilities omit page and folding controls while keeping rule anchors and regular nested headings", () => {
  const entry = { ...ability, entries: [{ type: "h4", name: "Nested", entries: ["Nested effect."] }] };
  const interactive = renderChapter({ entries: [entry] }, { interactive: true });
  const plain = renderChapter({ entries: [entry] });
  assert.deepEqual(interactive.headings, plain.headings);
  assert.doesNotMatch(interactive.html, /aria-controls="section-1-content"|id="section-1-content"/);
  const header = interactive.html.match(/<header class="ability-header">([\s\S]*?)<\/header>/)[1];
  assert.doesNotMatch(header, /heading-controls|heading-page|data-section-toggle|foldable-heading/);
  assert.match(interactive.html, /class="ability-content"/);
  assert.match(interactive.html, /aria-controls="section-2-content"/);
  assert.match(interactive.html, /id="section-2"/);
});

test("ability level labels accept strings and remain safe, while simple abilities are never foldable", () => {
  for (const level of ["Level", "  Level  ", "1", "—"]) {
    for (const interactive of [true, false]) {
      const { html } = renderChapter({ entries: [{ ...ability, kind: undefined, level }] }, { interactive });
      assert.ok(html.includes(`<span class="ability-level">${level.trim()}</span>`));
      assert.doesNotMatch(html, /heading-page|data-section-toggle|class="section-body"|foldable-heading/);
    }
  }
  const escaped = renderChapter({ entries: [{ ...ability, kind: undefined, level: '<script>bad()</script>' }] }).html;
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
  for (const level of [" ", null, {}, false]) {
    assert.doesNotMatch(renderChapter({ entries: [{ ...ability, kind: undefined, level }] }).html, /ability-level/);
  }
});

test("ability field values support entry arrays and the effect alternative", () => {
  const html = renderChapter({ entries: [{
    type: "ability", name: "Structured", prerequisites: ["{@b First} requirement.", "Second requirement."],
    effect: "The effect is {@i here}.", special: [{ type: "list", items: ["An exception."] }],
  }] }).html;
  assert.match(html, /<strong>First<\/strong> requirement/);
  assert.match(html, /Second requirement/);
  assert.match(html, /The effect is <em>here<\/em>/);
  assert.match(html, /An exception/);
});

test("body paragraphs stay flush left while labeled ability fields retain hanging indents", async () => {
  const css = await readFile(new URL("../css/site.css", import.meta.url), "utf8");
  assert.match(css, /:is\(\.book-content, \.rule-preview-body\) p \{ text-indent: 0; \}/);
  assert.doesNotMatch(css, /p \+ p \{[^}]*text-indent:/);
  assert.match(css, /:is\(\.flavor, \.setting-explanation, table\) p \{ text-indent: 0; \}/);
  assert.match(css, /\.ability-field \{[^}]*padding-inline-start: 1\.25em; text-indent: -1\.25em;/);
  assert.match(css, /\.ability-field dd > p \{ display: inline; margin: 0; text-indent: 0; \}/);
  const html = renderChapter({ entries: [
    "First body paragraph.", "Second body paragraph.",
    { ...ability, entries: ["First description paragraph.", "Second description paragraph."] },
  ] }).html;
  assert.match(html, /<p>First body paragraph\.<\/p>\n<p>Second body paragraph\.<\/p>/);
  assert.match(html, /class="ability-effect"><p>First description paragraph\.<\/p>\n<p>Second description paragraph\.<\/p>/);
  assert.match(html, /class="ability-field"><dt>Prerequisites<\/dt><dd><p>/);
});

test("ability blocks escape authored text instead of injecting HTML or arbitrary attributes", () => {
  const html = renderChapter({ entries: [{
    type: "ability", name: '<script>bad()</script>', kind: '<img src=x onerror="bad()">',
    traits: ['<script>trait</script>', null, {}], prerequisites: '<script>field</script>',
    actions: '1" onclick="bad()', entries: ['<script>effect</script>'], special: '<script>special</script>',
  }] }, { interactive: true }).html;
  assert.doesNotMatch(html, /<script>|<img|data-symbol=/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /\[object Object\]/);
});

test("ability rule links and previews keep the complete stat block, source and unique anchors", () => {
  const entry = { ...ability, id: "example-feat", aliases: ["Example"], ruleDefault: true, setting: "modified", settingNote: "Campaign adaptation." };
  const registry = createRuleRegistry([{ book, chapters: [{ name: "Rules", entries: [entry] }] }]);
  const target = registry.resolve("Example", "PC1").target;
  assert.equal(target.entry, entry);
  assert.equal(target.anchor, "section-1");
  assert.match(target.href, /rule=example-feat#section-1/);
  const preview = renderRulePreview("Example Ability", "PC1", registry);
  assert.match(preview, /class="ability-block"/);
  assert.match(preview, /data-symbol="2"/);
  assert.match(preview, /<dt>Prerequisites<\/dt>/);
  assert.match(preview, /<dt>Special<\/dt>/);
  assert.match(preview, /class="ability-trait"/);
  assert.match(preview, /pg\. 15/);
  assert.match(preview, /id="rule-preview-section-1"/);
  assert.doesNotMatch(preview, /id="section-1"|data-section-toggle/);
  assert.equal((preview.match(/class="setting-provenance"/g) || []).length, 1);
});

test("compact abilities preserve the full fields, glyphs, and anchor without adding controls", () => {
  const entry = { ...ability, compact: true };
  for (const interactive of [false, true]) {
    const { html, headings } = renderChapter({ entries: [entry] }, { interactive });
    assert.match(html, /class="ability-block ability-block--compact" aria-labelledby="section-1"/);
    assert.match(html, /data-symbol="2"/);
    assert.match(html, /class="ability-level">Feat 1/);
    assert.match(html, /class="ability-trait" role="listitem">General/);
    assert.match(html, /<dt>Frequency<\/dt>/);
    assert.match(html, /<dt>Trigger<\/dt>/);
    assert.match(html, /<dt>Special<\/dt>/);
    assert.match(html, /Cast <em>light<\/em>/);
    assert.equal(headings[0].name, ability.name);
    assert.equal(headings[0].id, "section-1");
    assert.doesNotMatch(html, /data-section-toggle|heading-page/);
  }
  for (const compact of [undefined, false, "true"]) {
    assert.doesNotMatch(renderChapter({ entries: [{ ...ability, compact }] }).html, /ability-block--compact/);
  }
});

test("compact ability styles inherit the ability font and use a hanging, inline layout", async () => {
  const css = await readFile(new URL("../css/site.css", import.meta.url), "utf8");
  assert.match(css, /\.ability-block \{[^}]*font: \.9rem\/1\.65 system-ui, sans-serif/);
  const compact = css.match(/:is\(\.book-content, \.rule-preview-body\) \.ability-block--compact \{([^}]+)\}/)[1];
  assert.match(compact, /padding: 0 0 0 1\.25em/);
  assert.match(compact, /text-indent: -1\.25em/);
  assert.doesNotMatch(compact, /font:/);
  assert.match(css, /\.ability-block--compact \.ability-header > :is\([^}]+font: inherit; font-weight: 700/);
  assert.match(css, /\.ability-block--compact \.ability-traits::before \{ content: "\("; \}/);
  assert.match(css, /\.ability-block--compact \.ability-traits::after \{ content: "\) "; \}/);
  assert.match(css, /\.ability-block--compact \.ability-field \+ \.ability-field::before[^}]+content: "; "/);
  assert.match(css, /\.ability-block--compact \.ability-effect::before \{ content: "; Effect "/);
  assert.doesNotMatch(css, /p \+ p \{[^}]*text-indent:/);
});

test("compact ability previews preserve compact formatting and normal rule resolution", () => {
  const entry = { ...ability, compact: true, id: "compact-example", setting: "original" };
  const registry = createRuleRegistry([{ book, chapters: [{ name: "Rules", entries: [entry] }] }]);
  const target = registry.resolve("Example Ability", "PC1").target;
  assert.match(target.href, /rule=compact-example#section-1/);
  const preview = renderRulePreview("compact-example", "PC1", registry);
  assert.match(preview, /class="ability-block ability-block--compact"/);
  assert.match(preview, /id="rule-preview-section-1"/);
  assert.match(preview, /<dt>Requirements<\/dt>/);
  assert.match(preview, /setting-content--original/);
  assert.doesNotMatch(preview, /id="section-1"|data-section-toggle/);
});
