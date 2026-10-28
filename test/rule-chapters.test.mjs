import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuleLibrary, chapterHref, renderBrowse, renderRuleBody } from "../js/rule-library.js";
import { findChapter, renderChapter } from "../js/chapter-reader.js";
import { renderRulePreview } from "../js/reference-previews.js";

const fixture = () => ({ sources: [{ id: "PC1", name: "Player Core" }, { id: "GMC", name: "GM Core" }], rules: [
  { name: "First", source: "PC1", chapter: "Chapter 8", page: 400, entries: [
    "First description.",
    { type: "h2", name: "Child", entries: ["Child description."] },
    { type: "h2", name: "Elsewhere", chapter: "Chapter 9", entries: [
      "Elsewhere description.",
      { type: "h3", name: "Return", chapter: "Chapter 8", entries: ["Return description."] },
    ] },
  ] },
  { name: "Second", source: "PC1", chapter: "Chapter 8", entries: ["Second description."] },
  { name: "GM section", source: "GMC", chapter: "Chapter 8", entries: ["GM-only description."] },
] });

test("whole chapters preserve authored order, include descendants once and exclude other chapters and sources", () => {
  const data = fixture(), before = JSON.stringify(data), library = createRuleLibrary(data);
  const chapter = findChapter(library, "pc1", "Chapter 8");
  assert.equal(chapter.sourceName, "Player Core");
  assert.equal(chapter.rules.length, 4);
  assert.deepEqual(chapter.roots.map(rule => rule.name), ["First", "Return", "Second"]);
  const html = renderChapter(chapter, library);
  for (const text of ["First description.", "Child description.", "Return description.", "Second description."]) assert.equal(html.split(text).length - 1, 1);
  assert.ok(html.indexOf("First description.") < html.indexOf("Return description."));
  assert.ok(html.indexOf("Return description.") < html.indexOf("Second description."));
  assert.doesNotMatch(html, /Elsewhere description|GM-only description/);
  const other = renderChapter(findChapter(library, "PC1", "Chapter 9"), library);
  assert.match(other, /Elsewhere description/);
  assert.doesNotMatch(other, /Return description|First description|GM-only description/);
  assert.equal(JSON.stringify(data), before);
  assert.equal(findChapter(library, "PC1", "Unknown"), null);
  assert.equal(findChapter(library, "Unknown", "Chapter 8"), null);
});

test("authored h1 chapters keep introduction and interleaved prose while indexing h2-h6 and boxes once", () => {
  const chapterEntry = { type: "h1", name: "Chapter 8: Playing the Game", source: "PC1", page: 400, entries: [
    "Chapter introduction.",
    { type: "h2", name: "Checks", entries: [
      "Checks description.",
      { type: "h3", name: "Bonuses", entries: [
        { type: "h4", name: "Proficiency", entries: [
          { type: "h5", name: "Ranks", entries: [{ type: "h6", name: "Legendary", page: 401, entries: ["Deep description."] }] },
        ] },
      ] },
      { type: "box", name: "Secret Checks", entries: ["Box description."] },
      { type: "h3", name: "Inline note", rule: false, entries: ["Inline description."] },
    ] },
    "Text between rules.",
    { type: "h2", name: "Damage", entries: ["Damage description."] },
    "Closing paragraph.",
  ] };
  const payload = { sources: [{ id: "PC1", name: "Player Core" }], rules: [chapterEntry] };
  const before = JSON.stringify(payload), library = createRuleLibrary(payload);
  assert.equal(library.chapters.length, 1);
  assert.equal(library.rules.length, 7);
  assert.equal(library.fromEntry(chapterEntry), undefined);
  assert.equal(library.get("PC1:checks").parentId, null);
  assert.equal(library.get("PC1:legendary").parentId, "PC1:ranks");
  assert.equal(library.get("PC1:legendary").page, 401);
  assert.equal(library.get("PC1:bonuses").page, 400);
  assert.equal(library.get("PC1:bonuses").sourceName, "Player Core");
  assert.equal(library.get("PC1:inline-note"), undefined);
  const chapter = findChapter(library, "PC1", chapterEntry.name);
  const html = renderChapter(chapter, library);
  const texts = ["Chapter introduction.", "Checks description.", "Deep description.", "Box description.", "Inline description.", "Text between rules.", "Damage description.", "Closing paragraph."];
  let previous = -1;
  for (const text of texts) {
    assert.equal(html.split(text).length - 1, 1);
    assert.ok(html.indexOf(text) > previous);
    previous = html.indexOf(text);
  }
  for (const rule of library.rules) assert.match(html, new RegExp('data-select-rule="' + rule.id + '"'));
  assert.doesNotMatch(renderRuleBody(library.get("PC1:checks"), library), /Chapter introduction|Damage description|Closing paragraph/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id));
  const browse = renderBrowse(library, library.rules);
  assert.equal((browse.match(/data-select-rule=/g) || []).length, 7);
  assert.match(browse, /data-select-rule="PC1:legendary"/);
  assert.equal(JSON.stringify(payload), before);
});

test("a chapter with introductory text and no rules remains browsable and readable", () => {
  const library = createRuleLibrary({ rules: [{ type: "h1", name: "Chapter 1", source: "PC1", entries: ["Just the introduction."] }] });
  assert.equal(library.rules.length, 0);
  assert.deepEqual(library.sources, ["PC1"]);
  assert.match(renderBrowse(library, []), /data-select-chapter=/);
  assert.doesNotMatch(renderBrowse(library, [], { includeEmptyChapters: false }), /data-select-chapter=/);
  const chapter = findChapter(library, "PC1", "Chapter 1");
  assert.match(renderChapter(chapter, library), /Just the introduction/);
  for (const name of ["Chapter 1", "chapter-1", "PC1:chapter-1"]) {
    const target = library.registry.resolve(name, "PC1").target;
    assert.equal(target.isChapter, true);
    assert.equal(target.href, chapterHref("PC1", "Chapter 1"));
  }
  assert.equal(library.registry.resolve("Chapter 1", "GMC").status, "missing");
  assert.match(renderRulePreview("Chapter 1", "PC1", library.registry), /Just the introduction/);
  assert.throws(() => createRuleLibrary({ rules: [{ type: "h1" }] }), /chapter needs a name/);
});

test("chapter links reload their source and title and chapter outlines point to unique existing anchors", () => {
  const library = createRuleLibrary(fixture());
  const chapter = findChapter(library, "PC1", "Chapter 8");
  const url = new URL(chapterHref(chapter.sourceId, chapter.title), "http://localhost/project/");
  assert.equal(url.searchParams.get("chapter-source"), "PC1");
  assert.equal(url.searchParams.get("chapter"), "Chapter 8");
  const html = renderChapter(chapter, library);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(match[1]));
  assert.match(html, /data-select-rule="PC1:first"/);
  assert.match(html, /href="rules.html\?id=PC1%3Afirst"/);
  assert.match(html, /Player Core/);
  assert.match(html, /p\. 400/);
});
