// Shared import-time conversion to the site's safe, native rich-content blocks.
import { DomUtils } from "htmlparser2";
const origin = "https://2e.aonprd.com/";

export const htmlText = node => DomUtils.textContent(node).replace(/\s+/g, " ").trim();
export const foldHtmlReference = value => value.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9]+/g, " ").trim();
const symbolNames = { "one-action": "1", "two-actions": "2", "three-actions": "3", reaction: "r", "free-action": "f" };

export function renderHtmlInline(nodes, references) {
  return nodes.map(node => {
    if (node.type === "text") return node.data.replace(/\s+/g, " ");
    if (["script", "style", "button", "input", "select"].includes(node.name) || /(?:^|\s)(?:hide-on-print|creature-spellbook-wrapper)(?:\s|$)/.test(node.attribs?.class || "")) return "";
    const children = () => renderHtmlInline(node.children || [], references);
    const classes = (node.attribs?.class || "").split(/\s+/);
    if (classes.includes("action")) {
      const symbol = symbolNames[htmlText(node).replace(/[\[\]]/g, "")];
      if (!symbol) throw new Error(`Unknown action symbol: ${htmlText(node)}`);
      return `{@as ${symbol}}`;
    }
    if (["b", "strong", "i", "em", "sup", "sub"].includes(node.name)) {
      const content = children();
      return content.trim() ? `{@${({ strong: "b", em: "i" })[node.name] || node.name} ${content}}` : "";
    }
    if (node.name === "a") {
      const label = htmlText(node), href = node.attribs.href || "";
      const path = href.replace(/^\//, "");
      const kind = { Feats: "feat", Classes: "class", Ancestries: "ancestry", Archetypes: "archetype", Backgrounds: "background", Rules: "rule", Familiars: "companion", Companions: "companion", Monsters: "creature", Spells: "spell", Actions: "action", Conditions: "condition", Skills: "skill", Traits: "trait", Equipment: "equipment", Weapons: "equipment", Armor: "equipment", Shields: "equipment", MonsterAbilities: references.creatureability ? "creatureability" : "action" }[/^(\w+)\.aspx\?ID=/i.exec(path)?.[1]];
      if (!label) return "";
      if (kind) {
        const lookup = references[kind];
        const canonical = (kind === "equipment" ? lookup?.byName.get(foldHtmlReference(label)) : null) || lookup?.byPath.get(path) || lookup?.byName.get(foldHtmlReference(label))
          || (kind === "condition" && /persistent.*damage/i.test(label) ? lookup?.byName.get("persistent damage") : null)
          || (["condition", "trait"].includes(kind) ? lookup?.names.find(name => foldHtmlReference(label).startsWith(foldHtmlReference(name) + " ")) : null);
        if (canonical) return `{@${kind} ${canonical}|${lookup.sourceByPath?.get(path) || lookup.sourceByName?.get(canonical) || (["spell", "equipment"].includes(kind) ? "PC1" : "")}${canonical !== label ? `|${label}` : ""}}`;
      }
      if (references.externalFallback && /^(Spells|Equipment|Weapons|Armor|Shields|Traits|MonsterAbilities|Feats|Classes|Ancestries|Archetypes|Backgrounds|Actions|Rules|Rituals)\.aspx\?ID=/.test(path)) return `{@link ${label}|${origin + path}}`;
      if (/^Monsters\.aspx\?ID=/.test(path)) return `{@link ${label}|${origin + path}}`;
      return children();
    }
    if (node.name === "br") return " ";
    return children();
  }).join("");
}

export function htmlContentBlocks(nodes, references) {
  const entries = [];
  let paragraph = "";
  const flush = () => { if (paragraph.trim()) entries.push(...paragraph.replace(/\s+/g, " ").trim().split(/;\s*(?=\{@b Stage \d)/)); paragraph = ""; };
  for (const node of nodes) {
    if (node.name === "br") { flush(); continue; }
    if (node.name === "hr") { flush(); if (entries.length && entries.at(-1)?.type !== "hr") entries.push({ type: "hr" }); continue; }
    if (["script", "style", "nethys-search"].includes(node.name) || /(?:^|\s)(?:hide-on-print|creature-spellbook-wrapper)(?:\s|$)/.test(node.attribs?.class || "")) continue;
    if (node.name === "details") {
      flush();
      const summary = (node.children || []).find(child => child.name === "summary");
      entries.push({ type: /clarification/.test(node.attribs?.class || "") ? "clarification" : "box", name: summary ? htmlText(summary) : "Details", entries: htmlContentBlocks((node.children || []).filter(child => child !== summary), references) });
      continue;
    }
    if (["p", "div"].includes(node.name)) { flush(); entries.push(...htmlContentBlocks(node.children || [], references)); continue; }
    if (["ul", "ol"].includes(node.name)) {
      flush();
      entries.push({ type: "list", ...(node.name === "ol" ? { ordered: true } : {}), items: (node.children || []).filter(child => child.name === "li").map(child => ({ entries: htmlContentBlocks(child.children || [], references) })) });
      continue;
    }
    if (node.name === "table") {
      flush();
      const rows = DomUtils.findAll(child => child.name === "tr", node.children || []).map(row => row.children.filter(cell => ["td", "th"].includes(cell.name)).map(cell => {
        const entry = renderHtmlInline(cell.children || [], references).trim();
        const rowSpan = Number(cell.attribs?.rowspan), colSpan = Number(cell.attribs?.colspan);
        return rowSpan > 1 || colSpan > 1 ? { entry, ...(rowSpan > 1 ? { rowSpan } : {}), ...(colSpan > 1 ? { colSpan } : {}) } : entry;
      }));
      const colLabels = rows.shift() || [];
      entries.push({ type: "table", colLabels, rows });
      continue;
    }
    if (/^h[2-6]$/.test(node.name || "")) { flush(); entries.push({ type: "h3", name: renderHtmlInline(node.children || [], references).trim(), entries: [] }); continue; }
    paragraph += renderHtmlInline([node], references);
  }
  flush();
  while (entries.at(-1)?.type === "hr") entries.pop();
  return entries;
}

