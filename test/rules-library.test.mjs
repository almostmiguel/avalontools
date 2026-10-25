import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderInline } from "../js/content-renderer.js";
import { renderRulePreview } from "../js/rule-links.js";
import { createLibrary, searchRules, sortRules, renderResults, renderRuleBody } from "../js/rules-library.js";

const fixture = () => ({
  sources: [{ id: "PC1", source: "PC1", name: "Player Core" }],
  rules: [
    { name: "Perception", id: "perception-rules", ruleDefault: true, source: "PC1", topic: "Playing", aliases: ["Awareness"], page: 400, entries: [
      "Notice {@i hidden} creatures and {@rule Actions|PC1}.",
      { type: "h3", name: "An Internal Heading", entries: ["Details stay inside this rule."] },
      { type: "box", name: "A Note", entries: [{ type: "h2", name: "Box Header", entries: ["Keep this note."] }] },
    ] },
    { name: "Actions", id: "actions", source: "PC1", topic: "Playing", entries: [{ type: "ability", name: "Stride", actions: 1, entries: ["Move your Speed."] }] },
    { name: "Água", id: "agua", source: "PC1", topic: "Playing", kind: "optional", entries: ["Water obscures your vision."] },
    { name: "Perception", id: "perception-summary", source: "PC1", topic: "Character Creation", entries: ["A brief summary."] },
  ],
});

test("sorting handles case, accents, numbers and ties without changing catalog or input order", () => {
  const library = createLibrary({ rules: [
    { id: "ten", name: "Áction 10", source: "PC2", entries: ["Text."] },
    { id: "two", name: "action 2", source: "PC1", entries: ["Text."] },
    { id: "one", name: "Action 1", source: "PC2", kind: "optional", entries: ["Text."] },
  ] });
  const input = [...library.rules].reverse();
  const before = input.map(rule => rule.id);
  const catalogBefore = library.rules.map(rule => rule.id);
  assert.deepEqual(sortRules(input, { sort: "name" }).map(rule => rule.entry.id), ["one", "two", "ten"]);
  assert.deepEqual(sortRules(input, { sort: "name", order: "desc" }).map(rule => rule.entry.id), ["ten", "two", "one"]);
  assert.deepEqual(sortRules(input, { sort: "type" }).map(rule => rule.entry.id), ["two", "ten", "one"]);
  assert.deepEqual(sortRules(input, { sort: "source" }).map(rule => rule.entry.id), ["two", "one", "ten"]);
  assert.deepEqual(sortRules(input, { sort: "source", order: "desc" }).map(rule => rule.entry.id), ["one", "ten", "two"]);
  assert.deepEqual(input.map(rule => rule.id), before);
  assert.deepEqual(library.rules.map(rule => rule.id), catalogBefore);
});

test("only authored rules are indexed; nested headings, notes and source metadata do not create rules", () => {
  const payload = fixture();
  const before = JSON.stringify(payload);
  payload.sources[0].file = "data/book/book-pc1.json";
  const library = createLibrary(payload);
  assert.equal(library.rules.length, 4);
  assert.deepEqual(library.topics, ["Character Creation", "Playing"]);
  assert.equal(library.get("PC1:perception-rules").page, 400);
  assert.ok(!library.rules.some(rule => ["A Note", "Box Header", "An Internal Heading", "Stride"].includes(rule.name)));
  assert.equal(library.registry.resolve("An Internal Heading", "PC1").status, "missing");
  assert.match(renderRuleBody(library.get("PC1:perception-rules"), library), /Keep this note/);
  delete payload.sources[0].file;
  assert.equal(JSON.stringify(payload), before);
  assert.equal(createLibrary({ sources: payload.sources, rules: [] }).rules.length, 0);
});

test("search matches names and aliases only and combines topic, source and type filters", () => {
  const library = createLibrary(fixture());
  assert.equal(searchRules(library, { query: "Perception" })[0].id, "PC1:perception-rules");
  assert.equal(searchRules(library, { query: "awareness" })[0].id, "PC1:perception-rules");
  assert.equal(searchRules(library, { query: "agua" })[0].name, "Água");
  assert.deepEqual(searchRules(library, { topic: "Playing", source: "pc1", kind: "optional" }).map(rule => rule.name), ["Água"]);
  assert.deepEqual(searchRules(library, { query: "HIDDEN creatures", topic: "Playing", kind: "core" }), []);
  for (const query of ["Playing", "Character Creation", "Internal Heading", "Box Header", "Stride", "PC1"]) {
    assert.deepEqual(searchRules(library, { query }), [], `Excluded content or metadata: ${query}`);
  }
  assert.deepEqual(searchRules(library, { query: "percep", topic: "Playing", source: "PC1", kind: "core" }).map(rule => rule.id), ["PC1:perception-rules"]);
  assert.equal(searchRules(library, { query: "hidden", topic: "Character Creation" }).length, 0);
  assert.equal(searchRules(library, { source: "missing" }).length, 0);
  assert.equal(searchRules(library, { query: "no-such-rule" }).length, 0);
});

