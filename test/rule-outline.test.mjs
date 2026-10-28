import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuleLibrary, renderRuleContent, renderRuleBody, renderRuleOutline } from "../js/rule-library.js";

test("On this page uses real heading anchors and excludes boxes, notes and minor headings", () => {
  const library = createRuleLibrary({ rules: [{ id: "checks", name: "Checks", entries: [
    { type: "h2", name: "Step 1: Roll", entries: [
      { type: "h3", name: "Bonuses", entries: ["Text."] },
      { type: "h4", name: "Minor Heading", entries: ["Small detail."] },
    ] },
    { type: "box", name: "Box Title", entries: [{ type: "h1", name: "Box Header", entries: ["Text."] }] },
    { type: "clarification", entries: [{ type: "h2", name: "Clarification Header", entries: ["Text."] }] },
    { type: "sidebar", name: "Sidebar", entries: [{ type: "h2", name: "Sidebar Header", entries: ["Text."] }] },
    { type: "h2", name: "Step 2: Compare <DC>", entries: ["Text."] },
  ] }] });
  const rule = library.get("Avalon:checks");
  const content = renderRuleContent(rule, library);
  const outline = renderRuleOutline(content.headings);
  assert.match(outline, /<details id="rule-outline" class="rule-outline"><summary aria-label="On this page"/);
  assert.match(outline, /3 sections/);
  assert.match(outline, /Step 1: Roll/);
  assert.match(outline, /data-depth="1"><a[^>]+>Bonuses/);
  assert.match(outline, /Step 2: Compare &lt;DC&gt;/);
  assert.doesNotMatch(outline, /Box Title|Box Header|Clarification Header|Sidebar|Minor Heading/);
  for (const [, id] of outline.matchAll(/href="#([^"]+)"/g)) assert.ok(content.html.includes(`id="${id}"`));
  assert.match(content.html, /Box Header|Minor Heading/);
  assert.equal(renderRuleBody(rule, library), content.html);
});

test("short rules have no empty outline and duplicate names get separate anchors", () => {
  const library = createRuleLibrary({ rules: [
    { id: "short", name: "Short", entries: ["One paragraph."] },
    { id: "long", name: "Long", entries: [
      { type: "h2", name: "Example", rule: false, entries: ["First."] },
      { type: "h2", name: "Example", rule: false, entries: ["Second."] },
    ] },
  ] });
  assert.equal(renderRuleOutline(renderRuleContent(library.get("Avalon:short"), library).headings), "");
  const content = renderRuleContent(library.get("Avalon:long"), library);
  const links = [...renderRuleOutline(content.headings).matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(links).size, 2);
});
