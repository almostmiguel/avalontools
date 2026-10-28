import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderInline } from "../js/content-renderer.js";
import { renderRulePreview } from "../js/reference-previews.js";
import { createRuleLibrary, searchRules, renderRuleBody, renderBrowse } from "../js/rule-library.js";

const fixture = () => ({
  sources: [{ id: "PC1", source: "PC1", name: "Player Core" }],
  rules: [
    { name: "Perception", id: "perception-rules", ruleDefault: true, source: "PC1", aliases: ["Awareness"], page: 400, entries: [
      "Notice {@i hidden} creatures and {@rule Actions}.",
      { type: "h3", name: "An Internal Heading", rule: false, entries: ["Details stay inside this rule."] },
      { type: "box", name: "A Note", rule: false, entries: [{ type: "h2", name: "Box Header", rule: false, entries: ["Keep this note."] }] },
    ] },
    { name: "Actions", id: "actions", source: "PC1", entries: [{ type: "ability", name: "Stride", rule: false, actions: 1, entries: ["Move your Speed."] }] },
    { name: "Água", id: "agua", source: "PC1", kind: "optional", entries: ["Water obscures your vision."] },
    { name: "Perception", id: "perception-summary", source: "PC1", entries: ["A brief summary."] },
  ],
});

test("rule false keeps headings and notes inline, while source metadata never creates rules", () => {
  const payload = fixture();
  const before = JSON.stringify(payload);
  payload.sources[0].file = "data/book/book-pc1.json";
  const library = createRuleLibrary(payload);
  assert.equal(library.rules.length, 4);
  assert.equal(library.get("PC1:perception-rules").page, 400);
  assert.ok(!library.rules.some(rule => ["A Note", "Box Header", "An Internal Heading", "Stride"].includes(rule.name)));
  assert.equal(library.registry.resolve("An Internal Heading", "PC1").status, "missing");
  assert.match(renderRuleBody(library.get("PC1:perception-rules"), library), /Keep this note/);
  delete payload.sources[0].file;
  assert.equal(JSON.stringify(payload), before);
  assert.equal(createRuleLibrary({ sources: payload.sources, rules: [] }).rules.length, 0);
});

test("search matches names and aliases only and combines source and type filters", () => {
  const library = createRuleLibrary(fixture());
  assert.equal(searchRules(library, { query: "Perception" })[0].id, "PC1:perception-rules");
  assert.equal(searchRules(library, { query: "awareness" })[0].id, "PC1:perception-rules");
  assert.equal(searchRules(library, { query: "agua" })[0].name, "Água");
  assert.deepEqual(searchRules(library, { source: "pc1", kind: "optional" }).map(rule => rule.name), ["Água"]);
  assert.deepEqual(searchRules(library, { query: "HIDDEN creatures", kind: "core" }), []);
  for (const query of ["Playing", "Character Creation", "Internal Heading", "Box Header", "Stride", "PC1"]) {
    assert.deepEqual(searchRules(library, { query }), [], `Excluded content or metadata: ${query}`);
  }
  assert.deepEqual(searchRules(library, { query: "percep", source: "PC1", kind: "core" }).map(rule => rule.id), ["PC1:perception-rules", "PC1:perception-summary"]);
  assert.equal(searchRules(library, { query: "hidden", }).length, 0);
  assert.equal(searchRules(library, { source: "missing" }).length, 0);
  assert.equal(searchRules(library, { query: "no-such-rule" }).length, 0);
});

test("rule references prefer default definitions and explicit ids while keeping source metadata and previews", () => {
  const library = createRuleLibrary(fixture());
  const result = library.registry.resolve("Perception", "PC1");
  assert.equal(result.status, "found");
  assert.equal(result.target.href, "rules.html?id=PC1%3Aperception-rules");
  assert.equal(library.registry.resolve("perception-summary", "PC1").target.id, "PC1:perception-summary");
  const inline = renderInline("{@rule Perception}", { resolveRule: library.registry.resolve });
  assert.match(inline, /href="rules.html\?id=PC1%3Aperception-rules"/);
  const preview = renderRulePreview("Perception", "PC1", library.registry);
  assert.match(preview, /Notice <em>hidden<\/em>/);
  assert.match(preview, /· p\. 400/);
  assert.doesNotMatch(preview, /A brief summary/);
  const ambiguous = fixture();
  delete ambiguous.rules[0].ruleDefault;
  assert.equal(createRuleLibrary(ambiguous).registry.resolve("Perception", "PC1").status, "ambiguous");
});


