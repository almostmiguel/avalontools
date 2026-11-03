import { pc1Payload } from "./core-fixtures.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseDocument, DomUtils } from "htmlparser2";
import { renderInline } from "../js/content-renderer.js";
import { createCatalog, searchCatalog, sortCatalog, encounterMatchesFilters } from "../js/reference-library.js";
import { createCreatureCatalog, createCompanionCatalog, creatureOptions, CREATURE_FILTERS, renderCreatureDetail, renderCreaturePreview, CREATURE_BROWSER_DEFINITION, COMPANION_BROWSER_DEFINITION } from "../js/creature-library.js";
import { parseCreaturePage, parseCreatureAbilityIndex } from "../scripts/import-core-creatures.mjs";
import { parseCompanionPage, parseFamiliarAbilityPage } from "../scripts/import-pc1-companions.mjs";

const payload = JSON.parse(await readFile(new URL("../data/creatures.json", import.meta.url), "utf8"));
const library = createCreatureCatalog(payload);
const creatures = library.records.filter(record => record.kind === "creature");

test("shared core creature abilities are complete and all former external ability links resolve locally", () => {
  const abilities = library.records.filter(record => record.kind === "ability");
  assert.equal(abilities.length, 42);
  assert.equal(new Set(library.records.map(record => record.id)).size, 848);
  for (const record of abilities) {
    assert.ok(Number.isInteger(record.page) && record.page > 0);
    assert.ok(library.sources.includes(record.source));
    const html = renderCreatureDetail(record, library);
    assert.match(html, /Creature Ability/);
    assert.match(html, /<footer class="reader-footer">/);
    assert.doesNotMatch(html, /undefined|\[object Object\]|<script|Creature null|creature-size|creature-family|\{@/);
    assert.match(library.renderPreview(record), /Creature Ability/);
  }
  const raw = JSON.stringify(payload);
  assert.doesNotMatch(raw, /\{@link [^{}]*MonsterAbilities\.aspx/);
  const links = [...raw.matchAll(/\{@creatureability ([^|{}]+)\|([^|{}]*)(?:\|[^{}]*)?\}/g)];
  assert.ok(links.length > 2000);
  for (const [, name, source] of links) {
    const found = library.registry.resolve(name, source);
    assert.equal(found.status, "found", `${name}|${source}`);
    assert.equal(found.target.kind, "ability");
  }
  const grab = library.registry.resolve("Grab").target;
  assert.equal(grab.id, "RoE:ability-grab");
  assert.equal(grab.page, 232);
  assert.match(renderCreatureDetail(grab, library), /data-symbol="1"/);
  assert.match(renderCreatureDetail(library.registry.resolve("Engulf").target, library), /data-symbol="2"/);
  assert.match(renderCreatureDetail(library.registry.resolve("Darkvision").target, library), /magical darkness/);
  assert.equal(library.registry.resolve("Improved Grab, Improved Knockdown, or Improved Push").status, "found");
  assert.match(renderInline("{@creatureability Grab|RoE|grab}", { resolveCreatureAbility: library.registry.resolve }), /href="creatures.html\?id=RoE%3Aability-grab"/);
});

test("creature ability import preserves costs, requirements and effects with their actual source", () => {
  const html = '<h1 class="title">Creature Abilities</h1><span><h2 class="title"><a href="MonsterAbilities.aspx?ID=1">Test Ability</a><span class="action">[reaction]</span></h2><b>Source</b><a>Monster Core pg. 358</a><br><b>Trigger</b> A creature attacks.<br><b>Effect</b> Its attack fails.<h2 class="title"><a href="MonsterAbilities.aspx?ID=2">Other Ability</a></h2><b>Source</b><a>Other Book pg. 10</a><br>Other text.</span>';
  const abilities = parseCreatureAbilityIndex(html, {});
  assert.equal(abilities.length, 1);
  assert.equal(abilities[0].name, "Test Ability");
  assert.equal(abilities[0].source, "MC1");
  assert.equal(abilities[0].actions, "r");
  assert.equal(abilities[0].category, "Reaction");
  assert.deepEqual(abilities[0].entries, ["{@b Trigger} A creature attacks.", "{@b Effect} Its attack fails."]);
});

test("PC1 companions include all 16 types, full support and advanced maneuvers, and complete advancement rules", async () => {
  const payload = pc1Payload(JSON.parse(await readFile(new URL("../data/companions.json", import.meta.url), "utf8")));
  const library = createCompanionCatalog(payload);
  const companions = library.records.filter(record => record.kind === "companion");
  assert.deepEqual(companions.map(record => record.name), ["Ape", "Arboreal Sapling", "Badger", "Bat", "Bear", "Bird", "Boar", "Cat", "Crocodile", "Dromaeosaur", "Horse", "Riding Drake", "Scorpion", "Shark", "Snake", "Wolf"]);
  const traits = createCatalog(JSON.parse(await readFile(new URL("../data/traits.json", import.meta.url), "utf8")), { collection: "traits", href: "traits.html" });
  for (const record of companions) {
    assert.equal(record.source, "PC1");
    assert.ok(record.page >= 206 && record.page <= 211);
    for (const trait of record.traits) assert.equal(traits.registry.resolve(trait).status, "found", trait);
    const html = COMPANION_BROWSER_DEFINITION.renderDetail(record, library);
    assert.doesNotMatch(html, /undefined|\[object Object\]|<script|PFS Standard|Legacy Content|Site Owner:|\{@/);
    assert.match(html, /Support Benefit/);
    assert.match(html, /Advanced Maneuver/);
    assert.match(html, /data-symbol="1"/);
    assert.match(html, /<footer class="reader-footer">[\s\S]*Player Core/);
    assert.match(html, /<details class="creature-family"><summary>Companion rules and advancement/);
    for (const stage of ["Young Animal Companions", "Mature Animal Companions", "Nimble Animal Companions", "Savage Animal Companions", "Specialized Animal Companions", "Ambusher", "Bully", "Daredevil", "Racer", "Tracker", "Wrecker"]) assert.ok(html.includes(stage), stage);
    const preview = library.renderPreview(record);
    assert.match(preview, /Support Benefit/);
    assert.match(preview, /<footer class="reader-footer">/);
  }
  assert.equal(library.records.filter(record => record.category === "Plant").length, 1);
  assert.equal(library.registry.resolve("Wolf").target.page, 210);
  assert.deepEqual(searchCatalog(library, "frightened"), []);
  assert.equal(library.records.filter(record => encounterMatchesFilters(record, { category: new Map([["Plant", 1]]), size: new Map([["Small", 1]]), trait: new Map([["uncommon", 1]]) }))[0].name, "Arboreal Sapling");
  assert.match(renderInline("{@companion Wolf|PC1}", { resolveCompanion: library.registry.resolve }), /href="companions.html\?id=PC1%3Awolf"/);
});

test("all 41 PC1 familiar and master abilities preserve prerequisites, full text, source footers and links", async () => {
  const payload = pc1Payload(JSON.parse(await readFile(new URL("../data/companions.json", import.meta.url), "utf8")));
  const library = createCompanionCatalog(payload);
  const abilities = library.records.filter(record => record.kind === "familiar");
  assert.equal(abilities.length, 41);
  assert.equal(new Set(abilities.map(record => record.name)).size, 41);
  assert.equal(abilities.filter(record => record.category === "Familiar").length, 31);
  assert.equal(abilities.filter(record => record.category === "Master").length, 10);
  for (const record of abilities) {
    assert.equal(record.source, "PC1");
    assert.ok(Number.isInteger(record.page) && record.page > 0);
    const html = COMPANION_BROWSER_DEFINITION.renderDetail(record, library);
    assert.match(html, new RegExp(`${record.category} Ability`));
    assert.match(html, /<footer class="reader-footer">[\s\S]*Player Core/);
    assert.doesNotMatch(html, /undefined|\[object Object\]|\{@|<script|Companion rules and advancement|creature-size|Ability Type/);
    assert.match(library.renderPreview(record), new RegExp(`${record.category} Ability`));
  }
  const toolbearer = library.registry.resolve("Toolbearer").target;
  const html = COMPANION_BROWSER_DEFINITION.renderDetail(toolbearer, library);
  assert.match(html, /data-companion-name="Manual Dexterity"/);
  assert.match(html, /must have/);
  assert.match(html, /href="companions.html\?id=PC1%3Amanual-dexterity"/);
  const filters = { abilityType: new Map([["Master", 1]]) };
  assert.equal(abilities.filter(record => encounterMatchesFilters(record, filters)).length, 10);
});

test("familiar ability imports verify the book and ability type and retain requirements", () => {
  const html = '<h1 class="title">Test Ability</h1><b>Source</b><a>Player Core pg. 213</a><br><b>Ability Type</b>Familiar<br>Your familiar must have speech. Full effect.<div class="clear"></div>Footer';
  const selection = { name: "Test Ability", path: "Familiars.aspx?ID=1" };
  const record = parseFamiliarAbilityPage(html, selection, {});
  assert.equal(record.category, "Familiar");
  assert.equal(record.kind, "familiar");
  assert.deepEqual(record.entries, ["Your familiar must have speech. Full effect."]);
  assert.throws(() => parseFamiliarAbilityPage(html.replace("Player Core", "Other Book"), selection, {}), /Missing PC1 familiar citation/);
});

test("creature badges order optional rarity before size and other traits in readers and previews", () => {
  for (const record of creatures) for (const html of [renderCreatureDetail(record, library), renderCreaturePreview(record, library)]) {
    const doc = parseDocument(html);
    const list = DomUtils.findOne(node => node.attribs?.["aria-label"] === "Traits", doc.children);
    const badges = list.children.filter(node => node.attribs?.role === "listitem");
    const rarity = trait => ["uncommon", "rare", "unique"].includes(trait);
    const expected = [...record.traits.filter(rarity), record.size.toLowerCase(), ...record.traits.filter(trait => !rarity(trait))];
    assert.deepEqual(badges.map(node => DomUtils.textContent(node).toLowerCase()), expected, record.name);
    assert.equal(badges[record.traits.filter(rarity).length].attribs["data-trait-badge"], "size");
  }
});

test("companion imports preserve action costs, requirements and support text while rejecting the wrong book", () => {
  const html = `<h1 class="title">Test Companion</h1><span class="trait">Animal</span><span class="trait">Minion</span><br><b>Source</b><a>Player Core pg. 206</a><br>A companion.<br><b>Size</b>Small<br><b>Melee</b><span class="action">[one-action]</span> claw<br><b>Support Benefit</b>Support text.<br><b>Advanced Maneuver</b>Test maneuver<h3 class="title">Test maneuver <span class="action">[two-actions]</span></h3><b>Source</b><a>Player Core pg. 206</a><br><b>Requirements</b>A foe in reach.<hr>Maneuver effect.<div class="clear"></div>Footer`;
  const record = parseCompanionPage(html, { name: "Test Companion", path: "Companions.aspx?ID=1" }, {});
  assert.equal(record.size, "Small");
  assert.match(JSON.stringify(record.entries), /Test maneuver \{@as 2\}/);
  assert.match(JSON.stringify(record.entries), /A foe in reach/);
  assert.doesNotMatch(JSON.stringify(record.entries), /Source|Player Core|Footer/);
  assert.throws(() => parseCompanionPage(html.replaceAll("Player Core", "Core Rulebook"), { name: "Test Companion" }, {}), /Missing PC1 citation/);
});

test("both complete Monster Core catalogs have usable stat blocks, resolvable traits and source citations", async () => {
  assert.equal(creatures.length, 806);
  assert.equal(new Set(creatures.map(record => record.name)).size, 806);
  assert.equal(creatures.filter(record => record.source === "MC1").length, 411);
  assert.equal(creatures.filter(record => record.source === "MC2").length, 395);
  const traits = createCatalog(JSON.parse(await readFile(new URL("../data/traits.json", import.meta.url), "utf8")), { collection: "traits", href: "traits.html" });
  for (const record of creatures) {
    assert.ok(Number.isInteger(record.page) && record.page > 0);
    assert.ok(record.size);
    for (const trait of record.traits) assert.equal(traits.registry.resolve(trait).status, "found", `${record.name}: ${trait}`);
    const html = renderCreatureDetail(record, library);
    assert.doesNotMatch(html, /undefined|\[object Object\]|<script|PFS Standard|Site Owner:|All Monsters|Load Spell Descriptions|Print Stat Block/);
    for (const field of ["AC", "HP", "Speed", "Perception"]) assert.match(JSON.stringify(record.entry.entries), new RegExp(`\\{@b ${field}\\}`), record.name);
    assert.ok(html.indexOf('class="reader-footer"') > html.indexOf('class="rich-content'));
    const row = CREATURE_BROWSER_DEFINITION.renderResults([record], record.id);
    assert.ok(row.indexOf("catalog-result-level") < row.indexOf("catalog-result-source"));
  }
  const sentinel = library.registry.resolve("Adamant Sentinel", "MC2").target;
  const html = renderCreatureDetail(sentinel, library);
  assert.match(html, /<strong>AC<\/strong> 42/);
  assert.match(html, /<strong>HP<\/strong> 255/);
  assert.match(html, /Self-Repair/);
  assert.match(html, /data-symbol="1"/);
  assert.match(html, /data-condition-name="Slowed"/);
  assert.match(html, /data-trait-name="rare"/);
  const dragon = renderCreatureDetail(library.registry.resolve("Adult Conspirator Dragon").target, library);
  assert.match(dragon, /Occult Innate Spells/);
  assert.match(dragon, /data-spell-name="Charm"/);
  assert.doesNotMatch(dragon, /data-action-name="Sneak"/);
  const vampire = library.registry.resolve("Vampire Count").target;
  assert.ok(vampire.familyRules);
  assert.match(renderCreatureDetail(vampire, library), /Coffin Restoration/);
  assert.match(renderCreatureDetail(vampire, library), /Revulsion/);
  assert.match(renderCreaturePreview(vampire, library), /Creature 6/);
  assert.match(renderInline("{@creature Vampire Count|MC1|the count}", { resolveCreature: library.registry.resolve }), /href="creatures.html\?id=MC1%3Avampire-count"/);
});

test("creature filters combine source, type, level, size, rarity, family and traits; sorting includes level minus one", () => {
  const options = creatureOptions({ records: creatures });
  assert.deepEqual(options.source.map(option => option.value), ["MC1", "MC2"]);
  assert.equal(sortCatalog(creatures, "level")[0].level, -1);
  assert.equal(sortCatalog(creatures, "level", "desc")[0].level, 25);
  const filters = Object.fromEntries(CREATURE_FILTERS.map(({ key }) => [key, new Map()]));
  filters.source.set("MC2", 1); filters.category.set("Construct", 1); filters.level.set("18", 1);
  filters.rarity.set("Rare", 1); filters.size.set("Huge", 1); filters.trait.set("mindless", 1);
  assert.deepEqual(library.records.filter(record => encounterMatchesFilters(record, filters)).map(record => record.name), ["Adamant Sentinel"]);
  filters.trait.set("mindless", -1);
  assert.equal(library.records.filter(record => encounterMatchesFilters(record, filters)).length, 0);
  assert.deepEqual(searchCatalog(library, "adamant sentinel").map(record => record.name), ["Adamant Sentinel"]);
  assert.deepEqual(searchCatalog(library, "self-repair"), []);
});

test("creature HTML imports keep abilities separate, preserve costs and poison stages, and discard family catalogs and page controls", () => {
  const selection = { name: "Test Creature", path: "Monsters.aspx?ID=1", book: { id: "MC2", name: "Monster Core 2" } };
  const html = `<h1 class="title">Test Creature</h1>Its description.</span><h2 class="hide-on-print">Elite | Weak</h2><h1 class="title monster-statblock-name">Test Creature<span>Creature -1</span></h1><span class="traitsize">Small</span><span class="trait">Animal</span><br><b>Source</b><a>Monster Core 2 pg. 12</a><br><b>Perception</b> +4<br><b>AC</b> 13<br><b>HP</b> 8<hr><b>Speed</b> 20 feet<br><span class="hanging-indent"><b>Melee</b><span class="action">[one-action]</span> jaws +5, <b>Damage</b> 1d4</span><span class="hanging-indent"><b>Venom</b><b>Stage 1</b> 1 poison; <b>Stage 2</b> 2 poison</span><div class="creature-spellbook-wrapper">Load Spell Descriptions</div><div class="monster-family hide-on-print"><h2>All Monsters in Animals</h2><a href="MonsterFamilies.aspx?ID=1">Animals</a><h1>Animals</h1><b>Source</b><a>Monster Core 2 pg. 10</a><br><b>Shared Ability</b> Important rule.</div><div class="clear"></div>Site Owner:`;
  const record = parseCreaturePage(html, selection, { externalFallback: true });
  assert.equal(record.level, -1); assert.equal(record.size, "Small"); assert.equal(record.category, "Animal");
  assert.deepEqual(record.description, ["Its description."]);
  assert.ok(record.entries.some(entry => typeof entry === "string" && /^\{@b Melee\}\s*\{@as 1\}/.test(entry)));
  assert.ok(record.entries.some(entry => typeof entry === "string" && entry.startsWith("{@b Stage 2}")));
  assert.match(JSON.stringify(record.familyRules), /Shared Ability/);
  assert.doesNotMatch(JSON.stringify(record.entries), /Elite|Weak|All Monsters|Load Spell|Site Owner/);
  assert.throws(() => parseCreaturePage(html.replace("Monster Core 2 pg. 12", "Other Book pg. 12"), selection, {}), /Missing MC2 citation/);
});
