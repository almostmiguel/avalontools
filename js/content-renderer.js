// Render reusable JSON content independently of page layout and translation.
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
  const formatting = { b: "strong", bold: "strong", i: "em", italic: "em", s: "s", u: "u", sup: "sup", sub: "sub" };
  if (Object.hasOwn(formatting, tag)) return `<${formatting[tag]}>${renderInline(value, options)}</${formatting[tag]}>`;
  if (tag === "rule" || tag === "action") {
    const name = inlineText(parts[0]).trim();
    const source = (parts[1] || "").trim();
    const labelText = inlineText(parts[2] || parts[0]);
    const label = escapeHtml(labelText);
    const attributes = `data-${tag}-name="${escapeHtml(name)}" data-${tag}-source="${escapeHtml(source)}" data-reference-kind="${tag}"`;
    const resolution = (tag === "rule" ? options.resolveRule : options.resolveAction)?.(name, source, { label: labelText });
    const noun = tag === "rule" ? "Rule" : "Action";
    if (resolution && resolution.status !== "found") {
      const message = resolution.status === "ambiguous" ? `More than one ${tag} matches` : `${noun} not found`;
      return `<span class="${tag}-link rule-link-unresolved" tabindex="0" ${attributes} title="${message}: ${escapeHtml(name)}${source ? ` (${escapeHtml(source)})` : ""}">${label}</span>`;
    }
    const fallback = `${tag === "rule" ? "rules" : "actions"}.html?${new URLSearchParams(source ? { [tag]: name, source } : { [tag]: name })}`;
    const confirmedAction = tag === "action" && resolution?.status === "found" ? ' data-action-resolved="true"' : "";
    const firstWord = /^(\s*\S+)([\s\S]*)$/u.exec(labelText);
    const linkedLabel = firstWord ? `<span class="reference-link-start">${escapeHtml(firstWord[1])}</span>${escapeHtml(firstWord[2])}` : label;
    return `<a class="${tag}-link" href="${escapeHtml(resolution?.target?.href || fallback)}" ${attributes}${confirmedAction}>${linkedLabel}</a>`;
  }
  if (tag === "spell") return `<em>${renderInline(parts[2] || parts[0], options)}</em>`;
  const text = renderInline(parts[0], options);
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
  if (["dice", "damage", "d20", "scaledice", "scaledamage"].includes(tag)) return parts[1] ? renderInline(parts[1], options) : text;
  if (tag === "dc") return `DC ${text}`;
  if (tag === "hit") return `${value.startsWith("-") ? "" : "+"}${text}`;
  if (tag === "chance") return `${text}%`;
  if (tag === "note") return `<em>${text}</em>`;
  if (["filter", "footnote", "quickref", "adventure"].includes(tag)) return text;
  // Entity tags remain readable without linking to tools that do not exist yet.
  return parts[2] ? renderInline(parts[2], options) : text;
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

