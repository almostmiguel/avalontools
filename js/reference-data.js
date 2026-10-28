import { escapeHtml } from "./content-renderer.js";

// Share concurrent requests within a reader; retry after failure without a global cache.
export function createLazyResource(initialValue, loader) {
  let value = initialValue, pending;
  return {
    get current() { return value; },
    load() {
      if (value != null) return Promise.resolve(value);
      if (!pending) pending = Promise.resolve().then(loader).then(result => {
        value = result;
        return result;
      }).catch(error => { pending = undefined; throw error; });
      return pending;
    },
  };
}

export async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  try { return await response.json(); }
  catch { throw new Error(`${path} is not valid JSON. Check its commas and brackets.`); }
}

// A source keeps its color regardless of list order, filtering, or selection.
export function sourceTone(source) {
  return [...String(source || "").toUpperCase()].reduce((tone, char) => (tone + char.codePointAt(0)) % 6, 0);
}

export function renderReferenceCitation(rule) {
  if (rule.setting === "original") return '<span class="rule-citation">Avalon original</span>';
  const prefix = rule.setting === "modified" ? "Adapted from " : "";
  const page = rule.page ? ` · p. ${rule.page}` : "";
  return `<span class="rule-citation">${prefix}<span class="source-color" data-source-tone="${sourceTone(rule.sourceId)}">${escapeHtml(rule.sourceName)}</span>${page}</span>`;
}
