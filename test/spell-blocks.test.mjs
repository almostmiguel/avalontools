import { pc1Payload } from "./core-fixtures.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";
import { createRuleLibrary, renderRuleBody } from "../js/rule-library.js";
import { renderRulePreview } from "../js/reference-previews.js";
import { readFile } from "node:fs/promises";
import { createCatalog, searchCatalog, sortCatalog } from "../js/reference-library.js";
import { createSpellCatalog, renderSpellDetail, renderSpellPreview, spellOptions, spellMatchesFilters, SPELL_FILTERS } from "../js/spell-library.js";
import { parseSpellPage } from "../scripts/import-pc1-spells.mjs";

const spell = {
  type: "spell", name: "Example Spell", level: "Level", traits: ["Concentrate", "Manipulate"],
  traditions: ["arcane", "primal"], cast: 2, cost: "One gem.", trigger: "An enemy approaches.",
  requirements: "A free hand.", range: "60 feet", area: "20-foot burst", targets: "1 creature",
  defense: "basic Reflex", duration: "1 minute", entries: ["The spell deals {@b damage}.", "Another paragraph."],
  heightened: [{ level: 3, entries: ["The area grows."] }, { level: "+1", entries: ["Add {@dice 1d6} damage."] }],
};

test("the PC1 spell catalog contains every unique spell and renders full mechanics with correct citations", async () => {
  const payload = pc1Payload(JSON.parse(await readFile(new URL("../data/spells.json", import.meta.url), "utf8")));
  const library = createSpellCatalog(payload);
  const traits = createCatalog(JSON.parse(await readFile(new URL("../data/traits.json", import.meta.url), "utf8")), { collection: "traits", href: "traits.html" });
  assert.equal(library.records.length, 472);
  assert.equal(new Set(library.records.map(record => record.name)).size, 472);
  assert.deepEqual(Object.fromEntries(["Spell", "Cantrip", "Focus"].map(type => [type, library.records.filter(record => record.category === type).length])), { Spell: 300, Cantrip: 41, Focus: 131 });
  for (const record of library.records) {
    assert.equal(record.source, "PC1");
    assert.ok(record.page >= 300 && record.page <= 390, record.name);
    assert.ok(record.level >= 1 && record.level <= 10);
    for (const trait of record.traits) assert.equal(traits.registry.resolve(trait).status, "found", trait);
    const html = renderSpellDetail(record, library);
    assert.doesNotMatch(html, /undefined|\[object Object\]|<script|nethys-search|Site Owner:|<h1/);
    assert.match(html, /<footer class="reader-footer">[\s\S]*Player Core/);
    assert.ok(html.indexOf("reader-footer") > html.indexOf("spell-block"));
    assert.doesNotMatch(JSON.stringify(record.entry), /Gods & Magic|Howl of the Wild|Draconic Codex|Bloodline|Catalysts/);
  }
  const fireball = library.registry.resolve("Fireball", "PC1").target;
  assert.equal(fireball.level, 3);
  const html = renderSpellDetail(fireball, library);
  for (const fragment of ["500 feet", "20-foot burst", "basic Reflex", "6d6", "Heightened (+1)", "2d6", 'data-symbol="2"', "p. 331"]) assert.ok(html.includes(fragment), fragment);
  const preview = renderSpellPreview(fireball, library);
  assert.match(preview, /<h2 id="rule-preview-title">Fireball .*data-symbol="2"/);
  assert.match(preview, /<span>Spell 3<\/span>/);
  assert.ok(preview.includes("2d6"));
  assert.equal(library.records.filter(record => record.name === "Tempest Surge").length, 1);
  assert.equal(library.registry.resolve("Tempest Surge").target.level, 1);
  assert.equal(library.registry.resolve("Embed Message").status, "found");
  const animal = library.registry.resolve("Animal Form").target.entry;
  assert.deepEqual(animal.heightened.map(group => group.level), ["3rd", "4th", "5th"]);
  assert.equal(animal.entries.filter(entry => entry.type === "list").at(-1).items.length, 9);
  assert.equal(library.registry.resolve("Avatar").target.entry.entries.filter(entry => entry.type === "list").at(-1).items.length, 20);
  assert.match(renderSpellDetail(library.registry.resolve("Creative Splash").target, library), /<table>/);
  assert.match(renderSpellDetail(library.registry.resolve("Goblin Pox").target, library), /Stage 3/);
});