test("rule references prefer default definitions and explicit ids while keeping source metadata and previews", () => {
  const library = createLibrary(fixture());
  const result = library.registry.resolve("Perception", "PC1");
  assert.equal(result.status, "found");
  assert.equal(result.target.href, "rules.html?id=PC1%3Aperception-rules");
  assert.equal(library.registry.resolve("perception-summary", "PC1").target.id, "PC1:perception-summary");
  const inline = renderInline("{@rule Perception|PC1}", { resolveRule: library.registry.resolve });
  assert.match(inline, /href="rules.html\?id=PC1%3Aperception-rules"/);
  const preview = renderRulePreview("Perception", "PC1", library.registry);
  assert.match(preview, /Notice <em>hidden<\/em>/);
  assert.match(preview, /pg\. 400/);
  assert.doesNotMatch(preview, /A brief summary/);
  const ambiguous = fixture();
  delete ambiguous.rules[0].ruleDefault;
  assert.equal(createLibrary(ambiguous).registry.resolve("Perception", "PC1").status, "ambiguous");
});

test("omitting a source resolves the first authored match across all sources, including GM-only rules", () => {
  const library = createLibrary({ sources: [{ id: "GMC", name: "GM Core" }], rules: [
    { id: "dc-gm", name: "Difficulty Classes", source: "GMC", page: 52, aliases: ["DCs"], entries: ["GM difficulty rules."] },
    { id: "dc-pc", name: "Difficulty Classes", source: "PC1", ruleDefault: true, entries: ["Another definition."] },
    { id: "gm-only", name: "GM Only", source: "GMC", entries: ["Only in GM Core."] },
  ] });
  for (const source of [undefined, null, "", "   "]) {
    assert.equal(library.registry.resolve("Difficulty Classes", source).target.id, "GMC:dc-gm");
    assert.equal(library.registry.resolve("GM Only", source).status, "found");
  }
  assert.equal(library.registry.resolve("DCs").target.id, "GMC:dc-gm");
  assert.equal(library.registry.resolve("Difficulty Classes", "PC1").target.id, "PC1:dc-pc");
  assert.equal(library.registry.resolve("GM Only", "PC1").status, "missing");
  assert.equal(library.registry.resolve("Not Written").status, "missing");
  const html = renderInline("{@rule Difficulty Classes} and {@rule Difficulty Classes||DCs}", {
    source: "PC1", resolveRule: library.registry.resolve,
  });
  assert.match(html, /href="rules.html\?id=GMC%3Adc-gm"/);
  assert.match(html, /data-rule-source=""/);
  assert.match(html, />DCs<\/a>/);
  assert.doesNotMatch(html, /rule-link-unresolved/);
  const preview = renderRulePreview("Difficulty Classes", "", library.registry);
  assert.match(preview, /GM difficulty rules/);
  assert.match(preview, /Source GM Core/);
  assert.doesNotMatch(preview, /Another definition/);
});

test("ruleName separates the indexed title from its parent heading and keeps both names linkable", () => {
  const child = { type: "h2", id: "degree", name: "Step 4: Degree of Success", ruleName: "Degree of Success", rule: true, aliases: ["Degrees of Success"], entries: [
    "Determine the result.",
    { type: "h3", id: "critical", name: "Critical Success", rule: true, entries: ["A critical result."] },
  ] };
  const payload = { rules: [{ id: "checks", name: "Checks", source: "PC1", entries: [child] }] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  const rule = library.get("PC1:degree");
  assert.equal(rule.name, "Degree of Success");
  assert.equal(rule.entry.name, "Step 4: Degree of Success");
  for (const name of ["Degree of Success", "Step 4: Degree of Success", "Degrees of Success", "degree"]) {
    assert.equal(library.registry.resolve(name).target, rule);
    assert.equal(library.registry.resolve(name, "PC1").target, rule);
  }
  assert.ok(searchRules(library, { query: "Degree of Success" }).includes(rule));
  assert.ok(searchRules(library, { query: "Step 4" }).includes(rule));
  assert.match(renderResults([rule]), /<strong class="rule-result-name">Degree of Success<\/strong>/);
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
    const library = createLibrary({ rules: [{ id: "checks", name: "Checks", ruleName, entries: ["Text."] }] });
    assert.equal(library.get("Avalon:checks").name, "Checks");
    assert.deepEqual(library.get("Avalon:checks").aliases, []);
  }
});

