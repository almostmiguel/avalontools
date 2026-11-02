import { readFile, readdir } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import { escapeHtml, inlineText, renderIcon, renderInline } from "../js/content-renderer.js";

const projectRoot = new URL("../", import.meta.url);
export const fold = value => String(value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const compare = new Intl.Collator("pt-PT", { sensitivity: "base", numeric: true }).compare;
const href = ({ article, category, portal } = {}) => article ? `setting/${article}.html` : category ? `setting/category-${category}.html` : portal ? `setting/portal-${portal}.html` : "setting/articles.html";
const articleLink = article => `<a class="wiki-link" href="${escapeHtml(article.href)}">${escapeHtml(article.name)}</a>`;

export function createWiki(metadata, documents) {
  const portals = new Map();
  for (const portal of metadata.portals || []) {
    if (!/^[a-z0-9-]+$/.test(portal.id) || !portal.name || portals.has(portal.id)) throw new Error("Invalid or duplicate wiki portal.");
    portals.set(portal.id, portal);
  }
  const categories = new Map();
  for (const category of metadata.categories || []) {
    if (!/^[a-z0-9-]+$/.test(category.id) || !category.name || categories.has(category.id)) throw new Error("Invalid or duplicate wiki category.");
    if (portals.size && !portals.has(category.portal)) throw new Error(`Unknown portal for category: ${category.id}`);
    categories.set(category.id, category);
  }
  const byId = new Map(), byName = new Map(), outputs = new Set(["setting/articles.html", ...[...categories.keys()].map(category => href({ category })), ...[...portals.keys()].map(portal => href({ portal }))]);
  const articles = documents.map(({ id, data, content }) => {
    if (!/^[a-z0-9-]+$/.test(id) || !data.title || byId.has(id) || byName.has(fold(data.title)) || outputs.has(href({ article: id }))) throw new Error(`Invalid or duplicate wiki article: ${id}`);
    if (!categories.has(data.category)) {
      const children = [...categories.values()].filter(category => category.portal === data.category).map(category => category.id);
      throw new Error(`${id}.md: categoria "${data.category || ""}" inválida. ${portals.has(data.category)
        ? `"${data.category}" é um portal; usa uma das suas categorias: ${children.join(", ")}.`
        : 'Usa um ID da lista "categories" em content/setting/atlas.json.'}`);
    }
    const article = { ...data, id, name: data.title, markdown: content, href: href({ article: id }), status: data.draft ? "draft" : "" };
    byId.set(id, article); byName.set(fold(article.name), article); outputs.add(article.href);
    return article;
  }).sort((a, b) => compare(a.name, b.name));
  const wiki = { title: metadata.title || "Wiki de Avalon", description: metadata.description || "", portals, categories, articles, byId,
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
        if (result.target) state.env.article?.outgoing.add(result.target.id);
        else state.env.article?.missing.add(name);
        return result;
      } }).replace(/title="Article not found: /g, 'title="Artigo por escrever: ');
    }
    state.pos += consumed;
    return true;
  });
  const renderInlineMarkdown = (value, article) => markdown.renderInline(String(value || ""), { article });
  for (const article of articles) {
    article.outgoing = new Set(); article.missing = new Set(); article.headings = [];
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
  wiki.missingReferences = articles.flatMap(article => [...article.missing].map(name => ({ article: article.id, name })));
  wiki.pages = [{ output: "setting.html", type: "home", title: wiki.title }, { output: "setting/articles.html", type: "index", title: "Todos os artigos" },
    ...[...portals.values()].map(portal => ({ output: href({ portal: portal.id }), type: "portal", portal: portal.id, title: portal.name })),
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

const status = article => article.draft ? '<span class="wiki-draft">Rascunho</span>' : "";
const articleCount = count => `${count} ${count === 1 ? "artigo" : "artigos"}`;
const initial = article => /^[a-z]/.test(fold(article.name)) ? fold(article.name)[0].toUpperCase() : "#";
const letterId = letter => `letra-${letter === "#" ? "outros" : letter.toLowerCase()}`;
const card = (article, wiki, anchor = "") => `<a class="wiki-entry"${anchor ? ` id="${anchor}"` : ""} data-wiki-name="${escapeHtml(fold(article.name))}" href="${article.href}"><strong>${escapeHtml(article.name)}</strong><span class="wiki-entry-category">${escapeHtml(wiki.categories.get(article.category).name)}</span>${article.summary ? `<p>${escapeHtml(article.summary)}</p>` : ""}</a>`;
const portalCategories = (wiki, portal) => [...wiki.categories.values()].filter(category => category.portal === portal);

function alphabet(wiki) {
  const present = new Set(wiki.articles.map(initial));
  return `<nav class="wiki-alphabet" aria-label="Índice alfabético" data-wiki-alphabet>${[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"].map(letter => present.has(letter) ? `<a href="${href()}#${letterId(letter)}">${letter}</a>` : `<span aria-disabled="true">${letter}</span>`).join("")}</nav>`;
}

export function renderWikiHome(wiki) {
  return `<header class="wiki-page-heading"><h1>${escapeHtml(wiki.title)}</h1><p class="wiki-result-count">${articleCount(wiki.articles.length)}</p></header><div class="wiki-overview"><section id="portais" class="wiki-subjects" aria-labelledby="wiki-subjects-title"><h2 id="wiki-subjects-title">Índice do cenário</h2>${[...wiki.portals.values()].map(portal => `<section id="portal-${portal.id}" class="wiki-portal-row"><h3><a href="${href({ portal: portal.id })}">${renderIcon(portal.icon)}${escapeHtml(portal.name)}</a></h3><ul>${portalCategories(wiki, portal.id).map(category => `<li><a href="${href({ category: category.id })}">${escapeHtml(category.name)}</a></li>`).join("")}</ul></section>`).join("")}</section><aside class="wiki-index-tools" aria-label="Índices da wiki"><section><h2>Nesta página</h2><ul>${[...wiki.portals.values()].map(portal => `<li><a href="setting.html#portal-${portal.id}">${escapeHtml(portal.name)}</a></li>`).join("")}</ul></section><section><h2>Índice A–Z</h2>${alphabet(wiki)}<a class="wiki-index-link" href="${href()}">Todos os artigos</a></section><section><h2>Artigos disponíveis</h2><ul>${wiki.articles.slice(0, 12).map(article => `<li>${articleLink(article)}</li>`).join("")}</ul></section></aside></div>`;
}

export function renderWikiIndex(wiki, category = "") {
  const collection = wiki.categories.get(category), articles = searchWiki(wiki, "", category);
  const heading = collection?.name || "Todos os artigos", seen = new Set();
  return `<header class="wiki-page-heading"><h1 id="wiki-results-title" data-wiki-title="${escapeHtml(heading)}">${escapeHtml(heading)}</h1>${collection ? `<p class="wiki-description">${escapeHtml(collection.description)}</p>` : ""}<p id="wiki-result-count" class="wiki-result-count" role="status">${articleCount(articles.length)}</p></header>${category ? "" : alphabet(wiki)}<div class="wiki-entry-list" id="wiki-results"${category ? "" : ' data-wiki-searchable="true"'}>${articles.map(article => { const letter = initial(article), anchor = seen.has(letter) ? "" : letterId(letter); seen.add(letter); return card(article, wiki, anchor); }).join("")}</div><div id="wiki-no-results" class="wiki-empty"${articles.length ? " hidden" : ""}><h2>Não foram encontrados artigos</h2><p>Pesquisa outro título ou consulta a lista completa.</p><a href="${href()}">Todos os artigos</a></div>`;
}

export function renderWikiPortal(wiki, portal) {
  const categories = portalCategories(wiki, portal.id);
  return `<header class="wiki-page-heading"><h1>${escapeHtml(portal.name)}</h1><p class="wiki-result-count">${articleCount(wiki.articles.filter(article => categories.some(category => category.id === article.category)).length)}</p></header><div class="wiki-portal-sections">${categories.map(category => {
    const articles = searchWiki(wiki, "", category.id);
    return `<section class="wiki-topic-section"><h2><a href="${href({ category: category.id })}">${escapeHtml(category.name)}</a><small>${articleCount(articles.length)}</small></h2><p>${escapeHtml(category.description)}</p>${articles.length ? `<ul>${articles.map(article => `<li>${articleLink(article)}</li>`).join("")}</ul>` : '<p class="wiki-muted">Sem artigos.</p>'}</section>`;
  }).join("")}</div>`;
}

export function renderWikiArticle(wiki, article, contents = "") {
  const facts = article.facts.length ? `<aside class="wiki-infobox" aria-label="${escapeHtml(article.name)} em resumo"><strong>Em resumo</strong><dl>${article.facts.map(fact => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${fact.html}</dd></div>`).join("")}</dl></aside>` : "";
  const incoming = [...wiki.backlinks.get(article.id)].sort((a, b) => compare(a.name, b.name));
  const peers = wiki.articles.filter(other => other.category === article.category && other !== article);
  return `<article class="wiki-article"><header class="wiki-page-heading"><div class="wiki-article-meta"><a href="${href({ category: article.category })}">${escapeHtml(wiki.categories.get(article.category).name)}</a>${status(article)}</div><h1>${escapeHtml(article.name)}</h1>${article.summary ? `<p class="wiki-description">${escapeHtml(article.summary)}</p>` : ""}</header>${article.sample ? '<p class="wiki-notice">Artigo de exemplo.</p>' : ""}<div class="wiki-article-body"><div class="wiki-article-text"><div class="wiki-prose rich-content">${article.html}</div></div>${contents || facts ? `<aside class="wiki-article-rail" aria-label="Informações do artigo">${contents}${facts}</aside>` : ""}</div><footer class="wiki-article-footer"><section><h2>Ligações para este artigo</h2>${incoming.length ? `<ul>${incoming.map(other => `<li>${articleLink(other)}</li>`).join("")}</ul>` : '<p class="muted">Sem ligações de outros artigos.</p>'}</section>${peers.length ? `<section><h2>Nesta categoria</h2><ul>${peers.map(other => `<li>${articleLink(other)}</li>`).join("")}</ul></section>` : ""}<a class="wiki-back" href="${href()}">Todos os artigos</a></footer></article>`;
}

export async function renderWikiPage(wiki, page) {
  const home = await readFile(new URL("index.html", projectRoot), "utf8");
  const header = home.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0]
    .replace('<header class="site-header">', '<header class="site-header" lang="en">')
    .replace('href="setting.html" data-reference-kind="setting"', 'href="setting.html" data-reference-kind="setting" aria-current="page"');
  const article = wiki.byId.get(page.article), category = wiki.categories.get(article?.category || page.category);
  const portal = wiki.portals.get(page.portal || category?.portal);
  const navigation = `<a href="setting.html"${page.type === "home" ? ' aria-current="page"' : ""}>Início</a><a href="${href()}"${page.type === "index" ? ' aria-current="page"' : ""}>Índice A–Z</a><a href="setting.html#portais">Portais</a>`;
  const breadcrumb = `<a href="setting.html">Cenário</a><span>/</span>${portal && page.type !== "portal" ? `<a href="${href({ portal: portal.id })}">${escapeHtml(portal.name)}</a><span>/</span>` : ""}${article ? `<a href="${href({ category: category.id })}">${escapeHtml(category.name)}</a><span>/</span>` : ""}<span aria-current="page">${escapeHtml(page.type === "home" ? "Página inicial" : page.title)}</span>`;
  const contents = article?.headings.length ? `<details id="wiki-toc" class="wiki-contents" open><summary>Índice</summary><nav aria-label="Índice do artigo">${article.headings.map(heading => `<a href="${page.output}#${heading.id}" data-depth="${heading.level}">${escapeHtml(heading.name)}</a>`).join("")}</nav></details>` : "";
  const body = article ? renderWikiArticle(wiki, article, contents) : page.type === "home" ? renderWikiHome(wiki) : page.type === "portal" ? renderWikiPortal(wiki, portal) : renderWikiIndex(wiki, page.category);
  return `<!doctype html>
<html lang="pt-PT" data-theme="dark"><head>
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
  <a class="skip-link" href="${page.output}#wiki-content">Ir para o conteúdo</a>
  ${header}
  <main id="main"><div id="wiki-page" class="wiki-shell">
    <div class="wiki-toolbar">
      <a id="wiki-home" class="wiki-identity" href="setting.html"><strong>Avalon</strong><span>Wiki</span></a>
      <nav id="wiki-navigation" aria-label="Navegação da wiki">${navigation}</nav>
      <form id="wiki-search-form" role="search" action="${href()}"><label class="sr-only" for="wiki-search">Pesquisar títulos de artigos</label><div class="wiki-search">${renderIcon("search")}<input id="wiki-search" name="q" type="search" placeholder="Pesquisar artigos…" autocomplete="off"></div></form>
    </div>
    <div class="wiki-main"><nav id="wiki-breadcrumb" class="wiki-breadcrumb" aria-label="Localização na wiki">${breadcrumb}</nav><div id="wiki-content" tabindex="-1">${body}</div></div>
  </div></main>
  ${page.type === "home" ? `<script type="application/json" id="wiki-legacy-routes">${JSON.stringify(Object.fromEntries(wiki.articles.flatMap(item => [[fold(item.id), item.href], [fold(item.name), item.href]]))).replaceAll("<", "\\u003c")}</script>` : ""}
</body></html>`.replace(/href="#([^"<>]*)"/g, `href="${page.output}#$1"`);
}
