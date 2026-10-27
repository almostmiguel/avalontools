import assert from "node:assert/strict";
import { test } from "node:test";
import { createLibrary, searchRules, rulePath, renderBrowse, renderRulePath, browseBranchIds } from "../js/rules-library.js";
import { sourceTone, renderRuleCitation } from "../js/rule-sources.js";

test("source colors stay consistent between Browse and citations when filtered or reordered", () => {
  const library = createLibrary({ sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [
    { id: "checks", name: "Checks", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: ["Roll."] },
    { id: "dc", name: "Difficulty Classes", source: "GMC", entries: ["Set a DC."] },
  ] });
  assert.notEqual(sourceTone("PC1"), sourceTone("GMC"));
  assert.equal(sourceTone("pc1"), sourceTone("PC1"));
  for (const rule of [...library.rules].reverse()) {
    const attribute = `data-source-tone="${sourceTone(rule.sourceId)}"`;
    assert.ok(renderBrowse(library, [rule]).includes(attribute));
    assert.ok(renderRuleCitation(rule).includes(attribute));
  }
  const browse = renderBrowse(library, library.rules);
  assert.match(browse, /data-browse-group="source"/);
  assert.match(browse, /class="browse-group-type">Source<\/span>Player Core/);
  assert.match(browse, /data-browse-group="chapter"/);
  assert.match(browse, /class="browse-group-icon"/);
  assert.match(browse, /data-select-rule="PC1:checks"/);
});

const fixture = () => createLibrary({ rules: [
  { id: "checks", name: "Checks", source: "PC1", entries: [
    { type: "h2", id: "attack", name: "Attack Rolls", rule: true, entries: [
      { type: "h3", id: "map", name: "Multiple Attack Penalty", aliases: ["MAP"], rule: true, entries: ["Attack again."] },
      { type: "h3", id: "range", name: "Range Penalty", rule: true, entries: ["Too far away."] },
    ] },
    { type: "h3", id: "save", name: "Saving Throws", rule: true, kind: "optional", entries: ["Save."] },
  ] },
  { id: "hero", name: "Hero Points", source: "PC1", entries: ["A standalone rule."] },
] });

test("Browse groups sources and chapters before rules, preserving source and authored rule order", () => {
  const library = createLibrary({ sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [
    { id: "z", name: "Z First", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: [
      { type: "h2", id: "child", name: "Child", rule: true, entries: ["Text."] },
    ] },
    { id: "a", name: "A Second", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: ["Text."] },
    { id: "later", name: "Later Chapter", source: "PC1", chapter: "Chapter 10: Later", entries: ["Text."] },
    { id: "earlier", name: "Earlier Chapter", source: "PC1", chapter: "Chapter 2: Earlier", entries: ["Text."] },
    { id: "gm", name: "GM Rule", source: "GMC", chapter: "Chapter 1: Running the Game", entries: ["Text."] },
  ] });
  const html = renderBrowse(library, library.rules);
  assert.ok(html.indexOf("Player Core") < html.indexOf("GM Core"));
  assert.ok(html.indexOf("Chapter 2: Earlier") < html.indexOf("Chapter 8: Playing the Game"));
  assert.ok(html.indexOf("Chapter 8: Playing the Game") < html.indexOf("Chapter 10: Later"));
  assert.ok(html.indexOf('data-select-rule="PC1:z"') < html.indexOf('data-select-rule="PC1:a"'));
  assert.equal(library.get("PC1:child").chapter, "Chapter 8: Playing the Game");
  assert.equal((html.match(/data-select-rule=/g) || []).length, library.rules.length);
  const selected = renderBrowse(library, searchRules(library, { query: "Child" }), { selectedId: "PC1:child" });
  for (const id of browseBranchIds(library, library.get("PC1:child"))) {
    const attribute = id.replaceAll('"', "&quot;");
    assert.ok([...selected.matchAll(/<details [^>]*>/g)].some(([tag]) => tag.includes(`data-rule-branch="${attribute}"`) && /\sopen>/.test(tag)));
  }
  assert.doesNotMatch(selected, /GM Core|Later Chapter|A Second/);
});

