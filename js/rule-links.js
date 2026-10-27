import { escapeHtml } from "./content-renderer.js";
import { renderRuleBody } from "./rules-library.js";
import { renderRuleCitation } from "./rule-sources.js";
import { loadJson } from "./data-loader.js";
import { ACTION_CATEGORIES, createActionLibrary, actionTimeHtml, renderActionBody } from "./actions-library.js";

const previewHeading = (title, label) => `<header class="rule-preview-heading"><h2 id="rule-preview-title">${escapeHtml(title)}</h2><span>${label}</span></header>`;

export function renderRulePreview(name, source, registry) {
  const resolution = registry.resolve(name, source);
  const target = resolution.target;
  const header = previewHeading(target?.name || name, "Rules");
  if (!target) {
    const message = resolution.status === "ambiguous" ? "This reference matches more than one rule. Open a specific rule from the Rules page."
      : "No matching rule has been added. Check the name and source, or open the Rules page.";
    return `${header}<div class="rule-preview-body"><p>${escapeHtml(message)}</p></div>`;
  }
  const body = renderRuleBody(target, { registry }, { anchorPrefix: "rule-preview-section" });
  return `${header}<p class="rule-preview-source">${renderRuleCitation(target)}</p><div class="rule-preview-body">${body}</div>`;
}

export function renderActionPreview(name, source, actions, rules) {
  const resolution = actions.registry.resolve(name, source);
  const target = resolution.target;
  const header = previewHeading(target?.name || name, "Actions");
  if (!target) {
    const message = resolution.status === "ambiguous" ? "More than one action matches this name. Choose its entry on the Actions page."
      : "No matching action has been added. Check the name and source, or open the Actions page.";
    return `${header}<div class="rule-preview-body"><p>${message}</p></div>`;
  }
  const context = `${ACTION_CATEGORIES[target.category]} action${target.owners.length ? ` · ${target.owners.join(", ")}` : ""}`;
  const body = renderActionBody(target, actions, rules, { anchorPrefix: "action-preview-section" });
  return `${header}<p class="rule-preview-source">${renderRuleCitation(target)}</p><div class="rule-preview-body"><p class="action-preview-meta">${actionTimeHtml(target)}<span>${escapeHtml(context)}</span></p>${body}</div>`;
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

export function attachRulePreviews({ document, window, registry, actions = null, loadActions = () => loadJson("data/actions.json").then(createActionLibrary) }) {
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
  let actionCatalog = actions;
  let actionLoad;
  let version = 0;
  const getActions = () => {
    if (actionCatalog) return Promise.resolve(actionCatalog);
    if (!actionLoad) actionLoad = Promise.resolve().then(loadActions).then(library => {
      actionCatalog = library;
      return library;
    }).catch(error => { actionLoad = null; throw error; });
    return actionLoad;
  };
  const validateActions = async root => {
    const links = [...(root?.querySelectorAll?.("[data-action-name]") || [])]
      .filter(link => link.dataset.actionResolved == null);
    if (!links.length) return;
    try {
      const library = await getActions();
      for (const link of links) {
        link.dataset.actionResolved = String(library.registry.resolve(link.dataset.actionName, link.dataset.actionSource).status === "found");
      }
    } catch { /* Unverified links keep navigation, but never display a confirmed-action icon. */ }
  };
  const listeners = [];
  const on = (element, event, handler, options) => {
    element.addEventListener(event, handler, options);
    listeners.push(() => element.removeEventListener(event, handler, options));
  };
  const cancelClose = () => window.clearTimeout(closeTimer);
  const hide = (restoreFocus = false) => {
    version++;
    window.clearTimeout(openTimer);
    cancelClose();
    const link = current;
    current = null;
    panel.hidden = true;
    panel.removeAttribute("aria-busy");
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
    if (current === link && !panel.hidden) return position();
    if (current !== link) hide();
    const action = link.dataset.actionName != null;
    if (!action && !registry) return;
    panel.dataset.referenceKind = action ? "action" : "rule";
    current = link;
    const requestVersion = ++version;
    const rules = registry ? { registry } : undefined;
    if (action && actionCatalog) link.dataset.actionResolved = String(actionCatalog.registry.resolve(link.dataset.actionName, link.dataset.actionSource).status === "found");
    panel.setAttribute("aria-busy", String(action && !actionCatalog));
    panel.innerHTML = action
      ? actionCatalog ? renderActionPreview(link.dataset.actionName, link.dataset.actionSource, actionCatalog, rules)
        : `${previewHeading(link.dataset.actionName, "Actions")}<div class="rule-preview-body"><p role="status">Loading action…</p></div>`
      : renderRulePreview(link.dataset.ruleName, link.dataset.ruleSource, registry);
    void validateActions(panel).then(position);
    panel.hidden = false;
    link.setAttribute("aria-controls", panel.id);
    link.setAttribute("aria-describedby", panel.id);
    position();
    if (action && !actionCatalog) return getActions().then(library => {
      link.dataset.actionResolved = String(library.registry.resolve(link.dataset.actionName, link.dataset.actionSource).status === "found");
      if (current !== link || version !== requestVersion) return;
      panel.innerHTML = renderActionPreview(link.dataset.actionName, link.dataset.actionSource, library, rules);
      panel.setAttribute("aria-busy", "false");
      position();
    }).catch(() => {
      if (current !== link || version !== requestVersion) return;
      panel.innerHTML = `${previewHeading(link.dataset.actionName, "Actions")}<div class="rule-preview-body"><p>Unable to load this preview. Follow the link to open Actions, or try again.</p></div>`;
      panel.setAttribute("aria-busy", "false");
      position();
    });
  };
  const scheduleClose = () => {
    window.clearTimeout(openTimer);
    cancelClose();
    closeTimer = window.setTimeout(() => {
      if (!panel.contains(document.activeElement) && document.activeElement !== current) hide();
    }, 180);
  };
  const referenceLink = target => target?.closest?.(registry ? "[data-rule-name], [data-action-name]" : "[data-action-name]");
  on(document, "pointerover", event => {
    if (event.pointerType === "touch") return;
    const link = referenceLink(event.target);
    if (!link || panel.contains(link) || link.contains(event.relatedTarget)) return;
    cancelClose();
    window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => show(link), 120);
  });
  on(document, "pointerout", event => {
    const link = referenceLink(event.target);
    if (link && !link.contains(event.relatedTarget) && !panel.contains(event.relatedTarget)) scheduleClose();
  });
  on(panel, "pointerenter", cancelClose);
  on(panel, "pointerleave", scheduleClose);
  on(document, "focusin", event => {
    if (restoringFocus || panel.contains(event.target)) return;
    const link = referenceLink(event.target);
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
  on(window, "resize", position);
  on(window, "scroll", position, true);
  on(panel, "load", position, true);
  return { show, hide, panel, validateActions, destroy() { hide(); listeners.forEach(remove => remove()); panel.remove(); } };
}
