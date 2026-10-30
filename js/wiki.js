// Articles, navigation, contents and backlinks are already present in the HTML.
import { attachReferencePreviews } from "./reference-previews.js";

const fold = value => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function legacyWikiUrl(location, base, routes = {}) {
  const url = new URL(location.href);
  if (!url.pathname.endsWith("/setting.html")) return null;
  let path;
  if (url.searchParams.has("article")) path = routes[fold(url.searchParams.get("article"))];
  else if (/^[a-z0-9-]+$/.test(url.searchParams.get("category") || "")) path = `setting/category-${url.searchParams.get("category")}.html`;
  else if (url.searchParams.has("view") || url.searchParams.has("q")) path = "setting/articles.html";
  if (!path) return null;
  const target = new URL(path, base);
  if (url.searchParams.has("q")) target.searchParams.set("q", url.searchParams.get("q"));
  target.hash = url.hash;
  return target;
}

export function filterWikiCards(cards, query) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  let count = 0;
  for (const card of cards) {
    card.hidden = !terms.every(term => fold(card.dataset.wikiName).includes(term));
    if (!card.hidden) count++;
  }
  return count;
}

export function mountWiki({ document, window, previews = attachReferencePreviews({ document, window }) }) {
  const content = document.querySelector("#wiki-content"), menu = document.querySelector("#wiki-menu");
  const mobile = window.matchMedia?.("(max-width: 720px)");
  const layoutChanged = () => { menu.open = !mobile?.matches; };
  layoutChanged(); mobile?.addEventListener("change", layoutChanged);
  const search = document.querySelector("#wiki-search"), form = document.querySelector("#wiki-search-form");
  const results = document.querySelector('[data-wiki-searchable="true"]');
  const cards = results ? [...results.querySelectorAll("[data-wiki-name]")] : [];
  const filter = () => {
    const count = filterWikiCards(cards, search.value);
    document.querySelector("#wiki-result-count").textContent = `${count} ${count === 1 ? "article" : "articles"}`;
    document.querySelector("#wiki-results-title").textContent = search.value.trim() ? `Results for “${search.value.trim()}”` : "All articles";
    document.querySelector("#wiki-no-results").hidden = count !== 0;
    results.hidden = count === 0;
  };
  const changed = () => {
    const url = new URL(window.location.href);
    if (search.value) url.searchParams.set("q", search.value); else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    filter();
  };
  const submitted = event => { event.preventDefault(); changed(); content.focus({ preventScroll: true }); };
  const popped = () => { search.value = new URL(window.location.href).searchParams.get("q") || ""; filter(); };
  if (results) {
    popped(); search.addEventListener("input", changed); form.addEventListener("submit", submitted); window.addEventListener("popstate", popped);
  }
  void previews.validateActions(content);
  return { destroy() {
    mobile?.removeEventListener("change", layoutChanged);
    search.removeEventListener("input", changed); form.removeEventListener("submit", submitted); window.removeEventListener("popstate", popped); previews.destroy();
  } };
}

if (typeof document !== "undefined" && document.body.dataset.page === "setting") {
  const routes = JSON.parse(document.querySelector("#wiki-legacy-routes")?.textContent || "{}");
  const target = legacyWikiUrl(window.location, document.baseURI, routes);
  if (target) window.location.replace(target.href);
  else mountWiki({ document, window });
}
