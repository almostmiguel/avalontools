import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";
import { createRuleLibrary, renderRuleBody } from "../js/rule-library.js";
import { renderRulePreview } from "../js/reference-previews.js";

const spell = {
  type: "spell", name: "Example Spell", level: "Level", traits: ["Concentrate", "Manipulate"],
  traditions: ["arcane", "primal"], cast: 2, cost: "One gem.", trigger: "An enemy approaches.",
  requirements: "A free hand.", range: "60 feet", area: "20-foot burst", targets: "1 creature",
  defense: "basic Reflex", duration: "1 minute", entries: ["The spell deals {@b damage}.", "Another paragraph."],
  heightened: [{ level: 3, entries: ["The area grows."] }, { level: "+1", entries: ["Add {@dice 1d6} damage."] }],
};

test("spell blocks preserve traits, casting fields, description and heightened effects in order", () => {
  const { html, headings } = renderContent({ entries: [spell] });
  assert.match(html, /class="ability-block spell-block"/);
  assert.match(html, /class="ability-level">Spell Level<\/span>/);
  assert.match(html, /role="listitem">Concentrate/);
  assert.match(html, /arcane, primal/);
  assert.match(html, /data-symbol="2"/);
  assert.doesNotMatch(html.split("</header>")[0], /action-symbol/);
  let previous = -1;
  for (const text of ["Traditions", "Cast", "Cost", "Trigger", "Requirements", "Range", "Area", "Targets", "Defense", "Duration", "The spell deals", "Heightened (3)", "Heightened (+1)"]) {
    const index = html.indexOf(text, previous + 1);
    assert.ok(index > previous, `Missing or misplaced: ${text}`);
    previous = index;
  }
  assert.match(html, /The spell deals <strong>damage<\/strong>/);
  assert.match(html, /Add 1d6 damage/);
  const rows = [...html.matchAll(/<div class="ability-field">([\s\S]*?)<\/div>/g)].slice(0, 5).map(match => match[1]);
  assert.deepEqual(rows.map(row => [...row.matchAll(/<dt>([^<]+)<\/dt>/g)].map(match => match[1])), [
    ["Traditions"], ["Cast", "Cost"], ["Trigger", "Requirements"], ["Range", "Area", "Targets"], ["Defense", "Duration"],
  ]);
  assert.deepEqual(rows.map(row => (row.replace(/<[^>]*>/g, "").match(/;/g) || []).length), [0, 1, 1, 2, 1]);
  assert.equal(headings[0].outline, false);
  assert.match(html, new RegExp('aria-labelledby="' + headings[0].id + '"'));
});

test("optional spell fields disappear, casting accepts action costs or time, and spell classifications stay distinct", () => {
  const minimal = renderContent({ entries: [{ type: "spell", name: "Simple", entries: ["Effect."] }] }).html;
  assert.doesNotMatch(minimal, /ability-traits|ability-fields|ability-special|action-symbol|undefined|\[object Object\]/);
  for (const cast of [1, 2, 3, "r", "f"]) {
    const html = renderContent({ entries: [{ type: "spell", name: "Quick", cast }] }).html;
    assert.match(html, new RegExp('data-symbol="' + cast + '"'));
  }
  for (const cast of ["1 round", "1 minute", "10 minutes", "1 hour"]) {
    const html = renderContent({ entries: [{ type: "spell", name: "Slow", cast }] }).html;
    assert.ok(html.includes(cast));
    assert.doesNotMatch(html, /action-symbol/);
  }
  const formatted = renderContent({ entries: [{ type: "spell", name: "Formatted", cast: "{@as 2} (concentrate, manipulate)", traditions: "Tradition explanation.", defense: ["A save.", "Another result."] }] }).html;
  assert.match(formatted, /data-symbol="2"/);
  assert.match(formatted, /Tradition explanation/);
  assert.match(formatted, /Another result/);
  for (const [spellType, label] of [["cantrip", "Cantrip"], ["focus", "Focus"]]) {
    const html = renderContent({ entries: [{ type: "spell", name: "Different", spellType, level: 1 }] }).html;
    assert.ok(html.includes(label + " 1"));
  }
  const empty = renderContent({ entries: [{ type: "spell", name: "Empty", traditions: [], cast: " ", traits: [], duration: "", heightened: [null, { level: "+1", entries: [] }] }] }).html;
  assert.doesNotMatch(empty, /ability-traits|ability-fields|ability-special|Heightened/);
});

test("spell blocks remain safe and render consistently inside rule previews without becoming catalog rules", () => {
  const entry = { ...spell, name: '<script>spell</script>', heightened: [{ level: '<img src=x onerror="bad()">', entries: ["{@b Heightened} effect."] }] };
  const payload = { sources: [{ id: "PC1", name: "Player Core" }], rules: [{ type: "h2", name: "Reading Spells", source: "PC1", entries: [entry] }] };
  const before = JSON.stringify(payload), library = createRuleLibrary(payload);
  assert.equal(library.rules.length, 1);
  const html = renderRuleBody(library.get("PC1:reading-spells"), library);
  const preview = renderRulePreview("Reading Spells", "PC1", library.registry);
  for (const content of [html, preview]) {
    assert.match(content, /spell-block/);
    assert.match(content, /&lt;script&gt;spell&lt;\/script&gt;/);
    assert.match(content, /&lt;img/);
    assert.doesNotMatch(content, /<script>|<img|\[object Object\]/);
    assert.match(content, /<strong>Heightened<\/strong> effect/);
    const ids = [...content.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.equal(JSON.stringify(payload), before);
});

test("domains replace traditions and missing grouped fields never leave separator-only rows", () => {
  const getHtml = entry => renderContent({ entries: [{ type: "spell", name: "Domain Spell", ...entry }] }).html;
  for (const domain of ["Fire", ["Fire", "Sun"]]) {
    const html = getHtml({ domain, traditions: ["arcane"], cast: 2, targets: "One creature", defense: "Will" });
    assert.match(html, /<dt>Domain<\/dt>/);
    assert.match(html, /Fire/);
    assert.doesNotMatch(html, /Traditions|arcane|;\s*<\/dd>/);
    const rows = [...html.matchAll(/<div class="ability-field">([\s\S]*?)<\/div>/g)];
    assert.ok(rows.every(row => !row[1].includes(";")));
  }
  for (const domain of ["", " ", [], [" "]]) {
    const html = getHtml({ domain, traditions: ["primal"] });
    assert.match(html, /<dt>Traditions<\/dt>/);
    assert.doesNotMatch(html, /<dt>Domain<\/dt>/);
  }
  const legacy = getHtml({ savingThrow: "Reflex" });
  assert.match(legacy, /<dt>Defense<\/dt>/);
  assert.match(legacy, /Reflex/);
  assert.doesNotMatch(legacy, /Saving Throw/);
});
