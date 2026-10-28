import assert from "node:assert/strict";
import { test } from "node:test";
import { attachReferencePreviews, previewPosition, renderRulePreview, renderActionPreview, renderCatalogPreview } from "../js/reference-previews.js";
import { createActionLibrary, createCatalog, renderActionBody } from "../js/reference-library.js";
import { createRuleLibrary, renderRuleBody } from "../js/rule-library.js";
import { renderReferenceCitation } from "../js/reference-data.js";

const { registry } = createRuleLibrary({
  sources: [{ id: "PC1", name: "Player Core" }],
  rules: [{ id: "action", name: "Action", source: "PC1", page: 10, entries: ["Use an action to do something.", { type: "clarification", entries: ["An explanation."] }] }],
});

const actions = createActionLibrary({ sources: [{ id: "PC1", name: "Player Core" }], actions: [
  { name: "Stride", source: "PC1", page: 418, category: "basic", time: { unit: "action", value: 1 }, traits: ["move"], requirements: "You can move.", entries: ["Move up to your Speed.", { type: "h3", name: "Movement", entries: ["See {@rule Action} or {@action Aid}."] }] },
  { name: "Aid", source: "PC1", page: 416, category: "basic", time: { unit: "reaction" }, trigger: "An ally acts.", entries: ["Help the ally."] },
  { name: "Refocus", source: "PC1", page: 298, category: "general", time: { unit: "minute", value: 10 }, entries: ["Restore a Focus Point."] },
] });

const conditions = createCatalog({ sources: [{ id: "PC1", name: "Player Core" }], conditions: [
  { name: "Blinded", source: "PC1", category: "Sense", entries: ["You cannot see."] },
] }, { collection: "conditions", href: "conditions.html" });

const skills = createCatalog({ sources: [{ id: "PC1", name: "Player Core" }], skills: [
  { name: "Acrobatics", source: "PC1", category: "Skill", entries: ["Keep your balance."] },
] }, { collection: "skills", href: "skills.html" });

test("action previews share the full reader body, citation, symbols and formatting", () => {
  const action = actions.get("PC1:stride");
  const html = renderActionPreview("Stride", "PC1", actions, { registry });
  assert.match(html, /<h2 id="rule-preview-title">Stride<\/h2><span>Actions<\/span>/);
  assert.match(html, /data-symbol="1"/);
  assert.match(html, /class="ability-trait" role="listitem">move/);
  assert.match(html, /<dt>Requirements<\/dt>/);
  assert.ok(html.includes(renderReferenceCitation(action)));
  assert.ok(html.includes(renderActionBody(action, actions, { registry }, { anchorPrefix: "action-preview-section" })));
  assert.match(html, /id="action-preview-section-1"/);
  assert.doesNotMatch(html, /id="action-section-1"|data-close-rule-preview|<button/);
  assert.match(renderActionPreview("Aid", "", actions), /data-symbol="r"/);
  assert.match(renderActionPreview("Refocus", "", actions), /10 minutes/);
  assert.match(renderActionPreview("Missing", "PC1", actions), /No matching action/);
  assert.doesNotMatch(renderActionPreview("<script>bad()</script>", "", actions), /<script>/);
});

test("previews show authored content and citation and explain missing rules", () => {
  const html = renderRulePreview("Action", "PC1", registry);
  assert.match(html, /Use an action to do something/);
  assert.match(html, /Player Core/);
  assert.match(html, /· p\. 10/);
  const citation = html.match(/<p class="rule-preview-source">([\s\S]*?)<\/p>/)[1];
  assert.equal(citation, renderReferenceCitation(registry.resolve("Action", "PC1").target));
  assert.doesNotMatch(citation, /<a\b|href=/);
  assert.doesNotMatch(html, /data-close-rule-preview|<button/);
  assert.match(html, /<span>Rules<\/span><\/header>/);
  assert.match(renderRulePreview("Missing", "PC1", registry), /No matching rule has been added/);
  assert.doesNotMatch(renderRulePreview("<script>bad</script>", "PC1", registry), /<script>/);
});

