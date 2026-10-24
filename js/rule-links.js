import { escapeHtml, inlineText, renderChapter, safeHref } from "./book-renderer.js";

const normalize = value => String(value ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const lookupKey = (name, source) => JSON.stringify([normalize(source), normalize(name)]);

// Build targets from the same renderer that creates the visible heading anchors.
export function createRuleRegistry(records) {
  const targets = new Map();
  for (const { book, chapters } of records) {
    chapters.forEach((chapter, chapterIndex) => {
      const metadata = new WeakMap();
      const mark = (value, page, source, setting, settingNote) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) return value.forEach(item => mark(item, page, source, setting, settingNote));
        const ownsSetting = ["modified", "original"].includes(value.setting);
        const inherited = {
          page: value.page ?? page, source: value.source ?? source,
          setting: ownsSetting ? value.setting : setting,
          settingNote: ownsSetting ? value.settingNote : settingNote,
        };
        metadata.set(value, inherited);
        Object.values(value).forEach(item => mark(item, inherited.page, inherited.source, inherited.setting, inherited.settingNote));
      };
      mark(chapter, null, book.source || book.id);
      const headings = renderChapter(chapter).headings;
      if (chapter.name) headings.unshift({ id: "chapter-title", name: chapter.name, entry: chapter });
      for (const heading of headings) {
        const entry = heading.entry;
        if (!entry) continue;
        const inherited = metadata.get(entry);
        const name = inlineText(heading.name);
        const ruleId = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : name;
        const query = new URLSearchParams({ book: book.id, chapter: String(chapterIndex), rule: ruleId });
        const target = {
          name, entry, chapter: chapterIndex, anchor: heading.id,
          source: inherited.source, sourceName: book.name,
          setting: inherited.setting, settingNote: inherited.settingNote,
          page: Number.isInteger(inherited.page) && inherited.page > 0 ? inherited.page : null,
          href: `book.html?${query}#${heading.id}`,
        };
        for (const source of new Set([inherited.source, book.id])) {
          const aliases = Array.isArray(entry.aliases) ? entry.aliases.filter(alias => typeof alias === "string") : [];
          for (const alias of new Set([name, ruleId, ...aliases].map(normalize))) {
            const key = lookupKey(alias, source);
            if (!targets.has(key)) targets.set(key, []);
            const matches = targets.get(key);
            if (!matches.includes(target)) matches.push(target);
          }
        }
      }
    });
  }
  return {
    resolve(name, source = "PC1") {
      const matches = targets.get(lookupKey(name, source)) || [];
      if (!matches.length) return { status: "missing" };
      // Explicit ids still reach a summary even when another entry is the default.
      const exactIds = matches.filter(target => typeof target.entry.id === "string" && normalize(target.entry.id) === normalize(name));
      const defaults = matches.filter(target => target.entry.ruleDefault === true);
      const candidates = exactIds.length ? exactIds : defaults.length ? defaults : matches;
      if (candidates.length !== 1) return { status: "ambiguous" };
      return { status: "found", target: candidates[0] };
    },
  };
}

export function createBookRegistry(books) {
  return {
    resolve(name, source = "") {
      const query = normalize(source || name);
      const matches = books.filter(book => [book.id, book.source, book.name].some(value => value && normalize(value) === query));
      if (matches.length !== 1) return { status: matches.length ? "ambiguous" : "missing" };
      const book = matches[0];
      return { status: "found", target: { book, href: `book.html?${new URLSearchParams({ book: book.id })}` } };
    },
  };
}

export function renderBookPreview(name, source, books) {
  const resolution = books.resolve(name, source);
  const target = resolution.target;
  const title = escapeHtml(target?.book.name || name);
  const header = `<header class="rule-preview-heading"><h2 id="rule-preview-title">${title}</h2><span>Book</span><button type="button" data-close-rule-preview aria-label="Close book preview">×</button></header>`;
  if (!target) {
    const message = resolution.status === "ambiguous"
      ? "More than one book matches this name. Specify its id in the book tag."
      : "This book has not been added to data/books.json yet.";
    return `${header}<div class="rule-preview-body"><p>${escapeHtml(message)}</p></div>`;
  }
  const cover = safeHref(target.book.cover);
  const artwork = cover
    ? `<a href="${escapeHtml(target.href)}" aria-label="Open ${title}"><img class="book-preview-cover" src="${escapeHtml(cover)}" alt="${title} book cover" decoding="async"></a>`
    : '<p class="book-preview-no-cover">No cover has been added for this book yet.</p>';
  return `${header}<div class="rule-preview-body book-preview-body">${artwork}<a class="book-preview-open" href="${escapeHtml(target.href)}">Open book <span aria-hidden="true">↗</span></a></div>`;
}

