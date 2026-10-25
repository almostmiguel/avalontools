// Run before the stylesheet so a saved theme is applied before the first paint.
(() => {
  const storageKey = "avalon-theme";
  const normalizeTheme = value => value === "light" ? "light" : "dark";
  let theme = "dark";
  try { theme = normalizeTheme(window.localStorage.getItem(storageKey)); } catch { /* Storage may be blocked. */ }
  document.documentElement.dataset.theme = theme;

  const updateControls = (announce = false) => {
    for (const button of document.querySelectorAll("[data-theme-choice]")) {
      button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
    }
    const status = document.querySelector("#theme-status");
    if (status && announce) status.textContent = `${theme === "dark" ? "Dark" : "Light"} mode enabled.`;
  };
  const apply = value => {
    theme = normalizeTheme(value);
    document.documentElement.dataset.theme = theme;
    updateControls(true);
  };

  const setup = () => {
    updateControls();
    for (const button of document.querySelectorAll("[data-theme-choice]")) {
      button.addEventListener("click", () => {
        apply(button.dataset.themeChoice);
        try { window.localStorage.setItem(storageKey, theme); } catch { /* The selection still works for this visit. */ }
      });
    }
    const settings = document.querySelector("#site-settings");
    if (!settings) return;
    document.addEventListener("click", event => {
      if (!settings.contains(event.target)) settings.open = false;
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && settings.open) {
        settings.open = false;
        settings.querySelector("summary").focus();
      }
    });
  };
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) apply(event.key === null ? "dark" : event.newValue);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
