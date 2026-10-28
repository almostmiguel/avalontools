// Assemble complete chapters without repeating their indexed descendants.
import { escapeHtml } from "./content-renderer.js";
import { renderRuleContent, renderRuleOutline, chapterKey, RULE_KINDS } from "./rule-library.js";
import { renderReferenceCitation } from "./reference-data.js";

export function findChapter(library, sourceId, title) {
  const rules = library.authoredRules.filter(rule => rule.sourceId.toLowerCase() === String(sourceId).toLowerCase() && rule.chapter === title);
  const authored = library.chapters.find(chapter => chapter.sourceId.toLowerCase() === String(sourceId).toLowerCase() && chapter.title === title);
  if ((!rules.length && !authored) || !title) return null;
  const source = authored || rules[0];
  const members = new Set(rules.map(rule => rule.id));
  return {
    ...authored, key: chapterKey(source.sourceId, title), sourceId: source.sourceId, sourceName: source.sourceName, title, rules,
    roots: rules.filter(rule => !members.has(rule.parentId)),
  };
}

export function renderChapter(chapter, library) {
  const headings = [];
  const represented = new Set();
  const headingTargets = new WeakMap();
  // Descendants already render inside their parent; sections assigned to another chapter render there.
  const prune = value => {
    if (Array.isArray(value)) return value.map(prune).filter(item => item !== undefined);
    if (!value || typeof value !== "object") return value;
    const rule = library.fromEntry(value);
    if (rule && (rule.sourceId !== chapter.sourceId || rule.chapter !== chapter.title)) return undefined;
    const copy = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, prune(item)]));
    if (rule) { represented.add(rule.id); headingTargets.set(copy, rule); }
    return copy;
  };
  let authoredContent = "";
  if (chapter.entry) {
    const content = renderRuleContent({ ...chapter, entry: prune(chapter.entry) }, library, {
      anchorPrefix: "chapter-section", headingLink: entry => headingTargets.get(entry),
    });
    headings.push(...content.headings);
    authoredContent = '<div class="rich-content rule-page-content">' + content.html + '</div>';
  }
  const sections = chapter.roots.filter(rule => !represented.has(rule.id)).map(rule => {
    const id = "chapter-rule-" + rule.order;
    const content = renderRuleContent({ ...rule, entry: prune(rule.entry) }, library, { anchorPrefix: id + "-section", headingOffset: 1 });
    headings.push({ id, name: rule.name, level: 3, outline: true }, ...content.headings);
    return '<section class="chapter-rule" aria-labelledby="' + id + '"><header class="chapter-rule-heading"><h3 id="' + id + '"><a href="' + escapeHtml(rule.href) + '" data-select-rule="' + escapeHtml(rule.id) + '">' + escapeHtml(rule.name) + '</a></h3><p class="rule-page-source">' + renderReferenceCitation(rule) + '</p></header><div class="rich-content rule-page-content">' + content.html + "</div></section>";
  }).join("\n");
  const kind = Object.hasOwn(RULE_KINDS, chapter.kind) ? chapter.kind : "core";
  return '<header class="rule-page-heading"><div class="rule-title-row"><h2 id="rule-detail-title">' + escapeHtml(chapter.title) + '</h2></div><div class="rule-meta-row"><p class="rule-page-source">' + renderReferenceCitation(chapter) + '<span class="rule-meta-kind rule-kind--' + kind + '">' + RULE_KINDS[kind] + '</span></p><div class="rule-reader-tools">' + renderRuleOutline(headings) + '</div></div></header><article class="chapter-reader">' + authoredContent + sections + "</article>";
}
