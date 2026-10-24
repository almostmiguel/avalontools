import { escapeHtml, getChapters, renderChapter, renderHeadingControls, renderInline, safeHref } from "./book-renderer.js";
import { attachRulePreviews, createBookRegistry, createRuleRegistry } from "./rule-links.js";
import { attachReaderControls, renderContents } from "./reader-controls.js";

const page = document.body.dataset.page;
const navigation = document.querySelector("#navigation");
const main = document.querySelector("#main");

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${path} is not valid JSON. Check for missing commas or brackets.`);
  }
}

function bookUrl(book, chapter) {
  const query = new URLSearchParams({ book: book.id });
  if (chapter !== undefined) query.set("chapter", String(chapter));
  return `book.html?${query}`;
}

function groupBooks(books) {
  const groups = new Map();
  for (const book of books) {
    const group = book.group || "Core";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(book);
  }
  for (const group of groups.values()) group.sort((a, b) => String(a.published ?? "").localeCompare(String(b.published ?? "")) || a.name.localeCompare(b.name, "en"));
  return groups;
}

function bookLink(book, previousYear) {
  const year = /^\d{4}/.exec(book.published ?? "")?.[0] ?? "";
  const color = /^#[\da-f]{6}$/i.test(book.color) ? book.color : "#36b5b4";
  return `<a class="book-link" href="${escapeHtml(bookUrl(book))}" style="--book-color:${color}"><span class="book-year">${year === previousYear ? "" : year}</span><span class="book-name">${escapeHtml(book.name)}</span></a>`;
}

function bookCard(book) {
  const year = /^\d{4}/.exec(book.published ?? "")?.[0] ?? "";
  const color = /^#[\da-f]{6}$/i.test(book.color) ? book.color : "#c8ae7c";
  const cover = safeHref(book.cover);
  const artwork = cover
    ? `<img class="catalog-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async">`
    : `<span class="mini-volume"><small>Pathfinder · Second Edition</small><span class="mini-ornament">✧</span><strong>${escapeHtml(book.name)}</strong><small>${escapeHtml(book.source || book.id)}</small></span>`;
  return `<a class="catalog-book" href="${escapeHtml(bookUrl(book))}" style="--book-color:${color}"><span class="catalog-art" aria-hidden="true">${artwork}</span><span class="catalog-info"><strong>${escapeHtml(book.name)}</strong><span>${year}</span></span><span class="catalog-open"><span>Open book · ${escapeHtml(book.source || book.id)}</span><span aria-hidden="true">↗</span></span></a>`;
}

function groupedLinks(books, menu = false) {
  return [...groupBooks(books)].map(([group, entries]) => {
    let previousYear;
    const links = entries.map(book => {
      const html = bookLink(book, previousYear);
      previousYear = /^\d{4}/.exec(book.published ?? "")?.[0] ?? "";
      return html;
    }).join("");
    return menu ? `<div><h2 class="group-label">${escapeHtml(group)}</h2>${links}</div>` : `<section class="library-group"><h2>${escapeHtml(group)}</h2><div class="book-grid">${entries.map(bookCard).join("")}</div></section>`;
  }).join("");
}

function renderNavigation(books) {
  navigation.innerHTML = `<a class="nav-home" href="index.html"${page === "home" ? ' aria-current="page"' : ""}>Home</a><details class="books-menu"${page !== "home" ? ' data-active="true"' : ""}><summary>Books</summary><div class="menu-panel"><a class="menu-all" href="books.html"${page === "books" ? ' aria-current="page"' : ""}>View All Books</a>${groupedLinks(books, true)}</div></details>`;
  const menu = navigation.querySelector("details");
  document.addEventListener("click", event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
}

function renderEmptyBook(book, file) {
  document.querySelector("#reader").innerHTML = `<section class="empty-state"><h1>${escapeHtml(book.name)}</h1><p>The reader is ready. This book has no chapters yet.</p><p>Add your English book JSON to <code>${escapeHtml(file)}</code>, then refresh this page.</p><a href="books.html">Back to Books</a></section>`;
}

function bookFile(book) {
  const file = book.file || `data/book/book-${book.id.toLowerCase()}.json`;
  if (!/^data\/[\w./-]+\.json$/.test(file) || file.split("/").includes("..")) {
    throw new Error("Book files must be JSON paths inside the data folder.");
  }
  return file;
}

async function renderBook(books) {
  const parameters = new URLSearchParams(location.search);
  const id = parameters.get("book") || "PC1";
  const book = books.find(entry => [entry.id, entry.source].some(source => source?.toLowerCase() === id.toLowerCase()));
  if (!book) throw new Error(`Book “${id}” is not in the book index.`);
  document.title = `${book.name} · Avalon`;
  const file = bookFile(book);
  const payload = await loadJson(file);
  const chapters = getChapters(payload, book.id);
  if (!chapters.length) return renderEmptyBook(book, file);
  const records = await Promise.all(books.map(async entry => {
    if (entry === book) return { book, chapters };
    try {
      return { book: entry, chapters: getChapters(await loadJson(bookFile(entry)), entry.id) };
    } catch {
      // A missing future book must not stop the current book from opening.
      return null;
    }
  }));
  const rules = createRuleRegistry(records.filter(Boolean));
  const bookRegistry = createBookRegistry(books);
  const requestedRule = parameters.get("rule");
  const requestedTarget = requestedRule ? rules.resolve(requestedRule, book.source || book.id) : null;
  if (requestedTarget && requestedTarget.status !== "found") {
    throw new Error(requestedTarget.status === "ambiguous"
      ? `More than one rule named “${requestedRule}” exists. Use the intended entry's unique id.`
      : `Rule “${requestedRule}” was not found in ${book.name}. Check its name in the book JSON.`);
  }
  const rawChapter = parameters.get("chapter") ?? "0";
  const index = requestedTarget?.target.chapter ?? Number(rawChapter);
  if ((!requestedTarget && !/^\d+$/.test(rawChapter)) || !Number.isSafeInteger(index) || !chapters[index]) throw new Error("That chapter does not exist. Choose the book again from the Books menu.");
  const chapter = chapters[index];
  const title = chapter.name || `Chapter ${index + 1}`;
  const renderOptions = { source: book.source || book.id, resolveRule: rules.resolve, resolveBook: bookRegistry.resolve, interactive: true };
  const rendered = renderChapter(chapter, renderOptions);
  document.title = `${title} · ${book.name} · Avalon`;
  const sidebarHeadings = rendered.headings.filter(item => item.tocLevel >= 1 && item.tocLevel <= 2);
  const chapterLinks = chapters.map((entry, chapterIndex) => {
    const current = chapterIndex === index;
    const link = `<a href="${escapeHtml(bookUrl(book, chapterIndex))}"${current ? ' aria-current="page"' : ""}>${escapeHtml(entry.name || `Chapter ${chapterIndex + 1}`)}</a>`;
    const sections = current ? renderContents(sidebarHeadings) : "";
    return `<li>${sections ? `<details class="toc-chapter" open><summary>${link}</summary>${sections}</details>` : link}</li>`;
  }).join("");
  document.querySelector("#contents").innerHTML = `<div class="contents-panel"><div class="contents-actions" role="group" aria-label="Overview groups"><button type="button" data-toc-action="collapse">Collapse all</button><button type="button" data-toc-action="expand">Expand all</button></div><section class="contents-tree" aria-labelledby="contents-title"><h2 class="contents-title" id="contents-title">${escapeHtml(book.name)}</h2><ol>${chapterLinks}</ol></section></div>`;
  const previous = index > 0 ? `<a rel="prev" href="${escapeHtml(bookUrl(book, index - 1))}">← ${escapeHtml(chapters[index - 1].name || `Chapter ${index}`)}</a>` : "";
  const next = index < chapters.length - 1 ? `<a rel="next" href="${escapeHtml(bookUrl(book, index + 1))}">${escapeHtml(chapters[index + 1].name || `Chapter ${index + 2}`)} →</a>` : "";
  const exampleNote = payload?._meta?.example === true ? '<div class="example-note"><strong>JSON writing example.</strong> These are sample chapters, not Player Core text. Replace the <code>data</code> array in <code>data/book/book-pc1.json</code> with your book, then remove <code>_meta.example</code>.</div>' : "";
  document.querySelector("#reader").innerHTML = `${exampleNote}<header class="book-heading"><p>${escapeHtml(book.name)} · Chapter ${index + 1} of ${chapters.length}</p><div class="chapter-heading-row"><h1 id="chapter-title">${renderInline(title, renderOptions)}</h1>${renderHeadingControls("chapter-title", title, chapter.page)}</div></header><article class="book-content section-body" id="chapter-title-content">${rendered.html}</article><nav class="chapter-nav" aria-label="Chapters">${previous}${next}</nav>`;
  const readerControls = attachReaderControls({ document, window, reader: document.querySelector("#reader"), contents: document.querySelector("#contents") });
  attachRulePreviews({ document, window, registry: rules, bookRegistry });
  if (requestedTarget) window.history?.replaceState(null, "", requestedTarget.target.href);
  const anchor = requestedTarget?.target.anchor || location.hash.slice(1);
  if (anchor) {
    readerControls.reveal(anchor);
    document.getElementById(anchor)?.scrollIntoView();
  }
}

