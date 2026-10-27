import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLibrary } from "../js/rules-library.js";
import { renderInline } from "../js/content-renderer.js";
import { checkRuleLinks, formatDiagnostic } from "../scripts/check-rule-links.mjs";

const fixture = () => createLibrary({ sources: [{ id: "PC1", name: "Player Core" }], rules: [
  { name: "Areas", source: "PC1", page: 300 },
  { name: "Areas", source: "PC1", page: 426 },
  { name: "Unique", source: "PC1", aliases: ["Only one"] },
  { name: "Water", source: "PC1", ruleDefault: true },
  { name: "Water", source: "GMC" },
] });

test("JSON diagnostics catch formatted ambiguous links, preserve labels and offer targets that resolve", () => {
  const library = fixture();
  const text = JSON.stringify({ entries: [
    'A "quoted" phrase: {@b {@rule Areas||here}}.',
    "Two: {@rule Areas|PC1} and {@rule Areas}.",
  ] }, null, 2).replaceAll("\n", "\r\n");
  const issues = checkRuleLinks(text, library.registry);
  assert.equal(issues.length, 3);
  assert.deepEqual(issues.map(issue => issue.line), [3, 4, 4]);
  assert.deepEqual(issues[0].suggestions, ["{@rule areas-300|PC1|here}", "{@rule areas-426|PC1|here}"]);
  const rawLine = text.split("\r\n")[issues[0].line - 1];
  assert.equal(rawLine.slice(issues[0].column - 1, issues[0].endColumn - 1), 'A \\"quoted\\" phrase: {@b {@rule Areas||here}}.');
  for (const issue of issues) for (const suggestion of issue.suggestions) {
    let resolved = false;
    renderInline(suggestion, { resolveRule(name, source) {
      const result = library.registry.resolve(name, source);
      assert.equal(result.status, "found"); resolved = true; return result;
    } });
    assert.equal(resolved, true);
  }
});

test("literal code, property keys, exact targets, aliases, defaults and missing rules produce no ambiguity errors", () => {
  const text = JSON.stringify({ "{@rule Areas}": "A property key", entries: [
    "{@code {@rule Areas}} and {@kbd {@rule Areas}}",
    "{@rule areas-300|PC1|Areas} and {@rule PC1:areas-426||Areas}",
    "{@rule Only one} {@rule Water} {@rule Missing rule}",
    "Malformed {@rule Areas",
  ] });
  assert.deepEqual(checkRuleLinks(text, fixture().registry), []);
  assert.throws(() => checkRuleLinks('{"entries":', fixture().registry), SyntaxError);
});

test("the editor task recognizes diagnostic ranges and resets them between save checks", async () => {
  const tasks = JSON.parse(await readFile(new URL("../.vscode/tasks.json", import.meta.url), "utf8"));
  const matcher = tasks.tasks[0].problemMatcher;
  const issue = checkRuleLinks(JSON.stringify({ entry: "{@rule Areas}" }), fixture().registry)[0];
  const output = formatDiagnostic("data/rules.json", issue);
  const match = new RegExp(matcher.pattern.regexp).exec(output);
  assert.equal(match[matcher.pattern.file], "data/rules.json");
  assert.equal(Number(match[matcher.pattern.line]), issue.line);
  assert.equal(Number(match[matcher.pattern.column]), issue.column);
  assert.equal(Number(match[matcher.pattern.endLine]), issue.endLine);
  assert.equal(Number(match[matcher.pattern.endColumn]), issue.endColumn);
  assert.equal(match[matcher.pattern.message], issue.message);
  assert.ok(new RegExp(matcher.background.beginsPattern).test("Checking rule links..."));
  assert.ok(new RegExp(matcher.background.endsPattern).test("Rule link check complete: 0 errors."));
});
