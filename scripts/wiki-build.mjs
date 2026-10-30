import { readFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { escapeHtml, inlineText, renderIcon, renderInline } from "../js/content-renderer.js";

const projectRoot = new URL("../", import.meta.url);
export const fold = value => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const compare = new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare;
const href = ({ article, category } = {}) => article ? `setting/${article}.html` : category ? `setting/category-${category}.html` : "setting/articles.html";
const articleLink = article => `<a class="wiki-link" href="${escapeHtml(article.href)}">${escapeHtml(article.name)}</a>`;

export function createWiki(metadata, documents) {
  const categories = new Map();
  for (const category of metadata.categories || []) {
    if (!/^[a-z0-9-]+$/.test(category.id) || !category.name || categories.has(category.id)) throw new Error("Invalid or duplicate wiki category.");
    categories.set(category.id, category);
  }
  const byId = new Map(), byName = new Map(), outputs = new Set(["setting/articles.html", ...[...categories.keys()].map(category => href({ category }))]);
  const articles = documents.map(({ id, data, content }) => {
    if (!/^[a-z0-9-]+$/.test(id) || !data.title || !categories.has(data.category) || byId.has(id) || byName.has(fold(data.title)) || outputs.has(href({ article: id }))) throw new Error(`Invalid or duplicate wiki article: ${id}`);
    const article = { ...data, id, name: data.title, markdown: content, href: href({ article: id }), status: data.draft ? "draft" : "" };
    byId.set(id, article); byName.set(fold(article.name), article); outputs.add(article.href);
    return article;
  }).sort((a, b) => compare(a.name, b.name));
  const wiki = { title: metadata.title || "The Avalon Atlas", description: metadata.description || "", categories, articles, byId,
    resolve(name) { const target = byId.get(name) || byName.get(fold(name)); return { status: target ? "found" : "missing", target }; },
    backlinks: new Map(articles.map(article => [article.id, new Set()])),
  };
  const markdown = new MarkdownIt({ html: false });
  markdown.core.ruler.after("inline", "atlas-links", state => {
    for (const block of state.tokens) for (const token of block.children || []) {
      if (token.type !== "link_open") continue;
      const link = token.attrGet("href") || "";
      const internal = /^(?:\.\/)?([a-z0-9-]+)\.md([?#].*)?$/.exec(link) || /^setting\/([a-z0-9-]+)\.html([?#].*)?$/.exec(link);
      if (!internal) {
        if (/\.md(?:[?#]|$)/.test(link) && !/^[a-z][a-z0-9+.-]*:/i.test(link)) throw new Error(`${state.env.article?.id}: unknown Markdown article path "${link}"`);
        continue;
      }
      const target = byId.get(internal[1]);
      if (!target) throw new Error(`${state.env.article?.id}: unknown article "${internal[1]}"`);
      token.attrSet("href", target.href + (internal[2] || ""));
      token.attrJoin("class", "wiki-link"); state.env.article?.outgoing.add(target.id);
    }
  });
  markdown.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
  markdown.renderer.rules.table_close = () => '</table></div>\n';
  markdown.renderer.rules.heading_open = (tokens, index, options, _env, renderer) => {
    const alias = tokens[index].meta?.legacyId;
    return (alias ? `<span id="${alias}" class="wiki-anchor-alias" aria-hidden="true"></span>` : "") + renderer.renderToken(tokens, index, options);
  };
  // Let Markdown handle prose and code; expand wiki/game references only in inline text.
  markdown.inline.ruler.before("escape", "avalon-reference", (state, silent) => {
    const rest = state.src.slice(state.pos);
    const wikiLink = /^\[\[([^\]\n]+)\]\]/.exec(rest);
    let raw, consumed;
    if (wikiLink) {
      const [name, ...label] = wikiLink[1].split("|");
      raw = `{@wiki ${name.trim()}${label.length ? `||${label.join("|")}` : ""}}`; consumed = wikiLink[0].length;
    } else if (rest.startsWith("{@")) {
      let depth = 1, end = 2;
      for (; end < rest.length && depth; end++) { if (rest[end] === "{") depth++; if (rest[end] === "}") depth--; }
      if (depth) return false;
      raw = rest.slice(0, end); consumed = end;
    } else return false;
    if (!silent) {
      const token = state.push("html_inline", "", 0);
      token.content = renderInline(raw, { resolveWiki(name) {
        const result = wiki.resolve(name);
        if (!result.target) throw new Error(`${state.env.article?.id || "Wiki"}: unknown article "${name}"`);
        state.env.article?.outgoing.add(result.target.id);
        return result;
      } });
    }
    state.pos += consumed;
    return true;
  });
  const renderInlineMarkdown = (value, article) => markdown.renderInline(String(value || ""), { article });
  for (const article of articles) {
    article.outgoing = new Set(); article.headings = [];
    const environment = { article }, tokens = markdown.parse(article.markdown, environment);
    const ids = new Set(["main", "navigation", "wiki-content", "wiki-page", "wiki-toc", ...tokens.filter(token => token.type === "heading_open").map((_token, index) => `wiki-${article.id}-${index + 1}`)]);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type !== "heading_open") continue;
      const level = Number(token.tag.slice(1));
      if (level === 1) throw new Error(`${article.id}: put the article title in front matter and start body headings at ##.`);
      const label = (tokens[index + 1]?.children || []).map(child => child.type === "html_inline" ? inlineText(child.content.replace(/<[^>]+>/g, "")) : child.type === "text" || child.type === "code_inline" ? child.content : "").join("");
      const stem = fold(label).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
      let id = stem, count = 1;
      while (ids.has(id)) id = `${stem}-${++count}`;
      ids.add(id);
      token.attrSet("id", id); token.attrSet("data-heading-level", String(level));
      token.meta = { ...token.meta, legacyId: `wiki-${article.id}-${article.headings.length + 1}` };
      article.headings.push({ id, name: label, level });
    }
    article.html = markdown.renderer.render(tokens, markdown.options, environment);
    article.facts = (article.facts || []).map(fact => ({ label: fact.label, html: renderInlineMarkdown(fact.value, article) }));
  }
  for (const article of articles) for (const id of article.outgoing) if (id !== article.id) wiki.backlinks.get(id).add(article);
  wiki.pages = [{ output: "setting.html", type: "home", title: wiki.title }, { output: "setting/articles.html", type: "index", title: "All articles" },
    ...[...categories.values()].map(category => ({ output: href({ category: category.id }), type: "category", category: category.id, title: category.name })),
    ...articles.map(article => ({ output: article.href, type: "article", article: article.id, title: article.name }))];
  return wiki;
}

export async function loadWiki(directory = new URL("content/setting/", projectRoot)) {
  const metadata = JSON.parse(await readFile(new URL("atlas.json", directory), "utf8"));
  const articleDirectory = new URL("articles/", directory);
  const files = (await readdir(articleDirectory)).filter(name => name.endsWith(".md")).sort();
  const documents = await Promise.all(files.map(async file => ({ id: basename(file, ".md"), ...matter(await readFile(new URL(file, articleDirectory), "utf8")) })));
  return createWiki(metadata, documents);
}

export function searchWiki(wiki, query = "", category = "") {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return wiki.articles.filter(article => (!category || article.category === category) && terms.every(term => fold(article.name).includes(term)));
}

const status = article => article.draft ? '<span class="wiki-draft">Draft</span>' : "";
const articleCount = count => `${count} ${count === 1 ? "article" : "articles"}`;
const card = (article, wiki) => `<a class="wiki-entry" data-wiki-name="${escapeHtml(fold(article.name))}" href="${article.href}"><span class="wiki-entry-category">${escapeHtml(wiki.categories.get(article.category).name)} ${status(article)}</span><strong>${escapeHtml(article.name)}</strong><p>${escapeHtml(article.summary || "")}</p><span class="wiki-entry-arrow" aria-hidden="true">↗</span></a>`;

export function renderWikiHome(wiki) {
  const first = wiki.byId.get("avalon") || wiki.articles[0];
  return `<header class="wiki-welcome"><p class="eyebrow">A living world, one story at a time</p><h1>${escapeHtml(wiki.title)}</h1><p class="wiki-lead">${escapeHtml(wiki.description)}</p><div class="wiki-welcome-bottom"><a class="wiki-primary" href="${first?.href || href()}">Begin exploring ${renderIcon("chevron-right")}</a><span>${articleCount(wiki.articles.length)} · ${wiki.categories.size} collections</span></div><div class="wiki-compass" aria-hidden="true">${renderIcon("map")}</div></header><section aria-labelledby="collections-title"><div class="wiki-section-heading"><h2 id="collections-title">Explore the atlas</h2><a href="${href()}">All articles ${renderIcon("chevron-right")}</a></div><div class="wiki-category-grid">${[...wiki.categories.values()].map(category => `<a class="wiki-category-card" href="${href({ category: category.id })}">${renderIcon(category.icon)}<div><h3>${escapeHtml(category.name)}</h3><p>${escapeHtml(category.description)}</p><span>${articleCount(searchWiki(wiki, "", category.id).length)}</span></div></a>`).join("")}</div></section><section aria-labelledby="starting-title"><div class="wiki-section-heading"><h2 id="starting-title">A few threads to follow</h2></div><div class="wiki-entry-grid">${wiki.articles.filter(article => article !== first).slice(0, 3).map(article => card(article, wiki)).join("")}</div></section>${wiki.articles.some(article => article.sample) ? '<p class="wiki-starter-note">These draft entries are examples for the new atlas, ready to be replaced with Avalon\'s own lore.</p>' : ""}`;
}

export function renderWikiIndex(wiki, category = "") {
  const collection = wiki.categories.get(category), articles = searchWiki(wiki, "", category);
  return `<header class="wiki-index-heading"><p class="eyebrow">Browse the atlas</p><h1 id="wiki-results-title">${escapeHtml(collection?.name || "All articles")}</h1><p class="wiki-lead">${escapeHtml(collection?.description || "Follow a name. Discover how the stories connect.")}</p><p id="wiki-result-count" class="wiki-result-count" role="status">${articleCount(articles.length)}</p></header><div class="wiki-entry-grid" id="wiki-results"${category ? "" : ' data-wiki-searchable="true"'}>${articles.map(article => card(article, wiki)).join("")}</div><div id="wiki-no-results" class="wiki-empty"${articles.length ? " hidden" : ""}><h2>No articles found</h2><p>Try another name or browse a different collection.</p><a href="${href()}">Browse all articles</a></div>`;
}

export function renderWikiArticle(wiki, article) {
  const facts = article.facts.length ? `<aside class="wiki-infobox" aria-label="${escapeHtml(article.name)} at a glance"><div>${renderIcon(wiki.categories.get(article.category).icon)}<strong>At a glance</strong></div><dl>${article.facts.map(fact => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${fact.html}</dd></div>`).join("")}</dl></aside>` : "";
  const incoming = [...wiki.backlinks.get(article.id)].sort((a, b) => compare(a.name, b.name));
  const peers = wiki.articles.filter(other => other.category === article.category && other !== article);
  return `<article class="wiki-article"><header class="wiki-article-heading"><div class="wiki-article-meta"><a href="${href({ category: article.category })}">${escapeHtml(wiki.categories.get(article.category).name)}</a>${status(article)}</div><h1>${escapeHtml(article.name)}</h1><p class="wiki-lead">${escapeHtml(article.summary || "")}</p></header>${article.sample ? '<p class="wiki-sample-note">Sample entry · This draft illustrates the atlas and is not established setting lore.</p>' : ""}<div class="wiki-prose rich-content">${facts}${article.html}</div><footer class="wiki-article-footer"><section><h2>What links here</h2>${incoming.length ? `<ul>${incoming.map(other => `<li>${articleLink(other)}</li>`).join("")}</ul>` : '<p class="muted">No other articles link here yet.</p>'}</section>${peers.length ? `<section><h2>In this collection</h2><ul>${peers.map(other => `<li>${articleLink(other)}</li>`).join("")}</ul></section>` : ""}<a class="wiki-back" href="${href()}">← Back to all articles</a></footer></article>`;
}

export async function renderWikiPage(wiki, page) {
  const home = await readFile(new URL("index.html", projectRoot), "utf8");
  const header = home.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0].replace('href="setting.html" data-reference-kind="setting"', 'href="setting.html" data-reference-kind="setting" aria-current="page"');
  const article = wiki.byId.get(page.article), category = wiki.categories.get(article?.category || page.category);
  const navigation = `<a href="setting.html"${page.type === "home" ? ' aria-current="page"' : ""}>${renderIcon("map")}<span>Atlas home</span></a><a href="${href()}"${page.type === "index" ? ' aria-current="page"' : ""}>${renderIcon("book-open")}<span>All articles</span><small>${wiki.articles.length}</small></a><p class="wiki-nav-label">Collections</p>${[...wiki.categories.values()].map(item => `<a href="${href({ category: item.id })}"${category?.id === item.id ? ' aria-current="page"' : ""}>${renderIcon(item.icon)}<span>${escapeHtml(item.name)}</span><small>${searchWiki(wiki, "", item.id).length}</small></a>`).join("")}`;
  const breadcrumb = `<a href="setting.html">Setting</a><span>/</span>${article ? `<a href="${href({ category: category.id })}">${escapeHtml(category.name)}</a><span>/</span>` : ""}<span aria-current="page">${escapeHtml(page.type === "home" ? "Atlas" : page.title)}</span>`;
  const contents = article?.headings.length ? `<p class="wiki-nav-label">On this page</p><nav aria-label="Article contents"><a href="${page.output}#wiki-content">Beginning</a>${article.headings.map(heading => `<a href="${page.output}#${heading.id}" data-depth="${heading.level}">${escapeHtml(heading.name)}</a>`).join("")}</nav>` : '<p class="wiki-nav-label">The atlas</p><p class="wiki-margin-note">A name leads to a place.<br>A place leads to a story.</p>';
  const body = article ? renderWikiArticle(wiki, article) : page.type === "home" ? renderWikiHome(wiki) : renderWikiIndex(wiki, page.category);
  return `<!doctype html>
<html lang="en" data-theme="dark"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  ${page.output.includes("/") ? '<base href="../">' : ""}
  <meta name="description" content="${escapeHtml(article?.summary || wiki.description)}">
  <title>${escapeHtml(page.title)} · Avalon</title>
  <script src="js/site-shell.js"></script>
  <link rel="preload" href="fonts/source-sans-3-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="fonts/Gin-Regular.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="stylesheet" href="css/site.css"><link rel="stylesheet" href="css/rules.css"><link rel="stylesheet" href="css/wiki.css">
  <script type="module" src="js/wiki.js"></script><script type="module" src="js/image-viewer.js"></script>
</head><body data-page="setting" data-reference-kind="setting" data-wiki-view="${page.type}">
  <a class="skip-link" href="${page.output}#wiki-content">Skip to content</a>
  ${header}
  <main id="main"><div id="wiki-page" class="wiki-shell">
    <aside class="wiki-sidebar" aria-label="Atlas navigation">
      <a id="wiki-home" class="wiki-identity" href="setting.html">${renderIcon("map")}<div><strong>Avalon</strong><span>The world atlas</span></div></a>
      <form id="wiki-search-form" role="search" action="${href()}"><label class="sr-only" for="wiki-search">Search article names</label><div class="wiki-search">${renderIcon("search")}<input id="wiki-search" name="q" type="search" placeholder="Search the atlas…" autocomplete="off"></div></form>
      <details id="wiki-menu" class="wiki-menu" open><summary>Browse the atlas</summary><nav id="wiki-navigation" aria-label="Setting collections">${navigation}</nav></details>
      <p class="wiki-sidebar-note">A world is more than a map.<br>Follow the stories.</p>
    </aside>
    <div class="wiki-main"><nav id="wiki-breadcrumb" class="wiki-breadcrumb" aria-label="Breadcrumb">${breadcrumb}</nav><div id="wiki-content" tabindex="-1">${body}</div></div>
    <aside id="wiki-toc" class="wiki-toc" aria-label="On this page">${contents}</aside>
  </div></main>
  ${page.type === "home" ? `<script type="application/json" id="wiki-legacy-routes">${JSON.stringify(Object.fromEntries(wiki.articles.flatMap(item => [[fold(item.id), item.href], [fold(item.name), item.href]]))).replaceAll("<", "\\u003c")}</script>` : ""}
</body></html>`.replace(/href="#([^"<>]*)"/g, `href="${page.output}#$1"`);
}
