import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { renderChapter, renderHeadingControls } from "../js/book-renderer.js";
import { attachReaderControls, renderContents } from "../js/reader-controls.js";

test("interactive headings show real or inherited pages and control only their own bodies", () => {
  const chapter = { page: 5, entries: [
    { type: "h1", name: "Parent", entries: [
      "Parent text.", { type: "h2", name: "Child", page: 8, entries: ["Child text."] },
    ] },
    { type: "box", name: "Note", entries: ["A note."] },
    { type: "list", name: "Checklist", items: ["One."] },
    { type: "h4", name: "Bad page", page: "<script>", entries: ["Text."] },
  ] };
  const plain = renderChapter(chapter);
  const rendered = renderChapter(chapter, { interactive: true });
  assert.deepEqual(rendered.headings, plain.headings);
  assert.deepEqual(rendered.headings.map(h => h.page), [5, 8, 5, 5, null]);
  assert.equal((rendered.html.match(/class="heading-page"/g) || []).length, 4);
  for (const heading of rendered.headings) {
    assert.ok(rendered.html.includes(`aria-controls="${heading.id}-content"`));
    assert.ok(rendered.html.includes(`id="${heading.id}-content"`));
    assert.ok(rendered.html.includes(`aria-label="Collapse ${heading.name}"`));
  }
  assert.match(rendered.html, /class="rule-box-content section-body"/);
  assert.doesNotMatch(plain.html, /data-section-toggle|section-body/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.doesNotMatch(renderHeadingControls("id", 'A "title"', null), /heading-page/);
  assert.match(renderHeadingControls("id", 'A "title"', 12), /p\. 12/);
  assert.match(renderHeadingControls("id", 'A "title"', 12), /A &quot;title&quot;/);
});

test("overview builds expandable h1–h2 groups, excludes lower levels, and escapes titles", () => {
  const headings = [
    { id: "a", name: "Main", tocLevel: 1 },
    { id: "b", name: "Sub", tocLevel: 2 },
    { id: "hidden-third", name: "Hidden third-level", tocLevel: 3 },
    { id: "c", name: "Next", tocLevel: 1 },
    { id: "d", name: "{@i <unsafe>}", tocLevel: 2 },
    { id: "e", name: "Hidden", tocLevel: 4 },
  ];
  const html = renderContents(headings);
  assert.equal((html.match(/class="toc-branch"/g) || []).length, 2);
  assert.match(html, /href="#a">Main<\/a><\/summary><ol[^>]*><li class="toc-h2"/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /Hidden|<unsafe>|<em>/);
  assert.equal(renderContents([]), "");
});

test("overview leaves reserve the same toggle gutter and text padding as expandable siblings", async () => {
  const html = renderContents([
    { id: "parent", name: "Parent", tocLevel: 1 },
    { id: "child", name: "Child", tocLevel: 2 },
    { id: "leaf", name: "Sibling without children", tocLevel: 1 },
  ]);
  assert.match(html, /class="toc-h1"><details class="toc-branch" open><summary><a href="#parent"/);
  assert.match(html, /class="toc-h1"><a href="#leaf">Sibling without children<\/a><\/li>/);
  const css = await readFile(new URL("../css/site.css", import.meta.url), "utf8");
  assert.match(css, /\.contents \{ --toc-toggle-space: 1\.35rem;/);
  assert.match(css, /grid-template-columns: var\(--toc-toggle-space\) minmax\(0, 1fr\)/);
  assert.match(css, /\.contents \.section-links > li > a, \.contents-tree > ol > li > a \{ margin-left: var\(--toc-toggle-space\); \}/);
  for (const level of [1, 2, 3]) {
    const leaf = css.match(new RegExp(`\\.toc-h${level} > a \\{([^}]+)\\}`))[1];
    const branch = css.match(new RegExp(`\\.toc-h${level} > details > summary > a \\{([^}]+)\\}`))[1];
    assert.match(leaf, /padding-left: \.6rem/);
    assert.match(branch, /padding-left: \.6rem/);
  }
  assert.match(css, /\.section-links \.section-links \{[^}]+border-left: 1px solid var\(--line\)/);
});

class Element {
  constructor(tagName = "DIV", attributes = {}) {
    this.tagName = tagName;
    this.attributes = attributes;
    this.id = attributes.id;
    this.dataset = {};
    this.children = [];
    this.handlers = new Map();
    this.hidden = false;
    this.open = true;
    this.classList = { contains: name => (attributes.class || "").split(" ").includes(name) };
  }
  append(child) { child.parentElement = this; this.children.push(child); return child; }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = value; }
  matches(selector) {
    return selector.split(", ").some(part => part.startsWith(".") ? this.classList.contains(part.slice(1)) : part === 'a[href^="#"]' ? this.tagName === "A" && this.attributes.href?.startsWith("#") : part === "span" ? this.tagName === "SPAN" : Object.hasOwn(this.attributes, part.slice(1, -1)));
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  removeEventListener(type) { this.handlers.delete(type); }
  emit(type, target = this) { this.handlers.get(type)?.({ target }); }
  scrollIntoView() { this.scrolled = true; }
}

function environment() {
  const root = new Element();
  const reader = root.append(new Element());
  const heading = reader.append(new Element("H1", { id: "chapter-title" }));
  const button = (parent, id, name) => {
    const toggle = parent.append(new Element("BUTTON", { "data-section-toggle": "", "aria-controls": `${id}-content`, "aria-expanded": "true" }));
    toggle.dataset.sectionName = name;
    toggle.append(new Element("SPAN"));
    return toggle;
  };
  const chapterToggle = button(reader, "chapter-title", "Chapter");
  const chapter = reader.append(new Element("ARTICLE", { id: "chapter-title-content", class: "section-body" }));
  const parent = chapter.append(new Element("H2", { id: "parent" }));
  const parentToggle = button(parent, "parent", "Parent");
  const parentBody = chapter.append(new Element("DIV", { id: "parent-content", class: "section-body" }));
  const child = parentBody.append(new Element("H3", { id: "child" }));
  const childToggle = button(child, "child", "Child");
  const childBody = parentBody.append(new Element("DIV", { id: "child-content", class: "section-body" }));
  const contents = root.append(new Element());
  const collapse = contents.append(new Element("BUTTON", { "data-toc-action": "" }));
  collapse.dataset.tocAction = "collapse";
  const expand = contents.append(new Element("BUTTON", { "data-toc-action": "" }));
  expand.dataset.tocAction = "expand";
  const tree = contents.append(new Element("SECTION", { class: "contents-tree" }));
  const chapterBranch = tree.append(new Element("DETAILS", { class: "toc-chapter" }));
  const branch = chapterBranch.append(new Element("DETAILS", { class: "toc-branch" }));
  const link = branch.append(new Element("A", { href: "#child" }));
  const document = { getElementById: id => root.querySelectorAll("[id]").find(element => element.id === id) };
  const window = new Element();
  window.location = { hash: "" };
  const controller = attachReaderControls({ document, window, reader, contents });
  return { reader, contents, window, controller, heading, chapterToggle, chapter, parentToggle, parentBody, childToggle, childBody, collapse, expand, tree, chapterBranch, branch, link };
}

test("section controls fold independently and preserve child state when a parent reopens", () => {
  const page = environment();
  page.reader.emit("click", page.childToggle.children[0]);
  assert.equal(page.childBody.hidden, true);
  assert.equal(page.childToggle.getAttribute("aria-expanded"), "false");
  assert.equal(page.childToggle.getAttribute("aria-label"), "Expand Child");
  assert.equal(page.childToggle.children[0].textContent, "+");
  page.reader.emit("click", page.parentToggle);
  assert.equal(page.parentBody.hidden, true);
  page.reader.emit("click", page.parentToggle);
  assert.equal(page.parentBody.hidden, false);
  assert.equal(page.childBody.hidden, true);
  page.reader.emit("click", page.chapterToggle);
  assert.equal(page.chapter.hidden, true);
  page.controller.reveal("chapter-title");
  assert.equal(page.chapter.hidden, false);
});

test("overview links and hash navigation reopen the target and all folded ancestors", () => {
  const page = environment();
  for (const button of [page.childToggle, page.parentToggle, page.chapterToggle]) page.reader.emit("click", button);
  page.chapterBranch.open = page.branch.open = false;
  page.contents.emit("click", page.link);
  for (const body of [page.childBody, page.parentBody, page.chapter]) assert.equal(body.hidden, false);
  for (const branch of [page.chapterBranch, page.branch]) assert.equal(branch.open, true);
  page.reader.emit("click", page.childToggle);
  page.window.location.hash = "#child";
  page.window.emit("hashchange");
  assert.equal(page.childBody.hidden, false);
  assert.equal(page.childToggle.parentElement.scrolled, true);
  assert.doesNotThrow(() => page.controller.reveal("not-found"));
});

test("overview collapse/expand all leaves book text alone and listeners can be removed", () => {
  const page = environment();
  page.contents.emit("click", page.collapse);
  assert.equal(page.chapterBranch.open, false);
  assert.equal(page.branch.open, false);
  assert.equal(page.childBody.hidden, false);
  page.contents.emit("click", page.expand);
  assert.equal(page.tree.tagName, "SECTION");
  assert.equal(page.tree.hidden, false);
  assert.equal(page.branch.open, true);
  page.controller.destroy();
  assert.equal(page.reader.handlers.size, 0);
  assert.equal(page.contents.handlers.size, 0);
  assert.equal(page.window.handlers.size, 0);
});
