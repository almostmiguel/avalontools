// Shared hover and keyboard previews for rules and reference catalogs.
import { escapeHtml, renderContent } from "./content-renderer.js";
import { renderRuleBody } from "./rule-library.js";
import { createLazyResource, loadJson, renderReaderFooter } from "./reference-data.js";
import { actionTimeHtml, createActionLibrary, createCatalog, renderActionBody } from "./reference-library.js";

const previewHeading = (title, label, headingId = "rule-preview-title", suffix = "") => `<header class="rule-preview-heading"><h2 id="${headingId}">${escapeHtml(title)}${suffix}</h2><span>${label}</span></header>`;

export function renderRulePreview(name, source, registry) {
  const resolution = registry.resolve(name, source);
  const target = resolution.target;
  const header = previewHeading(target?.name || name, "Rule");
  if (!target) {
    const message = resolution.status === "ambiguous" ? "This reference matches more than one rule. Open a specific rule from the Rules page."
      : "No matching rule has been added. Check the name and source, or open the Rules page.";
    return `${header}<div class="rule-preview-body"><p>${escapeHtml(message)}</p></div>`;
  }
  const body = renderRuleBody(target, { registry }, { anchorPrefix: "rule-preview-section" });
  return `${header}<div class="rule-preview-body">${body}</div>${renderReaderFooter(target)}`;
}

export function renderActionPreview(name, source, actions, rules) {
  const resolution = actions.registry.resolve(name, source);
  const target = resolution.target;
  const header = previewHeading(target?.name || name, "Action", undefined, target ? ` ${actionTimeHtml(target)}` : "");
  if (!target) {
    const message = resolution.status === "ambiguous" ? "More than one action matches this name. Choose its entry on the Actions page."
      : "No matching action has been added. Check the name and source, or open the Actions page.";
    return `${header}<div class="rule-preview-body"><p>${message}</p></div>`;
  }
  const body = renderActionBody(target, actions, rules, { anchorPrefix: "action-preview-section" });
  return `${header}<div class="rule-preview-body">${body}</div>${renderReaderFooter(target)}`;
}

