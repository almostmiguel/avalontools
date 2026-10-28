import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuleLibrary } from "../js/rule-library.js";
import { createReaderState, READER_STATE_KEY, RECENT_ENTRY_LIMIT, renderSavedMenu, renderStarButton } from "../js/reader-state.js";

const fixture = () => createRuleLibrary({ rules: Array.from({ length: 9 }, (_, i) => ({ id: `rule-${i}`, name: `Rule ${i}`, entries: ["Text."] })) });
const browser = (saved = null) => {
  const storage = new Map(saved == null ? [] : [[READER_STATE_KEY, saved]]);
  return { storage, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
};

test("stars and recents persist by stable id, deduplicate and keep the six most recently viewed rules", () => {
  const library = fixture();
  const window = browser();
  const memory = createReaderState(library, window);
  assert.equal(memory.toggle("Avalon:rule-3"), true);
  assert.equal(memory.toggle("Avalon:rule-1"), true);
  for (const rule of library.rules) memory.visit(rule.id);
  memory.visit("Avalon:rule-3");
  memory.visit("Avalon:rule-3");
  assert.equal(memory.recent.length, RECENT_ENTRY_LIMIT);
  assert.equal(memory.recent[0].id, "Avalon:rule-3");
  assert.equal(new Set(memory.recent.map(rule => rule.id)).size, RECENT_ENTRY_LIMIT);
  const reloaded = createReaderState(library, window);
  assert.deepEqual(reloaded.starred.map(rule => rule.id), ["Avalon:rule-1", "Avalon:rule-3"]);
  assert.deepEqual(reloaded.recent, memory.recent);
  reloaded.clearRecent();
  assert.equal(createReaderState(library, window).recent.length, 0);
  assert.equal(reloaded.starred.length, 2);
  assert.equal(reloaded.toggle("Avalon:rule-3"), false);
  assert.equal(reloaded.toggle("unknown"), false);
  reloaded.visit("unknown");
  assert.equal(reloaded.recent.length, 0);
});

test("corrupt, deleted and duplicated saved entries are ignored, and renamed rules keep their stars", () => {
  const library = fixture();
  for (const invalid of ["invalid", "null", "42", "{}", '"text"']) {
    const memory = createReaderState(library, browser(invalid));
    assert.equal(memory.starred.length, 0);
    assert.equal(memory.recent.length, 0);
  }
  const window = browser(JSON.stringify({ starred: ["unknown", "Avalon:rule-2", "Avalon:rule-2", 42], recent: [null, "Avalon:rule-2"] }));
  const renamed = createRuleLibrary({ rules: [{ id: "rule-2", name: "Renamed Rule", entries: ["Text."] }] });
  const memory = createReaderState(renamed, window);
  assert.deepEqual(memory.starred.map(rule => rule.name), ["Renamed Rule"]);
  assert.equal(memory.recent.length, 1);
});

test("reading state can be scoped to another collection without mixing its history", () => {
  const library = fixture(), window = browser();
  const rules = createReaderState(library, window);
  const other = createReaderState(library, window, { storageKey: "avalon-skills", recentLimit: 2 });
  rules.visit(library.rules[0].id);
  for (const entry of library.rules) other.visit(entry.id);
  other.toggle(library.rules[1].id);
  assert.equal(other.recent.length, 2);
  assert.equal(rules.recent.length, 1);
  assert.equal(rules.starred.length, 0);
  assert.equal(rules.sync({ key: "avalon-skills", newValue: window.storage.get("avalon-skills") }), false);
  assert.equal(createReaderState(library, window, { storageKey: "avalon-skills", recentLimit: 2 }).starred.length, 1);
});

test("blocked storage keeps features working for the visit and storage events synchronize without writes", () => {
  const library = fixture();
  const window = { get localStorage() { throw new Error("Blocked"); } };
  const memory = createReaderState(library, window);
  memory.toggle("Avalon:rule-1");
  memory.visit("Avalon:rule-1");
  assert.equal(memory.isStarred("Avalon:rule-1"), true);
  assert.equal(memory.recent.length, 1);
  assert.equal(memory.sync({ key: "avalon-theme", newValue: "dark" }), false);
  assert.equal(memory.sync({ key: READER_STATE_KEY, newValue: JSON.stringify({ starred: ["Avalon:rule-2"], recent: ["Avalon:rule-3"] }) }), true);
  assert.equal(memory.isStarred("Avalon:rule-2"), true);
  assert.equal(memory.recent[0].id, "Avalon:rule-3");
  memory.sync({ key: null });
  assert.equal(memory.starred.length, 0);
  assert.equal(memory.recent.length, 0);
});

test("saved shortcuts and Star controls escape titles and use current library data", () => {
  const library = createRuleLibrary({ rules: [{ id: "safe", name: '<img src=x onerror="bad()">', entries: ["Text."] }] });
  const rule = library.get("Avalon:safe");
  const memory = createReaderState(library, browser());
  memory.toggle(rule.id);
  memory.visit(rule.id);
  const html = renderSavedMenu(memory) + renderStarButton(rule, true);
  assert.doesNotMatch(html, /<img /);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /href="rules.html\?id=Avalon%3Asafe"/);
  assert.match(html, /aria-pressed="true"/);
});

test("saved menu renders only the selected collection with one scrollable list", () => {
  const library = fixture();
  const memory = createReaderState(library, browser());
  memory.toggle("Avalon:rule-1");
  memory.visit("Avalon:rule-2");
  const stars = renderSavedMenu(memory, true, "starred");
  const recent = renderSavedMenu(memory, true, "recent");
  assert.match(stars, /aria-label="Starred rules"/);
  assert.match(stars, /data-saved-rule="Avalon:rule-1"/);
  assert.doesNotMatch(stars, /data-saved-rule="Avalon:rule-2"|data-clear-recent/);
  assert.match(recent, /aria-label="Recently viewed rules"/);
  assert.match(recent, /data-saved-rule="Avalon:rule-2"/);
  assert.doesNotMatch(recent, /data-saved-rule="Avalon:rule-1"/);
  assert.equal((stars.match(/<ul /g) || []).length, 1);
  assert.equal((recent.match(/<ul /g) || []).length, 1);
});
