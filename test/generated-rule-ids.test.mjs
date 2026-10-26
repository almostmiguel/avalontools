import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary, renderRuleBody, renderRulePath } from "../js/rules-library.js";
import { renderRulePreview } from "../js/rule-links.js";

test("named h1, h2, h3 and box blocks are indexed by default with generated ids and inherited metadata", () => {
  const payload = { sources: [{ id: "PC1", name: "Player Core" }], rules: [{
    name: "Checks", source: "PC1", chapter: "Chapter 8", page: 400, kind: "optional", entries: [
      { type: "h2", name: "Attack Rolls", entries: [
        { type: "h3", name: "Multiple Attack Penalty", entries: ["Attack again."] },
      ] },
      { type: "box", name: "Secret Checks", entries: ["Hidden roll."] },
      { type: "h1", name: "Overview", entries: ["Introduction."] },
      { name: "Generic Section", entries: ["Details."] },
      { type: "list", name: "Named List", items: ["An item."] },
    ],
  }] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  assert.equal(library.rules.length, 5);
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
  const types = ["h4", "h5", "h6", "entries", "box-section", "formula", "ability", "item", "list", "table", "clarification", "inset", "sidebar", "quote", "image"];
  for (const flag of [undefined, true]) {
    const entries = types.map(type => ({ type, name: `Named ${type}`, rule: flag, entries: ["Inline text."], items: ["Item."], rows: [["Cell."]] }));
    entries.push({ name: "Generic section", rule: flag, entries: [
      { type: "h2", name: "Eligible child", entries: ["A nested rule."] },
    ] });
    const library = createLibrary({ rules: [{ name: "Parent", entries }] });
    assert.deepEqual(library.rules.map(rule => rule.id), ["Avalon:eligible-child", "Avalon:parent"]);
    assert.equal(library.get("Avalon:eligible-child").parentId, "Avalon:parent");
    const html = renderRuleBody(library.get("Avalon:parent"), library);
    assert.match(html, /Named h4/);
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
  assert.match(path, /data-rule-name="checks" data-rule-source="Avalon"/);
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

test("id collisions require an explicit override within a source and invalid explicit ids are reported", () => {
  const first = { name: "Armor Class", source: "PC1" };
  const second = { name: "Armor-Class", source: "PC1" };
  assert.throws(() => createLibrary({ rules: [first, second] }), /Duplicate rule id: PC1:armor-class.*explicit, unique ids/);
  second.id = "armor-class-summary";
  assert.equal(createLibrary({ rules: [first, second] }).rules.length, 2);
  assert.equal(createLibrary({ rules: [first, { name: "Armor Class", source: "GMC" }] }).rules.length, 2);
  assert.throws(() => createLibrary({ rules: [{ name: "Example", id: "armor-class", source: "PC1" }, first] }), /Duplicate rule id/);
  for (const id of [null, "", " ", 12]) {
    assert.throws(() => createLibrary({ rules: [{ name: "Example", id }] }), /non-empty string id/);
  }
  assert.throws(() => createLibrary({ rules: [{ name: "---" }] }), /needs an explicit id/);
  assert.ok(createLibrary({ rules: [{ name: "---", id: "separator" }] }).get("Avalon:separator"));
  assert.throws(() => createLibrary({ rules: [{ name: "Parent", entries: [{ type: "h2", rule: true }] }] }), /promoted rule needs a name/);
});