test("stable rule ids survive renaming, topic changes and reordering", () => {
  const payload = fixture();
  const href = createLibrary(payload).get("PC1:perception-rules").href;
  payload.rules[0].name = "Renamed Perception";
  payload.rules[0].topic = "Encounters";
  payload.rules.reverse();
  const changed = createLibrary(payload).get("PC1:perception-rules");
  assert.equal(changed.href, href);
  assert.equal(changed.name, "Renamed Perception");
  assert.equal(changed.topic, "Encounters");
});

test("Avalon rules preserve rich content and setting markers and reject duplicate ids or unknown types", () => {
  const library = createLibrary({ rules: [{
    id: "night-watch", name: "Night Watch", source: "Avalon", topic: "Exploration", setting: "original",
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
  assert.throws(() => createLibrary({ rules: [{ name: "Missing id" }] }), /unique id/);
  assert.throws(() => createLibrary({ rules: [{ id: "same", name: "One" }, { id: "SAME", name: "Two" }] }), /Duplicate rule id/);
  assert.throws(() => createLibrary({ rules: [{ id: "a", name: "Bad kind", kind: "unrecognized" }] }), /core, optional, or setting/);
});

test("results escape authored HTML and distinguish an empty collection from a filtered empty result", () => {
  const library = createLibrary({ rules: [{ id: "safe", name: '<script>alert(1)</script>', topic: '<img src=x>', entries: ['<b>unsafe</b>'] }] });
  const html = renderResults(library.rules);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(renderResults([]), /data-clear-filters/);
  assert.doesNotMatch(renderResults([], { hasRules: false }), /data-clear-filters|No matching rules/);
  assert.match(renderRuleBody(library.rules[0], library), /&lt;b&gt;unsafe/);
});

test("multiple topics remain independently filterable without appearing in name search", () => {
  const payload = { rules: [
    { id: "shared", name: "Shared Rule", source: "PC1", topic: [" Playing the Game ", "Checks", "Checks", "", null], entries: ["A rule."] },
    { id: "single", name: "Single Topic", topic: "Checks", entries: ["Another rule."] },
    { id: "empty", name: "Default Topic", topic: [], entries: ["General rule."] },
  ] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  const rule = library.get("PC1:shared");
  assert.deepEqual(rule.topics, ["Playing the Game", "Checks"]);
  assert.equal(rule.topic, "Playing the Game");
  assert.deepEqual(library.topics, ["Checks", "General", "Playing the Game"]);
  assert.equal(library.rules.length, 3);
  for (const topic of rule.topics) assert.ok(searchRules(library, { topic }).includes(rule));
  assert.deepEqual(searchRules(library, { query: "checks playing" }), []);
  assert.equal(searchRules(library, { topic: "Checks", source: "PC1", kind: "core" }).length, 1);
  assert.equal(JSON.stringify(payload), before);
});

test("promoted sections inherit metadata and remain in their parent without changing authored JSON", () => {
  const child = { type: "h4", name: "Modifier", id: "modifier", rule: true, aliases: ["Attribute Modifier"], entries: [
    "Child description.",
    { type: "box", name: "Nested Box", id: "nested-box", rule: true, source: "GMC", page: 52, topic: "Variants", kind: "core", setting: "original", entries: ["Box content."] },
  ] };
  const parent = { id: "checks", name: "Checks", source: "PC1", page: 400, topic: ["Play", "Mechanics"], kind: "optional", setting: "modified", settingNote: "Adapted for Avalon.", ruleDefault: true, aliases: ["Whole Rule"], entries: [
    "Parent introduction.",
    { type: "h3", name: "Step One", page: 401, entries: [child, { type: "h4", name: "Ordinary Header", id: "unlisted", entries: ["Not promoted."] }] },
  ] };
  const payload = { sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [parent] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  assert.equal(library.rules.length, 3);
  const promoted = library.get("PC1:modifier");
  assert.equal(promoted.entry, child);
  assert.equal(promoted.parentId, "PC1:checks");
  assert.equal(promoted.sourceName, "Player Core");
  assert.equal(promoted.page, 401);
  assert.deepEqual(promoted.topics, ["Checks"]);
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
  assert.deepEqual(nested.topics, ["Variants"]);
  assert.equal(nested.kind, "core");
  assert.equal(nested.setting, "original");
  assert.equal(nested.settingNote, undefined);
  assert.match(renderRuleBody(library.get("PC1:checks"), library), /Parent introduction/);
  assert.match(renderRuleBody(library.get("PC1:checks"), library), /Child description/);
  const body = renderRuleBody(promoted, library);
  assert.match(body, /Child description/);
  assert.doesNotMatch(body, /Parent introduction/);
  const preview = renderRulePreview("Modifier", "PC1", library.registry);
  assert.match(preview, /pg\. 401/);
  assert.match(preview, /Child description/);
  assert.doesNotMatch(preview, /Parent introduction/);
  assert.ok(searchRules(library, { query: "Modifier", topic: "Checks", kind: "optional" }).includes(promoted));
  assert.equal(JSON.stringify(payload), before);
});

test("promoted topics use the top-level parent rule title at every depth unless explicitly overridden", () => {
  const library = createLibrary({ rules: [{ id: "checks", name: "{@b Checks}", source: "PC1", topic: ["Play", "Mechanics"], entries: [
    { type: "box", name: "Intermediate Section", topic: "Other Topic", entries: [
      { type: "h3", id: "first", name: "First Section", rule: true, entries: [
        { type: "h4", name: "Ordinary Heading", topic: "Unlisted Topic", entries: [
          { type: "h5", id: "nested", name: "Nested Section", rule: true, entries: ["Nested text."] },
        ] },
      ] },
      { type: "box", id: "custom", name: "{@b Custom Section}", rule: true, topic: ["Custom", "Variants"], entries: [
        "Custom text.",
        { type: "h4", id: "custom-child", name: "Custom Child", rule: true, entries: ["Another rule."] },
      ] },
    ] },
  ] }] });
  assert.deepEqual(library.get("PC1:checks").topics, ["Play", "Mechanics"]);
  assert.deepEqual(library.get("PC1:first").topics, ["Checks"]);
  assert.deepEqual(library.get("PC1:nested").topics, ["Checks"]);
  assert.equal(library.get("PC1:nested").parentId, "PC1:first");
  assert.deepEqual(library.get("PC1:custom").topics, ["Custom", "Variants"]);
  assert.deepEqual(library.get("PC1:custom-child").topics, ["Checks"]);
  assert.deepEqual(searchRules(library, { topic: "Checks" }).map(rule => rule.name), ["Custom Child", "First Section", "Nested Section"]);
  assert.deepEqual(searchRules(library, { topic: "First Section" }), []);
});

test("promoted boxes, tables, lists and abilities keep their complete formatting", () => {
  const blocks = [
    { type: "box", id: "box", name: "A Box", rule: true, entries: ["Box text."] },
    { type: "table", id: "table", name: "A Table", rule: true, colLabels: ["Name", "Value"], rows: [["Example", "42"]] },
    { type: "list", id: "list", name: "A List", rule: true, items: ["A list item."] },
    { type: "ability", id: "ability", name: "An Ability", rule: true, kind: "Feat", level: 1, actions: 1, entries: ["An effect."] },
  ];
  const library = createLibrary({ rules: [{ id: "parent", name: "Parent", source: "PC1", kind: "optional", entries: blocks }] });
  assert.equal(library.rules.length, 5);
  assert.match(renderRuleBody(library.get("PC1:box"), library), /class="rule-box"/);
  const table = renderRuleBody(library.get("PC1:table"), library);
  assert.match(table, /<table>/);
  assert.match(table, /<th scope="col">Value<\/th>/);
  assert.match(table, /<td>42<\/td>/);
  assert.match(renderRuleBody(library.get("PC1:list"), library), /<ul><li><p>A list item/);
  const ability = library.get("PC1:ability");
  assert.equal(ability.kind, "optional");
  assert.equal(ability.entry.kind, "Feat");
  assert.match(renderRuleBody(ability, library), /Feat 1/);
  assert.match(renderRuleBody(ability, library), /data-symbol="1"/);
});

test("promoted rules need their own ids and reject duplicates while links survive moving a section", () => {
  const child = { type: "h3", name: "Child", rule: true, entries: ["Details."] };
  const parent = { id: "parent", name: "Parent", source: "PC1", entries: [child] };
  assert.throws(() => createLibrary({ rules: [parent] }), /promoted rule needs a name and a unique id/);
  child.id = "parent";
  assert.throws(() => createLibrary({ rules: [parent] }), /Duplicate rule id/);
  child.id = "child";
  const href = createLibrary({ rules: [parent] }).get("PC1:child").href;
  child.name = "Renamed Child";
  parent.entries = [{ type: "box", name: "A wrapper", entries: [child] }];
  assert.equal(createLibrary({ rules: [parent] }).get("PC1:child").href, href);
});

test("the live collection is independent of book files and contains only explicitly authored records", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/rules.json", import.meta.url), "utf8"));
  const library = createLibrary(manifest);
  for (const entry of manifest.rules) assert.equal(library.fromEntry(entry).entry, entry);
  assert.ok(manifest.sources.every(source => !Object.hasOwn(source, "file")));
  for (const rule of library.rules) {
    assert.ok(manifest.rules.includes(rule.entry) || rule.entry.rule === true);
    assert.equal(library.get(new URL(rule.href, "http://local/").searchParams.get("id")), rule);
    assert.doesNotMatch(renderRuleBody(rule, library), /\[object Object\]/);
  }
});
