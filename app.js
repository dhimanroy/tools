/**
 * Minimal theme toggle logic for Tools Hub
 */
(function () {
  "use strict";

  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");

  function getPreferredTheme() {
    const saved = localStorage.getItem("tools_theme");
    if (saved) return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tools_theme", theme);
    if (themeIcon) {
      themeIcon.textContent = theme === "dark" ? "🌙" : "☀️";
    }
  }

  const currentTheme = getPreferredTheme();
  applyTheme(currentTheme);

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }
})();
