import assert from "node:assert/strict";
import { test } from "node:test";
import { attachRulePreviews, previewPosition, renderRulePreview } from "../js/rule-links.js";
import { createLibrary } from "../js/rules-library.js";

const { registry } = createLibrary({
  sources: [{ id: "PC1", name: "Player Core" }],
  rules: [{ id: "action", name: "Action", source: "PC1", page: 10, entries: ["Use an action to do something."] }],
});

test("previews show authored content and citation and explain missing rules", () => {
  const html = renderRulePreview("Action", "PC1", registry);
  assert.match(html, /Use an action to do something/);
  assert.match(html, /Player Core/);
  assert.match(html, /pg\. 10/);
  const citation = html.match(/<p class="rule-preview-source">([\s\S]*?)<\/p>/)[1];
  assert.match(citation, /Source Player Core/);
  assert.doesNotMatch(citation, /<a\b|href=/);
  assert.match(renderRulePreview("Missing", "PC1", registry), /No matching rule has been added/);
  assert.doesNotMatch(renderRulePreview("<script>bad</script>", "PC1", registry), /<script>/);
});

test("previews keep structured lists and boxes with unique content anchors", () => {
  const { registry: structured } = createLibrary({ rules: [{
    id: "example", name: "Example", source: "Avalon", entries: [
      { type: "list", style: "list-no-bullets", items: ["First.", "Second."] },
      { type: "box", name: "Outer", entries: [
        { type: "box-section", name: "Inner", entries: ["Cast {@spell light}."] },
      ] },
    ],
  }] });
  const html = renderRulePreview("Example", "Avalon", structured);
  assert.match(html, /<ul class="list-no-bullets" role="list">/);
  assert.match(html, /id="rule-preview-section-1"/);
  assert.match(html, /id="rule-preview-section-2"/);
  assert.match(html, /Cast <em>light<\/em>/);
});
test("hover cards stay inside the viewport and move above the link when needed", () => {
  assert.deepEqual(previewPosition({ left: 50, top: 100, bottom: 120 }, { width: 300, height: 100 }, { width: 800, height: 600 }), { left: 50, top: 128 });
  assert.deepEqual(previewPosition({ left: 750, top: 500, bottom: 520 }, { width: 500, height: 200 }, { width: 800, height: 600 }), { left: 288, top: 292 });
  assert.deepEqual(previewPosition({ left: 0, top: 0, bottom: 10 }, { width: 296, height: 176 }, { width: 320, height: 200 }), { left: 12, top: 12 });
});

function environment() {
  class EventTarget {
    handlers = new Map();
    addEventListener(type, handler) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set());
      this.handlers.get(type).add(handler);
    }
    removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler); }
    emit(type, event = {}) { for (const handler of this.handlers.get(type) || []) handler({ target: this, relatedTarget: null, ...event }); }
  }
  const document = new EventTarget();
  class Element extends EventTarget {
    attributes = new Map(); dataset = {}; style = {}; children = []; innerHTML = "";
    rect = { left: 100, top: 100, bottom: 125, width: 400, height: 200 };
    append(child) { child.parent = this; this.children.push(child); }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    contains(other) { for (let node = other; node; node = node.parent) if (node === this) return true; return false; }
    closest(selector) {
      const selectors = selector.split(",").map(value => value.trim());
      if (selectors.includes("[data-rule-name]") && this.dataset.ruleName) return this;
      if (selector === "[data-close-rule-preview]" && this.isClose) return this;
      return this.parent?.closest(selector) || null;
    }
    getBoundingClientRect() { return this.rect; }
    focus() { document.activeElement = this; document.emit("focusin", { target: this }); }
  }
  document.body = new Element();
  document.activeElement = document.body;
  document.createElement = () => new Element();
  const timers = new Map();
  let timerId = 0;
  const window = new EventTarget();
  Object.assign(window, { innerWidth: 900, innerHeight: 700,
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  const flush = () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(callback => callback()); };
  const link = new Element();
  link.dataset = { ruleName: "Action", ruleSource: "PC1" };
  link.setAttribute("href", registry.resolve("Action", "PC1").target.href);
  document.body.append(link);
  const controller = attachRulePreviews({ document, window, registry });
  return { document, window, flush, link, controller, Element };
}

test("pointer hover opens the preview, allows entering it, and closes on outside interaction", () => {
  const env = environment();
  const { document, flush, link, controller } = env;
  assert.equal(controller.panel.hidden, true);
  document.emit("pointerover", { target: link, pointerType: "mouse" });
  flush();
  assert.equal(controller.panel.hidden, false);
  assert.match(controller.panel.innerHTML, /Player Core/);
  assert.equal(link.attributes.get("aria-controls"), "rule-preview");
  document.emit("pointerout", { target: link });
  controller.panel.emit("pointerenter");
  flush();
  assert.equal(controller.panel.hidden, false);
  controller.panel.emit("pointerleave");
  flush();
  assert.equal(controller.panel.hidden, true);
  controller.show(link);
  document.emit("pointerdown", { target: document.body });
  assert.equal(controller.panel.hidden, true);
  controller.destroy();
  assert.equal(document.body.children.includes(controller.panel), false);
});

test("keyboard focus and Escape work without stealing focus or blocking navigation", () => {
  const { document, link, controller, Element } = environment();
  const href = link.attributes.get("href");
  link.focus();
  assert.equal(controller.panel.hidden, false);
  assert.equal(document.activeElement, link);
  let prevented = false;
  document.emit("keydown", { key: "ArrowDown", altKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(document.activeElement, controller.panel);
  document.emit("keydown", { key: "Escape" });
  assert.equal(controller.panel.hidden, true);
  assert.equal(document.activeElement, link);
  assert.equal(link.attributes.get("aria-describedby"), undefined);
  assert.equal(link.attributes.get("href"), href);
  controller.show(link);
  const closeButton = new Element();
  closeButton.isClose = true;
  controller.panel.append(closeButton);
  closeButton.focus();
  controller.panel.emit("click", { target: closeButton });
  assert.equal(controller.panel.hidden, true);
  assert.equal(document.activeElement, link);
});

test("touch hover is ignored, and resizing or scrolling cannot strand a preview off screen", () => {
  const { document, window, link, controller, flush } = environment();
  document.emit("pointerover", { target: link, pointerType: "touch" });
  flush();
  assert.equal(controller.panel.hidden, true);
  controller.show(link);
  window.innerWidth = 500;
  window.emit("resize");
  assert.ok(Number.parseFloat(controller.panel.style.left) >= 12);
  link.rect = { ...link.rect, top: -100, bottom: -80 };
  window.emit("scroll");
  assert.equal(controller.panel.hidden, true);
});
