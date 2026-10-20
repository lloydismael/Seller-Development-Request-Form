/* Admin-only UI. Transport and schema invariants belong to BookingStore/FormSchema. */
(function () {
  "use strict";
  const schema = window.FormSchema;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const label = c => typeof c === "string" ? c : c.label;
  const option = (value, title, selected) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(title)}</option>`;
  const select = (values, selected) => values.map(v => option(v, v, selected)).join("");
  const typeNames = { text:"Short text", textarea:"Long text", email:"Email", number:"Number", date:"Date", choice:"Single choice", multi:"Multiple choice" };
  const actions = ["booking.create", "booking.update", "booking.delete", "block.create", "block.delete", "profile.update", "password.change", "form.draft", "form.publish", "facilitator.create", "facilitator.update", "training.complete", "training.accept", "training.decline", "attendee.create", "invitation.issue", "invitation.revoke", "sharing.rotate", "sharing.revoke", "sharing.reactivate"];
  let activeTab = "", generation = 0, busy = false, profileDirty = false;
  let draft = null, saved = "", selected = "", previewOpen = false;
  let activityQuery = { page:1, action:"", from:"", to:"", actor:"", actorType:"" };
  const dirty = () => profileDirty || !!draft && JSON.stringify(draft.config) !== saved;
  window.addEventListener("beforeunload", e => { if (dirty() || busy) { e.preventDefault(); e.returnValue = ""; } });

  function canLeave() {
    if (busy) { alert("Please wait for the current request to finish."); return false; }
    if (!dirty()) return true;
    if (!confirm("Discard unsaved changes and leave this tab? Saved drafts are not affected.")) return false;
    if (draft && saved) {
      draft.config = JSON.parse(saved);
      if (activeTab === "settings") window.BookingAppearance.previewColors(draft.config.theme);
    }
    profileDirty = false; previewOpen = false;
    return true;
  }
  function deactivate() {
    window.BookingAppearance.clearColorPreview();
    activeTab = ""; generation++;
  }
  function warning(view, result) {
    if (result?.auditRecorded !== false) return;
    const el = document.createElement("div"); el.className = "alert"; el.setAttribute("role", "alert");
    el.textContent = "Change saved, but activity recording failed. Do not retry this saved change.";
    view.prepend(el);
  }
  function error(view, err) {
    let el = view.querySelector(".settings-error");
    if (!el) { el = document.createElement("div"); el.className = "alert settings-error"; view.prepend(el); }
    el.setAttribute("role", "alert"); el.tabIndex = -1;
    el.textContent = err.status === 409 ? `${err.message} Your unsaved edits were retained. ${activeTab === "profile" ? "Reload the page to fetch the latest profile." : "Use Reload draft to discard them and fetch the latest revision."}` :
      err.status === 401 ? "Your session expired. Reload this page and sign in again; unsaved edits will be lost." : err.message || "Request failed. Please retry.";
    el.focus();
  }
  async function operation(view, work) {
    if (busy) return;
    busy = true; view.setAttribute("aria-busy", "true");
    const controls = [...view.querySelectorAll("button,input,select,textarea")];
    const disabled = controls.map(el => el.disabled);
    controls.forEach(el => { el.disabled = true; });
    try { await work(); }
    catch (err) { error(view, err); }
    finally {
      busy = false; view.removeAttribute("aria-busy");
      controls.forEach((el, i) => { if (el.isConnected) el.disabled = disabled[i]; });
      if (activeTab === "profile") view.querySelector("#profileForm")?.oninput?.();
    }
  }
  async function render(tab, view, context) {
    window.BookingAppearance.clearColorPreview();
    activeTab = tab; const token = ++generation;
    if (context.mode !== "api" && tab === "settings") { settings(view, context); return; }
    if (context.mode !== "api") {
      view.innerHTML = `<section class="panel settings-unavailable"><span class="state-mark" aria-hidden="true">◎</span><h2>${esc({ profile:"My profile", builder:"Form builder", activity:"Activity log" }[tab])}</h2><p class="muted">These settings require the authenticated API. Account changes, drafts and publishing are not available in local storage mode.</p></section>`;
      return;
    }
    view.innerHTML = '<div class="panel" role="status">Loading settings…</div>';
    try {
      if (tab === "profile") {
        const identity = await context.S.profile();
        if (token === generation && activeTab === tab) profile(view, context, identity);
      } else if (tab === "builder" || tab === "settings") {
        if (!draft) {
          const result = await context.S.formDraft();
          if (token !== generation) return;
          adoptDraft(result);
        }
        if (token === generation && activeTab === tab) (tab === "settings" ? settings : builder)(view, context);
      } else {
        const result = await context.S.activity({ ...activityQuery });
        if (token === generation && activeTab === tab) activity(view, context, result);
      }
    } catch (err) {
      if (token !== generation) return;
      view.innerHTML = '<section class="panel"><h2>Settings unavailable</h2><button type="button" class="btn settings-retry">Retry</button></section>';
      error(view, err); view.querySelector(".settings-retry").onclick = () => render(tab, view, context);
    }
  }

  const colorPresets = {
    light: { teal:["#0f766e", "#f8fafc"], ocean:["#1d4ed8", "#eff6ff"], violet:["#7c3aed", "#faf5ff"], rose:["#be185d", "#fff1f2"] },
    dark: { teal:["#5eead4", "#0f172a"], ocean:["#93c5fd", "#0c182e"], violet:["#c4b5fd", "#1c142b"], rose:["#fda4af", "#27151d"] }
  };
  function settings(view, ctx) {
    const available = ctx.mode === "api";
    const cfg = available ? draft.config : null;
    const theme = cfg?.theme || ctx.config?.theme || schema.GLASS_DEFAULTS;
    const colorValue = (mode, kind) => theme[mode === "dark" ? kind === "primary" ? "darkPrimary" : "darkBackground" : kind] || colorPresets[mode].teal[kind === "primary" ? 0 : 1];
    const selectedPreset = mode => Object.keys(colorPresets[mode]).find(key => colorPresets[mode][key].every((color, i) => color === colorValue(mode, i ? "background" : "primary").toLowerCase())) || "custom";
    const style = !theme.glassEnabled ? "solid" : theme.glassBlur <= 6 ? "liquid" : "frosted";
    const preferences = window.BookingAppearance.preferences();
    const facilitators = [...new Set(Object.values(cfg?.questions || ctx.config?.questions || {}).filter(q => q.field === "facilitator").flatMap(q => (q.choices || []).map(label)))];
    view.innerHTML = `<div class="settings-grid preferences-grid">
      <section class="panel appearance-panel"><p class="eyebrow">Shared experience</p><h2>Appearance</h2><p class="muted">Choose the material for the booking form and admin workspace. Save and publish to make it live for everyone.</p>
        ${!available ? '<p class="alert">Shared appearance requires the authenticated API. Browser preferences below still work.</p>' : ""}
        <fieldset class="material-options" ${available ? "" : "disabled"}><legend>Surface material</legend>
          ${[["liquid", "Liquid glass", "Clear reflections · light blur"], ["frosted", "Frosted glass", "Soft diffusion · deeper blur"], ["solid", "Solid", "Opaque · no glass effect"]].map(([value, title, detail]) => `<label class="material-option"><input type="radio" name="material" value="${value}" ${style === value ? "checked" : ""}><span class="material-swatch ${value}" aria-hidden="true"></span><strong>${title}</strong><span class="muted small">${detail}</span></label>`).join("")}
        </fieldset><p class="muted small">Readable surfaces are capped at 20% transparency in light mode and 10% in dark mode. Your browser's accessibility preferences always take priority.</p>
        <div class="material-preview" aria-label="Material preview"><span class="eyebrow">Preview only</span><h3>Your next learning session</h3><p>Clear details. Comfortable reading. A little more depth.</p><span class="badge">Ready to plan</span></div>
        <h3>Application colors</h3><p class="muted small">Customize light and dark mode independently. Unpublished colors preview only in Settings; use the page switch to check each mode. Other admin tabs and the booking page use the same published colors. Save the draft to keep your edits, then publish to apply them everywhere. Accents are adjusted when needed for readable text and buttons.</p>
        <div class="palette-grid">${["light", "dark"].map(mode => `<fieldset class="palette-editor" ${available ? "" : "disabled"}><legend>${mode === "light" ? "Light" : "Dark"} mode</legend>
          <label for="${mode}Preset">Color preset</label><select id="${mode}Preset" data-palette-preset="${mode}">${Object.keys(colorPresets[mode]).map(key => `<option value="${key}" ${selectedPreset(mode) === key ? "selected" : ""}>${key[0].toUpperCase() + key.slice(1)}</option>`).join("")}<option value="custom" ${selectedPreset(mode) === "custom" ? "selected" : ""}>Custom</option></select>
          ${["primary", "background"].map(kind => `<label class="palette-color" for="${mode}${kind}"><span>${kind === "primary" ? "Accent" : "Page background"}</span><input type="color" id="${mode}${kind}" data-color-mode="${mode}" data-color-kind="${kind}" value="${esc(colorValue(mode, kind))}"><output id="${mode}${kind}Value">${esc(colorValue(mode, kind))}</output></label>`).join("")}
          <div class="palette-preview" id="${mode}PalettePreview" aria-label="${mode} color preview"><strong>Your next session</strong><p>Booking details and readable surfaces.</p><span class="palette-preview-button">Continue</span></div>
        </fieldset>`).join("")}</div>
        <h3>Page layout &amp; style</h3><p class="muted small">Apply spacing, content width, and card depth to the booking form and every admin tab. Narrow keeps content focused; wide gives dashboards more room. Mobile layouts remain responsive.</p>
        <fieldset class="layout-editor" ${available ? "" : "disabled"}><legend>Application style</legend>
          ${[["density", "Spacing", [["comfortable", "Comfortable"], ["compact", "Compact"]]], ["width", "Content width", [["narrow", "Narrow"], ["standard", "Standard"], ["wide", "Wide"]]], ["cardStyle", "Card style", [["outlined", "Outlined"], ["elevated", "Elevated"], ["flat", "Flat"]]]].map(([key, title, values]) => `<label for="appearance${key}">${title}<select id="appearance${key}" data-appearance-style="${key}">${values.map(([value, text]) => option(value, text, theme[key])).join("")}</select></label>`).join("")}
        </fieldset>
        <p class="small" id="appearanceStatus" role="status"></p>
        ${available ? '<div class="settings-actions"><button class="btn primary" id="saveAppearance">Save draft</button><button class="btn" id="previewAppearance">Preview form</button><button class="btn primary" id="publishAppearance">Publish</button><button class="btn" id="reloadAppearance">Reload draft</button></div><p class="muted small">These actions save or publish the entire form draft, including any saved Form Builder changes.</p>' : ""}
      </section>
      <section class="panel"><p class="eyebrow">This browser only</p><h2>Accessibility</h2><p class="muted">Personal preferences, not changes for other visitors. System preferences are also respected.</p>
        <label class="preference-row"><span><strong>Reduce motion</strong><small>Skip decorative transitions and scaling.</small></span><input type="checkbox" data-preference="reduceMotion" ${preferences.reduceMotion ? "checked" : ""}></label>
        <label class="preference-row"><span><strong>Reduce transparency</strong><small>Use opaque surfaces for easier reading.</small></span><input type="checkbox" data-preference="reduceTransparency" ${preferences.reduceTransparency ? "checked" : ""}></label>
        <p class="muted small">Use the appearance switch at the top of the page for light or dark mode.</p>
      </section>
      <section class="panel"><p class="eyebrow">Scheduling safeguards</p><h2>Booking rules</h2><ul class="settings-list"><li>Overlapping active sessions for the same facilitator are flagged as conflicts.</li><li>Blocked dates keep leave and holidays unavailable.</li><li>Rejected and cancelled requests release their time slots.</li></ul><p class="muted small">These are enforced scheduling rules, not editable toggles.</p><button class="btn" data-settings-nav="blocks">Manage blocked dates</button></section>
      <section class="panel"><p class="eyebrow">Team &amp; operations</p><h2>Facilitators</h2><p class="muted">${facilitators.length} facilitators in the ${available ? "draft" : "current"} form. Manage the facilitator question's choices in Form Builder; publish to update the live roster.</p><div class="facilitator-chips">${facilitators.map(name => `<span class="badge">${esc(name)}</span>`).join("") || '<p class="muted">No facilitators configured.</p>'}</div><div class="settings-actions"><button class="btn" data-settings-nav="builder">Edit roster in Form Builder</button><button class="btn" data-settings-nav="availability">Check availability</button></div></section>
      <section class="panel"><p class="eyebrow">Records &amp; accountability</p><h2>Data and account</h2><p class="muted">Export filtered booking records as CSV from Bookings. Review administrative changes in Activity Log, or update your account details.</p><div class="settings-actions"><button class="btn" data-settings-nav="bookings">Bookings &amp; CSV export</button><button class="btn" data-settings-nav="activity">Activity log</button><button class="btn" data-settings-nav="profile">Account &amp; security</button></div></section>
    </div><section class="panel" id="appearancePreviewPanel" hidden><h2>Saved draft preview</h2><p class="muted">Submissions are disabled.</p><iframe class="draft-preview" title="Saved booking form draft"></iframe></section>`;
    const find = selector => view.querySelector(selector);
    function status() {
      if (available) window.BookingAppearance.previewColors(theme);
      const changed = dirty();
      let valid = true;
      if (available) { try { schema.validate(cfg); } catch { valid = false; } }
      find("#appearanceStatus").textContent = !available ? "Shared settings are unavailable in local mode." : !valid ? "Fix the form draft validation errors in Form Builder." : changed ? "Unsaved changes — save before previewing or publishing." : `Draft saved · Live version: ${draft.version}`;
      if (available) {
        find("#saveAppearance").disabled = !changed || !valid;
        find("#publishAppearance").disabled = changed || !valid;
        find("#previewAppearance").disabled = changed || !valid;
      }
      const preview = find(".material-preview");
      preview.dataset.material = !theme.glassEnabled ? "solid" : theme.glassBlur <= 6 ? "liquid" : "frosted";
      ["density", "width", "cardStyle"].forEach(key => { preview.dataset[key] = theme[key]; });
      ["light", "dark"].forEach(mode => {
        find(`#${mode}Preset`).value = selectedPreset(mode);
        ["primary", "background"].forEach(kind => {
          find(`#${mode}${kind}`).value = colorValue(mode, kind);
          find(`#${mode}${kind}Value`).textContent = colorValue(mode, kind);
        });
        Object.entries(window.BookingAppearance.palette(theme, mode)).forEach(([key, value]) => find(`#${mode}PalettePreview`).style.setProperty(key, value));
      });
    }
    function colorChanged() { find("#appearancePreviewPanel").hidden = true; status(); }
    view.querySelectorAll("[data-appearance-style]").forEach(input => { input.onchange = () => {
      if (!available) return;
      theme[input.dataset.appearanceStyle] = input.value;
      colorChanged();
    }; });
    view.querySelectorAll("[data-palette-preset]").forEach(input => { input.onchange = () => {
      if (!available || !colorPresets[input.dataset.palettePreset][input.value]) return;
      const mode = input.dataset.palettePreset, colors = colorPresets[mode][input.value];
      Object.assign(theme, mode === "dark" ? { darkPrimary:colors[0], darkBackground:colors[1] } : { primary:colors[0], background:colors[1] });
      colorChanged();
    }; });
    view.querySelectorAll("[data-color-kind]").forEach(input => { input.oninput = () => {
      if (!available) return;
      const key = input.dataset.colorMode === "dark" ? input.dataset.colorKind === "primary" ? "darkPrimary" : "darkBackground" : input.dataset.colorKind;
      theme[key] = input.value;
      colorChanged();
    }; });
    view.querySelectorAll("[data-preference]").forEach(input => { input.onchange = () => window.BookingAppearance.setPreference(input.dataset.preference, input.checked); });
    view.querySelectorAll("[data-settings-nav]").forEach(button => { button.onclick = () => ctx.navigate(button.dataset.settingsNav); });
    view.querySelectorAll('[name="material"]').forEach(input => { input.onchange = () => {
      if (!available || !input.checked) return;
      Object.assign(theme, { glassEnabled:input.value !== "solid", glassTransparency:input.value === "liquid" ? 40 : 20, glassBlur:input.value === "liquid" ? 4 : 16 });
      find("#appearancePreviewPanel").hidden = true;
      status();
    }; });
    if (available) {
      find("#saveAppearance").onclick = () => {
        let normalized; try { normalized = schema.validate(cfg); } catch (err) { error(view, err); return; }
        operation(view, async () => {
          const result = await (ctx.S.saveFormDraft.length >= 2 ? ctx.S.saveFormDraft(normalized, draft.revision) : ctx.S.saveFormDraft({ config:normalized, revision:draft.revision }));
          adoptDraft(result); settings(view, ctx); ctx.toast("Draft saved; live appearance unchanged"); warning(view, result);
        });
      };
      find("#publishAppearance").onclick = () => {
        if (dirty()) return;
        try { schema.validate(cfg); } catch (err) { error(view, err); return; }
        if (!confirm("Publish the entire saved form draft and appearance for all visitors?")) return;
        operation(view, async () => {
          const result = await ctx.S.publishForm(ctx.S.saveFormDraft.length >= 2 ? draft.revision : { revision:draft.revision });
          adoptDraft({ config:result.config, revision:result.version, version:result.version });
          ctx.onPublished?.(result); settings(view, ctx); ctx.toast("Shared appearance published"); warning(view, result);
        });
      };
      find("#reloadAppearance").onclick = () => {
        if (dirty() && !confirm("Discard unsaved edits and reload the server draft?")) return;
        operation(view, async () => { adoptDraft(await ctx.S.formDraft()); settings(view, ctx); });
      };
      find("#previewAppearance").onclick = () => {
        if (dirty()) return;
        find("#appearancePreviewPanel").hidden = false;
        find("iframe").src = "/?preview=draft";
        find("#appearancePreviewPanel").scrollIntoView({ block:"start" });
      };
    }
    status();
  }

  function profile(view, ctx, account) {
    const p = account.profile || {}, local = account.provider === "local";
    profileDirty = false;
    view.innerHTML = `<div class="settings-grid">
        <section class="panel"><h3>Contact details</h3><dl class="account-metadata"><dt>Role</dt><dd>${account.role === "facilitator" ? "Facilitator" : account.role === "supervisor" ? "Supervisor" : "Administrator"}</dd>${account.facilitatorLabel ? `<dt>Assignment</dt><dd>${esc(account.facilitatorLabel)}</dd>` : ""}</dl><p class="muted small">Sign-in method: ${local ? "Username and password" : "External identity provider"}</p>
          <form id="profileForm" class="settings-form">
            <label>Username<input name="username" value="${esc(account.user)}" autocomplete="username" readonly></label>
            <label>Display name<input name="displayName" value="${esc(p.displayName)}" autocomplete="name" maxlength="100" required></label>
            <label>Email<input name="email" type="email" value="${esc(p.email)}" autocomplete="email" maxlength="254"></label>
            <label>Phone<input name="phone" type="tel" value="${esc(p.phone)}" autocomplete="tel" maxlength="32"></label>
            <p class="muted small">Email is used for contact and request notifications when enabled, not sign-in or password recovery.</p><p id="profileFeedback" role="status" aria-live="polite" hidden></p><div class="settings-actions"><button class="btn primary" type="submit" id="saveProfile" disabled>Save changes</button><button class="btn ghost" type="button" id="cancelProfile" disabled>Cancel changes</button></div>
          </form>
        </section>
        <section class="panel"><h3>Security</h3>${local ? `<p class="muted" id="passwordPolicy">Use 12–128 characters. Changing your password signs out all sessions.</p>
          <form id="passwordForm" class="settings-form" aria-describedby="passwordPolicy">
            <input type="text" name="username" value="${esc(account.user)}" autocomplete="username" readonly hidden>
            ${[["currentPassword", "Current password", "current-password"], ["newPassword", "New password", "new-password"], ["confirmPassword", "Confirm new password", "new-password"]].map(([name, title, autocomplete]) => `<label for="${name}">${title}</label><div class="password-control"><input id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" ${name !== "currentPassword" ? 'minlength="12"' : ""} maxlength="128" required><button class="btn" type="button" data-reveal="${name}" aria-controls="${name}" aria-label="Show ${title.toLowerCase()}" aria-pressed="false">Show</button></div>`).join("")}
            <button type="submit" class="btn primary">Change password</button>
          </form>` : '<p class="muted">This account uses an external identity provider. Change your password with that provider; this portal cannot update it.</p>'}</section>
      </div>`;
    const pf = view.querySelector("#profileForm"), passwordForm = view.querySelector("#passwordForm");
    const contactDirty = () => ["displayName", "email", "phone"].some(k => pf.elements[k].value.trim() !== (p[k] || ""));
    const feedback = (message, invalid = false) => {
      const node = view.querySelector("#profileFeedback"); node.textContent = message; node.hidden = false; node.className = invalid ? "alert" : "account-notice"; node.setAttribute("role", invalid ? "alert" : "status");
    };
    const formsDirty = () => {
      const changed = contactDirty();
      profileDirty = changed || !!passwordForm && ["currentPassword", "newPassword", "confirmPassword"].some(k => passwordForm.elements[k].value !== "");
      view.querySelector("#saveProfile").disabled = !changed;
      view.querySelector("#cancelProfile").disabled = !changed;
    };
    view.querySelector("#cancelProfile").onclick = () => {
      for (const k of ["displayName", "email", "phone"]) pf.elements[k].value = p[k] || "";
      formsDirty(); feedback("Contact changes discarded.");
    };
    pf.oninput = formsDirty;
    pf.onsubmit = e => {
      e.preventDefault();
      if (!contactDirty() || !pf.reportValidity()) return;
      const fields = Object.fromEntries(["displayName", "email", "phone"].map(k => [k, pf.elements[k].value.trim()]));
      if (!fields.displayName || fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) || fields.phone && !/^[+()\d .-]+$/.test(fields.phone)) {
        feedback("Enter a display name and valid email/phone contact details.", true); return;
      }
      operation(view, async () => {
        const result = await ctx.S.updateProfile(fields);
        Object.assign(p, result.profile || fields);
        for (const k of Object.keys(fields)) pf.elements[k].value = p[k];
        formsDirty(); ctx.onProfile?.(result); feedback("Contact details saved."); warning(view, result);
      });
    };
    if (!passwordForm) return;
    passwordForm.oninput = () => { passwordForm.elements.confirmPassword.setCustomValidity(""); formsDirty(); };
    view.querySelectorAll("[data-reveal]").forEach(btn => { btn.onclick = () => {
      const input = passwordForm.elements[btn.dataset.reveal], show = input.type === "password";
      input.type = show ? "text" : "password"; btn.textContent = show ? "Hide" : "Show";
      btn.setAttribute("aria-pressed", String(show)); btn.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${btn.dataset.reveal.replace(/([A-Z])/g, " $1").toLowerCase()}`);
    }; });
    passwordForm.onsubmit = e => {
      e.preventDefault();
      const input = Object.fromEntries(["currentPassword", "newPassword", "confirmPassword"].map(k => [k, passwordForm.elements[k].value]));
      if (input.newPassword.length < 12 || input.newPassword.length > 128 || input.newPassword !== input.confirmPassword || input.newPassword === input.currentPassword) {
        error(view, new Error("Passwords must match, differ from the current password, and contain 12–128 characters.")); return;
      }
      if (profileDirty && ["displayName", "email", "phone"].some(k => pf.elements[k].value !== (p[k] || ""))) {
        error(view, new Error("Save your profile changes before changing your password.")); return;
      }
      operation(view, async () => {
        const result = await ctx.S.changePassword(input);
        passwordForm.reset(); profileDirty = false;
        view.innerHTML = '<section class="panel"><h2>Password changed</h2><p>Your sessions have been invalidated. Sign in again with your new password.</p><button type="button" class="btn primary" id="signInAgain">Sign in again</button></section>';
        warning(view, result); view.querySelector("#signInAgain").onclick = () => location.reload();
      });
    };
  }

  function adoptDraft(result) {
    draft = { config:schema.validate(result.config), revision:result.revision, version:result.version };
    saved = JSON.stringify(draft.config); selected = draft.config.order.includes(selected) ? selected : draft.config.start;
  }
  function protectedQuestion(q) { return schema.REQUIRED.includes(q.field) || q.field === "requesterEmail"; }
  function uniqueId(prefix, taken) {
    let i = 1; while (taken.includes(prefix + i)) i++;
    return prefix + i;
  }
  function destinationOptions(config, current, ownId, branch = false) {
    const reaches = (id, target, seen = new Set()) => {
      if (id === target) return true;
      if (!id || seen.has(id)) return false;
      seen.add(id); const q = config.questions[id];
      return !!q && [q.next, ...(q.choices || []).map(c => typeof c === "object" && c.goto)].filter(Boolean).some(next => reaches(next, target, seen));
    };
    return option("", branch ? "Use next question" : "End of form", current || "") + config.order.filter(id => !ownId || !reaches(id, ownId))
      .map(id => option(id, `${config.order.indexOf(id) + 1}. ${config.questions[id].title}`, current)).join("");
  }
  function linear(q) { return !(q.choices || []).some(c => typeof c === "object" && c.goto); }
  function incoming(config, id) {
    const edges = [];
    for (const [key, q] of Object.entries(config.questions)) {
      if (q.next === id) edges.push({ key, kind:"next" });
      (q.choices || []).forEach((c, i) => { if (typeof c === "object" && c.goto === id) edges.push({ key, kind:"choice", i }); });
    }
    return edges;
  }
  function updateEdge(config, edge, target) {
    const object = edge.kind === "next" ? config.questions[edge.key] : config.questions[edge.key].choices[edge.i];
    const key = edge.kind === "next" ? "next" : "goto";
    if (target) object[key] = target; else delete object[key];
  }
  function structural(view, ctx, change) {
    try {
      const candidate = clone(draft.config), nextSelection = change(candidate);
      draft.config = schema.validate(candidate);
      if (nextSelection) selected = nextSelection;
      previewOpen = false; builder(view, ctx);
    } catch (err) { error(view, err); }
  }
  function moveQuestion(config, id, direction) {
    const order = config.order, at = order.indexOf(id), other = order[at + direction];
    if (!other) throw new Error("This question is already at the edge of the list.");
    const a = direction < 0 ? other : id, b = direction < 0 ? id : other;
    const qa = config.questions[a], qb = config.questions[b], before = incoming(config, a), intoB = incoming(config, b);
    if (!linear(qa) || !linear(qb) || qa.next !== b || intoB.length !== 1 || intoB[0].key !== a || intoB[0].kind !== "next" ||
      (config.start !== a && (before.length !== 1 || before[0].kind !== "next" || !linear(config.questions[before[0].key])))) {
      throw new Error("Only adjacent questions in a simple linear segment can be moved. Branches and joins are preserved; edit routing explicitly instead.");
    }
    const after = qb.next;
    if (config.start === a) config.start = b;
    before.forEach(edge => updateEdge(config, edge, b));
    qb.next = a; if (after) qa.next = after; else delete qa.next;
    [order[at], order[at + direction]] = [order[at + direction], order[at]];
    return id;
  }
  function builder(view, ctx) {
    const cfg = draft.config;
    if (!cfg.questions[selected]) selected = cfg.start;
    const q = cfg.questions[selected], essential = protectedQuestion(q), fixedType = ["date", "facilitator", "time"].includes(selected) || ["participants", "requesterEmail"].includes(q.field);
    const openPanels = new Set([...view.querySelectorAll("details[open][data-builder-panel]")].map(el => el.dataset.builderPanel));
    view.innerHTML = `<div class="settings-heading builder-heading"><div><p class="muted">Save a draft, preview it, then publish to make it live.</p></div>
      <div class="settings-actions"><button type="button" class="btn" id="reloadDraft">Reload draft</button><button type="button" class="btn" id="saveDraft">Save draft</button><button type="button" class="btn" id="previewDraft">Preview</button><button type="button" class="btn primary" id="publishForm">Publish</button></div></div>
      <div class="builder-status" role="status" aria-live="polite" id="builderStatus"></div>
      <div class="alert settings-validation" id="draftValidation" role="alert" hidden></div>
      <div class="builder-layout">
        <aside class="panel question-list"><h3>Questions <span class="muted small">${cfg.order.length}</span></h3><ol>${cfg.order.map((id, i) => `<li><button type="button" class="question-pick ${id === selected ? "selected" : ""}" data-question="${esc(id)}" ${id === selected ? 'aria-current="true"' : ""}><span>${i + 1}. ${esc(cfg.questions[id].title)}</span><small>${esc(typeNames[cfg.questions[id].type] || cfg.questions[id].type)}${protectedQuestion(cfg.questions[id]) ? " · Required" : ""}${cfg.start === id ? " · First" : ""}</small></button></li>`).join("")}</ol>
          <button type="button" class="btn" id="addQuestion">Add question</button></aside>
        <section class="panel question-editor"><h3>Edit question</h3><div class="settings-actions inspector-actions"><button type="button" class="btn" id="moveUp">Move up</button><button type="button" class="btn" id="moveDown">Move down</button><button type="button" class="btn" id="duplicateQuestion">Duplicate</button><button type="button" class="btn danger" id="removeQuestion" ${essential ? "disabled" : ""}>Remove</button></div>
          ${essential ? '<p class="muted small">Required booking field. Cannot be removed or made optional.</p>' : ""}
          <form class="settings-form" id="inspector">
            <label>Label<input data-prop="title" value="${esc(q.title)}" maxlength="200" required></label>
            <div class="form-grid"><label>Answer type<select data-prop="type" ${fixedType ? "disabled" : ""}>${schema.TYPES.filter(t => !q.field || t !== "multi" || q.field === "topic").map(t => option(t, typeNames[t] || t, q.type)).join("")}</select></label>
              <label>Section<select data-prop="section">${option("", "No section", q.section || "")}${cfg.sections.map(s => option(s.id, s.title, q.section)).join("")}</select></label></div>
            <label class="check-label"><input type="checkbox" data-prop="required" ${q.required ? "checked" : ""} ${essential ? "disabled" : ""}>Required answer</label>
            <label>Help text<textarea data-prop="help" maxlength="1000">${esc(q.help)}</textarea></label>
            <label>Placeholder<input data-prop="placeholder" value="${esc(q.placeholder)}" maxlength="200"></label>
            <details class="builder-details" data-builder-panel="routing" ${openPanels.has("routing") ? "open" : ""}><summary>Question routing</summary><div class="settings-form"><p class="muted small">Choose what comes next. Choice routes override this.</p><label>Next question<select data-prop="next">${destinationOptions(cfg, q.next, selected)}</select></label></div></details>
            ${["number", "multi"].includes(q.type) ? `<div class="form-grid">${["min", "max"].map(k => `<label>${k === "min" ? "Minimum" : "Maximum"}${q.type === "multi" ? " selections" : " value"}<input type="number" step="1" data-prop="${k}" value="${esc(q[k])}" min="${q.type === "multi" ? 1 : -1000000}" max="${q.type === "multi" ? q.choices.length : 1000000}"></label>`).join("")}</div>` : ""}
            ${["choice", "multi"].includes(q.type) ? `<label>Choices (one label per line)<textarea id="choiceLines" rows="6" aria-describedby="choiceHelp">${esc(q.choices.map(label).join("\n"))}</textarea></label><p id="choiceHelp" class="muted small">One option per line. Apply changes before saving.</p>
              <button type="button" class="btn" id="applyChoices">Apply choices</button>
              ${q.type === "choice" ? `<label class="check-label"><input type="checkbox" data-prop="allowOther" ${q.allowOther ? "checked" : ""} ${["facilitator", "time"].includes(selected) ? "disabled" : ""}>Allow another answer</label><details class="builder-details" data-builder-panel="branches" ${openPanels.has("branches") ? "open" : ""}><summary>Choice routing</summary><p class="muted small">Send an answer to a specific question, or use the next question.</p><div class="branch-list">${q.choices.map((c, i) => `<label>${esc(label(c))}<select data-branch="${i}">${destinationOptions(cfg, typeof c === "object" ? c.goto : "", selected, true)}</select></label>`).join("")}</div></details>` : ""}` : ""}
          </form>
        </section>
      </div>
      <details class="panel builder-details" data-builder-panel="settings" ${openPanels.has("settings") ? "open" : ""}><summary>Form settings</summary><div class="form-grid"><label>Form title<input id="formTitle" value="${esc(cfg.title)}" maxlength="200" required></label><label>First question<select id="formStart">${cfg.order.map((id, i) => option(id, `${i + 1}. ${cfg.questions[id].title}`, cfg.start)).join("")}</select></label></div>
        <h3>Appearance</h3><div class="theme-grid">${["primary", "background"].map(k => `<label>${k === "primary" ? "Light accent color" : "Light background color"}<input type="color" data-theme="${k}" value="${esc(cfg.theme[k])}"></label>`).join("")}
          ${[["density", ["compact", "comfortable"]], ["width", ["narrow", "standard", "wide"]], ["cardStyle", ["outlined", "elevated", "flat"]]].map(([key, values]) => `<label>${esc(key)}<select data-theme="${key}">${select(values, cfg.theme[key])}</select></label>`).join("")}</div>
        <p class="muted small">Manage dark colors and light/dark presets in Settings.</p>
        <h3>Subtle frosted glass</h3>
        <label class="check-label"><input type="checkbox" data-theme="glassEnabled" ${cfg.theme.glassEnabled ? "checked" : ""}>Enable glass surfaces</label>
        <p class="muted small" id="glassHelp">Transparency is capped at 20% in light mode and 10% in dark mode. Solid surfaces are used when glass is unsupported or reduced transparency is preferred.</p>
        <div class="theme-grid">${[["glassTransparency", "Transparency (%)", 40], ["glassBlur", "Frost blur (px)", 20]].map(([key, title, max]) => `<label>${title}<input type="number" data-theme="${key}" value="${esc(cfg.theme[key] ?? schema.GLASS_DEFAULTS[key])}" min="0" max="${max}" step="1" aria-describedby="glassHelp" ${cfg.theme.glassEnabled ? "" : "disabled"}></label>`).join("")}</div>
        <button type="button" class="btn" id="resetGlass">Reset and disable glass</button>
        <p class="muted small version-info">Draft: ${esc(draft.revision)} · Live: ${esc(draft.version)}</p>
      </details>
      <details class="panel builder-details" data-builder-panel="sections" ${openPanels.has("sections") ? "open" : ""}><summary>Sections</summary><div class="section-list">${cfg.sections.map(s => `<div class="section-editor"><label>Section title<input data-section-title="${esc(s.id)}" value="${esc(s.title)}" maxlength="200"></label><label>Description<textarea data-section-description="${esc(s.id)}" maxlength="1000">${esc(s.description)}</textarea></label><button type="button" class="btn danger" data-remove-section="${esc(s.id)}">Delete section</button></div>`).join("") || '<p class="muted">No sections yet.</p>'}</div><button type="button" class="btn" id="addSection">Add section</button></details>
      <section class="panel" id="previewPanel" ${previewOpen ? "" : "hidden"}><h3>Draft preview</h3><p class="muted">Submissions are disabled. Save changes to preview them.</p>${previewOpen ? '<iframe class="draft-preview" title="Saved booking form draft" src="/?preview=draft"></iframe>' : ""}</section>`;
    const find = s => view.querySelector(s);
    find("#inspector").onsubmit = e => e.preventDefault();
    function status() {
      let valid = true;
      try { schema.validate(cfg); find("#draftValidation").hidden = true; }
      catch (err) { valid = false; find("#draftValidation").textContent = err.message; find("#draftValidation").hidden = false; }
      const changed = dirty();
      find("#builderStatus").textContent = !valid ? "Check the highlighted form error." : changed ? "Unsaved changes — save to preview." : "Draft saved — ready to preview or publish.";
      find("#saveDraft").title = !valid ? "Fix the form error first" : !changed ? "No changes to save" : "Save without changing the live form";
      ["#previewDraft", "#publishForm"].forEach(s => { find(s).title = !valid ? "Fix the form error first" : changed ? "Save your changes first" : ""; });
      find("#publishForm").disabled = changed || !valid;
      find("#previewDraft").disabled = changed || !valid;
      find("#saveDraft").disabled = !valid || !changed;
      if (changed) find("#previewPanel").hidden = true;
    }
    // Multiline choices are unapplied input too: keep a separate dirty sentinel by
    // committing them on explicit Apply, and gate save/preview until then.
    let choicePending = false;
    function changed() {
      previewOpen = false;
      const picked = [...view.querySelectorAll("[data-question]")].find(btn => btn.dataset.question === selected);
      if (picked) picked.querySelector("span").textContent = `${cfg.order.indexOf(selected) + 1}. ${q.title}`;
      refreshStructureActions(); status();
    }
    function refreshStructureActions() {
      [["#moveUp", -1], ["#moveDown", 1]].forEach(([selector, direction]) => {
        let reason = "";
        try { schema.validate(moveCandidate(direction)); }
        catch { reason = cfg.order.indexOf(selected) + direction < 0 || cfg.order.indexOf(selected) + direction >= cfg.order.length ? "Already at the end of the list" : "Routing prevents this move"; }
        const button = find(selector);
        button.disabled = choicePending || !!reason;
        button.title = choicePending ? "Apply choices first" : reason;
      });
      ["#addQuestion", "#duplicateQuestion", "#removeQuestion"].forEach(selector => {
        const reason = selector === "#removeQuestion" && essential ? "Required booking field" : !linear(q) ? "Clear choice routes first" : "";
        find(selector).disabled = choicePending || !!reason;
        find(selector).title = choicePending ? "Apply choices first" : reason;
      });
    }
    function moveCandidate(direction) {
      const candidate = clone(cfg);
      moveQuestion(candidate, selected, direction);
      return candidate;
    }
    function pendingChoices() {
      const lines = find("#choiceLines");
      choicePending = !!lines && lines.value !== q.choices.map(label).join("\n");
      if (choicePending) {
        profileDirty = true; find("#builderStatus").textContent = "Apply choices before saving.";
        ["#saveDraft", "#publishForm", "#previewDraft"].forEach(s => { find(s).disabled = true; find(s).title = "Apply choices first"; });
      } else { profileDirty = false; status(); }
      refreshStructureActions();
    }
    if (find("#choiceLines")) find("#choiceLines").oninput = pendingChoices;
    const guardChoices = () => { if (choicePending) { error(view, new Error("Apply your choice edits before selecting another question or changing the structure.")); return false; } return true; };
    view.querySelectorAll("[data-question]").forEach(btn => { btn.onclick = () => { if (!guardChoices()) return; selected = btn.dataset.question; builder(view, ctx); view.querySelector("#inspector input").focus(); }; });
    view.querySelectorAll("[data-prop]").forEach(input => {
      input.oninput = () => {
        const key = input.dataset.prop, value = input.type === "checkbox" ? input.checked : input.value;
        if (key === "type") {
          if (!guardChoices()) { input.value = q.type; return; }
          const branching = !linear(q);
          if ((branching || q.choices) && !confirm("Change this question type? Incompatible choices, bounds and branch routes will be removed. The resulting draft must still validate.")) { input.value = q.type; return; }
          q.type = value;
          if (!["choice", "multi"].includes(value)) { delete q.choices; delete q.allowOther; }
          else {
            q.choices ||= ["Option 1"];
            if (value === "multi") { q.choices = q.choices.map(label); delete q.allowOther; }
          }
          if (!["number", "multi"].includes(value)) { delete q.min; delete q.max; }
          changed(); builder(view, ctx); return;
        }
        if (["min", "max"].includes(key)) { if (value === "") delete q[key]; else q[key] = Number(value); }
        else if (["next", "section", "help", "placeholder"].includes(key) && value === "") delete q[key];
        else q[key] = value;
        changed(); if (choicePending) pendingChoices();
      };
    });
    view.querySelectorAll("[data-branch]").forEach(input => { input.onchange = () => {
      const i = +input.dataset.branch;
      q.choices[i] = input.value ? { label:label(q.choices[i]), goto:input.value } : label(q.choices[i]); changed(); if (choicePending) pendingChoices();
    }; });
    if (find("#applyChoices")) find("#applyChoices").onclick = () => {
      const labels = find("#choiceLines").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!labels.length || labels.length > 50 || new Set(labels).size !== labels.length) { error(view, new Error("Use 1–50 unique, nonempty choice labels.")); return; }
      const previous = q.choices, missing = previous.filter(c => !labels.includes(label(c)));
      const routed = missing.filter(c => typeof c === "object" && c.goto);
      if (missing.length && !confirm("Remove or rename choice values? Historical answers retain their original labels. Review any affected branching before saving.")) return;
      // Only index-preserving renames may carry a route; ambiguous edits fail closed.
      if (routed.length && (labels.length !== previous.length || previous.some((c, i) => typeof c === "object" && c.goto && !labels.includes(label(c)) && previous.some(old => label(old) === labels[i])))) {
        error(view, new Error("A routed choice was removed or ambiguously moved. Clear its branch first, or rename it on the same line without adding/removing lines.")); return;
      }
      const choices = labels.map((text, i) => {
        const exact = previous.find(c => label(c) === text);
        if (exact) return clone(exact);
        const old = previous[i];
        return previous.length === labels.length && old && typeof old === "object" && old.goto && !labels.includes(label(old)) ? { label:text, goto:old.goto } : text;
      });
      q.choices = choices; profileDirty = false; choicePending = false; changed(); builder(view, ctx);
    };
    find("#formTitle").oninput = e => { cfg.title = e.target.value; changed(); if (choicePending) pendingChoices(); };
    find("#formStart").onchange = e => { cfg.start = e.target.value; changed(); if (choicePending) pendingChoices(); };
    const syncGlass = () => {
      view.querySelectorAll('[data-theme="glassTransparency"],[data-theme="glassBlur"]').forEach(input => { input.disabled = !cfg.theme.glassEnabled; });
    };
    view.querySelectorAll("[data-theme]").forEach(input => { input.oninput = () => {
      cfg.theme[input.dataset.theme] = input.type === "checkbox" ? input.checked : input.type === "number" ? input.valueAsNumber : input.value;
      syncGlass(); changed(); if (choicePending) pendingChoices();
    }; });
    find("#resetGlass").onclick = () => {
      Object.assign(cfg.theme, schema.GLASS_DEFAULTS);
      view.querySelectorAll('[data-theme^="glass"]').forEach(input => {
        if (input.type === "checkbox") input.checked = cfg.theme[input.dataset.theme];
        else input.value = cfg.theme[input.dataset.theme];
      });
      syncGlass(); changed(); if (choicePending) pendingChoices();
    };
    view.querySelectorAll("[data-section-title],[data-section-description]").forEach(input => { input.oninput = () => {
      const id = input.dataset.sectionTitle || input.dataset.sectionDescription, section = cfg.sections.find(s => s.id === id);
      section[input.dataset.sectionTitle ? "title" : "description"] = input.value; changed(); if (choicePending) pendingChoices();
    }; });
    view.querySelectorAll("[data-remove-section]").forEach(btn => { btn.onclick = () => {
      if (!guardChoices() || !confirm("Delete this section? Its questions will remain and become unsectioned.")) return;
      structural(view, ctx, c => { c.sections = c.sections.filter(s => s.id !== btn.dataset.removeSection); for (const item of Object.values(c.questions)) if (item.section === btn.dataset.removeSection) delete item.section; });
    }; });
    find("#addSection").onclick = () => { if (!guardChoices()) return; structural(view, ctx, c => { c.sections.push({ id:uniqueId("section", c.sections.map(s => s.id)), title:"New section" }); }); };
    function insert(copy) {
      if (!guardChoices()) return;
      structural(view, ctx, c => {
        const anchor = c.questions[selected];
        if (!linear(anchor)) throw new Error("Select a question with a simple default route to insert after it. Existing choice branches will not be disrupted.");
        const id = uniqueId("custom", c.order), added = copy ? clone(anchor) : { title:"New question", type:"text", required:false };
        delete added.field;
        if (copy) added.title = (anchor.title.slice(0, 190) + " (copy)");
        if (anchor.next) added.next = anchor.next; else delete added.next;
        anchor.next = id; c.questions[id] = added; c.order.splice(c.order.indexOf(selected) + 1, 0, id);
        return id;
      });
    }
    find("#addQuestion").onclick = () => insert(false); find("#duplicateQuestion").onclick = () => insert(true);
    find("#removeQuestion").onclick = () => {
      if (essential || !guardChoices() || !confirm(`Remove “${q.title}”? Historical bookings keep this answer. Incoming routes will reconnect only if the remaining form validates.`)) return;
      structural(view, ctx, c => {
        if (!linear(c.questions[selected])) throw new Error("Clear choice branches before removing this question.");
        const next = c.questions[selected].next;
        if (c.start === selected) c.start = next;
        incoming(c, selected).forEach(edge => updateEdge(c, edge, next));
        delete c.questions[selected]; c.order = c.order.filter(id => id !== selected);
        return next || c.start;
      });
    };
    refreshStructureActions();
    find("#moveUp").onclick = () => { if (guardChoices()) structural(view, ctx, c => moveQuestion(c, selected, -1)); };
    find("#moveDown").onclick = () => { if (guardChoices()) structural(view, ctx, c => moveQuestion(c, selected, 1)); };
    find("#reloadDraft").onclick = () => {
      if (dirty() && !confirm("Discard all unsaved edits and load the server draft?")) return;
      operation(view, async () => { const result = await ctx.S.formDraft(); adoptDraft(result); profileDirty = false; previewOpen = false; builder(view, ctx); });
    };
    find("#saveDraft").onclick = () => {
      if (!guardChoices()) return;
      let normalized; try { normalized = schema.validate(cfg); } catch (err) { error(view, err); return; }
      operation(view, async () => {
        // Accept the in-flight positional transport as well as the agreed object contract.
        const result = await (ctx.S.saveFormDraft.length >= 2 ? ctx.S.saveFormDraft(normalized, draft.revision) : ctx.S.saveFormDraft({ config:normalized, revision:draft.revision }));
        adoptDraft(result); profileDirty = false; builder(view, ctx); ctx.toast("Draft saved; live form unchanged"); warning(view, result);
      });
    };
    find("#previewDraft").onclick = () => {
      if (dirty() || !guardChoices()) return;
      try { schema.validate(cfg); previewOpen = true; builder(view, ctx); view.querySelector("#previewPanel").scrollIntoView({ block:"start" }); }
      catch (err) { error(view, err); }
    };
    find("#publishForm").onclick = () => {
      if (dirty() || !guardChoices()) return;
      try { schema.validate(cfg); } catch (err) { error(view, err); return; }
      if (!confirm("Publish this saved draft for all new booking requests? Existing answers remain unchanged. People with an older form may need to refresh.")) return;
      operation(view, async () => {
        const result = await ctx.S.publishForm(ctx.S.saveFormDraft.length >= 2 ? draft.revision : { revision:draft.revision });
        // Publish advances both draft revision and live version to the returned version.
        adoptDraft({ config:result.config, revision:result.version, version:result.version });
        previewOpen = false; builder(view, ctx); ctx.onPublished?.(result); ctx.toast("Form published"); warning(view, result);
      });
    };
    status();
  }

  function activity(view, ctx, result) {
    const actionNames = { "booking.create":"Booking submitted", "booking.update":"Booking updated", "booking.delete":"Booking deleted", "block.create":"Blocked dates added", "block.delete":"Blocked dates removed", "profile.update":"Contact details updated", "password.change":"Password changed", "form.draft":"Form draft saved", "form.publish":"Form published", "facilitator.create":"Facilitator account created", "facilitator.update":"Facilitator account updated", "training.complete":"Training completed", "training.accept":"Training accepted", "training.decline":"Training declined", "attendee.create":"Attendee added", "invitation.issue":"Invitation issued", "invitation.revoke":"Invitation revoked", "sharing.rotate":"Sharing link rotated", "sharing.revoke":"Sharing disabled", "sharing.reactivate":"Sharing enabled" };
    const actor = item => {
      const details = item.actorDetails || {};
      const kind = ["self-reported", "authenticated"].includes(details.kind) ? details.kind : "unknown";
      return { ...details, kind, name:details.name || (item.actor === "anonymous" ? "Anonymous" : item.actor || "Unknown"), label:kind === "self-reported" ? "Self-reported" : kind === "authenticated" ? "Authenticated account" : "Not recorded" };
    };
    const actorHtml = item => {
      const a = actor(item);
      return `<strong>${esc(a.name)}</strong><br><span class="pill ${a.kind === "authenticated" ? "Approved" : "Pending"}">${esc(a.label)}</span>${a.kind === "authenticated" ? `<br><small>${esc(a.username || "")} · ${esc(a.role || "")}</small>` : ""}`;
    };
    const bookingAction = item => /^(booking\.|training\.|sharing\.|attendee\.create$)/.test(item.action) && item.action !== "booking.delete";
    view.innerHTML = `<p class="muted">Names reflect the event time. Requestor names are self-reported, not verified identities. Source IP and location are not collected.</p><form id="activityFilters" class="toolbar activity-filters"><label>Actor<input type="search" name="actor" maxlength="256" placeholder="Name or username" value="${esc(activityQuery.actor)}"></label><label>Actor type<select name="actorType">${option("", "All types", activityQuery.actorType)}${option("self-reported", "Self-reported", activityQuery.actorType)}${option("authenticated", "Authenticated account", activityQuery.actorType)}${option("unknown", "Not recorded", activityQuery.actorType)}</select></label><label>Action<select name="action">${option("", "All actions", activityQuery.action)}${actions.map(action => option(action, actionNames[action] || action, activityQuery.action)).join("")}</select></label><label>From<input type="date" name="from" value="${esc(activityQuery.from)}"></label><label>To<input type="date" name="to" value="${esc(activityQuery.to)}"></label><button type="submit" class="btn primary">Apply filters</button><button type="button" class="btn ghost" id="activityClear">Clear filters</button><button type="button" class="btn" id="activityRefresh">Refresh</button></form><p id="activityFilterError" class="alert" role="alert" hidden></p>
      <section class="panel activity-panel"><table class="tbl"><caption class="sr-only">Activity, page ${esc(result.page)}</caption><thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Summary</th><th scope="col">Details</th></tr></thead><tbody>${result.items.map((item,index) => `<tr><td>${esc(new Date(item.timestamp).toLocaleString())}</td><td>${actorHtml(item)}</td><td>${esc(actionNames[item.action] || item.action)}</td><td>${esc(item.summary)}</td><td><button type="button" class="btn sm" data-event-details="${index}" aria-expanded="false" aria-controls="eventDetails${index}">Details</button></td></tr><tr id="eventDetails${index}" hidden><td colspan="5"><dl class="activity-event-details"><dt>Actor</dt><dd>${actorHtml(item)}</dd><dt>Identity confidence</dt><dd>${actor(item).kind === "self-reported" ? "Submitted name; identity not verified." : actor(item).kind === "authenticated" ? "Signed-in account; display name is editable." : "Legacy event; actor identity was not recorded."}</dd><dt>Timestamp</dt><dd>${esc(item.timestamp)}</dd><dt>Action</dt><dd>${esc(item.action)}</dd><dt>Target</dt><dd class="activity-target">${esc(item.target)}</dd><dt>Source</dt><dd>${item.source === "local-shared" ? "Local shared-production API. " : item.source === "server" ? "Server API. " : ""}Source unavailable — IP and location are not collected.</dd></dl>${bookingAction(item) && ctx.onViewBooking ? `<button type="button" class="btn sm" data-activity-booking="${esc(item.target)}">View booking</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="5">No activity matches these filters.</td></tr>'}</tbody></table></section>
      <div class="toolbar"><button type="button" class="btn" id="activityPrev" ${result.page <= 1 ? "disabled" : ""}>Previous</button><span role="status" aria-live="polite">Page ${esc(result.page)} · ${result.items.length} event${result.items.length === 1 ? "" : "s"}</span><button type="button" class="btn" id="activityNext" ${result.hasMore ? "" : "disabled"}>Next</button></div>`;
    view.querySelector("#activityFilters").onsubmit = e => {
      e.preventDefault(); const form = e.currentTarget;
      if (form.elements.from.value && form.elements.to.value && form.elements.from.value > form.elements.to.value) { const error = view.querySelector("#activityFilterError"); error.textContent = "From date must not be after To date."; error.hidden = false; return; }
      activityQuery = { page:1, ...Object.fromEntries(["action","from","to","actor","actorType"].map(key => [key, form.elements[key].value.trim()])) }; render("activity", view, ctx);
    };
    view.querySelector("#activityClear").onclick = () => { activityQuery = { page:1, action:"", from:"", to:"", actor:"", actorType:"" }; render("activity", view, ctx); };
    view.querySelectorAll("[data-event-details]").forEach(button => { button.onclick = () => { const row = view.querySelector(`#eventDetails${button.dataset.eventDetails}`); row.hidden = !row.hidden; button.setAttribute("aria-expanded", String(!row.hidden)); }; });
    view.querySelectorAll("[data-activity-booking]").forEach(button => { button.onclick = () => ctx.onViewBooking(button.dataset.activityBooking); });
    view.querySelector("#activityRefresh").onclick = () => render("activity", view, ctx);
    view.querySelector("#activityPrev").onclick = () => { activityQuery.page = Math.max(1, result.page - 1); render("activity", view, ctx); };
    view.querySelector("#activityNext").onclick = () => { activityQuery.page = result.page + 1; render("activity", view, ctx); };
  }
  window.SettingsUI = { render, canLeave, deactivate };
})();