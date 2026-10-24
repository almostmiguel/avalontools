import { escapeHtml, inlineText } from "./book-renderer.js";

// Heading levels, rather than JSON nesting, define the visible contents tree.
export function renderContents(headings) {
  const roots = [];
  const stack = [];
  for (const heading of headings.filter(item => item.tocLevel >= 1 && item.tocLevel <= 2)) {
    const node = { ...heading, children: [] };
    while (stack.length && stack.at(-1).tocLevel >= node.tocLevel) stack.pop();
    (stack.at(-1)?.children || roots).push(node);
    stack.push(node);
  }
  const list = nodes => `<ol class="section-links">${nodes.map(node => {
    const link = `<a href="#${escapeHtml(node.id)}">${escapeHtml(inlineText(node.name))}</a>`;
    return `<li class="toc-h${node.tocLevel}">${node.children.length ? `<details class="toc-branch" open><summary>${link}</summary>${list(node.children)}</details>` : link}</li>`;
  }).join("")}</ol>`;
  return roots.length ? list(roots) : "";
}

export function attachReaderControls({ document, window, reader, contents }) {
  const toggleFor = body => [...reader.querySelectorAll("[data-section-toggle]")].find(button => button.getAttribute("aria-controls") === body.id);
  const setExpanded = (button, expanded) => {
    const body = document.getElementById(button.getAttribute("aria-controls"));
    if (!body || !reader.contains(body)) return;
    body.hidden = !expanded;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${button.dataset.sectionName}`);
    button.querySelector("span").textContent = expanded ? "−" : "+";
  };
  const reveal = id => {
    const target = document.getElementById(id);
    if (!target || !reader.contains(target)) return;
    for (let element = target; element && element !== reader; element = element.parentElement) {
      if (element.classList.contains("section-body")) {
        const button = toggleFor(element);
        if (button) setExpanded(button, true);
      }
    }
    // Reveal the destination's own text, not just its heading.
    const button = [...reader.querySelectorAll("[data-section-toggle]")].find(item => item.getAttribute("aria-controls") === `${id}-content`);
    if (button) setExpanded(button, true);
    for (const link of contents.querySelectorAll('a[href^="#"]')) {
      if (link.getAttribute("href") !== `#${id}`) continue;
      for (let element = link.parentElement; element && element !== contents; element = element.parentElement) {
        if (element.tagName === "DETAILS") element.open = true;
      }
    }
  };
  const onReaderClick = event => {
    const button = event.target.closest?.("[data-section-toggle]");
    if (button && reader.contains(button)) setExpanded(button, button.getAttribute("aria-expanded") !== "true");
  };
  const onContentsClick = event => {
    const action = event.target.closest?.("[data-toc-action]");
    if (action && contents.contains(action)) {
      const expanded = action.dataset.tocAction === "expand";
      for (const branch of contents.querySelectorAll(".toc-chapter, .toc-branch")) branch.open = expanded;
    }
    const link = event.target.closest?.('a[href^="#"]');
    if (link && contents.contains(link)) reveal(link.getAttribute("href").slice(1));
  };
  const onHashChange = () => {
    let id = window.location.hash.slice(1);
    try { id = decodeURIComponent(id); } catch { /* Malformed fragments simply do not match. */ }
    reveal(id);
    document.getElementById(id)?.scrollIntoView();
  };
  reader.addEventListener("click", onReaderClick);
  contents.addEventListener("click", onContentsClick);
  window.addEventListener("hashchange", onHashChange);
  return { reveal, destroy() {
    reader.removeEventListener("click", onReaderClick);
    contents.removeEventListener("click", onContentsClick);
    window.removeEventListener("hashchange", onHashChange);
  } };
}