export function renderContent(content, options = {}) {
  const headings = [];
  let outlineDepth = 0;
  const outlineExcluded = new Set(["box", "box-section", "inset", "insetReadaloud", "sidebar", "clarification", "ability", "spell", "quote", "flavor", "formula", "table", "list"]);
  const inline = value => renderInline(value, options);
  const heading = (name, level, entry, { afterName = "", trailing = "" } = {}) => {
    const id = `${options.anchorPrefix || "section"}-${headings.length + 1}`;
    const size = Math.max(2, Math.min(6, level + (options.headingOffset || 0)));
    const minorHeading = entry?.type === "h6" ? ' data-heading-level="6"' : "";
    headings.push({ id, name: String(name), level: size, entry, outline: outlineDepth === 0 && level <= 4 });
    const target = options.headingLink?.(entry);
    const title = target ? `<a class="content-heading-link" href="${escapeHtml(target.href)}" data-select-rule="${escapeHtml(target.id)}">${inline(name)}</a>` : inline(name);
    return `<h${size} id="${escapeHtml(id)}"${minorHeading}>${title}${afterName}${trailing}</h${size}>`;
  };
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
    const exclude = entry && typeof entry === "object" && outlineExcluded.has(entry.type);
    if (exclude) outlineDepth++;
    const html = renderBlock(entry, level);
    if (exclude) outlineDepth--;
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
    if (type === "ability" || type === "spell") {
      const spell = type === "spell";
      const symbol = String(entry.actions ?? "").trim().toLowerCase();
      const action = !spell && ["1", "2", "3", "r", "f"].includes(symbol) ? ` ${inline(`{@as ${symbol}}`)}` : "";
      const spellTypes = { spell: "Spell", cantrip: "Cantrip", focus: "Focus" };
      const kind = spell ? (Object.hasOwn(spellTypes, entry.spellType) ? spellTypes[entry.spellType] : "Spell") : typeof entry.kind === "string" ? entry.kind.trim() : "";
      const rank = typeof entry.level === "string" ? entry.level.trim() : Number.isInteger(entry.level) && entry.level >= 0 ? String(entry.level) : "";
      const classification = [kind, rank].filter(Boolean).join(" ");
      const title = heading(entry.name || (spell ? "Spell" : "Ability"), level, entry, {
        afterName: action,
        trailing: classification ? `<span class="ability-level">${inline(classification)}</span>` : "",
      });
      const id = headings.at(-1).id;
      const traits = Array.isArray(entry.traits) ? entry.traits.filter(trait => typeof trait === "string" && trait.trim()) : [];
      const traitRow = traits.length ? `<div class="ability-traits" role="list" aria-label="Traits">${traits.map(trait => `<span class="ability-trait" role="listitem">${inline(trait)}</span>`).join("")}</div>` : "";
      const hasContent = value => value != null && value !== false && (Array.isArray(value) ? value.length > 0 : typeof value !== "string" || value.trim().length > 0);
      const field = (label, value) => `<div class="ability-field"><dt>${label}</dt><dd>${blocks(value, level + 1)}</dd></div>`;
      const fieldGroup = values => {
        const present = values.filter(([, value]) => hasContent(value));
        if (!present.length) return "";
        return `<div class="ability-field">${present.map(([label, value], index) => `<dt>${label}</dt><dd>${blocks(value, level + 1)}${index < present.length - 1 ? "; " : ""}</dd>`).join("")}</div>`;
      };
      const casting = String(entry.cast ?? "").trim().toLowerCase();
      const cast = ["1", "2", "3", "r", "f"].includes(casting) ? `{@as ${casting}}` : entry.cast;
      const traditions = Array.isArray(entry.traditions) ? entry.traditions.filter(value => typeof value === "string" && value.trim()).join(", ") : entry.traditions;
      const domains = Array.isArray(entry.domain) ? entry.domain.filter(value => typeof value === "string" && value.trim()).join(", ") : entry.domain;
      const fields = spell
        ? [
          [hasContent(domains) ? ["Domain", domains] : ["Traditions", traditions]],
          [["Cast", cast], ["Cost", entry.cost]],
          [["Trigger", entry.trigger], ["Requirements", entry.requirements]],
          [["Range", entry.range], ["Area", entry.area], ["Targets", entry.targets]],
          [["Defense", entry.defense ?? entry.savingThrow], ["Duration", entry.duration]],
        ].map(fieldGroup).join("")
        : [["Access", entry.access], ["Prerequisites", entry.prerequisites], ["Frequency", entry.frequency], ["Trigger", entry.trigger], ["Requirements", entry.requirements], ["Cost", entry.cost]]
          .filter(([, value]) => hasContent(value)).map(([label, value]) => field(label, value)).join("");
      const metadata = fields ? `<dl class="ability-fields">${fields}</dl>` : "";
      const effect = entry.effect ?? children;
      const description = hasContent(effect) ? `<div class="ability-effect">${blocks(effect, level + 1)}</div>` : "";
      const heightened = spell && Array.isArray(entry.heightened) ? entry.heightened.filter(value => value && typeof value === "object" && hasContent(value.entries ?? value.entry)).map(value => {
        const rank = typeof value.level === "string" ? value.level.trim() : Number.isInteger(value.level) && value.level >= 0 ? String(value.level) : "";
        return field(rank ? `Heightened (${inline(rank)})` : "Heightened", value.entries ?? value.entry);
      }).join("") : "";
      const special = spell
        ? heightened ? `<dl class="ability-fields ability-special">${heightened}</dl>` : ""
        : hasContent(entry.special) ? `<dl class="ability-fields ability-special">${field("Special", entry.special)}</dl>` : "";
      const compactClass = !spell && entry.compact === true ? " ability-block--compact" : "";
      return `<section class="ability-block${spell ? " spell-block" : ""}${compactClass}" aria-labelledby="${escapeHtml(id)}"><header class="ability-header">${title}</header><div class="ability-content">${traitRow}${metadata}${description}${special}</div></section>`;
    }
    if (type === "formula") {
      const label = entry.name ? `<p class="formula-label">${inline(entry.name)}</p>` : "";
      return `<div class="rule-formula">${label}<div class="formula-body">${blocks(children, level)}</div></div>`;
    }
    if (type === "clarification") {
      const title = inline(entry.name || "Paizo Clarification");
      const icon = '<svg class="clarification-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>';
      const toggle = '<svg class="clarification-toggle" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
      return `<details class="paizo-clarification"${entry.open === true ? " open" : ""}><summary>${icon}<span>${title}</span>${toggle}</summary><div class="clarification-body">${blocks(children, level)}</div></details>`;
    }
    if (type === "box-section") {
      const title = entry.name ? heading(entry.name, level, entry) : "";
      const id = entry.name ? headings.at(-1).id : null;
      const label = id ? ` aria-labelledby="${escapeHtml(id)}"` : "";
      return `<section class="box-section"${label}>${title}${blocks(children, level + 1)}</section>`;
    }
    if (type === "box") {
      const title = entry.name ? heading(entry.name, level, entry) : "";
      const id = entry.name ? headings.at(-1).id : null;
      const label = id ? ` aria-labelledby="${escapeHtml(id)}"` : "";
      return `<aside class="rule-box"${label}>${title}<div class="rule-box-content">${blocks(children, level + 1)}</div></aside>`;
    }
    if (type === "list") {
      const ordered = entry.style === "list-decimal" || entry.ordered === true;
      const tag = ordered ? "ol" : "ul";
      const plain = entry.style === "list-no-bullets";
      const columns = Number.isSafeInteger(entry.columns) && entry.columns >= 2;
      const classes = [plain && "list-no-bullets", columns && "list-columns"].filter(Boolean);
      const attributes = `${classes.length ? ` class="${classes.join(" ")}"` : ""}${plain ? ' role="list"' : ""}${columns ? ` style="--list-columns: ${entry.columns}"` : ""}`;
      const title = entry.name ? heading(entry.name, level, entry) : "";
      return `${title}<${tag}${attributes}>${(entry.items ?? []).map(item => `<li>${block(item, level + 1)}</li>`).join("")}</${tag}>`;
    }
    if (type === "table") {
      const labels = entry.colLabels ?? [];
      const rows = entry.rows ?? [];
      const dialogue = entry.style === "table-dialogue";
      const tableAttributes = dialogue ? ' class="dialogue-table"' : "";
      const columns = dialogue ? '<colgroup><col class="dialogue-speaker-column"><col></colgroup>' : "";
      const cellSpan = (value, key) => Number.isInteger(value?.[key]) && value[key] > 0 && value[key] <= 1000 ? value[key] : 1;
      const attributes = value => ["rowSpan", "colSpan"].map(key => cellSpan(value, key) > 1 ? ` ${key.toLowerCase()}="${cellSpan(value, key)}"` : "").join("");
      let span = Math.max(1, labels.reduce((count, value) => count + cellSpan(value, "colSpan"), 0));
      const occupied = [];
      const body = rows.map(row => {
        let column = 0;
        const cells = (Array.isArray(row) ? row : row.row ?? []).map((value, index) => {
          while (occupied[column] > 0) column++;
          const width = cellSpan(value, "colSpan");
          for (let offset = 0; offset < width; offset++) occupied[column + offset] = cellSpan(value, "rowSpan");
          column += width;
          const header = value?.rowHeader === true || (dialogue && index === 0);
          return header ? `<th scope="row"${attributes(value)}>${cell(value)}</th>` : `<td${attributes(value)}>${cell(value)}</td>`;
        }).join("");
        span = Math.max(span, occupied.length, column);
        for (let column = 0; column < occupied.length; column++) occupied[column] = Math.max(0, (occupied[column] || 0) - 1);
        return `<tr>${cells}</tr>`;
      }).join("");
      const notes = (Array.isArray(entry.footnotes) ? entry.footnotes : [entry.footnotes]).filter(value => value != null && (typeof value !== "string" || value.trim()));
      const footer = notes.length ? `<tfoot><tr><td class="table-footnotes" colspan="${span}">${blocks(notes, level + 1)}</td></tr></tfoot>` : "";
      return `<div class="table-wrap"><table${tableAttributes}>${entry.caption ? `<caption>${inline(entry.caption)}</caption>` : ""}${columns}${labels.length ? `<thead><tr>${labels.map(label => `<th scope="col"${attributes(label)}>${cell(label)}</th>`).join("")}</tr></thead>` : ""}<tbody>${body}</tbody>${footer}</table></div>`;
    }
    if (type === "image") {
      const href = safeHref(entry.href?.url ?? entry.href?.path ?? entry.href ?? entry.url);
      if (!href) return "";
      const alt = inlineText(entry.alt ?? entry.title ?? "");
      const label = alt ? `Enlarge image: ${alt}` : "Enlarge image";
      const expand = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
      return `<figure class="rule-image${entry.align === "right" ? " rule-image--right" : ""}"><a class="rule-image-link" href="${escapeHtml(href)}" data-image-viewer aria-label="${escapeHtml(label)}"><img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" loading="lazy"><span class="image-expand" aria-hidden="true">${expand}</span></a>${entry.title ? `<figcaption>${inline(entry.title)}</figcaption>` : ""}</figure>`;
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
    const title = entry.name ? heading(entry.name, sectionLevel, entry) : "";
    const html = `${title}${blocks(children, sectionLevel + (entry.name ? 1 : 0))}`;
    return ["inset", "insetReadaloud", "sidebar"].includes(type) ? `<aside>${html}</aside>` : html;
  };
  return { html: blocks(content.entries ?? content.entry ?? [], 2), headings };
}
