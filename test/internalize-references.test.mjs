import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { internalizeData } from "../scripts/internalize-references.mjs";
import { renderInline } from "../js/content-renderer.js";

test("Nethys links resolve to local entries and unavailable entries remain readable", () => {
  const sources = [{ id: "PC1", name: "Player Core" }, { id: "PC2", name: "Player Core 2" }];
  const payloads = {
    equipment: { sources, equipment: [{ name: "Elixir of Life (Minor)", source: "PC2", page: 10, entries: [], reference: "https://2e.aonprd.com/Equipment.aspx?ID=1" }] },
    feats: { sources, feats: [
      { name: "Quick Draw", source: "PC1", page: 1, level: 1, traits: ["ranger"], entries: [] },
      { name: "Quick Draw", source: "PC1", page: 2, level: 1, traits: ["rogue"], entries: [] },
    ] },
    backgrounds: { sources, _meta: { reference: "https://2e.aonprd.com/Sources.aspx?ID=1" }, backgrounds: [{
      name: "Test", source: "PC1", page: 3, traits: ["rogue"], reference: "https://2e.aonprd.com/Backgrounds.aspx?ID=1", entries: [
        "Drink {@link minor elixir of life|https://2e.aonprd.com/Equipment.aspx?ID=1} and use {@link Quick Draw|https://2e.aonprd.com/Feats.aspx?ID=2}.",
        "Keep {@link unavailable spell|https://2e.aonprd.com/Spells.aspx?ID=3} readable. Open {@link here|traits}.",
        "Keep the space in .vscode and preserve the deity Nethys.",
      ],
    }] },
  };
  const result = internalizeData(payloads).payloads;
  const entry = result.backgrounds.backgrounds[0];
  assert.equal(entry.entries[0], "Drink {@equipment Elixir of Life (Minor)|PC2|minor elixir of life} and use {@feat Quick Draw (Rogue)|PC1|Quick Draw}.");
  assert.equal(entry.entries[1], "Keep unavailable spell readable. Open {@catalog traits|here}.");
  assert.equal(entry.entries[2], "Keep the space in .vscode and preserve the deity Nethys.");
  assert.equal(entry.reference, undefined);
  assert.equal(result.backgrounds._meta, undefined);
  assert.equal(internalizeData(result).stats.converted, 0);
});

test("catalog links open the site's own pages and reject unknown targets", () => {
  assert.equal(renderInline("{@catalog equipment}"), '<a href="equipment.html">equipment</a>');
  assert.equal(renderInline("{@catalog companions|here}"), '<a href="companions.html">here</a>');
  assert.equal(renderInline("{@catalog javascript:alert(1)|unsafe}"), "unsafe");
  assert.equal(renderInline("{@catalog constructor|unsafe}"), "unsafe");
});

test("content JSON contains no Nethys URLs, provenance fields or generic link tags", async () => {
  const root = new URL("../data/", import.meta.url);
  for (const file of (await readdir(root)).filter(name => name.endsWith(".json") && !name.endsWith(".schema.json"))) {
    const text = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(text, /aonprd\.com|archivesofnethys\.com|Archives of Nethys|\{@link\s|"(?:_meta|reference|references|referenceUrl|referenceSource)"\s*:/i, file);
  }
});
