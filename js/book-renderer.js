// Book JSON stays independent of the interface and of any future translation.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

export function safeHref(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const href = value.trim();
  if (/[\u0000-\u0020\\]/u.test(href) || href.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^https?:\/\//i.test(href)) return null;
  return href;
}

function splitArguments(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "{") depth++;
    if (value[index] === "}") depth--;
    if (value[index] === "|" && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function renderTag(body, options) {
  const match = /^(\S+)\s+([\s\S]*)$/.exec(body);
  if (!match) return escapeHtml(body);
  const [, rawTag, value] = match;
  const tag = rawTag.toLowerCase();
  const parts = splitArguments(value);
  if (["code", "kbd"].includes(tag)) return `<${tag}>${escapeHtml(value)}</${tag}>`;
  const text = renderInline(parts[0], options);
  const formatting = { b: "strong", bold: "strong", i: "em", italic: "em", s: "s", u: "u", sup: "sup", sub: "sub", code: "code", kbd: "kbd" };
  if (Object.hasOwn(formatting, tag)) return `<${formatting[tag]}>${renderInline(value, options)}</${formatting[tag]}>`;
  if (tag === "book") {
    const name = inlineText(parts[0]).trim();
    const source = (parts[1] || "").trim();
    const label = escapeHtml(inlineText(parts[2] || parts[0]));
    const attributes = `data-book-name="${escapeHtml(name)}" data-book-source="${escapeHtml(source)}"`;
    const resolution = options.resolveBook?.(name, source);
    if (resolution && resolution.status !== "found") {
      return `<span class="book-reference book-reference-unresolved" tabindex="0" ${attributes} title="Book unavailable: ${escapeHtml(name)}">${label}</span>`;
    }
    const fallback = `book.html?${new URLSearchParams({ book: source || name })}`;
    return `<a class="book-reference" href="${escapeHtml(resolution?.target.href || fallback)}" ${attributes}>${label}</a>`;
  }
  if (tag === "rule") {
    const name = inlineText(parts[0]).trim();
    const source = (parts[1] || options.source || "PC1").trim();
    const label = escapeHtml(inlineText(parts[2] || parts[0]));
    const attributes = `data-rule-name="${escapeHtml(name)}" data-rule-source="${escapeHtml(source)}"`;
    const resolution = options.resolveRule?.(name, source);
    if (resolution && resolution.status !== "found") {
      const message = resolution.status === "ambiguous" ? "More than one rule matches" : "Rule not found";
      return `<span class="rule-link rule-link-unresolved" tabindex="0" ${attributes} title="${message}: ${escapeHtml(name)} (${escapeHtml(source)})">${label}</span>`;
    }
    const fallback = `book.html?${new URLSearchParams({ book: source, rule: name })}`;
    return `<a class="rule-link" href="${escapeHtml(resolution?.target.href || fallback)}" ${attributes}>${label}</a>`;
  }
  if (tag === "link") {
    const href = safeHref(parts[1]);
    return href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${text}</a>` : text;
  }
  if (tag === "as" || tag === "actionsymbol") {
    const actions = {
      "1": "One action", "2": "Two actions", "3": "Three actions",
      r: "Reaction", f: "Free action",
    };
    const symbol = value.trim().toLowerCase();
    const action = Object.hasOwn(actions, symbol) ? actions[symbol] : null;
    return action ? `<span class="action-symbol" data-symbol="${symbol}" role="img" aria-label="${action}" title="${action}"></span>` : text;
  }
  if (["dice", "damage", "d20", "scaledice", "scaledamage"].includes(tag)) return renderInline(parts[1] || parts[0], options);
  if (tag === "dc") return `DC ${text}`;
  if (tag === "hit") return `${value.startsWith("-") ? "" : "+"}${text}`;
  if (tag === "chance") return `${text}%`;
  if (tag === "note") return `<em>${text}</em>`;
  if (tag === "spell") return `<em>${renderInline(parts[2] || parts[0], options)}</em>`;
  if (["filter", "footnote", "quickref", "adventure"].includes(tag)) return text;
  // Entity tags remain readable without linking to tools that do not exist yet.
  return renderInline(parts[2] || parts[0], options);
}

export function renderInline(value, options = {}) {
  const input = String(value ?? "");
  let result = "";
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf("{@", cursor);
    if (start === -1) return result + escapeHtml(input.slice(cursor));
    result += escapeHtml(input.slice(cursor, start));
    let depth = 1;
    let end = start + 2;
    for (; end < input.length && depth; end++) {
      if (input[end] === "{") depth++;
      if (input[end] === "}") depth--;
    }
    if (depth) return result + escapeHtml(input.slice(start));
    result += renderTag(input.slice(start + 2, end - 1), options);
    cursor = end;
  }
  return result;
}

export function inlineText(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
  return renderInline(value).replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => entities[entity]);
}

export function getChapters(payload, bookId = "PC1") {
  let chapters;
  if (Array.isArray(payload)) chapters = payload;
  else if (Array.isArray(payload?.data)) chapters = payload.data;
  else if (Array.isArray(payload?.bookData)) {
    chapters = payload.bookData.find(book => String(book.id).toLowerCase() === bookId.toLowerCase())?.data;
  } else if (Array.isArray(payload?.entries)) chapters = [payload];
  if (!Array.isArray(chapters)) throw new Error('Book JSON must contain a "data" array of chapters.');
  if (chapters.some(chapter => !chapter || typeof chapter !== "object" || Array.isArray(chapter))) {
    throw new Error("Each chapter must be an object with a name and entries.");
  }
  return chapters;
}

export function renderChapter(chapter, options = {}) {
  const headings = [];
  let boxDepth = 0;
  const pages = new WeakMap();
  const markPages = (value, inherited) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(item => markPages(item, inherited));
    const page = value.page ?? inherited;
    pages.set(value, Number.isInteger(page) && page > 0 ? page : null);
    Object.values(value).forEach(item => markPages(item, page));
  };
  markPages(chapter, null);
  const inline = value => renderInline(value, options);
  const heading = (name, level, tocLevel = null, entry = null, { afterName = "", trailing = "", controls = true } = {}) => {
    const id = `${options.anchorPrefix || "section"}-${headings.length + 1}`;
    const size = Math.max(2, Math.min(6, level));
    const page = pages.get(entry) ?? null;
    headings.push({ id, name: String(name), level: size, tocLevel: boxDepth ? null : tocLevel, entry, page });
    const title = options.interactive ? `<span class="heading-title">${inline(name)}${afterName}</span>${trailing}${controls ? renderHeadingControls(id, name, page) : ""}` : `${inline(name)}${afterName}${trailing}`;
    return `<h${size} id="${escapeHtml(id)}"${options.interactive && controls ? ' class="foldable-heading"' : ""}>${title}</h${size}>`;
  };
  const foldBody = (html, id) => options.interactive && id ? `<div class="section-body" id="${escapeHtml(id)}-content">${html}</div>` : html;
  const blocks = (entries, level) => (Array.isArray(entries) ? entries : [entries]).map(entry => block(entry, level)).join("\n");
  const cell = value => {
    if (value == null) return "";
    if (typeof value !== "object") return inline(value);
    if (value.roll) {
      const roll = value.roll;
      return escapeHtml(roll.exact ?? `${roll.min ?? ""}–${roll.max ?? ""}`);
    }
    return blocks(value.entries ?? value.entry ?? "", 5);
  };
  const block = (entry, level = 2) => {
    const isBox = entry && ["box", "inset", "insetReadaloud", "sidebar"].includes(entry.type);
    let html;
    if (isBox) boxDepth++;
    try {
      html = renderBlock(entry, level);
    } finally {
      if (isBox) boxDepth--;
    }
    if (!entry || !["modified", "original"].includes(entry.setting)) return html;
    const original = entry.setting === "original";
    const label = original ? "Original" : "Adapted";
    const description = original
      ? "Original material for the Avalon setting. Not part of the published sourcebook."
      : "Modified for the Avalon setting. This passage differs from the published sourcebook.";
    const note = typeof entry.settingNote === "string" && entry.settingNote.trim()
      ? `<p class="setting-note">${inline(entry.settingNote)}</p>` : "";
    return `<div class="setting-content setting-content--${entry.setting}"><details class="setting-provenance"><summary><span class="setting-sigil" aria-hidden="true">✧</span><span>Avalon <span aria-hidden="true">·</span> ${label}</span><span class="setting-note-toggle" aria-hidden="true">⌄</span></summary><div class="setting-explanation"><p>${description}</p>${note}</div></details>${html}</div>`;
  };
  const renderBlock = (entry, level = 2) => {
    if (entry == null) return "";
    if (typeof entry !== "object") return `<p>${inline(entry)}</p>`;
    if (Array.isArray(entry)) return blocks(entry, level);
    const type = entry.type || "entries";
    const children = entry.entries ?? entry.entry ?? [];
    if (type === "ability") {
      const symbol = String(entry.actions ?? "").trim().toLowerCase();
      const action = ["1", "2", "3", "r", "f"].includes(symbol) ? ` ${inline(`{@as ${symbol}}`)}` : "";
      const kind = typeof entry.kind === "string" ? entry.kind.trim() : "";
      const rank = typeof entry.level === "string" ? entry.level.trim() : Number.isInteger(entry.level) && entry.level >= 0 ? String(entry.level) : "";
      const classification = [kind, rank].filter(Boolean).join(" ");
      const title = heading(entry.name || "Ability", level, null, entry, {
        afterName: action,
        trailing: classification ? `<span class="ability-level">${inline(classification)}</span>` : "",
        controls: false,
      });
      const id = headings.at(-1).id;
      const traits = Array.isArray(entry.traits) ? entry.traits.filter(trait => typeof trait === "string" && trait.trim()) : [];
      const traitRow = traits.length ? `<div class="ability-traits" role="list" aria-label="Traits">${traits.map(trait => `<span class="ability-trait" role="listitem">${inline(trait)}</span>`).join("")}</div>` : "";
      const hasContent = value => value != null && value !== false && (Array.isArray(value) ? value.length > 0 : typeof value !== "string" || value.trim().length > 0);
      const field = (label, value) => `<div class="ability-field"><dt>${label}</dt><dd>${blocks(value, level + 1)}</dd></div>`;
      const fields = [["access", "Access"], ["prerequisites", "Prerequisites"], ["frequency", "Frequency"], ["trigger", "Trigger"], ["requirements", "Requirements"], ["cost", "Cost"]]
        .filter(([key]) => hasContent(entry[key])).map(([key, label]) => field(label, entry[key])).join("");
      const metadata = fields ? `<dl class="ability-fields">${fields}</dl>` : "";
      const effect = entry.effect ?? children;
      const description = hasContent(effect) ? `<div class="ability-effect">${blocks(effect, level + 1)}</div>` : "";
      const special = hasContent(entry.special) ? `<dl class="ability-fields ability-special">${field("Special", entry.special)}</dl>` : "";
      const compactClass = entry.compact === true ? " ability-block--compact" : "";
      return `<section class="ability-block${compactClass}" aria-labelledby="${escapeHtml(id)}"><header class="ability-header">${title}</header><div class="ability-content">${traitRow}${metadata}${description}${special}</div></section>`;
    }
    if (type === "box-section") {
      const title = entry.name ? heading(entry.name, level, null, entry) : "";
      const id = entry.name ? headings.at(-1).id : null;
      const label = id ? ` aria-labelledby="${escapeHtml(id)}"` : "";
      return `<section class="box-section"${label}>${title}${foldBody(blocks(children, level + 1), id)}</section>`;
    }
    if (type === "box") {
      const title = entry.name ? heading(entry.name, level, null, entry) : "";
      const id = entry.name ? headings.at(-1).id : null;
      const label = id ? ` aria-labelledby="${escapeHtml(id)}"` : "";
      const bodyAttributes = options.interactive && id ? ` id="${escapeHtml(id)}-content" class="rule-box-content section-body"` : ' class="rule-box-content"';
      return `<aside class="rule-box"${label}>${title}<div${bodyAttributes}>${blocks(children, level + 1)}</div></aside>`;
    }
    if (type === "list") {
      const ordered = entry.style === "list-decimal" || entry.ordered === true;
      const tag = ordered ? "ol" : "ul";
      const attributes = entry.style === "list-no-bullets" ? ' class="list-no-bullets" role="list"' : "";
      const title = entry.name ? heading(entry.name, level, null, entry) : "";
      const id = entry.name ? headings.at(-1).id : null;
      return `${title}${foldBody(`<${tag}${attributes}>${(entry.items ?? []).map(item => `<li>${block(item, level + 1)}</li>`).join("")}</${tag}>`, id)}`;
    }
    if (type === "table") {
      const labels = entry.colLabels ?? [];
      const rows = entry.rows ?? [];
      const dialogue = entry.style === "table-dialogue";
      const tableAttributes = dialogue ? ' class="dialogue-table"' : "";
      const columns = dialogue ? '<colgroup><col class="dialogue-speaker-column"><col></colgroup>' : "";
      return `<div class="table-wrap"><table${tableAttributes}>${entry.caption ? `<caption>${inline(entry.caption)}</caption>` : ""}${columns}${labels.length ? `<thead><tr>${labels.map(label => `<th scope="col">${cell(label)}</th>`).join("")}</tr></thead>` : ""}<tbody>${rows.map(row => `<tr>${(Array.isArray(row) ? row : row.row ?? []).map((value, index) => dialogue && index === 0 ? `<th scope="row">${cell(value)}</th>` : `<td>${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    if (type === "image") {
      const href = safeHref(entry.href?.url ?? entry.href?.path ?? entry.href ?? entry.url);
      if (!href) return "";
      return `<figure><img src="${escapeHtml(href)}" alt="${escapeHtml(entry.alt ?? entry.title ?? "")}" loading="lazy">${entry.title ? `<figcaption>${inline(entry.title)}</figcaption>` : ""}</figure>`;
    }
    if (type === "hr") return "<hr>";
    if (type === "flavor") return `<div class="flavor">${blocks(children, level)}</div>`;
    if (type === "quote") return `<blockquote>${blocks(children, level)}${entry.by ? `<footer>— ${inline(entry.by)}</footer>` : ""}</blockquote>`;
    if (["item", "itemSub", "itemSpell"].includes(type)) {
      const label = entry.name ? `<strong>${inline(entry.name)}</strong> ` : "";
      const hanging = entry.style === "hanging";
      if (typeof children === "string") return `<p${hanging ? ' class="hanging-entry"' : ""}>${label}${inline(children)}</p>`;
      const content = `${label}${blocks(children, level)}`;
      return hanging ? `<div class="hanging-entry">${content}</div>` : content;
    }
    const fixedHeading = /^h([1-6])$/.exec(type);
    const sectionLevel = fixedHeading ? Number(fixedHeading[1]) + 1 : level;
    const title = entry.name ? heading(entry.name, sectionLevel, fixedHeading ? Number(fixedHeading[1]) : null, entry) : "";
    const id = entry.name ? headings.at(-1).id : null;
    const content = `${title}${foldBody(blocks(children, sectionLevel + (entry.name ? 1 : 0)), id)}`;
    return ["inset", "insetReadaloud", "sidebar"].includes(type) ? `<aside>${content}</aside>` : content;
  };
  return { html: blocks(chapter.entries ?? chapter.entry ?? [], 2), headings };
}

export function renderHeadingControls(id, name, page) {
  const label = escapeHtml(inlineText(name));
  const pageLabel = Number.isInteger(page) && page > 0 ? `<span class="heading-page" aria-label="Page ${page}">p. ${page}</span>` : "";
  return `<span class="heading-controls">${pageLabel}<button type="button" class="section-toggle" data-section-toggle aria-controls="${escapeHtml(id)}-content" aria-expanded="true" aria-label="Collapse ${label}" data-section-name="${label}"><span aria-hidden="true">−</span></button></span>`;
}