export function renderRulePreview(name, source, registry, books) {
  const resolution = registry.resolve(name, source);
  const target = resolution.target;
  const title = escapeHtml(target?.name || name);
  const header = `<header class="rule-preview-heading"><h2 id="rule-preview-title">${title}</h2><span>Rules</span><button type="button" data-close-rule-preview aria-label="Close rule preview">×</button></header>`;
  if (!target) {
    const message = resolution.status === "ambiguous"
      ? "More than one entry has this name. Mark only the main definition with ruleDefault: true, or give the intended entry a unique id and use that id in the rule tag."
      : "No matching entry was found in this book. Check the rule name and source, or add its definition to the book JSON.";
    return `${header}<div class="rule-preview-body"><p>${escapeHtml(message)}</p></div>`;
  }
  const content = ["list", "ability"].includes(target.entry.type)
    ? [{ ...target.entry, name: target.entry.type === "list" ? undefined : target.entry.name, setting: undefined }]
    : target.entry.entries ?? target.entry.entry ?? [];
  const body = renderChapter({ entries: [{ entries: content, setting: target.setting, settingNote: target.settingNote }] }, {
    source: target.source, resolveRule: registry.resolve, resolveBook: books?.resolve, anchorPrefix: "rule-preview-section",
  }).html;
  const page = target.page && target.setting !== "original" ? ` <span>pg. ${target.page}</span>` : "";
  const sourceLabel = target.setting === "modified" ? "Adapted from" : target.setting === "original" ? "Reference book" : "Source";
  return `${header}<p class="rule-preview-source">${sourceLabel} <a href="${escapeHtml(target.href)}">${escapeHtml(target.sourceName)}</a>${page}</p><div class="rule-preview-body">${body || "<p>No description has been added yet.</p>"}</div>`;
}

export function previewPosition(anchor, panel, viewport) {
  const margin = 12;
  const gap = 8;
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - panel.width - margin));
  const below = anchor.bottom + gap;
  const preferred = below + panel.height <= viewport.height - margin ? below : anchor.top - panel.height - gap;
  const top = Math.max(margin, Math.min(preferred, viewport.height - panel.height - margin));
  return { left, top };
}

export function attachRulePreviews({ document, window, registry, bookRegistry = createBookRegistry([]) }) {
  const panel = document.createElement("section");
  panel.id = "rule-preview";
  panel.className = "rule-preview";
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", "rule-preview-title");
  document.body.append(panel);
  let current = null;
  let closeTimer;
  let openTimer;
  let restoringFocus = false;
  const listeners = [];
  const on = (element, event, handler, options) => {
    element.addEventListener(event, handler, options);
    listeners.push(() => element.removeEventListener(event, handler, options));
  };
  const cancelClose = () => window.clearTimeout(closeTimer);
  const hide = (restoreFocus = false) => {
    window.clearTimeout(openTimer);
    cancelClose();
    const link = current;
    current = null;
    panel.hidden = true;
    link?.removeAttribute("aria-describedby");
    link?.removeAttribute("aria-controls");
    if (restoreFocus && link && panel.contains(document.activeElement)) {
      restoringFocus = true;
      link.focus();
      restoringFocus = false;
    }
  };
  const position = () => {
    if (!current || panel.hidden) return;
    const anchor = current.getBoundingClientRect();
    if (anchor.bottom < 0 || anchor.top > window.innerHeight) return hide();
    const { left, top } = previewPosition(anchor, panel.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  const show = link => {
    window.clearTimeout(openTimer);
    cancelClose();
    if (panel.contains(link)) return;
    if (current !== link) hide();
    current = link;
    const isBook = link.dataset.bookName !== undefined;
    panel.className = isBook ? "rule-preview book-preview" : "rule-preview";
    panel.innerHTML = isBook
      ? renderBookPreview(link.dataset.bookName, link.dataset.bookSource, bookRegistry)
      : renderRulePreview(link.dataset.ruleName, link.dataset.ruleSource, registry, bookRegistry);
    panel.hidden = false;
    link.setAttribute("aria-controls", panel.id);
    link.setAttribute("aria-describedby", panel.id);
    position();
  };
  const scheduleClose = () => {
    window.clearTimeout(openTimer);
    cancelClose();
    closeTimer = window.setTimeout(() => {
      if (!panel.contains(document.activeElement) && document.activeElement !== current) hide();
    }, 180);
  };
  const ruleLink = target => target?.closest?.("[data-rule-name], [data-book-name]");
  on(document, "pointerover", event => {
    if (event.pointerType === "touch") return;
    const link = ruleLink(event.target);
    if (!link || panel.contains(link) || link.contains(event.relatedTarget)) return;
    cancelClose();
    window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => show(link), 120);
  });
  on(document, "pointerout", event => {
    const link = ruleLink(event.target);
    if (link && !link.contains(event.relatedTarget) && !panel.contains(event.relatedTarget)) scheduleClose();
  });
  on(panel, "pointerenter", cancelClose);
  on(panel, "pointerleave", scheduleClose);
  on(document, "focusin", event => {
    if (restoringFocus || panel.contains(event.target)) return;
    const link = ruleLink(event.target);
    if (link) show(link);
    else hide();
  });
  on(document, "focusout", event => {
    if (!panel.contains(event.relatedTarget) && event.relatedTarget !== current) scheduleClose();
  });
  on(document, "keydown", event => {
    if (event.key === "Escape") hide(true);
    if (event.key === "ArrowDown" && event.altKey && current === document.activeElement && !panel.hidden) {
      event.preventDefault();
      panel.focus();
    }
  });
  on(document, "pointerdown", event => {
    if (!panel.contains(event.target) && !current?.contains(event.target)) hide();
  });
  on(panel, "click", event => {
    if (event.target?.closest?.("[data-close-rule-preview]")) hide(true);
  });
  on(window, "resize", position);
  on(window, "scroll", position, true);
  on(panel, "load", position, true);
  return { show, hide, panel, destroy() { hide(); listeners.forEach(remove => remove()); panel.remove(); } };
}
