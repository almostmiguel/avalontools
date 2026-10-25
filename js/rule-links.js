import { escapeHtml } from "./content-renderer.js";
import { renderRuleBody } from "./rules-library.js";

export function renderRulePreview(name, source, registry) {
  const resolution = registry.resolve(name, source);
  const target = resolution.target;
  const title = escapeHtml(target?.name || name);
  const header = `<header class="rule-preview-heading"><h2 id="rule-preview-title">${title}</h2><span>Rules</span><button type="button" data-close-rule-preview aria-label="Close rule preview">×</button></header>`;
  if (!target) {
    const message = resolution.status === "ambiguous"
      ? "More than one entry has this name. Mark only the main definition with ruleDefault: true, or give the intended entry a unique id and use that id in the rule tag."
      : "No matching rule has been added. Check the name and source, or add its definition to the rules collection.";
    return `${header}<div class="rule-preview-body"><p>${escapeHtml(message)}</p></div>`;
  }
  const body = renderRuleBody(target, { registry }, { anchorPrefix: "rule-preview-section" });
  const page = target.page && target.setting !== "original" ? ` <span>pg. ${target.page}</span>` : "";
  const sourceLabel = target.setting === "modified" ? "Adapted from" : target.setting === "original" ? "Reference" : "Source";
  return `${header}<p class="rule-preview-source">${sourceLabel} ${escapeHtml(target.sourceName)}${page}</p><div class="rule-preview-body">${body || "<p>No description has been added yet.</p>"}</div>`;
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

export function attachRulePreviews({ document, window, registry }) {
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
    panel.innerHTML = renderRulePreview(link.dataset.ruleName, link.dataset.ruleSource, registry);
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
  const ruleLink = target => target?.closest?.("[data-rule-name]");
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
