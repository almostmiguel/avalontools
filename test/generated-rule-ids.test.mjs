import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary, renderRuleBody, renderRulePath } from "../js/rules-library.js";
import { renderRulePreview } from "../js/rule-links.js";

test("named h1-h6 and box blocks are indexed by default with generated ids and inherited metadata", () => {
  const payload = { sources: [{ id: "PC1", name: "Player Core" }], rules: [{
    name: "Checks", source: "PC1", chapter: "Chapter 8", page: 400, kind: "optional", entries: [
      { type: "h2", name: "Attack Rolls", entries: [
        { type: "h3", name: "Multiple Attack Penalty", entries: ["Attack again."] },
      ] },
      { type: "box", name: "Secret Checks", entries: ["Hidden roll."] },
      { type: "h1", name: "Overview", entries: ["Introduction."] },
      { type: "h4", name: "Fourth", entries: [{ type: "h5", name: "Fifth", entries: [{ type: "h6", name: "Sixth", entries: ["Deep detail."] }] }] },
      { name: "Generic Section", entries: ["Details."] },
      { type: "list", name: "Named List", items: ["An item."] },
    ],
  }] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  assert.equal(library.rules.length, 8);
  assert.equal(library.get("PC1:sixth").parentId, "PC1:fifth");
  assert.equal(library.get("PC1:fifth").parentId, "PC1:fourth");
  assert.ok(library.get("PC1:overview"));
  assert.equal(library.get("PC1:generic-section"), undefined);
  assert.equal(library.get("PC1:named-list"), undefined);
  const nested = library.get("PC1:multiple-attack-penalty");
  assert.equal(nested.parentId, "PC1:attack-rolls");
  assert.equal(nested.page, 400);
  assert.equal(nested.chapter, "Chapter 8");
  assert.equal(nested.kind, "optional");
  assert.equal(library.get("PC1:secret-checks").parentId, "PC1:checks");
  assert.equal(library.registry.resolve("Multiple Attack Penalty", "PC1").target, nested);
  assert.equal(JSON.stringify(payload), before);
});

test("rule false keeps exceptions inline without preventing named children from becoming rules", () => {
  const library = createLibrary({ rules: [{ name: "Checks", source: "PC1", entries: [
    { type: "h2", name: "Instructions", rule: false, page: 401, entries: [
      { type: "h3", name: "Roll D20", entries: ["Roll a die."] },
    ] },
    { type: "formula", name: "Calculation", rule: false, entry: "d20 + modifier" },
    { type: "list", items: [{ type: "item", name: "Success", rule: false, entry: "An effect." }] },
    { type: "table", caption: "A caption", rows: [["A cell"]] },
  ] }] });
  assert.deepEqual(library.rules.map(rule => rule.id), ["PC1:checks", "PC1:roll-d20"]);
  assert.equal(library.get("PC1:roll-d20").parentId, "PC1:checks");
  assert.equal(library.get("PC1:roll-d20").page, 401);
  const body = renderRuleBody(library.get("PC1:checks"), library);
  for (const text of ["Instructions", "Calculation", "Success", "An effect.", "A caption"]) assert.ok(body.includes(text));
});

test("other nested types never become rules, even with an explicit rule true", () => {
  const types = ["entries", "box-section", "formula", "ability", "spell", "item", "list", "table", "clarification", "inset", "sidebar", "quote", "image"];
  for (const flag of [undefined, true]) {
    const entries = types.map(type => ({ type, name: `Named ${type}`, rule: flag, entries: ["Inline text."], items: ["Item."], rows: [["Cell."]] }));
    entries.push({ name: "Generic section", rule: flag, entries: [
      { type: "h2", name: "Eligible child", entries: ["A nested rule."] },
    ] });
    const library = createLibrary({ rules: [{ name: "Parent", entries }] });
    assert.deepEqual(library.rules.map(rule => rule.id), ["Avalon:eligible-child", "Avalon:parent"]);
    assert.equal(library.get("Avalon:eligible-child").parentId, "Avalon:parent");
    const html = renderRuleBody(library.get("Avalon:parent"), library);
    assert.match(html, /Named formula/);
    assert.match(html, /Inline text/);
  }
});

test("a top-level rule false container still passes metadata to independently browsable children", () => {
  const library = createLibrary({ rules: [{ name: "Container", rule: false, source: "PC1", page: 10, entries: [
    { type: "h2", name: "Child", entries: ["Text."] },
  ] }] });
  assert.equal(library.rules.length, 1);
  assert.equal(library.get("PC1:container"), undefined);
  assert.equal(library.get("PC1:child").parentId, null);
  assert.equal(library.get("PC1:child").page, 10);
});

test("rules generate lowercase hyphenated ids from ruleName first, then name, without changing authored data", () => {
  const payload = { rules: [
    { name: "Checks", source: "PC1", entries: [
      { type: "h2", name: "Step 4: Degree of Success", ruleName: "Degree of Success", rule: true, entries: ["Compare the result."] },
    ] },
    { name: "  {@b Água} & Fire_Checks!  ", entries: ["Elemental checks."] },
    { name: "Use the name", ruleName: " ", entries: ["Fallback."] },
  ] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  const child = library.get("PC1:degree-of-success");
  assert.equal(child.name, "Degree of Success");
  assert.equal(child.parentId, "PC1:checks");
  assert.equal(child.localId, "degree-of-success");
  assert.equal(library.get("Avalon:agua-fire-checks").name, "  Água & Fire_Checks!  ");
  assert.ok(library.get("Avalon:use-the-name"));
  for (const name of ["Degree of Success", "degree-of-success", "Step 4: Degree of Success"]) {
    assert.equal(library.registry.resolve(name, "PC1").target, child);
  }
  assert.equal(library.registry.resolve("", "PC1").status, "missing");
  assert.equal(JSON.stringify(payload), before);
});

test("generated ids work in inline links, hover cards and ancestor breadcrumbs", () => {
  const library = createLibrary({ rules: [{ name: "Checks", entries: [
    "See {@rule Degree of Success} and {@rule degree-of-success}.",
    { type: "h2", name: "Step 4", ruleName: "Degree of Success", rule: true, entries: ["Determine the outcome."] },
  ] }] });
  const root = library.get("Avalon:checks");
  const child = library.get("Avalon:degree-of-success");
  const body = renderRuleBody(root, library);
  assert.equal((body.match(/href="rules.html\?id=Avalon%3Adegree-of-success"/g) || []).length, 2);
  assert.match(renderRulePreview("degree-of-success", "Avalon", library.registry), /Determine the outcome/);
  const path = renderRulePath(child, library);
  assert.match(path, /data-rule-name="Avalon:checks" data-rule-source="Avalon"/);
  assert.doesNotMatch(path, /undefined/);
  assert.match(path, /href="rules.html\?id=Avalon%3Achecks"/);
});

test("explicit ids take priority, while generated ids remain stable across ordering and parent changes", () => {
  const child = { type: "h2", name: "Step 4", ruleName: "Degree of Success", rule: true, entries: ["Outcome."] };
  const root = { name: "Checks", entries: [child] };
  const explicit = { id: "stable_rule", name: "Old name", entries: [] };
  const first = createLibrary({ rules: [root, explicit] });
  child.name = "A renamed parent heading";
  root.entries = [{ type: "box", name: "Wrapper", entries: [child] }];
  explicit.name = "New name";
  const next = createLibrary({ rules: [explicit, root] });
  for (const id of ["Avalon:degree-of-success", "Avalon:stable_rule"]) {
    assert.equal(next.get(id).href, first.get(id).href);
  }
});

test("generated id collisions are separated automatically, explicit ids are reserved and invalid ids are reported", () => {
  const first = { name: "Armor Class", source: "PC1" };
  const second = { name: "Armor-Class", source: "PC1" };
  const repeated = createLibrary({ rules: [first, second] });
  assert.equal(repeated.rules.length, 2);
  assert.equal(new Set(repeated.rules.map(rule => rule.id)).size, 2);
  second.id = "armor-class-summary";
  assert.equal(createLibrary({ rules: [first, second] }).rules.length, 2);
  assert.equal(createLibrary({ rules: [first, { name: "Armor Class", source: "GMC" }] }).rules.length, 2);
  const reserved = createLibrary({ rules: [{ name: "Example", id: "armor-class", source: "PC1" }, first] });
  assert.equal(reserved.get("PC1:armor-class").name, "Example");
  assert.notEqual(reserved.rules.find(rule => rule.name === "Armor Class").id, "PC1:armor-class");
  assert.throws(() => createLibrary({ rules: [{ ...first, id: "same" }, { ...second, id: "same" }] }), /Duplicate rule id/);
  for (const id of [null, "", " ", 12]) {
    assert.throws(() => createLibrary({ rules: [{ name: "Example", id }] }), /non-empty string id/);
  }
  assert.throws(() => createLibrary({ rules: [{ name: "---" }] }), /needs an explicit id/);
  assert.ok(createLibrary({ rules: [{ name: "---", id: "separator" }] }).get("Avalon:separator"));
  assert.throws(() => createLibrary({ rules: [{ name: "Parent", entries: [{ type: "h2", rule: true }] }] }), /promoted rule needs a name/);
});

test("same-name rules use inherited page numbers and survive reordering and parent changes without altering JSON", () => {
  const payload = { sources: [{ id: "PC1", name: "Player Core" }], rules: [
    { name: "Spells", source: "PC1", chapter: "Chapter 7", page: 300, entries: [{ type: "h2", name: "Areas", entries: ["Spell areas."] }] },
    { name: "Effects", source: "PC1", chapter: "Chapter 8", page: 428, entries: [{ type: "h2", name: "Areas", entries: ["Effect areas."] }] },
  ] };
  const before = JSON.stringify(payload);
  const first = createLibrary(payload);
  const choices = first.registry.resolve("Areas", "PC1");
  assert.equal(choices.status, "ambiguous");
  assert.equal(new Set(choices.matches.map(rule => rule.id)).size, 2);
  assert.deepEqual(choices.matches.map(rule => rule.localId), ["areas-300", "areas-428"]);
  for (const rule of choices.matches) {
    assert.equal(first.registry.resolve(rule.id).target, rule);
    assert.equal(first.registry.resolve(rule.localId).target, rule);
  }
  assert.equal(JSON.stringify(payload), before);
  payload.rules.reverse();
  payload.rules[0].name = "Different parent";
  payload.rules[0].chapter = "A different chapter";
  const next = createLibrary(payload);
  for (const rule of choices.matches) assert.equal(next.get(rule.id).entry, rule.entry);
});

test("repeated name and page combinations add the source, with a final number for identical source and page", () => {
  const payload = { sources: [{ id: "PC1", source: "PlayerCore", name: "Player Core" }], rules: [
    { name: "Areas", source: "PlayerCore", page: 300 },
    { name: "Areas", source: "GMC", page: 300 },
    { name: "Areas", source: "PC1", page: 428 },
    { name: "Unique Rule", source: "PC1", page: 300 },
  ] };
  const first = createLibrary(payload);
  assert.ok(first.get("PC1:areas-300-pc1"));
  assert.ok(first.get("GMC:areas-300-gmc"));
  assert.ok(first.get("PC1:areas-428"));
  assert.ok(first.get("PC1:unique-rule"));
  assert.equal(first.registry.resolve("Areas").status, "ambiguous");
  assert.equal(first.registry.resolve("areas-300-gmc").target.sourceId, "GMC");
  payload.rules.reverse();
  const reordered = createLibrary(payload);
  for (const rule of first.rules) assert.equal(reordered.get(rule.id).entry, rule.entry);
  payload.rules.push({ name: "Areas", source: "PC1", page: 300 });
  const repeated = createLibrary(payload);
  assert.ok(repeated.get("PC1:areas-300-pc1-2"));
  assert.equal(new Set(repeated.rules.map(rule => rule.id)).size, repeated.rules.length);
});

test("missing pages and page-link collisions still produce usable distinct targets without replacing explicit ids", () => {
  const library = createLibrary({ rules: [
    { name: "Areas", source: "PC1", page: 300 },
    { name: "Areas", source: "PC1" },
    { name: "Reserved", id: "areas-300", source: "PC1" },
    { name: "Areas", source: "GMC" },
  ] });
  assert.equal(library.get("PC1:areas-300").name, "Reserved");
  assert.ok(library.get("PC1:areas-300-pc1"));
  assert.ok(library.get("PC1:areas-no-page-pc1"));
  assert.ok(library.get("GMC:areas-no-page-gmc"));
  assert.equal(library.registry.resolve("Areas").matches.length, 3);
});
