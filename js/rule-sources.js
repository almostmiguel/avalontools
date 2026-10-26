import { escapeHtml } from "./content-renderer.js";

// A source keeps its color regardless of list order, filtering, or selection.
export function sourceTone(source) {
  return [...String(source || "").toUpperCase()].reduce((tone, char) => (tone + char.codePointAt(0)) % 6, 0);
}

export function renderRuleCitation(rule) {
  if (rule.setting === "original") return '<span class="rule-citation">Avalon original</span>';
  const prefix = rule.setting === "modified" ? "Adapted from " : "";
  const page = rule.page ? ` · p. ${rule.page}` : "";
  return `<span class="rule-citation">${prefix}<span class="source-color" data-source-tone="${sourceTone(rule.sourceId)}">${escapeHtml(rule.sourceName)}</span>${page}</span>`;
}