test("duplicate names remain unresolved while unique names, explicit IDs and declared defaults stay reliable", () => {
  const payload = { sources: [{ id: "GMC", name: "GM Core" }], rules: [
    { id: "dc-gm", name: "Difficulty Classes", source: "GMC", page: 52, aliases: ["DCs"], entries: ["GM difficulty rules."] },
    { id: "dc-pc", name: "Difficulty Classes", source: "PC1", entries: ["Another definition."] },
    { id: "gm-only", name: "GM Only", source: "GMC", entries: ["Only in GM Core."] },
  ] };
  const library = createRuleLibrary(payload);
  for (const source of [undefined, null, "", "   "]) {
    const found = library.registry.resolve("Difficulty Classes", source);
    assert.equal(found.status, "ambiguous");
    assert.deepEqual(found.matches.map(rule => rule.id), ["GMC:dc-gm", "PC1:dc-pc"]);
    assert.equal(library.registry.resolve("GM Only", source).status, "found");
  }
  assert.equal(library.registry.resolve("DCs").target.id, "GMC:dc-gm");
  assert.equal(library.registry.resolve("Difficulty Classes", "PC1").target.id, "PC1:dc-pc");
  assert.equal(library.registry.resolve("GMC:dc-gm").target.id, "GMC:dc-gm");
  assert.equal(library.registry.resolve("gmc:DC-GM", "GMC").target.id, "GMC:dc-gm");
  assert.equal(library.registry.resolve("GMC:dc-gm", "PC1").status, "missing");
  assert.equal(library.registry.resolve("Not Written").status, "missing");
  const html = renderInline("{@rule Difficulty Classes}", { resolveRule: library.registry.resolve });
  assert.match(html, /rule-link-unresolved/);
  assert.doesNotMatch(html, /href=|<a /);
  const preview = renderRulePreview("Difficulty Classes", "", library.registry);
  assert.match(preview, /matches more than one rule/);
  assert.doesNotMatch(preview, /data-select-rule=|rule-match-options/);
  assert.doesNotMatch(preview, /GM difficulty rules|Another definition/);
  payload.rules.reverse();
  assert.equal(createRuleLibrary(payload).registry.resolve("Difficulty Classes").status, "ambiguous");
  payload.rules.find(rule => rule.id === "dc-pc").ruleDefault = true;
  assert.equal(createRuleLibrary(payload).registry.resolve("Difficulty Classes").target.id, "PC1:dc-pc");
  const sameSource = createRuleLibrary({ rules: [
    { name: "Areas", id: "spells_areas", source: "PC1", entries: [] },
    { name: "Areas", source: "PC1", entries: [] },
  ] });
  assert.equal(sameSource.registry.resolve("Areas", "PC1").status, "ambiguous");
  assert.equal(sameSource.registry.resolve("Areas").status, "ambiguous");
  assert.equal(sameSource.registry.resolve("PC1:areas").target.id, "PC1:areas");
});

test("ruleName separates the indexed title from its parent heading and keeps both names linkable", () => {
  const child = { type: "h2", id: "degree", name: "Step 4: Degree of Success", ruleName: "Degree of Success", rule: true, aliases: ["Degrees of Success"], entries: [
    "Determine the result.",
    { type: "h3", id: "critical", name: "Critical Success", rule: true, entries: ["A critical result."] },
  ] };
  const payload = { rules: [{ id: "checks", name: "Checks", source: "PC1", entries: [child] }] };
  const before = JSON.stringify(payload);
  const library = createRuleLibrary(payload);
  const rule = library.get("PC1:degree");
  assert.equal(rule.name, "Degree of Success");
  assert.equal(rule.entry.name, "Step 4: Degree of Success");
  for (const name of ["Degree of Success", "Step 4: Degree of Success", "Degrees of Success", "degree"]) {
    assert.equal(library.registry.resolve(name).target, rule);
    assert.equal(library.registry.resolve(name, "PC1").target, rule);
  }
  assert.ok(searchRules(library, { query: "Degree of Success" }).includes(rule));
  assert.ok(searchRules(library, { query: "Step 4" }).includes(rule));
  assert.match(renderBrowse(library, [rule]), /Degree of Success/);
  assert.match(renderRuleBody(library.get("PC1:checks"), library), />Step 4: Degree of Success<\/h3>/);
  assert.doesNotMatch(renderRuleBody(rule, library), /Step 4:/);
  const preview = renderRulePreview("Degree of Success", "", library.registry);
  assert.match(preview, /<h2 id="rule-preview-title">Degree of Success<\/h2>/);
  assert.doesNotMatch(preview, /Step 4:/);
  assert.equal(library.get("PC1:critical").name, "Critical Success");
  assert.equal(JSON.stringify(payload), before);
});

test("empty or invalid ruleName values fall back to the authored heading", () => {
  for (const ruleName of [undefined, "", "  ", 42, null]) {
    const library = createRuleLibrary({ rules: [{ id: "checks", name: "Checks", ruleName, entries: ["Text."] }] });
    assert.equal(library.get("Avalon:checks").name, "Checks");
    assert.deepEqual(library.get("Avalon:checks").aliases, []);
  }
});