test("condition and skill previews use their catalog entries and explain missing references", () => {
  const condition = renderCatalogPreview("Blinded", "PC1", conditions, { plural: "Conditions", singular: "condition" });
  const skill = renderCatalogPreview("Acrobatics", "PC1", skills, { plural: "Skills", singular: "skill" });
  assert.match(condition, /<span>Conditions<\/span>/);
  assert.match(condition, /You cannot see/);
  assert.match(skill, /<span>Skills<\/span>/);
  assert.match(skill, /Keep your balance/);
  assert.match(renderCatalogPreview("Missing", "PC1", conditions, { plural: "Conditions", singular: "condition" }), /No matching condition/);
});


test("reader and hover previews preserve rich blocks, nested references, safety and unique anchors", () => {
  const library = createRuleLibrary({ rules: [{
    name: "Example", source: "Avalon", entries: [
      { type: "list", columns: 2, style: "list-no-bullets", items: [
        { type: "item", style: "hanging", name: "First", entry: "Read {@rule Example}." },
        { type: "list", items: ["Nested item."] },
      ] },
      { type: "box", name: "Outer", entries: [
        { type: "box-section", name: "Inner", entries: ["Cast {@spell light}."] },
      ] },
      { type: "clarification", entries: ["A note about {@rule Example}."] },
      { type: "formula", entry: 'd20 + {@rule Example} <script>unsafe()</script> {@link Unsafe|javascript:bad()}' },
    ],
  }] });
  const preview = renderRulePreview("Example", "Avalon", library.registry);
  for (const html of [renderRuleBody(library.get("Avalon:example"), library), preview]) {
    for (const text of ["Nested item.", "Outer", "Inner", "A note about", "d20"]) assert.ok(html.includes(text));
    assert.match(html, /list-columns/);
    assert.match(html, /--list-columns: 2/);
    assert.match(html, /hanging-entry/);
    assert.match(html, /<details\b/);
    assert.match(html, /href="rules.html\?id=Avalon%3Aexample"/);
    assert.match(html, /<em>light<\/em>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>|javascript:|rule-link-unresolved/);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
  }
  assert.match(preview, /id="rule-preview-section-1"/);
  assert.match(preview, /id="rule-preview-section-2"/);
});

test("hover cards stay inside the viewport and move above the link when needed", () => {
  assert.deepEqual(previewPosition({ left: 50, top: 100, bottom: 120 }, { width: 300, height: 100 }, { width: 800, height: 600 }), { left: 50, top: 128 });
  assert.deepEqual(previewPosition({ left: 750, top: 500, bottom: 520 }, { width: 500, height: 200 }, { width: 800, height: 600 }), { left: 288, top: 292 });
  assert.deepEqual(previewPosition({ left: 0, top: 0, bottom: 10 }, { width: 296, height: 176 }, { width: 320, height: 200 }), { left: 12, top: 12 });
});

function environment(options = {}) {
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
      if (selectors.includes("[data-action-name]") && this.dataset.actionName) return this;
      if (selectors.includes("[data-condition-name]") && this.dataset.conditionName) return this;
      if (selectors.includes("[data-skill-name]") && this.dataset.skillName) return this;
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
  const controller = attachReferencePreviews({ document, window, registry, ...options });
  return { document, window, flush, link, controller, Element };
}

function actionLink(env, name = "Stride") {
  const link = new env.Element();
  link.dataset = { actionName: name, actionSource: "PC1" };
  link.setAttribute("href", actions.registry.resolve(name, "PC1").target.href);
  env.document.body.append(link);
  return link;
}

function conditionLink(env, name = "Blinded") {
  const link = new env.Element();
  link.dataset = { conditionName: name, conditionSource: "PC1" };
  link.setAttribute("href", `conditions.html?condition=${name}&source=PC1`);
  env.document.body.append(link);
  return link;
}

function skillLink(env, name = "Acrobatics") {
  const link = new env.Element();
  link.dataset = { skillName: name, skillSource: "PC1" };
  link.setAttribute("href", `skills.html?skill=${name}&source=PC1`);
  env.document.body.append(link);
  return link;
}

