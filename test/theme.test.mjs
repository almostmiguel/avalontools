import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const script = await read("js/theme.js");

class Target {
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }
}

function environment({ saved, blocked = false, loading = false } = {}) {
  const storage = new Map(saved === undefined ? [] : [["avalon-theme", saved]]);
  const window = new Target();
  window.localStorage = {
    getItem(key) { if (blocked) throw Error("Storage blocked"); return storage.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error("Storage blocked"); storage.set(key, value); },
  };
  const buttons = ["dark", "light"].map(themeChoice => {
    const button = new Target();
    button.dataset = { themeChoice };
    button.attributes = {};
    button.setAttribute = (key, value) => { button.attributes[key] = value; };
    return button;
  });
  const summary = { focused: false, focus() { this.focused = true; } };
  const settings = { open: false, contains: target => target === settings || target === summary || buttons.includes(target), querySelector: () => summary, matches: () => true };
  const status = { textContent: "" };
  const document = new Target();
  document.documentElement = { dataset: {} };
  document.readyState = loading ? "loading" : "complete";
  document.querySelectorAll = selector => selector === "[data-theme-choice]" ? buttons : [settings];
  document.querySelector = selector => selector === "#site-settings" ? settings : status;
  vm.runInNewContext(script, { window, document });
  return { window, document, buttons, storage, settings, summary, status, theme: () => document.documentElement.dataset.theme };
}

test("dark is the default and invalid saved values cannot select another theme", () => {
  assert.equal(environment().theme(), "dark");
  assert.equal(environment({ saved: "unknown" }).theme(), "dark");
  const page = environment();
  assert.equal(page.buttons[0].attributes["aria-pressed"], "true");
  assert.equal(page.buttons[1].attributes["aria-pressed"], "false");
});

test("a saved theme applies before DOM readiness and synchronizes controls afterward", () => {
  const page = environment({ saved: "light", loading: true });
  assert.equal(page.theme(), "light");
  assert.equal(page.buttons[1].listeners.size, 0);
  page.document.emit("DOMContentLoaded");
  assert.equal(page.buttons[1].attributes["aria-pressed"], "true");
  page.buttons[0].emit("click");
  assert.equal(page.theme(), "dark");
});

test("theme buttons save the choice, update accessible state, and restore on another page", () => {
  const page = environment();
  page.buttons[1].emit("click");
  assert.equal(page.theme(), "light");
  assert.equal(page.storage.get("avalon-theme"), "light");
  assert.equal(page.buttons[0].attributes["aria-pressed"], "false");
  assert.equal(page.buttons[1].attributes["aria-pressed"], "true");
  assert.equal(page.status.textContent, "Light mode enabled.");
  assert.equal(environment({ saved: page.storage.get("avalon-theme") }).theme(), "light");
  page.buttons[0].emit("click");
  assert.equal(page.storage.get("avalon-theme"), "dark");
});

test("theme switching still works when browser storage is blocked", () => {
  const page = environment({ blocked: true });
  assert.equal(page.theme(), "dark");
  assert.doesNotThrow(() => page.buttons[1].emit("click"));
  assert.equal(page.theme(), "light");
});

test("storage changes synchronize open tabs and clearing preferences restores dark", () => {
  const page = environment();
  page.window.emit("storage", { key: "avalon-theme", newValue: "light" });
  assert.equal(page.theme(), "light");
  assert.equal(page.buttons[1].attributes["aria-pressed"], "true");
  page.window.emit("storage", { key: "other", newValue: "dark" });
  assert.equal(page.theme(), "light");
  page.window.emit("storage", { key: null });
  assert.equal(page.theme(), "dark");
});

test("settings dismisses outside or on Escape", () => {
  const page = environment();
  page.settings.open = true;
  page.document.emit("click", { target: page.buttons[0] });
  assert.equal(page.settings.open, true);
  page.document.emit("click", { target: {} });
  assert.equal(page.settings.open, false);
  page.settings.open = true;
  page.document.emit("keydown", { key: "Escape" });
  assert.equal(page.settings.open, false);
  assert.equal(page.summary.focused, true);

});

test("every page loads the theme before styles and provides accessible settings", async () => {
  for (const path of ["index.html", "rules.html", "rule.html"]) {
    const html = await read(path);
    assert.ok(html.indexOf('src="js/theme.js"') < html.indexOf('href="css/site.css"'), path);
    assert.match(html, /<summary aria-label="Settings"/);
    assert.match(html, /data-theme-choice="dark"/);
    assert.match(html, /data-theme-choice="light"/);
    assert.match(html, /id="theme-status" role="status"/);
  }
  const css = await read("css/site.css");
  const rulesCss = await read("css/rules.css");
  assert.match(rulesCss, /\.rule-article \{[^}]*background: var\(--paper\)/);
});

test("both palettes maintain readable primary, secondary, and content text contrast", async () => {
  const css = await read("css/site.css");
  const variables = block => Object.fromEntries([...block.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map(([, name, color]) => [name, color]));
  const dark = variables(css.match(/^:root \{([^}]+)\}/m)[1]);
  const light = { ...dark, ...variables(css.match(/:root\[data-theme="light"\] \{([^}]+)\}/)[1]) };
  const luminance = color => color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  for (const [theme, palette] of Object.entries({ dark, light })) {
    for (const [fg, bg] of [["text", "background"], ["muted", "background"], ["accent", "background"], ["ink", "paper"], ["content-heading", "paper"], ["content-link", "paper"], ["content-muted", "paper"], ["callout-text", "callout-bg"], ["callout-heading", "callout-bg"], ["callout-heading", "preview-heading"], ["setting-adapted", "paper"], ["setting-original", "paper"], ["setting-adapted", "panel"], ["setting-original", "panel"]]) {
      const a = luminance(palette[fg]), b = luminance(palette[bg]);
      const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      assert.ok(contrast >= 4.5, `${theme} ${fg}/${bg}: ${contrast.toFixed(2)}`);
    }
  }
});