test("Avalon rules preserve rich content and setting markers and reject duplicate ids or unknown types", () => {
  const library = createRuleLibrary({ rules: [{
    id: "night-watch", name: "Night Watch", source: "Avalon", setting: "original",
    entries: ["Use {@rule Night Watch|Avalon}.", { type: "list", items: ["Take turns."] },
      { type: "item", style: "hanging", name: "Éditos", entry: "Protect your camp." }],
  }] });
  const rule = library.get("Avalon:night-watch");
  assert.equal(rule.kind, "setting");
  const html = renderRuleBody(rule, library);
  assert.match(html, /setting-content--original/);
  assert.match(html, /<ul>/);
  assert.match(html, /class="hanging-entry"/);
  assert.match(html, /href="rules.html\?id=Avalon%3Anight-watch"/);
  assert.throws(() => createRuleLibrary({ rules: [{ id: "missing-name" }] }), /needs a name/);
  assert.throws(() => createRuleLibrary({ rules: [{ id: "same", name: "One" }, { id: "SAME", name: "Two" }] }), /Duplicate rule id/);
  assert.throws(() => createRuleLibrary({ rules: [{ id: "a", name: "Bad kind", kind: "unrecognized" }] }), /core, optional, or setting/);
});

test("promoted sections inherit metadata and remain in their parent without changing authored JSON", () => {
  const child = { type: "h3", name: "Modifier", id: "modifier", rule: true, aliases: ["Attribute Modifier"], entries: [
    "Child description.",
    { type: "box", name: "Nested Box", id: "nested-box", rule: true, source: "GMC", page: 52, kind: "core", setting: "original", entries: ["Box content."] },
  ] };
  const parent = { id: "checks", name: "Checks", source: "PC1", page: 400, kind: "optional", setting: "modified", settingNote: "Adapted for Avalon.", ruleDefault: true, aliases: ["Whole Rule"], entries: [
    "Parent introduction.",
    { type: "h3", name: "Step One", rule: false, page: 401, entries: [child, { type: "h4", name: "Ordinary Header", rule: false, id: "unlisted", entries: ["Not promoted."] }] },
  ] };
  const payload = { sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [parent] };
  const before = JSON.stringify(payload);
  const library = createRuleLibrary(payload);
  assert.equal(library.rules.length, 3);
  const promoted = library.get("PC1:modifier");
  assert.equal(promoted.entry, child);
  assert.equal(promoted.parentId, "PC1:checks");
  assert.equal(promoted.sourceName, "Player Core");
  assert.equal(promoted.page, 401);
  assert.equal(promoted.kind, "optional");
  assert.equal(promoted.setting, "modified");
  assert.equal(promoted.settingNote, "Adapted for Avalon.");
  assert.equal(promoted.entry.ruleDefault, undefined);
  assert.equal(library.registry.resolve("Attribute Modifier").target, promoted);
  assert.equal(library.registry.resolve("Whole Rule").target.entry, parent);
  assert.equal(library.registry.resolve("Ordinary Header").status, "missing");
  const nested = library.get("GMC:nested-box");
  assert.equal(nested.parentId, promoted.id);
  assert.equal(nested.page, 52);
  assert.equal(nested.kind, "core");
  assert.equal(nested.setting, "original");
  assert.equal(nested.settingNote, undefined);
  assert.match(renderRuleBody(library.get("PC1:checks"), library), /Parent introduction/);
  assert.match(renderRuleBody(library.get("PC1:checks"), library), /Child description/);
  const body = renderRuleBody(promoted, library);
  assert.match(body, /Child description/);
  assert.doesNotMatch(body, /Parent introduction/);
  const preview = renderRulePreview("Modifier", "PC1", library.registry);
  assert.match(preview, /· p\. 401/);
  assert.match(preview, /Child description/);
  assert.doesNotMatch(preview, /Parent introduction/);
  assert.ok(searchRules(library, { query: "Modifier", kind: "optional" }).includes(promoted));
  assert.equal(JSON.stringify(payload), before);
});


test("the live collection is independent of book files and indexes named records unless opted out", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/rules.json", import.meta.url), "utf8"));
  const library = createRuleLibrary(manifest);
  for (const entry of manifest.rules) {
    if (entry.type === "h1") assert.ok(library.chapters.some(chapter => chapter.entry === entry));
    else assert.equal(library.fromEntry(entry).entry, entry);
  }
  assert.ok(manifest.sources.every(source => !Object.hasOwn(source, "file")));
  for (const rule of library.rules) {
    assert.notEqual(rule.entry.rule, false);
    assert.equal(typeof rule.entry.name, "string");
    assert.equal(library.get(new URL(rule.href, "http://local/").searchParams.get("id")), rule);
    assert.doesNotMatch(renderRuleBody(rule, library), /\[object Object\]/);
  }
});
test("rules use source and chapter metadata without generating category fields", () => {
  const library = createRuleLibrary({ rules: [{ id: "checks", name: "Checks", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: [
    { type: "h2", id: "child", name: "Child", rule: true, entries: ["Text."] },
  ] }] });
  assert.deepEqual(library.sources, ["PC1"]);
  assert.equal(library.get("PC1:child").chapter, "Chapter 8: Playing the Game");
  assert.equal(Object.hasOwn(library, "topics"), false);
  for (const rule of library.rules) {
    assert.equal(Object.hasOwn(rule, "topic"), false);
    assert.equal(Object.hasOwn(rule, "topics"), false);
  }
});