test("reader action links are checked once against the catalog before receiving an icon marker", async () => {
  let loads = 0;
  const env = environment({ loadActions: async () => { loads++; return actions; } });
  const makeLink = (name, source) => {
    const link = new env.Element();
    link.dataset = { actionName: name, actionSource: source };
    return link;
  };
  const valid = makeLink("Stride", "PC1"), missing = makeLink("Quick Draw", "PC1"), wrongSource = makeLink("Stride", "GMC"), sourceLess = makeLink("Aid", "");
  const root = { querySelectorAll: () => [valid, missing, wrongSource, sourceLess] };
  await env.controller.validateActions({ querySelectorAll: () => [] });
  assert.equal(loads, 0);
  assert.equal(valid.dataset.actionResolved, undefined);
  await env.controller.validateActions(root);
  assert.equal(valid.dataset.actionResolved, "true");
  assert.equal(sourceLess.dataset.actionResolved, "true");
  assert.equal(missing.dataset.actionResolved, "false");
  assert.equal(wrongSource.dataset.actionResolved, "false");
  await env.controller.validateActions(root);
  assert.equal(loads, 1);
  assert.equal(env.controller.panel.hidden, true);
});

test("unavailable action data leaves icons unconfirmed and a later validation can retry", async () => {
  let loads = 0;
  const env = environment({ loadActions: async () => { if (++loads === 1) throw Error("Offline"); return actions; } });
  const link = actionLink(env);
  const root = { querySelectorAll: () => [link] };
  await env.controller.validateActions(root);
  assert.equal(link.dataset.actionResolved, undefined);
  await env.controller.validateActions(root);
  assert.equal(link.dataset.actionResolved, "true");
  assert.equal(loads, 2);
});

