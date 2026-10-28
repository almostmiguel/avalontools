import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuleLibrary, searchRules } from "../js/rule-library.js";
import { FILTER_GROUPS, emptyFilters, filterOptions, readFilters, writeFilters, toggleFilter, filterCounts, renderFilterGroups, renderFilterChips } from "../js/rule-filters.js";

const fixture = () => createRuleLibrary({ rules: [
  { id: "one", name: "One", source: "PC1", entries: ["Not searchable content."] },
  { id: "two", name: "Two", source: "GMC", kind: "optional", entries: ["More text."] },
  { id: "three", name: "Three", source: "PC1", kind: "optional", entries: ["Text."] },
  { id: "four", name: "Four", source: "Avalon", kind: "setting", entries: ["Text."] },
] });
const names = (library, filters, query = "") => searchRules(library, { query, filters }).map(rule => rule.name).sort();

test("only source and type filters are available, combining unions within groups and intersections between them", () => {
  const library = fixture();
  const filters = emptyFilters();
  assert.deepEqual(FILTER_GROUPS.map(group => group.key), ["source", "kind"]);
  assert.deepEqual(Object.keys(filterOptions(library)), ["source", "kind"]);
  toggleFilter(filters, "source", "PC1");
  toggleFilter(filters, "source", "GMC");
  assert.deepEqual(names(library, filters), ["One", "Three", "Two"]);
  toggleFilter(filters, "kind", "optional");
  assert.deepEqual(names(library, filters), ["Three", "Two"]);
  toggleFilter(filters, "kind", "core");
  assert.deepEqual(names(library, filters), ["One", "Three", "Two"]);
  toggleFilter(filters, "source", "GMC");
  assert.deepEqual(names(library, filters), ["One", "Three"]);
  assert.deepEqual(names(library, filters, "content"), []);
});

test("source and type exclusions take precedence and toggling either state clears it", () => {
  const library = fixture();
  const filters = emptyFilters();
  toggleFilter(filters, "source", "PC1");
  toggleFilter(filters, "kind", "core", true);
  assert.deepEqual(names(library, filters), ["Three"]);
  toggleFilter(filters, "source", "PC1", true);
  assert.equal(filters.source.get("PC1"), -1);
  assert.deepEqual(names(library, filters), ["Four", "Two"]);
  toggleFilter(filters, "source", "PC1", true);
  assert.equal(filters.source.has("PC1"), false);
  toggleFilter(filters, "kind", "core", true);
  assert.deepEqual(names(library, filters), ["Four", "One", "Three", "Two"]);
  toggleFilter(filters, "kind", "core");
  toggleFilter(filters, "kind", "core");
  assert.equal(filters.kind.size, 0);
});

test("filter URLs round-trip repeated values and exclusions while discarding obsolete category parameters", () => {
  const library = fixture();
  const options = filterOptions(library);
  const params = new URLSearchParams("source=pc1&source=GMC&source=unknown&kind=optional&not-kind=optional&topic=Old&not-topic=Removed&view=browse&id=PC1%3Aone");
  const filters = readFilters(params, options);
  assert.deepEqual([...filters.source.keys()], ["PC1", "GMC"]);
  assert.equal(filters.kind.get("optional"), -1);
  writeFilters(params, filters);
  assert.deepEqual(readFilters(params, options), filters);
  assert.equal(params.get("view"), "browse");
  assert.equal(params.get("id"), "PC1:one");
  assert.equal(params.get("kind"), null);
  assert.equal(params.get("not-kind"), "optional");
  assert.equal(params.get("topic"), null);
  assert.equal(params.get("not-topic"), null);
  const legacy = readFilters(new URLSearchParams("source=PC1&kind=core"), options);
  assert.deepEqual(names(library, legacy), ["One"]);
});

test("facet counts respect name search and the other group without suppressing their own alternatives", () => {
  const library = fixture();
  const options = filterOptions(library);
  const filters = emptyFilters();
  toggleFilter(filters, "source", "PC1");
  toggleFilter(filters, "kind", "optional");
  const counts = filterCounts(library.rules, filters, options);
  assert.deepEqual(Object.keys(counts), ["source", "kind"]);
  assert.equal(counts.source.get("PC1"), 1);
  assert.equal(counts.source.get("GMC"), 1);
  assert.equal(counts.source.get("Avalon"), 0);
  assert.equal(counts.kind.get("core"), 1);
  assert.equal(counts.kind.get("optional"), 1);
  const searched = filterCounts(searchRules(library, { query: "One" }), filters, options);
  assert.equal(searched.source.get("GMC"), 0);
  assert.equal(searched.kind.get("core"), 1);
});

test("filter markup escapes values and chips identify include and exclude states without color alone", () => {
  const options = { source: [{ value: '<img src=x>', label: '<img src=x>' }], kind: [] };
  const filters = emptyFilters();
  filters.source.set('<img src=x>', -1);
  const groups = renderFilterGroups(options);
  const chips = renderFilterChips(filters, options);
  assert.match(groups, /data-filter-value="&lt;img src=x&gt;"/);
  assert.match(chips, /Remove excluded source &lt;img src=x&gt;/);
  assert.match(chips, /Source: − &lt;img src=x&gt;/);
  assert.doesNotMatch(groups + chips, /<img /);
});
