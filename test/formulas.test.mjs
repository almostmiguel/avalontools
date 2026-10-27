import assert from "node:assert/strict";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";


test("formulas preserve labels, formatting and multiple lines without adding outline headings", () => {
  const { html, headings } = renderContent({ entries: [
    { type: "formula", name: "Attack <roll>", entry: "{@b d20} + modifier" },
    { type: "formula", entries: ["First calculation.", "Second calculation."] },
  ] });
  for (const text of ["Attack &lt;roll&gt;", "<strong>d20</strong> + modifier", "First calculation.", "Second calculation."]) assert.ok(html.includes(text));
  assert.equal(headings.length, 0);
});
