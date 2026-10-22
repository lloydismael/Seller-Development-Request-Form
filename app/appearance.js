(() => {
  const root = document.documentElement;
  const key = "booking-accessibility";
  let revealTimer;
  function reveal() {
    if (root.dataset.appearanceLoading !== "true") return;
    root.dataset.appearanceLoading = "false";
    clearTimeout(revealTimer);
  }
  if (root.dataset.waitForAppearance === "true") {
    root.dataset.appearanceLoading = "true";
    revealTimer = setTimeout(reveal, 1500);
  }
  let preferences = {};
  function read() {
    try { preferences = JSON.parse(localStorage.getItem(key) || "{}"); } catch { preferences = {}; }
    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) preferences = {};
  }
  function applyPreferences() {
    root.dataset.reduceMotion = preferences.reduceMotion === true ? "true" : "false";
    root.dataset.reduceTransparency = preferences.reduceTransparency === true ? "true" : "false";
  }
  const rgb = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16));
  const hex = channels => "#" + channels.map(value => Math.round(value).toString(16).padStart(2, "0")).join("");
  const luminance = color => rgb(color).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
  const mix = (a, b, amount) => hex(rgb(a).map((value, i) => value * (1 - amount) + rgb(b)[i] * amount));
  function palette(theme, mode) {
    const dark = mode === "dark";
    const background = (dark ? theme.darkBackground : theme.background) || (dark ? "#0f172a" : "#f8fafc");
    if (dark && !theme.darkPrimary && !theme.darkBackground) return {
      "--ui-bg":"#0f172a", "--ui-surface":"#1e293b", "--ui-raised":"#273449", "--ui-text":"#f1f5f9", "--ui-muted":"#cbd5e1",
      "--ui-border":"#64748b", "--ui-primary":"#5eead4", "--ui-primary-ink":"#0f172a", "--ui-focus":"#5eead4", "--ui-glass-rgb":"30 41 59", "--ui-glass-min-alpha":".9"
    };
    if (!dark && background.toLowerCase() === "#f8fafc" && (!theme.primary || theme.primary.toLowerCase() === "#0f766e")) return {
      "--ui-bg":"#f8fafc", "--ui-surface":"#ffffff", "--ui-raised":"#f1f5f9", "--ui-text":"#0f172a", "--ui-muted":"#475569",
      "--ui-border":"#cbd5e1", "--ui-primary":"#0f766e", "--ui-primary-ink":"#ffffff", "--ui-focus":"#0f766e", "--ui-glass-rgb":"255 255 255", "--ui-glass-min-alpha":".8"
    };
    const text = luminance(background) < .179 ? "#ffffff" : "#000000";
    const surface = mix(background, text === "#ffffff" ? "#000000" : "#ffffff", .35);
    const raised = mix(background, surface, .7);
    const readable = color => {
      for (let i = 0; i < 40 && [background, surface, raised].some(base => contrast(color, base) < 4.5); i++) color = mix(color, text, .12);
      return [background, surface, raised].some(base => contrast(color, base) < 4.5) ? text : color;
    };
    const primary = readable((dark ? theme.darkPrimary : theme.primary) || (dark ? "#5eead4" : "#0f766e"));
    const ink = contrast("#ffffff", primary) > contrast("#000000", primary) ? "#ffffff" : "#000000";
    const muted = readable(mix(surface, text, .9));
    let opacity = dark ? 90 : 80;
    // Increase opacity if a custom palette loses contrast over a bright or dark backdrop.
    while (opacity < 100 && ["#000000", "#ffffff"].some(backdrop => [text, muted, primary].some(color => contrast(color, mix(backdrop, surface, opacity / 100)) < 4.5))) opacity++;
    return { "--ui-bg":background, "--ui-surface":surface, "--ui-raised":raised, "--ui-text":text,
      "--ui-muted":muted, "--ui-border":mix(surface, text, .65), "--ui-primary":primary, "--ui-primary-ink":ink,
      "--ui-focus":primary, "--ui-glass-rgb":rgb(surface).join(" "), "--ui-glass-min-alpha":String(opacity / 100) };
  }
  const paletteKey = "booking-published-palette-v1";
  const colorFields = ["primary", "background", "darkPrimary", "darkBackground"];
  function cachedPalette() {
    try {
      const value = JSON.parse(localStorage.getItem(paletteKey));
      if (!value || value.version !== 1 || !value.colors || typeof value.colors !== "object" || Array.isArray(value.colors)) return;
      if (Object.keys(value.colors).some(name => !colorFields.includes(name) || typeof value.colors[name] !== "string" || !/^#[0-9a-f]{6}$/i.test(value.colors[name]))) return;
      return { ...value.colors };
    } catch {}
  }
  let currentTheme = cachedPalette(), previewTheme, publishedMaterial;
  const backdrops = ["soft", "shapes", "aurora", "grid", "waves", "corporate", "executive", "plain", "custom"];
  const customDefaults = { glassCustomA:"#0f766e", glassCustomB:"#94a3b8", glassCustomAngle:135, glassCustomPattern:"none", glassCustomDim:85 };
  const customImage = /^(?=.{1,500}$)(?:https:\/\/|\/(?!\/))[^\s"'()<>\\]+$/i;
  // Values are re-validated here so a malformed theme can never inject CSS.
  function applyCustomBackdrop(theme) {
    const color = (value, fallback) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    const range = (value, min, max, fallback) => Number.isFinite(value) && value >= min && value <= max ? value : fallback;
    const pattern = ["grid", "dots", "lines"].includes(theme.glassCustomPattern) ? theme.glassCustomPattern : "none";
    const image = typeof theme.glassCustomImage === "string" && customImage.test(theme.glassCustomImage) ? theme.glassCustomImage : "";
    const dim = range(theme.glassCustomDim, 70, 95, customDefaults.glassCustomDim);
    const set = (name, value) => root.style.setProperty(name, value);
    set("--bd-a", color(theme.glassCustomA, customDefaults.glassCustomA));
    set("--bd-b", color(theme.glassCustomB, customDefaults.glassCustomB));
    set("--bd-angle", `${range(theme.glassCustomAngle, 0, 360, customDefaults.glassCustomAngle)}deg`);
    set("--bd-image", image ? `url("${image}")` : "none");
    set("--bd-scrim", image ? `color-mix(in srgb,var(--ui-bg) ${dim}%,transparent)` : "transparent");
    ["grid", "dots", "lines"].forEach(name => set(`--bd-${name}-o`, pattern === name ? "1" : "0"));
  }
  function applyMaterial(theme) {
    root.dataset.glass = theme.glassEnabled ? "enabled" : "disabled";
    root.dataset.glassStyle = !theme.glassEnabled ? "solid" : theme.glassBlur <= 6 ? "liquid" : "frosted";
    // "auto" keeps the original gentle wash for solid surfaces and the shapes backdrop for glass.
    root.dataset.backdrop = backdrops.includes(theme.glassBackdrop) ? theme.glassBackdrop : theme.glassEnabled ? "shapes" : "soft";
    applyCustomBackdrop(theme);
    root.style.setProperty("--glass-alpha", String(1 - theme.glassTransparency / 100));
    root.style.setProperty("--glass-blur", `${theme.glassBlur}px`);
  }
  function applyColors() {
    const theme = previewTheme || currentTheme;
    if (!theme) return;
    Object.entries(palette(theme, root.dataset.colorMode)).forEach(([key, value]) => root.style.setProperty(key, value));
    root.style.setProperty("--primary", "var(--ui-primary)");
    root.style.setProperty("--primary-2", "var(--ui-primary)");
    root.style.setProperty("--primary-ink", "var(--ui-primary-ink)");
    root.style.setProperty("--bg", "var(--ui-bg)");
  }
  read(); applyPreferences(); applyColors();
  window.BookingAppearance = {
    palette,
    reveal,
    refreshColors: applyColors,
    previewColors(theme) {
      previewTheme = { ...theme };
      applyColors();
      // Surface material previews live across the workspace, alongside the colors.
      if (typeof theme.glassEnabled === "boolean" && Number.isFinite(theme.glassBlur) && Number.isFinite(theme.glassTransparency)) applyMaterial(theme);
    },
    clearColorPreview() {
      previewTheme = null;
      applyColors();
      if (publishedMaterial) applyMaterial(publishedMaterial);
    },
    apply(theme, { published = true } = {}) {
      previewTheme = null;
      currentTheme = { ...theme };
      if (published) {
        const colors = Object.fromEntries(colorFields.filter(name => typeof theme[name] === "string" && /^#[0-9a-f]{6}$/i.test(theme[name])).map(name => [name, theme[name]]));
        try { localStorage.setItem(paletteKey, JSON.stringify({ version:1, colors })); } catch {}
      }
      applyColors();
      root.dataset.density = theme.density || "comfortable";
      root.dataset.width = theme.width || "standard";
      root.dataset.cardStyle = theme.cardStyle || "outlined";
      publishedMaterial = { ...theme };
      applyMaterial(theme);
    },
    preferences: () => ({ reduceMotion:preferences.reduceMotion === true, reduceTransparency:preferences.reduceTransparency === true }),
    setPreference(name, value) {
      if (!["reduceMotion", "reduceTransparency"].includes(name)) return;
      preferences[name] = value === true;
      applyPreferences();
      try { localStorage.setItem(key, JSON.stringify(preferences)); } catch {}
    }
  };
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    read(); applyPreferences();
  });
})();
