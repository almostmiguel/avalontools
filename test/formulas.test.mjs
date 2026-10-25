import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";
import { createLibrary, renderRuleBody } from "../js/rules-library.js";
import { renderRulePreview } from "../js/rule-links.js";

test("formulas support optional labels, formatted calculations and multiple lines without adding headings", () => {
  const { html, headings } = renderContent({ entries: [
    { type: "formula", name: "Attack <roll>", entry: "{@b d20} + modifier" },
    { type: "formula", entries: ["First calculation.", "Second calculation."] },
  ] });
  assert.match(html, /<div class="rule-formula"><p class="formula-label">Attack &lt;roll&gt;<\/p><div class="formula-body"><p><strong>d20<\/strong> \+ modifier<\/p>/);
  assert.match(html, /<div class="rule-formula"><div class="formula-body"><p>First calculation\.<\/p>\n<p>Second calculation\.<\/p>/);
  assert.equal(headings.length, 0);
});

test("formula rule links work in details and hover previews while unsafe content stays escaped", () => {
  const library = createLibrary({ rules: [
    { id: "attack", name: "Attack Rolls", entries: [{
      type: "formula", entry: 'd20 + {@rule Modifier} <script>bad()</script> {@link Unsafe|javascript:bad()}',
    }] },
    { id: "modifier", name: "Modifier", entries: ["Your modifier."] },
  ] });
  const rule = library.get("Avalon:attack");
  for (const html of [renderRuleBody(rule, library), renderRulePreview("Attack Rolls", "", library.registry)]) {
    assert.match(html, /class="rule-formula"/);
    assert.match(html, /href="rules.html\?id=Avalon%3Amodifier"/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /rule-link-unresolved|<script>|javascript:/);
  }
});
