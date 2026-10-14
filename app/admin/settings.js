/* Admin-only UI. Transport and schema invariants belong to BookingStore/FormSchema. */
(function () {
  "use strict";
  const schema = window.FormSchema;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const label = c => typeof c === "string" ? c : c.label;
  const option = (value, title, selected) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(title)}</option>`;
  const select = (values, selected) => values.map(v => option(v, v, selected)).join("");
  const actions = ["booking.create", "booking.update", "booking.delete", "block.create", "block.delete", "profile.update", "password.change", "form.draft", "form.publish"];
  let activeTab = "", generation = 0, busy = false, profileDirty = false;
  let draft = null, saved = "", selected = "", previewOpen = false;
  let activityQuery = { page:1, action:"", from:"" };
  const dirty = () => profileDirty || !!draft && JSON.stringify(draft.config) !== saved;
  window.addEventListener("beforeunload", e => { if (dirty() || busy) { e.preventDefault(); e.returnValue = ""; } });

  function canLeave() {
    if (busy) { alert("Please wait for the current request to finish."); return false; }
    if (!dirty()) return true;
    if (!confirm("Discard unsaved changes and leave this tab? Saved drafts are not affected.")) return false;
    if (draft && saved) draft.config = JSON.parse(saved);
    profileDirty = false; previewOpen = false;
    return true;
  }
  function deactivate() { activeTab = ""; generation++; }
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
    el.textContent = err.status === 409 ? `${err.message} Your unsaved edits were retained. Use Reload draft to discard them and fetch the latest revision.` :
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
    }
  }
  async function render(tab, view, context) {
    activeTab = tab; const token = ++generation;
    if (context.mode !== "api") {
      view.innerHTML = `<section class="panel"><h2>${esc({ profile:"My profile", builder:"Form builder", activity:"Activity log" }[tab])}</h2><p class="muted">These settings require the authenticated API. Account changes, drafts and publishing are not available in local storage mode.</p></section>`;
      return;
    }
    view.innerHTML = '<div class="panel" role="status">Loading settings…</div>';
    try {
      if (tab === "profile") {
        const identity = await context.S.profile();
        if (token === generation && activeTab === tab) profile(view, context, identity);
      } else if (tab === "builder") {
        if (!draft) {
          const result = await context.S.formDraft();
          if (token !== generation) return;
          adoptDraft(result);
        }
        if (token === generation && activeTab === tab) builder(view, context);
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

  function profile(view, ctx, account) {
    const p = account.profile || {}, local = account.provider === "local";
    profileDirty = false;
    view.innerHTML = `<div class="settings-heading"><div><h2>My profile</h2><p class="muted">Manage your contact details and account security.</p></div></div>
      <div class="settings-grid">
        <section class="panel"><h3>Account details</h3><p class="muted small">Signed in with ${esc(account.provider || "your identity provider")}.</p>
          <form id="profileForm" class="settings-form">
            <label>Username<input name="username" value="${esc(account.user)}" autocomplete="username" readonly></label>
            <label>Display name<input name="displayName" value="${esc(p.displayName)}" autocomplete="name" maxlength="100" required></label>
            <label>Email<input name="email" type="email" value="${esc(p.email)}" autocomplete="email" maxlength="254"></label>
            <label>Phone<input name="phone" type="tel" value="${esc(p.phone)}" autocomplete="tel" maxlength="32"></label>
            <p class="muted small">Your login username cannot be changed here.</p><button class="btn primary" type="submit">Save profile</button>
          </form>
        </section>
        <section class="panel"><h3>Password</h3>${local ? `<p class="muted" id="passwordPolicy">Use 12–128 characters, different from your current password. Spaces and pasted passwords are supported. A successful change signs out all sessions.</p>
          <form id="passwordForm" class="settings-form" aria-describedby="passwordPolicy">
            <input type="text" name="username" value="${esc(account.user)}" autocomplete="username" readonly hidden>
            ${[["currentPassword", "Current password", "current-password"], ["newPassword", "New password", "new-password"], ["confirmPassword", "Confirm new password", "new-password"]].map(([name, title, autocomplete]) => `<label for="${name}">${title}</label><div class="password-control"><input id="${name}" name="${name}" type="password" autocomplete="${autocomplete}" ${name !== "currentPassword" ? 'minlength="12"' : ""} maxlength="128" required><button class="btn" type="button" data-reveal="${name}" aria-controls="${name}" aria-label="Show ${title.toLowerCase()}" aria-pressed="false">Show</button></div>`).join("")}
            <button type="submit" class="btn primary">Change password</button>
          </form>` : '<p class="muted">This account uses an external identity provider. Change your password with that provider; this portal cannot update it.</p>'}</section>
      </div>`;
    const pf = view.querySelector("#profileForm"), passwordForm = view.querySelector("#passwordForm");
    const formsDirty = () => {
      profileDirty = ["displayName", "email", "phone"].some(k => pf.elements[k].value !== (p[k] || "")) ||
        !!passwordForm && ["currentPassword", "newPassword", "confirmPassword"].some(k => passwordForm.elements[k].value !== "");
    };
    pf.oninput = formsDirty;
    pf.onsubmit = e => {
      e.preventDefault();
      const fields = Object.fromEntries(["displayName", "email", "phone"].map(k => [k, pf.elements[k].value.trim()]));
      if (!fields.displayName || fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email) || fields.phone && !/^[+()\d .-]+$/.test(fields.phone)) {
        error(view, new Error("Enter a display name and valid email/phone contact details.")); return;
      }
      operation(view, async () => {
        const result = await ctx.S.updateProfile(fields);
        Object.assign(p, result.profile || fields);
        for (const k of Object.keys(fields)) pf.elements[k].value = p[k];
        formsDirty(); ctx.onProfile?.(result); ctx.toast("Profile saved"); warning(view, result);
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
  function protectedQuestion(q) { return schema.REQUIRED.includes(q.field); }
  function uniqueId(prefix, taken) {
    let i = 1; while (taken.includes(prefix + i)) i++;
    return prefix + i;
  }
  function destinationOptions(config, current, ownId) {
    const reaches = (id, target, seen = new Set()) => {
      if (id === target) return true;
      if (!id || seen.has(id)) return false;
      seen.add(id); const q = config.questions[id];
      return !!q && [q.next, ...(q.choices || []).map(c => typeof c === "object" && c.goto)].filter(Boolean).some(next => reaches(next, target, seen));
    };
    return option("", "Default / end of form", current || "") + config.order.filter(id => !ownId || !reaches(id, ownId))
      .map(id => option(id, `${config.questions[id].title} (${id})`, current)).join("");
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
    const q = cfg.questions[selected], essential = protectedQuestion(q), fixedType = ["date", "facilitator", "time"].includes(selected) || q.field === "participants";
    view.innerHTML = `<div class="settings-heading"><div><h2>Form builder</h2><p class="muted">Draft changes are private until published. Choice labels are stored answer values.</p></div>
      <div class="settings-actions"><button type="button" class="btn" id="reloadDraft">Reload draft</button><button type="button" class="btn primary" id="saveDraft">Save draft</button><button type="button" class="btn" id="previewDraft">Preview</button><button type="button" class="btn primary" id="publishForm">Publish</button></div></div>
      <div class="builder-status" role="status" aria-live="polite" id="builderStatus"></div>
      <p class="muted small version-info">Draft revision: ${esc(draft.revision)} · Live version: ${esc(draft.version)}</p>
      <div class="alert settings-validation" id="draftValidation" hidden></div>
      <div class="builder-layout">
        <aside class="panel question-list"><h3>Questions</h3><ol>${cfg.order.map(id => `<li><button type="button" class="question-pick ${id === selected ? "selected" : ""}" data-question="${esc(id)}" ${id === selected ? 'aria-current="true"' : ""}><span>${esc(cfg.questions[id].title)}</span><small>${esc(id)} · ${esc(cfg.questions[id].type)}${protectedQuestion(cfg.questions[id]) ? " · essential" : ""}${cfg.start === id ? " · start" : ""}</small></button></li>`).join("")}</ol>
          <button type="button" class="btn" id="addQuestion">Add after selected</button><p class="muted small">Reorder changes routing only in simple linear segments. Branches and joins are never silently rewired.</p></aside>
        <section class="panel"><h3>Question inspector</h3><div class="settings-actions inspector-actions"><button type="button" class="btn" id="moveUp">Move up</button><button type="button" class="btn" id="moveDown">Move down</button><button type="button" class="btn" id="duplicateQuestion">Duplicate</button><button type="button" class="btn danger" id="removeQuestion" ${essential ? "disabled" : ""}>Remove</button></div>
          <p class="muted small">Stable ID: ${esc(selected)}${q.field ? ` · Booking mapping: ${esc(q.field)}` : " · Custom answer"}. ${essential ? "Essential field: removal and optional answers are locked." : ""}</p>
          <form class="settings-form" id="inspector">
            <label>Label<input data-prop="title" value="${esc(q.title)}" maxlength="200" required></label>
            <div class="form-grid"><label>Type<select data-prop="type" ${fixedType ? "disabled" : ""}>${select(schema.TYPES.filter(t => !q.field || t !== "multi" || q.field === "topic"), q.type)}</select></label>
              <label>Section<select data-prop="section">${option("", "No section", q.section || "")}${cfg.sections.map(s => option(s.id, s.title, q.section)).join("")}</select></label></div>
            <label class="check-label"><input type="checkbox" data-prop="required" ${q.required ? "checked" : ""} ${essential ? "disabled" : ""}>Required answer</label>
            <label>Help text<textarea data-prop="help" maxlength="1000">${esc(q.help)}</textarea></label>
            <label>Placeholder<input data-prop="placeholder" value="${esc(q.placeholder)}" maxlength="200"></label>
            <label>Next question (default route)<select data-prop="next">${destinationOptions(cfg, q.next, selected)}</select></label>
            ${["number", "multi"].includes(q.type) ? `<div class="form-grid">${["min", "max"].map(k => `<label>${k === "min" ? "Minimum" : "Maximum"}${q.type === "multi" ? " selections" : " value"}<input type="number" step="1" data-prop="${k}" value="${esc(q[k])}" min="${q.type === "multi" ? 1 : -1000000}" max="${q.type === "multi" ? q.choices.length : 1000000}"></label>`).join("")}</div>` : ""}
            ${["choice", "multi"].includes(q.type) ? `<label>Choices (one label per line)<textarea id="choiceLines" rows="6" aria-describedby="choiceHelp">${esc(q.choices.map(label).join("\n"))}</textarea></label><p id="choiceHelp" class="muted small">Routes stay attached to unchanged labels. Renaming routed choices requires confirmation; their routes follow the same line when unambiguous. New labels use the default route.</p>
              <button type="button" class="btn" id="applyChoices">Apply choices</button>
              ${q.type === "choice" ? `<label class="check-label"><input type="checkbox" data-prop="allowOther" ${q.allowOther ? "checked" : ""} ${["facilitator", "time"].includes(selected) ? "disabled" : ""}>Allow another answer (uses default route)</label><h3>Choice branches</h3><div class="branch-list">${q.choices.map((c, i) => `<label>${esc(label(c))}<select data-branch="${i}">${destinationOptions(cfg, typeof c === "object" ? c.goto : "", selected)}</select></label>`).join("")}</div>` : ""}` : ""}
          </form>
        </section>
      </div>
      <section class="panel"><h3>Form settings</h3><div class="form-grid"><label>Form title<input id="formTitle" value="${esc(cfg.title)}" maxlength="200" required></label><label>Start question<select id="formStart">${cfg.order.map(id => option(id, cfg.questions[id].title + " (" + id + ")", cfg.start)).join("")}</select></label></div>
        <p class="muted small">Every route must include requestor, division, category, date, facilitator, time and venue. Invalid routes cannot be saved or published.</p>
        <h3>Safe appearance options</h3><div class="theme-grid">${["primary", "background"].map(k => `<label>${k === "primary" ? "Accent color" : "Background color"}<input type="color" data-theme="${k}" value="${esc(cfg.theme[k])}"></label>`).join("")}
          ${[["density", ["compact", "comfortable"]], ["width", ["narrow", "standard", "wide"]], ["cardStyle", ["outlined", "elevated", "flat"]]].map(([key, values]) => `<label>${esc(key)}<select data-theme="${key}">${select(values, cfg.theme[key])}</select></label>`).join("")}</div>
      </section>
      <section class="panel"><h3>Sections</h3><div class="section-list">${cfg.sections.map(s => `<div class="section-editor"><label>Section title<input data-section-title="${esc(s.id)}" value="${esc(s.title)}" maxlength="200"></label><label>Description<textarea data-section-description="${esc(s.id)}" maxlength="1000">${esc(s.description)}</textarea></label><button type="button" class="btn danger" data-remove-section="${esc(s.id)}">Delete section</button></div>`).join("") || '<p class="muted">No sections yet.</p>'}</div><button type="button" class="btn" id="addSection">Add section</button></section>
      <section class="panel" id="previewPanel" ${previewOpen ? "" : "hidden"}><h3>Saved draft preview</h3><p class="muted">Authenticated public renderer; submissions are disabled. Save again to preview further edits.</p>${previewOpen ? '<iframe class="draft-preview" title="Saved booking form draft" src="/?preview=draft"></iframe>' : ""}</section>`;
    const find = s => view.querySelector(s);
    find("#inspector").onsubmit = e => e.preventDefault();
    function status() {
      let valid = true;
      try { schema.validate(cfg); find("#draftValidation").hidden = true; }
      catch (err) { valid = false; find("#draftValidation").textContent = err.message; find("#draftValidation").hidden = false; }
      const changed = dirty();
      find("#builderStatus").textContent = changed ? "Unsaved changes — save a valid draft before preview or publish." : "Saved draft — ready to preview or publish.";
      find("#publishForm").disabled = changed || !valid;
      find("#previewDraft").disabled = changed || !valid;
      find("#saveDraft").disabled = !valid || !changed;
      if (changed) find("#previewPanel").hidden = true;
    }
    // Multiline choices are unapplied input too: keep a separate dirty sentinel by
    // committing them on explicit Apply, and gate save/preview until then.
    let choicePending = false;
    function changed() { previewOpen = false; status(); }
    function pendingChoices() {
      const lines = find("#choiceLines");
      choicePending = !!lines && lines.value !== q.choices.map(label).join("\n");
      if (choicePending) {
        profileDirty = true; find("#builderStatus").textContent = "Unapplied choice edits — use Apply choices before saving.";
        ["#saveDraft", "#publishForm", "#previewDraft"].forEach(s => { find(s).disabled = true; });
      } else { profileDirty = false; status(); }
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
    view.querySelectorAll("[data-theme]").forEach(input => { input.oninput = () => { cfg.theme[input.dataset.theme] = input.value; changed(); if (choicePending) pendingChoices(); }; });
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
    find("#moveUp").disabled = cfg.order.indexOf(selected) === 0;
    find("#moveDown").disabled = cfg.order.indexOf(selected) === cfg.order.length - 1;
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
    view.innerHTML = `<div class="settings-heading"><div><h2>Activity log</h2><p class="muted">Operational history of saved changes. No passwords or raw request bodies are shown.</p></div></div>
      <form id="activityFilters" class="toolbar"><label>Action<select name="action">${option("", "All actions", activityQuery.action)}${select(actions, activityQuery.action)}</select></label><label>Since date<input type="date" name="from" value="${esc(activityQuery.from)}"></label><button type="submit" class="btn primary">Apply filters</button><button type="button" class="btn" id="activityRefresh">Refresh</button></form>
      <section class="panel activity-panel"><table class="tbl"><caption class="sr-only">Admin activity, page ${esc(result.page)}</caption><thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Summary</th></tr></thead><tbody>${result.items.map(item => `<tr><td>${esc(new Date(item.timestamp).toLocaleString())}</td><td>${esc(item.actor)}</td><td>${esc(item.action)}</td><td class="activity-target">${esc(item.target)}</td><td>${esc(item.summary)}</td></tr>`).join("") || '<tr><td colspan="5">No activity matches these filters.</td></tr>'}</tbody></table></section>
      <div class="toolbar"><button type="button" class="btn" id="activityPrev" ${result.page <= 1 ? "disabled" : ""}>Previous</button><span role="status">Page ${esc(result.page)}</span><button type="button" class="btn" id="activityNext" ${result.hasMore ? "" : "disabled"}>Next</button></div>`;
    view.querySelector("#activityFilters").onsubmit = e => {
      e.preventDefault(); const form = e.currentTarget;
      activityQuery = { page:1, action:form.elements.action.value, from:form.elements.from.value }; render("activity", view, ctx);
    };
    view.querySelector("#activityRefresh").onclick = () => render("activity", view, ctx);
    view.querySelector("#activityPrev").onclick = () => { activityQuery.page = Math.max(1, result.page - 1); render("activity", view, ctx); };
    view.querySelector("#activityNext").onclick = () => { activityQuery.page = result.page + 1; render("activity", view, ctx); };
  }
  window.SettingsUI = { render, canLeave, deactivate };
})();