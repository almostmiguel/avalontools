import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderContent } from "../js/content-renderer.js";
import { imageView, attachImageViewer } from "../js/image-viewer.js";
import { createRuleLibrary } from "../js/rule-library.js";
import { renderRulePreview } from "../js/reference-previews.js";

test("rule images wrap on the right, stay accessible, and retain a working image link without JavaScript", () => {
  const image = { type: "image", href: "img/areas.webp", alt: 'Area "templates"', title: "Areas: {@b bursts and cones}", align: "right" };
  const { html, headings } = renderContent({ entries: [image, "Rule text beside the image."] });
  assert.match(html, /class="rule-image rule-image--right"/);
  assert.match(html, /href="img\/areas.webp" data-image-viewer/);
  assert.match(html, /aria-label="Enlarge image: Area &quot;templates&quot;"/);
  assert.match(html, /alt="Area &quot;templates&quot;" loading="lazy"/);
  assert.match(html, /<figcaption>Areas: <strong>bursts and cones<\/strong><\/figcaption>/);
  assert.ok(html.indexOf("<figure") < html.indexOf("<p>Rule text"));
  assert.equal(headings.length, 0);
  const { registry } = createRuleLibrary({ rules: [{ name: "Area", source: "PC1", entries: [image] }] });
  assert.ok(renderRulePreview("Area", "PC1", registry).includes(renderContent({ entries: [image] }).html));
  const ordinary = renderContent({ entries: [{ type: "image", href: { path: "img/other.webp" }, align: 'right" onclick="bad()' }] }).html;
  assert.match(ordinary, /class="rule-image"/);
  assert.doesNotMatch(ordinary, /rule-image--right|onclick/);
  for (const href of ["javascript:bad()", "//elsewhere/image.png", "data:image/svg+xml,bad"]) {
    assert.equal(renderContent({ entries: [{ type: "image", href, align: "right" }] }).html, "");
  }
});

test("zoom preserves the point under the pointer, clamps panning and respects fit and maximum zoom", () => {
  const state = { width: 800, height: 600, zoom: 1, x: 0, y: 0 };
  const bounds = { width: 800, height: 600 };
  assert.deepEqual(imageView(state, 2, bounds, { x: 100, y: 60 }), { ...state, zoom: 2, x: -100, y: -60 });
  const moved = imageView({ ...state, zoom: 2, x: 9999, y: -9999 }, 2, bounds);
  assert.equal(moved.x, 400);
  assert.equal(moved.y, -300);
  assert.deepEqual(imageView(moved, .1, bounds), state);
  assert.equal(imageView(state, 100, bounds).zoom, 8);
  assert.deepEqual(imageView({ ...state, width: 100, height: 100 }, 2, bounds), { ...state, width: 100, height: 100, zoom: 2 });
});

function environment() {
  class Target {
    handlers = new Map();
    addEventListener(name, callback) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(callback); }
    removeEventListener(name, callback) { this.handlers.get(name)?.delete(callback); }
    emit(name, extras = {}) {
      const event = { target: this, button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extras };
      for (const callback of this.handlers.get(name) || []) callback(event);
      return event;
    }
  }
  let document;
  class Element extends Target {
    dataset = {}; style = {}; attributes = new Map(); children = []; parts = new Map(); isConnected = true;
    classList = Object.assign(new Set(), { remove(value) { this.delete(value); } });
    open = false; hidden = false; complete = false; naturalWidth = 0; naturalHeight = 0;
    rect = { left: 20, top: 70, width: 800, height: 600 };
    append(child) { this.children.push(child); child.parent = this; }
    remove() { this.isConnected = false; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getBoundingClientRect() { return this.rect; }
    getClientRects() { return this.isConnected ? [this.rect] : []; }
    querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
    closest(selector) { return selector === "[data-image-viewer]" && this.attributes.has("href") ? this : null; }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; this.querySelector("[data-image-close]").focus(); }
    close() { this.open = false; this.emit("close"); }
    setPointerCapture(id) { this.captured = id; }
  }
  document = new Target();
  document.body = new Element();
  document.documentElement = new Element();
  document.activeElement = new Element();
  document.createElement = () => new Element();
  const window = new Target();
  const link = new Element();
  link.setAttribute("href", "img/areas.webp");
  link.querySelector("img").alt = "Area templates";
  const viewer = attachImageViewer({ document, window });
  const click = extras => document.emit("click", { target: link, ...extras });
  const load = () => {
    const dialog = document.body.children[0], stage = dialog.querySelector(".image-viewer-stage"), image = stage.querySelector("img");
    image.naturalWidth = 1600; image.naturalHeight = 1200; image.emit("load");
    return { dialog, stage, image, output: dialog.querySelector(".image-viewer-zoom"), out: dialog.querySelector("[data-image-out]"), into: dialog.querySelector("[data-image-in]") };
  };
  return { document, window, link, viewer, click, load };
}

