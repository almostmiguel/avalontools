import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent, renderTraitBadges } from "../js/content-renderer.js";
import { renderRulePreview } from "../js/reference-previews.js";
import { createRuleLibrary } from "../js/rule-library.js";

const source = { id: "PC1", source: "PC1", name: "Player Core" };
const ability = {
  type: "ability", name: "Example Ability", kind: "Feat", level: 1, actions: 2,
  page: 15, traits: ["General", "Skill"], access: "Campaign permission.",
  prerequisites: "Trained in a skill.", frequency: "Once per day",
  trigger: "An enemy approaches.", requirements: "You are standing.", cost: "One charge.",
  entries: ["Cast {@spell light}.", { type: "list", items: ["First effect.", "Second effect."] }],
  special: "You can select this more than once.",
};

test("trait badges share links across blocks and preserve explicit sources and labels", () => {
  const badges = renderTraitBadges(["Changeling", "{@trait Fire|PC1|Flame}", "<unsafe>", null, ""]);
  assert.match(badges, /href="traits.html\?trait=Changeling"/);
  assert.match(badges, /href="traits.html\?trait=Fire&amp;source=PC1"/);
  assert.match(badges, /data-trait-name="Fire"/);
  assert.match(badges, /reference-link-start">Flame/);
  assert.equal((badges.match(/<a\b/g) || []).length, 3);
  assert.equal((badges.match(/role="listitem"/g) || []).length, 3);
  assert.doesNotMatch(badges, /<unsafe>|\{@trait/);
  assert.equal(renderTraitBadges([]), "");
  const colored = renderTraitBadges([" UNCOMMON ", "{@trait Rare|PC1|Special find}", "Unique", "secret", "General"]);
  for (const tone of ["uncommon", "rare", "unique", "secret"]) assert.match(colored, new RegExp(`data-trait-badge="${tone}"`));
  assert.equal((colored.match(/data-trait-badge=/g) || []).length, 4);
  for (const type of ["ability", "spell"]) {
    const html = renderContent({ entries: [{ type, traits: ["Changeling"], entries: ["Description."] }] }).html;
    assert.match(html, /data-trait-name="Changeling"/);
  }
});

test("ability blocks preserve names, levels, traits, labeled fields and formatted effects", () => {
  const { html, headings } = renderContent({ entries: [ability] });
  assert.ok(html.includes(`aria-labelledby="${headings[0].id}"`));
  assert.match(html, /Example Ability/);
  assert.match(html, /data-symbol="2"/);
  assert.match(html, /<span class="ability-level">Feat 1<\/span>/);
  assert.match(html, /data-trait-name="General"/);
  assert.match(html, /data-trait-name="Skill"/);
  for (const label of ["Access", "Prerequisites", "Frequency", "Trigger", "Requirements", "Cost", "Special"]) {
    assert.ok(html.includes(`<dt>${label}</dt>`), label);
  }
  assert.match(html, /<em>light<\/em>/);
  assert.match(html, /<ul><li><p>First effect/);
  assert.equal(headings[0].name, "Example Ability");
});

test("optional ability fields, passive feats and action variants do not produce placeholders", () => {
  const minimal = renderContent({ entries: [{ type: "ability", name: "Passive Feature", entries: ["Always active."] }] }).html;
  assert.match(minimal, /Always active/);
  assert.doesNotMatch(minimal, /ability-level|ability-traits|ability-fields|action-symbol|undefined|\[object Object\]/);
  for (const actions of [1, 2, 3, "r", "f"]) {
    const html = renderContent({ entries: [{ type: "ability", name: "Action", actions }] }).html;
    assert.ok(html.includes(`data-symbol="${actions}"`));
  }
  const empty = renderContent({ entries: [{ type: "ability", name: "Empty", actions: "invalid", traits: [], prerequisites: " ", frequency: [], special: null }] }).html;
  assert.doesNotMatch(empty, /ability-traits|ability-fields|action-symbol/);
  assert.match(renderContent({ entries: [{ type: "ability", name: "Zero", kind: "Feat", level: 0 }] }).html, /Feat 0/);
});

test("ability level labels accept strings and remain safe", () => {
  for (const level of ["Level", "  Level  ", "1", "—"]) {
      const { html } = renderContent({ entries: [{ ...ability, kind: undefined, level }] });
      assert.ok(html.includes(`<span class="ability-level">${level.trim()}</span>`));
  }
  const escaped = renderContent({ entries: [{ ...ability, kind: undefined, level: '<script>bad()</script>' }] }).html;
  assert.doesNotMatch(escaped, /<script>/);
  assert.match(escaped, /&lt;script&gt;/);
  for (const level of [" ", null, {}, false]) {
    assert.doesNotMatch(renderContent({ entries: [{ ...ability, kind: undefined, level }] }).html, /ability-level/);
  }
});

test("ability field values support entry arrays and the effect alternative", () => {
  const html = renderContent({ entries: [{
    type: "ability", name: "Structured", prerequisites: ["{@b First} requirement.", "Second requirement."],
    effect: "The effect is {@i here}.", special: [{ type: "list", items: ["An exception."] }],
  }] }).html;
  assert.match(html, /<strong>First<\/strong> requirement/);
  assert.match(html, /Second requirement/);
  assert.match(html, /The effect is <em>here<\/em>/);
  assert.match(html, /An exception/);
});

test("ability blocks escape authored text instead of injecting HTML or arbitrary attributes", () => {
  const html = renderContent({ entries: [{
    type: "ability", name: '<script>bad()</script>', kind: '<img src=x onerror="bad()">',
    traits: ['<script>trait</script>', null, {}], prerequisites: '<script>field</script>',
    actions: '1" onclick="bad()', entries: ['<script>effect</script>'], special: '<script>special</script>',
  }] }).html;
  assert.doesNotMatch(html, /<script>|<img|data-symbol=/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /\[object Object\]/);
});


test("normal and compact ability previews retain fields, links, attribution and unique anchors", () => {
  for (const compact of [false, true]) {
    const entry = { ...ability, compact, id: "example-feat", aliases: ["Example"], setting: compact ? "original" : "modified", settingNote: "Campaign adaptation." };
    const rule = { id: entry.id, name: entry.name, aliases: entry.aliases, source: "PC1", page: 15, setting: entry.setting, entries: [{ ...entry, rule: false, setting: undefined }] };
    const registry = createRuleLibrary({ sources: [source], rules: [rule] }).registry;
    assert.equal(registry.resolve("Example", "PC1").target.entry, rule);
    const preview = renderRulePreview("Example", "PC1", registry);
    assert.match(preview, compact ? /ability-block--compact/ : /class="ability-block"/);
    for (const label of ["Prerequisites", "Requirements", "Special"]) assert.ok(preview.includes(label));
    assert.match(preview, /data-symbol="2"/);
    assert.match(preview, /id="rule-preview-section-1"/);
    assert.doesNotMatch(preview, /id="section-\d+"/);
    assert.match(preview, compact ? /Avalon original/ : /Adapted from/);
    assert.equal((preview.match(/class="setting-provenance"/g) || []).length, 1);
    const ids = [...preview.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  }
});

test("compact abilities preserve the full fields, glyphs, and anchor without adding controls", () => {
  const entry = { ...ability, compact: true };
  {
    const { html, headings } = renderContent({ entries: [entry] });
    assert.match(html, /class="ability-block ability-block--compact" aria-labelledby="section-1"/);
    assert.match(html, /data-symbol="2"/);
    assert.match(html, /class="ability-level">Feat 1/);
    assert.match(html, /data-trait-name="General"/);
    assert.match(html, /<dt>Frequency<\/dt>/);
    assert.match(html, /<dt>Trigger<\/dt>/);
    assert.match(html, /<dt>Special<\/dt>/);
    assert.match(html, /Cast <em>light<\/em>/);
    assert.equal(headings[0].name, ability.name);
    assert.equal(headings[0].id, "section-1");
  }
  for (const compact of [undefined, false, "true"]) {
    assert.doesNotMatch(renderContent({ entries: [{ ...ability, compact }] }).html, /ability-block--compact/);
  }
});