test("spell filters combine rank, tradition, type, casting time and traits without searching descriptions", async () => {
  const library = createSpellCatalog(JSON.parse(await readFile(new URL("../data/spells.json", import.meta.url), "utf8")));
  const filters = Object.fromEntries(SPELL_FILTERS.map(({ key }) => [key, new Map()]));
  assert.equal(searchCatalog(library, "roaring blast").length, 0);
  assert.equal(searchCatalog(library, "FIREBALL")[0].name, "Fireball");
  const heal = library.registry.resolve("Heal").target;
  assert.deepEqual(heal.costKeys, ["action-1", "action-2", "action-3"]);
  const options = spellOptions(library);
  assert.deepEqual(options.tradition.map(option => option.value), ["arcane", "divine", "occult", "primal"]);
  assert.ok(options.time.some(option => option.value === "reaction"));
  filters.level.set("3", 1); filters.tradition.set("arcane", 1); filters.trait.set("fire", 1); filters.time.set("action-2", 1);
  assert.ok(library.records.filter(record => spellMatchesFilters(record, filters)).some(record => record.name === "Fireball"));
  filters.tradition.set("primal", -1);
  assert.equal(spellMatchesFilters(library.registry.resolve("Fireball").target, filters), false);
  assert.equal(spellMatchesFilters(library.registry.resolve("Fireball").target, filters, "tradition"), true);
  assert.equal(sortCatalog(library.records, "level")[0].level, 1);
  assert.equal(sortCatalog(library.records, "level").at(-1).level, 10);
  assert.throws(() => createSpellCatalog({ spells: [{ name: "Broken", level: 11, entries: [] }] }), /Invalid spell/);
});

test("spell import skips source supplements while retaining core forms, tables and later heightening", () => {
  const html = `<h1 class="title"><a href ="PFS.aspx"><span><img src="pfs.png"></a></span>Test Spell <span class="action">[two-actions]</span><span style="margin-left:auto">Spell 2</span></h1>
    <span class="trait">Concentrate</span><br><b>Source</b> <i>Player Core pg. 320</i><br><b>Traditions</b> arcane, primal<br><b>Bloodline</b> non-PC1 option<br><b>Range</b> 30 feet<hr>
    Choose a form.<h3 class="framing">Player Core</h3><ul><li><b>Wolf</b> Core form.</li></ul><h3 class="framing">Howl of the Wild</h3><ul><li>Other book.</li></ul><hr><b>Heightened (4th)</b> Core heightening.
    <div class="clear"></div><script>unsafe()</script>`;
  const entry = parseSpellPage(html, "Test Spell", {});
  assert.equal(entry.cast, "{@as 2}");
  assert.deepEqual(entry.traditions, ["arcane", "primal"]);
  assert.match(JSON.stringify(entry.entries), /Wolf/);
  assert.doesNotMatch(JSON.stringify(entry), /Other book|non-PC1|unsafe/);
  assert.equal(entry.heightened[0].entries[0], "Core heightening.");
  assert.throws(() => parseSpellPage(html.replace("Player Core pg. 320", "GM Core pg. 320"), "Test Spell", {}), /Not a Player Core spell/);
});

test("spell blocks preserve traits, casting fields, description and heightened effects in order", () => {
  const { html, headings } = renderContent({ entries: [spell] });
  assert.match(html, /class="ability-block spell-block"/);
  assert.match(html, /class="ability-level">Spell Level<\/span>/);
  assert.match(html, /data-trait-name="Concentrate"/);
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