test("action hover and keyboard focus use the shared panel without intercepting links", () => {
  const env = environment({ actions });
  const link = actionLink(env);
  const href = link.attributes.get("href");
  env.document.emit("pointerover", { target: link, pointerType: "mouse" });
  env.flush();
  assert.equal(env.controller.panel.hidden, false);
  assert.match(env.controller.panel.innerHTML, /<span>Actions<\/span>/);
  assert.equal(env.controller.panel.dataset.referenceKind, "action");
  env.document.emit("pointerout", { target: link });
  env.controller.panel.emit("pointerenter"); env.flush();
  assert.equal(env.controller.panel.hidden, false);
  link.focus();
  let prevented = false;
  env.document.emit("keydown", { key: "ArrowDown", altKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(env.document.activeElement, env.controller.panel);
  env.document.emit("keydown", { key: "Escape" });
  assert.equal(env.controller.panel.hidden, true);
  assert.equal(env.document.activeElement, link);
  assert.equal(link.attributes.get("href"), href);
  assert.equal(link.attributes.get("aria-controls"), undefined);
  env.controller.show(env.link);
  assert.equal(env.controller.panel.dataset.referenceKind, "rule");
});

test("condition and skill links show shared hover previews without changing their destinations", () => {
  const env = environment({ conditions });
  const link = conditionLink(env), href = link.attributes.get("href");
  env.document.emit("pointerover", { target: link, pointerType: "mouse" });
  env.flush();
  assert.equal(env.controller.panel.hidden, false);
  assert.equal(env.controller.panel.dataset.referenceKind, "condition");
  assert.match(env.controller.panel.innerHTML, /You cannot see/);
  assert.equal(link.attributes.get("href"), href);

  const skillEnv = environment({ skills });
  const skill = skillLink(skillEnv), skillHref = skill.attributes.get("href");
  skillEnv.document.emit("pointerover", { target: skill, pointerType: "mouse" });
  skillEnv.flush();
  assert.equal(skillEnv.controller.panel.dataset.referenceKind, "skill");
  assert.match(skillEnv.controller.panel.innerHTML, /Keep your balance/);
  assert.equal(skill.attributes.get("href"), skillHref);
});

test("action previews work without a rule library, including on the Actions page", () => {
  const env = environment({ actions, registry: undefined });
  const link = actionLink(env);
  link.focus();
  assert.equal(env.controller.panel.hidden, false);
  assert.match(env.controller.panel.innerHTML, /Move up to your Speed/);
  env.document.emit("pointerdown", { target: env.document.body });
  assert.equal(env.controller.panel.hidden, true);
});

test("action data loads on first action hover, once, and stale results cannot replace the current preview", async () => {
  let loads = 0, resolve;
  const loading = new Promise(done => { resolve = done; });
  const env = environment({ loadActions() { loads++; return loading; } });
  env.controller.show(env.link);
  assert.equal(loads, 0);
  const first = actionLink(env), second = actionLink(env, "Aid");
  const pendingFirst = env.controller.show(first);
  assert.match(env.controller.panel.innerHTML, /Loading action/);
  const pendingSecond = env.controller.show(second);
  resolve(actions);
  await Promise.all([pendingFirst, pendingSecond]);
  assert.equal(loads, 1);
  assert.match(env.controller.panel.innerHTML, /<h2 id="rule-preview-title">Aid<\/h2>/);
  assert.match(env.controller.panel.innerHTML, /data-symbol="r"/);
  env.controller.show(first);
  assert.match(env.controller.panel.innerHTML, /Move up to your Speed/);
  assert.equal(loads, 1);
});

test("an action load failure keeps navigation usable and retries on another hover", async () => {
  let loads = 0;
  const env = environment({ loadActions() { if (++loads === 1) return Promise.reject(new Error("Unavailable")); return Promise.resolve(actions); } });
  const link = actionLink(env);
  await env.controller.show(link);
  assert.match(env.controller.panel.innerHTML, /Unable to load this preview/);
  assert.ok(link.attributes.get("href").startsWith("actions.html?"));
  env.controller.hide();
  await env.controller.show(link);
  assert.equal(loads, 2);
  assert.match(env.controller.panel.innerHTML, /Move up to your Speed/);
});

test("the default loader fetches the local action catalog once and leaves rule previews independent", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async path => {
    requests.push(path);
    return { ok: true, json: async () => ({ sources: [{ id: "PC1", name: "Player Core" }], actions: actions.actions.map(action => action.entry) }) };
  };
  const env = environment();
  env.controller.show(env.link);
  assert.deepEqual(requests, []);
  const pending = env.controller.show(actionLink(env));
  assert.equal(env.controller.panel.attributes.get("aria-busy"), "true");
  await pending;
  assert.deepEqual(requests, ["data/actions.json"]);
  assert.equal(env.controller.panel.attributes.get("aria-busy"), "false");
  assert.match(env.controller.panel.innerHTML, /Move up to your Speed/);
  env.controller.show(actionLink(env, "Aid"));
  assert.deepEqual(requests, ["data/actions.json"]);
  assert.match(env.controller.panel.innerHTML, /Help the ally/);
});

test("finishing an action load after dismissal cannot reopen the popup", async () => {
  let resolve;
  const env = environment({ loadActions: () => new Promise(done => { resolve = done; }) });
  const pending = env.controller.show(actionLink(env));
  await Promise.resolve();
  env.controller.destroy();
  resolve(actions); await pending;
  assert.equal(env.controller.panel.hidden, true);
  assert.equal(env.document.body.children.includes(env.controller.panel), false);
});

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

test("hovering a focused rule link preserves an expanded clarification in its open preview", () => {
  const { document, link, controller, flush } = environment();
  link.focus();
  assert.equal(controller.panel.hidden, false);
  assert.match(controller.panel.innerHTML, /<details class="paizo-clarification">/);
  controller.panel.innerHTML = controller.panel.innerHTML.replace('<details class="paizo-clarification">', '<details class="paizo-clarification" open>');
  const expanded = controller.panel.innerHTML;
  document.emit("pointerover", { target: link, pointerType: "mouse" });
  flush();
  assert.equal(controller.panel.innerHTML, expanded);
  controller.hide();
  controller.show(link);
  assert.match(controller.panel.innerHTML, /<details class="paizo-clarification">/);
});

test("keyboard focus and Escape work without stealing focus or blocking navigation", () => {
  const { document, link, controller } = environment();
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

test("ambiguous rule previews explain the unresolved reference without a chooser or guessing", () => {
  const library = createRuleLibrary({ rules: [
    { name: "Areas", source: "PC1", page: 300, entries: ["Spell text."] },
    { name: "Areas", source: "PC1", page: 426, entries: ["General text."] },
  ] });
  const env = environment({ registry: library.registry });
  const link = new env.Element();
  link.dataset = { ruleName: "Areas", ruleSource: "" };
  env.document.body.append(link);
  env.controller.show(link);
  const html = env.controller.panel.innerHTML;
  assert.match(html, /matches more than one rule/);
  assert.doesNotMatch(html, /data-select-rule=|rule-match-options|Spell text|General text/);
  env.document.emit("keydown", { key: "Escape" });
  assert.equal(env.controller.panel.hidden, true);
});
