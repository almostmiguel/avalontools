import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseDocument } from "htmlparser2";
import { renderContent, renderInline } from "../js/content-renderer.js";
import { createCatalog, searchCatalog } from "../js/reference-library.js";
import { createEquipmentCatalog, priceInCopper, sortEquipment, equipmentMatchesFilters, equipmentOptions, EQUIPMENT_FILTERS, renderEquipmentDetail, renderEquipmentPreview, renderEquipmentResults } from "../js/equipment-library.js";
import { parseEquipmentPage } from "../scripts/import-pc1-equipment.mjs";
import { htmlContentBlocks } from "../scripts/html-content.mjs";

const payload = JSON.parse(await readFile(new URL("../data/equipment.json", import.meta.url), "utf8"));
const library = createEquipmentCatalog(payload);

test("PC1 equipment includes all indexed gear variants, weapons, ammunition, armor and shields with safe complete readers", async () => {
  assert.equal(library.records.length, 262);
  assert.equal(new Set(library.records.map(record => record.name)).size, 262);
  assert.equal(library.records.filter(record => record.category === "Weapon").length, 84);
  assert.equal(library.records.filter(record => record.category === "Ammunition").length, 4);
  assert.equal(library.records.filter(record => record.category === "Armor").length, 13);
  assert.equal(library.records.filter(record => record.category === "Shield").length, 4);
  const traits = createCatalog(JSON.parse(await readFile(new URL("../data/traits.json", import.meta.url), "utf8")), { collection: "traits", href: "traits.html" });
  for (const record of library.records) {
    assert.equal(record.source, "PC1");
    assert.ok(Number.isInteger(record.page) && record.page > 0);
    for (const trait of record.traits) assert.equal(traits.registry.resolve(trait).status, "found", trait);
    const html = renderEquipmentDetail(record, library);
    assert.doesNotMatch(html, /undefined|\[object Object\]|<script|PFS Note|Specific Magic|Site Owner:/);
    assert.match(html, /<footer class="reader-footer">[\s\S]*Player Core/);
    assert.ok(html.indexOf("reader-footer") > html.indexOf("rich-content"));
    const row = renderEquipmentResults([record], record.id);
    assert.ok(row.indexOf("equipment-result-price") < row.indexOf("catalog-result-source"));
  }
  const sword = library.registry.resolve("Bastard Sword", "PC1").target;
  assert.equal(sword.entry.stats.Damage, "1d8 S");
  assert.equal(sword.price, 400);
  assert.equal(sword.entry.hands, "1");
  assert.match(renderEquipmentDetail(sword, library), /data-trait-name="two-hand"/);
  assert.match(renderEquipmentDetail(sword, library).replace(/<[^>]*>/g, ""), /Two-Hand 1d12/);
  const shield = library.registry.resolve("Buckler").target;
  assert.equal(shield.entry.stats["HP (BT)"], "6 (3)");
  assert.equal(shield.entry.stats.Hardness, "3");
  assert.equal(library.registry.resolve("Chain Mail").target.entry.stats["AC Bonus"], "+4");
  assert.equal(library.registry.resolve("Katana").target.price, 200);
  const lab = library.registry.resolve("Alchemist's Lab (Expanded)").target;
  assert.equal(lab.level, 3); assert.equal(lab.price, 5500);
  assert.match(renderEquipmentDetail(lab, library), /need an alchemist&#39;s lab/);
  assert.match(renderEquipmentDetail(lab, library), /\+1 item bonus/);
  assert.equal(library.registry.resolve("Survey Map (Atlas)").target.price, 5000);
  assert.equal(library.registry.resolve("Scholarly Journal (Compendium)").target.price, 3000);
  assert.equal(library.registry.resolve("Wheelchair (Supramarine Chair)").status, "missing");
  assert.match(renderEquipmentDetail(library.registry.resolve("Wheelchair").target, library), /Wheelchair Rules/);
  const preview = renderEquipmentPreview(shield, library);
  assert.match(preview, /<h2 id="rule-preview-title">Buckler<\/h2>/);
  assert.match(preview, /HP \(BT\)/);
  assert.match(preview, /p\. 274/);
});

test("equipment prices sort by monetary value and combine with type, level, category, group and trait filters", () => {
  assert.equal(priceInCopper("1 gp, 5 sp"), 150);
  assert.equal(priceInCopper("1,000 gp"), 100000);
  assert.equal(priceInCopper("2 pp, 3 gp, 4 sp, 5 cp"), 2345);
  assert.equal(priceInCopper("0 cp"), 0);
  assert.equal(priceInCopper("1 sp (price for 10)"), 10);
  for (const value of [undefined, "—", "varies", "1 gp to 2 gp"]) assert.equal(priceInCopper(value), null);
  const records = ["1 pp", "2 gp", "5 sp", "3 cp", "—"].map((price, index) => ({ name: String(index), id: String(index), price: priceInCopper(price) }));
  assert.deepEqual(sortEquipment(records, "price").map(record => record.price), [3, 50, 200, 1000, null]);
  assert.deepEqual(sortEquipment(records, "price", "desc").map(record => record.price), [1000, 200, 50, 3, null]);
  const filters = Object.fromEntries(EQUIPMENT_FILTERS.map(({ key }) => [key, new Map()]));
  filters.category.set("Weapon", 1); filters.subcategory.set("Martial", 1); filters.group.set("Sword", 1); filters.trait.set("two-hand", 1); filters.level.set("0", 1); filters.price.set("Over 1 to 10 gp", 1);
  const sword = library.registry.resolve("Bastard Sword").target;
  assert.equal(equipmentMatchesFilters(sword, filters), true);
  filters.trait.set("two-hand", -1);
  assert.equal(equipmentMatchesFilters(sword, filters), false);
  assert.equal(equipmentMatchesFilters(sword, filters, "trait"), true);
  assert.ok(equipmentOptions(library).price.some(option => option.value === "Unpriced / varies"));
  assert.equal(searchCatalog(library, "broad-bladed").length, 0);
  assert.equal(searchCatalog(library, "BASTARD SWORD")[0].id, sword.id);
  assert.match(renderInline("{@item Backpack|PC1}"), /href="equipment.html\?equipment=Backpack&amp;source=PC1"/);
  assert.match(renderInline("{@equipment Backpack|PC1}"), /data-equipment-name="Backpack"/);
});

test("equipment import inherits family text, keeps variant prices and ignores PFS notes and non-PC1 variants", () => {
  const references = { trait: { names: [] } };
  const html = `<h1 class="title"><a href="PFS.aspx"><span><img src="pfs.png"></a></span>Test Kit<span style="margin-left:auto">Item 0+</span></h1>
    <b>Source</b> Player Core pg. 290<br><b>Hands</b> 2<hr>Shared kit instructions.
    <h2 class="title">Test Kit<span style="margin-left:auto">Item 0</span></h2><b>Source</b> Player Core pg. 290<br><u><a href="PFS.aspx"><b><i>PFS Note</b></u></a> Other campaign rule</i><br><b>Price</b> 5 sp<br>
    <h2 class="title">Test Kit (Expanded)<span style="margin-left:auto">Item 3</span></h2><b>Source</b> Player Core pg. 290<br><b>Price</b> 55 gp<br>Expanded instructions.
    <h2 class="title">Test Kit (Other Book)<span style="margin-left:auto">Item 5</span></h2><b>Source</b> GM Core pg. 250<br><b>Price</b> 100 gp<br>Other book instructions.<div class="clear"></div>`;
  const records = parseEquipmentPage(html, [{ name: "Test Kit", path: "Equipment.aspx?ID=1" }, { name: "Test Kit (Expanded)", path: "Equipment.aspx?ID=1" }], references);
  assert.equal(records[0].price, "5 sp");
  assert.equal(records[1].price, "55 gp");
  assert.equal(records[1].hands, "2");
  assert.equal(records[1].level, 3);
  assert.deepEqual(records[1].entries, ["Shared kit instructions.", "Expanded instructions."]);
  assert.doesNotMatch(JSON.stringify(records), /PFS Note|Other campaign|Other book instructions/);
  assert.throws(() => parseEquipmentPage(html, [{ name: "Test Kit (Other Book)", path: "Equipment.aspx?ID=1" }], references), /Not a PC1 item/);
  const blocks = htmlContentBlocks(parseDocument('<table><tr><th>Type</th><th>Price</th></tr><tr><td rowspan="2">Light</td><td>10 gp</td></tr><tr><td>20 gp</td></tr></table><details class="clarification"><summary>Paizo Clarification</summary>Rule detail.</details>').children, {});
  const rendered = renderContent({ entries: blocks }).html;
  assert.match(rendered, /rowspan="2"/);
  assert.match(rendered, /<details class="paizo-clarification"/);
  assert.match(rendered, /Rule detail\./);
});