test("chapter overrides and source changes create independent groups without duplicating ancestors", () => {
  const payload = { sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [
    { id: "parent", name: "Parent", source: "PC1", chapter: "Chapter 8: Playing the Game", entries: [
      { type: "h2", id: "chapter", name: "Different Chapter", chapter: "Chapter 9: Other", rule: true, entries: ["Text."] },
      { type: "h2", id: "source", name: "Different Source", source: "GMC", rule: true, entries: ["Text."] },
    ] },
  ] };
  const before = JSON.stringify(payload);
  const library = createLibrary(payload);
  assert.equal(library.get("PC1:chapter").chapter, "Chapter 9: Other");
  assert.equal(library.get("GMC:source").chapter, null);
  assert.equal(library.get("GMC:source").parentId, "PC1:parent");
  const filtered = renderBrowse(library, searchRules(library, { source: "GMC" }));
  assert.match(filtered, /GM Core|Other rules/);
  assert.doesNotMatch(filtered, /Player Core|Chapter 8|data-select-rule="PC1:parent"/);
  assert.deepEqual(rulePath(library, library.get("GMC:source")).map(rule => rule.name), ["Parent", "Different Source"]);
  assert.equal(JSON.stringify(payload), before);
});

test("Browse preserves full ancestry for name and filter matches without showing unrelated rules", () => {
  const library = fixture();
  const matches = searchRules(library, { query: "MAP" });
  assert.equal(matches.length, 1);
  const html = renderBrowse(library, matches, { selectedId: matches[0].id });
  assert.match(html, /data-rule-branch="PC1:checks" open/);
  assert.match(html, /data-rule-branch="PC1:attack" open/);
  assert.match(html, /rule-branch-link--context[^>]*.*>Checks<\/a>/);
  assert.match(html, /data-select-rule="PC1:map" aria-current="true"/);
  assert.doesNotMatch(html, /Range Penalty|Saving Throws|Hero Points/);
  assert.ok(html.indexOf('data-select-rule="PC1:checks"') < html.indexOf('data-select-rule="PC1:attack"'));
  assert.ok(html.indexOf('data-select-rule="PC1:attack"') < html.indexOf('data-select-rule="PC1:map"'));
  const filtered = renderBrowse(library, searchRules(library, { kind: "optional" }));
  assert.match(filtered, />Checks<\/a>/);
  assert.match(filtered, />Saving Throws<\/a>/);
  assert.doesNotMatch(filtered, /Attack Rolls|Hero Points/);
});

test("Browse respects manual expansion, reveals selected descendants and keeps names separate from disclosure controls", () => {
  const library = fixture();
  const closed = renderBrowse(library, library.rules);
  assert.match(closed, /<details data-rule-branch="PC1:checks"><summary/);
  assert.match(closed, /<details data-rule-branch="PC1:attack"><summary/);
  const open = renderBrowse(library, library.rules, { expanded: new Set(["PC1:checks"]) });
  assert.match(open, /data-rule-branch="PC1:checks" open/);
  assert.match(open, /data-rule-branch="PC1:attack"><summary/);
  const selected = renderBrowse(library, library.rules, { selectedId: "PC1:range" });
  assert.match(selected, /data-rule-branch="PC1:checks" open/);
  assert.match(selected, /data-rule-branch="PC1:attack" open/);
  assert.match(selected, /<summary class="rule-branch-row"><svg[\s\S]*?<a class="rule-branch-link" href="rules.html\?id=PC1%3Achecks"/);
  assert.match(selected, /data-select-rule="PC1:hero"/);
});

test("breadcrumbs link every ancestor, use the short rule title and mark only the current rule", () => {
  const library = fixture();
  const rule = library.get("PC1:map");
  assert.deepEqual(rulePath(library, rule).map(item => item.name), ["Checks", "Attack Rolls", "Multiple Attack Penalty"]);
  const html = renderRulePath(rule, library);
  assert.match(html, /aria-label="Rule hierarchy"/);
  assert.match(html, /data-rule-name="PC1:checks" data-rule-source="PC1">Checks<\/a>/);
  assert.match(html, /data-rule-name="PC1:attack" data-rule-source="PC1">Attack Rolls<\/a>/);
  assert.match(html, /<span aria-current="page">Multiple Attack Penalty<\/span>/);
  assert.doesNotMatch(html, /data-rule-name="map"/);
  assert.equal(renderRulePath(library.get("PC1:checks"), library), "");
});

test("Browse and breadcrumbs escape authored labels and preserve empty states", () => {
  const library = createLibrary({ rules: [{ id: "safe", name: "<script>Parent</script>", entries: [
    { type: "h2", id: "child", name: "Step 1: <img>", ruleName: "<b>Child</b>", rule: true, entries: ["Text."] },
  ] }] });
  const rule = library.get("Avalon:child");
  for (const html of [renderBrowse(library, library.rules), renderRulePath(rule, library)]) {
    assert.doesNotMatch(html, /<script>|<img>|<b>/);
    assert.match(html, /&lt;b&gt;Child&lt;\/b&gt;/);
  }
  assert.match(renderBrowse(library, []), /No matching rules/);
  const empty = createLibrary({ rules: [] });
  assert.match(renderBrowse(empty, []), /No rules have been added/);
});