test("delegated image clicks open one modal, fit the original image, zoom and restore focus on closing", () => {
  const page = environment();
  assert.equal(page.click({ ctrlKey: true }).defaultPrevented, false);
  assert.equal(page.document.body.children.length, 0);
  assert.equal(page.click().defaultPrevented, true);
  const { dialog, stage, image, output, out, into } = page.load();
  assert.equal(dialog.open, true);
  assert.equal(page.document.documentElement.classList.has("image-viewer-open"), true);
  assert.equal(image.src, "img/areas.webp");
  assert.equal(image.alt, "Area templates");
  assert.equal(dialog.querySelector(".image-viewer-title").textContent, "Area templates");
  assert.equal(image.style.width, "800px");
  assert.equal(out.disabled, true);
  into.emit("click");
  assert.equal(output.textContent, "125%");
  assert.equal(out.disabled, false);
  out.emit("click");
  assert.equal(output.textContent, "100%");
  dialog.emit("click", { target: image });
  assert.equal(dialog.open, true);
  dialog.emit("click", { target: stage });
  assert.equal(dialog.open, false);
  assert.equal(page.document.activeElement, page.link);
  assert.equal(page.document.documentElement.classList.has("image-viewer-open"), false);
  page.link.querySelector("img").alt = "Another diagram";
  page.click(); page.load();
  assert.equal(page.document.body.children.length, 1);
  assert.equal(dialog.querySelector(".image-viewer-title").textContent, "Another diagram");
  assert.equal(output.textContent, "100%");
  dialog.emit("click", { target: dialog });
  assert.equal(dialog.open, false);
});

test("wheel zoom, captured dragging and keyboard controls explore the image without closing it", () => {
  const page = environment(); page.click();
  const { dialog, stage, image, output } = page.load();
  assert.equal(stage.emit("wheel", { deltaY: -100, clientX: 420, clientY: 370 }).defaultPrevented, true);
  assert.notEqual(output.textContent, "100%");
  dialog.emit("keydown", { key: "+" });
  stage.emit("pointerdown", { target: image, pointerId: 1, clientX: 400, clientY: 300 });
  assert.equal(stage.captured, 1);
  stage.emit("pointermove", { pointerId: 1, clientX: 450, clientY: 320 });
  assert.match(image.style.transform, /translate\(50px, 20px\)/);
  stage.emit("pointerup", { pointerId: 1 });
  dialog.emit("click", { target: stage });
  assert.equal(dialog.open, true);
  dialog.emit("keydown", { key: "ArrowRight" });
  assert.match(image.style.transform, /translate\(0px, 20px\)/);
  dialog.emit("keydown", { key: "0" });
  assert.equal(output.textContent, "100%");
  dialog.emit("keydown", { key: "+", ctrlKey: true });
  assert.equal(output.textContent, "100%");
  dialog.emit("keydown", { key: "+" });
  page.window.emit("resize");
  assert.equal(output.textContent, "100%");
  dialog.emit("keydown", { key: "+" });
  stage.emit("pointerdown", { target: image, pointerId: 2, clientX: 400, clientY: 300 });
  stage.emit("pointercancel", { pointerId: 2 });
  dialog.emit("click", { target: stage });
  assert.equal(dialog.open, false);
  page.click(); page.load();
  dialog.querySelector("[data-image-close]").emit("click");
  assert.equal(dialog.open, false);
});

test("image failures are recoverable, unsafe URLs keep native navigation and destroying releases listeners", () => {
  const page = environment(); page.click();
  const { dialog, stage, image, into } = page.load();
  image.emit("error");
  assert.equal(image.hidden, true);
  assert.equal(into.disabled, true);
  assert.match(dialog.querySelector(".image-viewer-loading").textContent, /could not be loaded/);
  image.emit("load");
  assert.equal(image.hidden, false);
  page.viewer.close();
  page.link.setAttribute("href", "javascript:bad()");
  assert.equal(page.click().defaultPrevented, false);
  assert.equal(dialog.open, false);
  page.link.setAttribute("href", "img/other.webp");
  page.click(); page.load();
  page.viewer.destroy();
  assert.equal(dialog.isConnected, false);
  assert.equal(page.document.documentElement.classList.has("image-viewer-open"), false);
  assert.equal(page.click().defaultPrevented, false);
  assert.equal(stage.handlers.get("wheel").size, 0);
});

test("content pages load the viewer and the editor provides the image option and reusable snippet", async () => {
  const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
  for (const name of ["rules.html", "rule.html", "actions.html"]) {
    assert.match(await read(name), /<script type="module" src="js\/image-viewer.js"><\/script>/);
  }
  const schema = JSON.parse(await read("data/rules.schema.json"));
  assert.deepEqual(schema.definitions.block.properties.align.enum, ["center", "right"]);
  const snippets = JSON.parse(await read(".vscode/avalon.code-snippets"));
  assert.equal(snippets["Avalon: Rule image"].prefix, "av-image");
});
