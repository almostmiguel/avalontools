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
    const menus = ["#site-settings", "#player-menu", "#game-master-menu", "#reference-menu"].map(selector => document.querySelector(selector)).filter(Boolean);
    document.addEventListener("click", event => {
      for (const menu of menus) {
        if (!menu.contains(event.target)) menu.open = false;
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      for (const menu of menus) {
        if (!menu.open) continue;
        menu.open = false;
        menu.querySelector("summary").focus();
      }
    });
  };
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) apply(event.key === null ? "dark" : event.newValue);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