export function renderCatalogPreview(name, source, catalog, { plural, singular, headingId }) {
  const resolution = catalog.registry.resolve(name, source);
  const target = resolution.target;
  const header = previewHeading(target?.name || name, singular[0].toUpperCase() + singular.slice(1), headingId);
  if (!target) {
    const message = resolution.status === "ambiguous" ? `More than one ${singular} has this name. Choose an entry from the ${plural} page.`
      : `No matching ${singular} has been added. Check the name and source, or open the ${plural} page.`;
    return `${header}<div class="rule-preview-body"><p>${escapeHtml(message)}</p></div>`;
  }
  if (catalog.renderPreview) return catalog.renderPreview(target);
  const body = renderContent({ entries: target.entry.entries }, { source: target.source, anchorPrefix: `${singular}-preview-section` }).html || "<p>No description has been added yet.</p>";
  return `${header}<div class="rule-preview-body">${body}</div>${renderReaderFooter(target)}`;
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

export function attachReferencePreviews({ document, window, registry, actions = null, conditions = null, skills = null, feats = null, classes = null, traits = null, backgrounds = null, archetypes = null, ancestries = null, parentPreview = null,
  loadActions = () => loadJson("data/actions.json").then(createActionLibrary),
  loadConditions = () => loadJson("data/conditions.json").then(data => createCatalog(data, { collection: "conditions", href: "conditions.html" })),
  loadSkills = () => loadJson("data/skills.json").then(data => createCatalog(data, { collection: "skills", href: "skills.html" })),
  loadTraits = () => loadJson("data/traits.json").then(data => createCatalog(data, { collection: "traits", href: "traits.html" })),
  loadBackgrounds = () => loadJson("data/backgrounds.json").then(data => createCatalog(data, { collection: "backgrounds", href: "backgrounds.html" })),
  loadArchetypes = () => loadJson("data/archetypes.json").then(data => createCatalog(data, { collection: "archetypes", href: "archetypes.html" })),
  loadAncestries = () => Promise.all([loadJson("data/ancestries.json"), import("./ancestry-reader.js")]).then(([data, module]) => module.createAncestryCatalog(data)),
  loadFeats = () => Promise.all([loadJson("data/feats.json"), import("./feat-library.js")]).then(([data, module]) => module.createFeatCatalog(data)),
  loadClasses = () => Promise.all([loadJson("data/classes.json"), import("./class-reader.js")]).then(([data, module]) => module.createClassOverviewCatalog(data)) }) {
  const panel = document.createElement("section");
  panel.id = parentPreview ? "trait-preview" : "rule-preview";
  panel.className = "rule-preview";
  panel.hidden = true;
  panel.tabIndex = -1;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", `${panel.id}-title`);
  document.body.append(panel);
  let current = null;
  let closeTimer;
  let openTimer;
  let restoringFocus = false;
  let nestedPreview;
  const actionResource = createLazyResource(actions, loadActions);
  const catalogs = {
    ancestry: { plural: "Ancestries", singular: "ancestry", resource: createLazyResource(ancestries, loadAncestries) },
    background: { plural: "Backgrounds", singular: "background", resource: createLazyResource(backgrounds, loadBackgrounds) },
    archetype: { plural: "Archetypes", singular: "archetype", resource: createLazyResource(archetypes, loadArchetypes) },
    condition: { plural: "Conditions", singular: "condition", resource: createLazyResource(conditions, loadConditions) },
    skill: { plural: "Skills", singular: "skill", resource: createLazyResource(skills, loadSkills) },
    feat: { plural: "Feats", singular: "feat", resource: createLazyResource(feats, loadFeats) },
    class: { plural: "Classes", singular: "class", resource: createLazyResource(classes, loadClasses) },
    trait: { plural: "Traits", singular: "trait", headingId: `${panel.id}-title`, resource: createLazyResource(traits, loadTraits) },
  };
  let version = 0;
  const getActions = actionResource.load;
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
  const containsPreview = target => panel.contains(target) || Boolean(nestedPreview?.panel.contains(target));
  const hide = (restoreFocus = false) => {
    nestedPreview?.hide();
    version++;
    window.clearTimeout(openTimer);
    cancelClose();
    const link = current;
    current = null;
    panel.hidden = true;
    panel.removeAttribute("aria-busy");
    link?.removeAttribute("aria-describedby");
    link?.removeAttribute("aria-controls");
    if (restoreFocus && link && containsPreview(document.activeElement)) {
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
    const catalogType = Object.keys(catalogs).find(kind => link.dataset[`${kind}Name`] != null);
    if (catalogType) {
      const { resource, ...labels } = catalogs[catalogType];
      const settings = { ...labels, catalog: resource.current, get: resource.load };
      panel.dataset.referenceKind = catalogType;
      current = link;
      const requestVersion = ++version;
      const name = link.dataset[`${catalogType}Name`], source = link.dataset[`${catalogType}Source`];
      panel.setAttribute("aria-busy", String(!settings.catalog));
      panel.innerHTML = settings.catalog
        ? renderCatalogPreview(name, source, settings.catalog, settings)
        : `${previewHeading(name, settings.plural, settings.headingId)}<div class="rule-preview-body"><p role="status">Loading ${settings.singular}…</p></div>`;
      panel.hidden = false;
      link.setAttribute("aria-controls", panel.id);
      link.setAttribute("aria-describedby", panel.id);
      position();
      if (!settings.catalog) return settings.get().then(library => {
        if (current !== link || version !== requestVersion) return;
        panel.innerHTML = renderCatalogPreview(name, source, library, settings);
        panel.setAttribute("aria-busy", "false");
        position();
      }).catch(() => {
        if (current !== link || version !== requestVersion) return;
        panel.innerHTML = `${previewHeading(name, settings.plural, settings.headingId)}<div class="rule-preview-body"><p>Unable to load this preview. Follow the link to open ${settings.plural}, or try again.</p></div>`;
        panel.setAttribute("aria-busy", "false");
        position();
      });
      return;
    }
    const action = link.dataset.actionName != null;
    if (!action && !registry) return;
    panel.dataset.referenceKind = action ? "action" : "rule";
    current = link;
    const requestVersion = ++version;
    const rules = registry ? { registry } : undefined;
    if (action && actionResource.current) link.dataset.actionResolved = String(actionResource.current.registry.resolve(link.dataset.actionName, link.dataset.actionSource).status === "found");
    panel.setAttribute("aria-busy", String(action && !actionResource.current));
    panel.innerHTML = action
      ? actionResource.current ? renderActionPreview(link.dataset.actionName, link.dataset.actionSource, actionResource.current, rules)
        : `${previewHeading(link.dataset.actionName, "Actions")}<div class="rule-preview-body"><p role="status">Loading action…</p></div>`
      : renderRulePreview(link.dataset.ruleName, link.dataset.ruleSource, registry);
    void validateActions(panel).then(position);
    panel.hidden = false;
    link.setAttribute("aria-controls", panel.id);
    link.setAttribute("aria-describedby", panel.id);
    position();
    if (action && !actionResource.current) return getActions().then(library => {
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
      if (!containsPreview(document.activeElement) && document.activeElement !== current) hide();
    }, 180);
  };
  const referenceSelector = parentPreview ? "[data-trait-name]" : [registry && "[data-rule-name]", "[data-action-name]", ...Object.keys(catalogs).map(kind => `[data-${kind}-name]`)].filter(Boolean).join(", ");
  const referenceLink = target => {
    const link = target?.closest?.(referenceSelector);
    return parentPreview && !parentPreview.contains(link) ? null : link;
  };
  const showNestedTrait = link => {
    if (!nestedPreview) {
      nestedPreview = attachReferencePreviews({ document, window, parentPreview: panel, traits: catalogs.trait.resource.current, loadTraits: catalogs.trait.resource.load });
      on(nestedPreview.panel, "pointerenter", cancelClose);
      on(nestedPreview.panel, "pointerleave", scheduleClose);
    }
    return nestedPreview.show(link);
  };
  on(document, "pointerover", event => {
    if (event.pointerType === "touch") return;
    const link = referenceLink(event.target);
    if (!link || link.contains(event.relatedTarget) || nestedPreview?.panel.contains(link)) return;
    if (panel.contains(link)) {
      if (!parentPreview && link.dataset.traitName != null) {
        cancelClose(); window.clearTimeout(openTimer);
        openTimer = window.setTimeout(() => showNestedTrait(link), 120);
      }
      return;
    }
    cancelClose();
    window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => show(link), 120);
  });
  on(document, "pointerout", event => {
    const link = referenceLink(event.target);
    if (link && !link.contains(event.relatedTarget) && !containsPreview(event.relatedTarget)) scheduleClose();
  });
  on(panel, "pointerenter", cancelClose);
  on(panel, "pointerleave", scheduleClose);
  on(document, "focusin", event => {
    if (restoringFocus || nestedPreview?.panel.contains(event.target)) return;
    if (panel.contains(event.target)) {
      const link = referenceLink(event.target);
      if (!parentPreview && link?.dataset.traitName != null) { cancelClose(); showNestedTrait(link); }
      return;
    }
    const link = referenceLink(event.target);
    if (link) show(link);
    else hide();
  });
  on(document, "focusout", event => {
    if (!containsPreview(event.relatedTarget) && event.relatedTarget !== current) scheduleClose();
  });
  on(document, "keydown", event => {
    if (event.key === "Escape") hide(true);
    if (event.key === "ArrowDown" && event.altKey && current === document.activeElement && !panel.hidden) {
      event.preventDefault();
      panel.focus();
    }
  });
  on(document, "pointerdown", event => {
    if (!containsPreview(event.target) && !current?.contains(event.target)) hide();
  });
  on(window, "resize", position);
  on(window, "scroll", position, true);
  on(panel, "load", position, true);
  return { show, hide, panel, validateActions, destroy() { hide(); nestedPreview?.destroy(); listeners.forEach(remove => remove()); panel.remove(); } };
}