async function start() {
  // Retire any old Pf2eTools offline worker after the reset.
  if ("serviceWorker" in navigator) {
    const scope = new URL("./", location.href).href;
    navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(
      registrations.filter(registration => registration.scope === scope).map(registration => registration.unregister()),
    )).catch(() => {});
  }
  try {
    const payload = await loadJson("data/books.json");
    const books = payload?.book;
    if (!Array.isArray(books) || books.some(book => !book || typeof book.id !== "string" || !/^[\w-]+$/.test(book.id) || typeof book.name !== "string")) {
      throw new Error('data/books.json needs a "book" array with an id and name for each book.');
    }
    if (new Set(books.map(book => book.id.toLowerCase())).size !== books.length) throw new Error("Each book needs a unique id in data/books.json.");
    renderNavigation(books);
    if (page === "books") document.querySelector("#book-list").innerHTML = books.length ? groupedLinks(books) : '<p class="muted">No books have been added yet.</p>';
    if (page === "book") await renderBook(books);
  } catch (error) {
    const target = document.querySelector("#reader") || document.querySelector("#book-list") || main;
    target.innerHTML = `<section class="notice" role="alert"><h1>Unable to load books</h1><p>${escapeHtml(error.message)}</p><p>Run <code>npm run serve:dev</code> and open the local address, rather than opening the HTML file directly.</p><a href="books.html">Back to Books</a></section>`;
    if (!navigation.childElementCount) navigation.innerHTML = '<a href="books.html">Books</a>';
  } finally {
    main.removeAttribute("aria-busy");
  }
}

start();
