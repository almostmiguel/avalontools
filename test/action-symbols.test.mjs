import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inlineText, renderContent, renderInline } from "../js/content-renderer.js";

test("action tags use the original font's glyph characters with accessible names", () => {
  const labels = { "1": "One action", "2": "Two actions", "3": "Three actions", r: "Reaction", f: "Free action" };
  for (const [symbol, label] of Object.entries(labels)) {
    const html = renderInline(`{@as ${symbol}}`);
    assert.ok(html.includes(`data-symbol="${symbol}"`));
    assert.ok(html.includes(`aria-label="${label}"`));
    assert.match(html, /role="img"/);
    assert.equal(renderInline(`{@actionsymbol ${symbol}}`), html);
    assert.equal(renderInline(`{@as ${symbol.toUpperCase()} }`), html);
  }
  assert.equal(renderInline("{@as unknown}"), "unknown");
  assert.equal(renderInline("{@code {@as 1}}"), "<code>{@as 1}</code>");
  assert.doesNotMatch(renderInline('{@as <script>bad</script>}'), /<script>/);
  assert.equal(inlineText("{@as 1} Single Actions").trim(), "Single Actions");
  const html = renderContent({ entries: [
    { type: "h4", name: "{@as 1} Single Actions", entries: ["Use {@as 2}, {@as 3}, {@as r}, or {@as f}."] },
  ] }).html;
  assert.equal((html.match(/class="action-symbol"/g) || []).length, 5);
});

test("the bundled TrueType font contains distinct glyphs for every supported action symbol", async () => {
  const font = await readFile(new URL("../fonts/Pathfinder2eActions.ttf", import.meta.url));
  assert.equal(font.readUInt32BE(0), 0x00010000);
  const tables = new Map();
  for (let index = 0; index < font.readUInt16BE(4); index++) {
    const offset = 12 + index * 16;
    tables.set(font.toString("ascii", offset, offset + 4), font.readUInt32BE(offset + 8));
  }
  const cmap = tables.get("cmap");
  assert.ok(cmap);
  const glyphs = new Map();
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const record = cmap + 4 + index * 8;
    const offset = cmap + font.readUInt32BE(record + 4);
    if (font.readUInt16BE(offset) !== 4) continue;
    const count = font.readUInt16BE(offset + 6) / 2;
    const end = offset + 14, start = end + count * 2 + 2;
    const delta = start + count * 2, range = delta + count * 2;
    for (const symbol of "123rf") {
      const code = symbol.charCodeAt(0);
      for (let segment = 0; segment < count; segment++) {
        if (code < font.readUInt16BE(start + segment * 2) || code > font.readUInt16BE(end + segment * 2)) continue;
        const distance = font.readUInt16BE(range + segment * 2);
        let glyph = distance ? font.readUInt16BE(range + segment * 2 + distance + 2 * (code - font.readUInt16BE(start + segment * 2))) : code;
        if (!distance || glyph) glyph = (glyph + font.readInt16BE(delta + segment * 2)) & 0xffff;
        glyphs.set(symbol, glyph);
        break;
      }
    }
  }
  assert.equal(glyphs.size, 5);
  assert.ok([...glyphs.values()].every(glyph => glyph > 0));
  assert.equal(new Set(glyphs.values()).size, 5);
});
