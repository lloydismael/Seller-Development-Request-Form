(() => {
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const key = "booking-color-mode";
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  if (!["light", "dark"].includes(preference)) preference = null;
  const apply = mode => {
    root.dataset.colorMode = mode;
    document.getElementById("themeToggle")?.setAttribute("aria-checked", String(mode === "dark"));
  };
  apply(preference || (system.matches ? "dark" : "light"));
  system.addEventListener("change", e => {
    if (!preference) apply(e.matches ? "dark" : "light");
  });
  window.addEventListener("storage", e => {
    if (e.key !== key && e.key !== null) return;
    preference = ["light", "dark"].includes(e.newValue) ? e.newValue : null;
    apply(preference || (system.matches ? "dark" : "light"));
  });
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;
    apply(root.dataset.colorMode);
    let timer;
    toggle.addEventListener("click", () => {
      preference = root.dataset.colorMode === "dark" ? "light" : "dark";
      if (!reducedMotion.matches) {
        clearTimeout(timer);
        root.classList.add("theme-switching");
        timer = setTimeout(() => root.classList.remove("theme-switching"), 500);
      }
      apply(preference);
      try { localStorage.setItem(key, preference); } catch {}
    });
  });
})();
