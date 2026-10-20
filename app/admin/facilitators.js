(function () {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded";
  const available = (labels, accounts, id) => [...new Set(labels)].filter(label => !accounts.some(a => a.id !== id && a.facilitatorLabel === label));
  const filtered = (accounts, search, status) => accounts.filter(a => (!status || (status === "disabled") === !!a.disabled) && `${a.user} ${a.facilitatorLabel} ${a.profile?.displayName || ""} ${a.profile?.email || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  function password() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-";
    let result = "";
    while (result.length < 20) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      for (const byte of bytes) if (byte < 256 - (256 % alphabet.length) && result.length < 20) result += alphabet[byte % alphabet.length];
    }
    return result;
  }
  function csv(accounts, accountType = "facilitator") {
    const cell = value => '"' + String(value ?? "").replace(/^[\s]*[=+\-@]/, match => "'" + match).replace(/"/g, '""') + '"';
    return [["Username", accountType === "supervisor" ? "Account role" : "Assigned facilitator", "Status", "Created", "Updated"], ...accounts.map(a => [a.user, accountType === "supervisor" ? "Supervisor" : a.facilitatorLabel, a.disabled ? "Disabled" : "Active", a.createdAt || "", a.updatedAt || ""])].map(row => row.map(cell).join(",")).join("\r\n");
  }
  let cleanup = () => {}, leave = () => true;
  async function render(view, { S, identity, labels, accountType = "facilitator" }) {
    deactivate();
    const supervisorDirectory = accountType === "supervisor";
    const accountName = supervisorDirectory ? "Supervisor" : "Facilitator";
    const listAccounts = () => supervisorDirectory ? S.supervisors() : S.facilitators();
    const saveAccount = (input, id) => supervisorDirectory ? S.saveSupervisor(input, id) : S.saveFacilitator(input, id);
    const canViewActivity = identity?.role === "admin";
    let active = true, accounts = [], search = "", status = "", drawer = null, dirty = false, busy = false, loading = false, opener = null, activityGeneration = 0;
    const live = () => active && view.isConnected;
    const unload = event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    leave = () => !busy && (!dirty || confirm("Discard unsaved account changes?"));
    cleanup = () => { active = false; activityGeneration++; window.removeEventListener("beforeunload", unload); if (drawer) { drawer.close(); drawer.remove(); drawer = null; } dirty = false; };
    if (supervisorDirectory ? identity?.role !== "admin" : !["admin", "supervisor"].includes(identity?.role)) { view.innerHTML = '<p role="alert" class="alert">Administrator access required.</p>'; return; }
    const notice = (message, failure = false) => {
      if (!live()) return;
      const node = view.querySelector("#accountNotice");
      node.textContent = message; node.hidden = false; node.className = failure ? "alert" : "account-notice"; node.setAttribute("role", failure ? "alert" : "status");
    };
    const close = (force = false) => {
      if (!force && !leave()) return false;
      activityGeneration++;
      if (drawer) { drawer.querySelectorAll('input[type="password"], input[data-secret]').forEach(input => { input.value = ""; }); drawer.close(); drawer.remove(); drawer = null; }
      dirty = false; if (opener?.isConnected) opener.focus(); else view.querySelector("#createAccount")?.focus();
      return true;
    };
    function rows() {
      const matches = filtered(accounts, search, status);
      view.querySelector("#accountCount").textContent = `${matches.length} of ${accounts.length} accounts`;
      view.querySelector("#accountRows").innerHTML = matches.map(a => `<tr><td><strong>${esc(a.profile?.displayName || a.user)}</strong><br><small>${esc(a.user)}</small><br><small>${esc(a.profile?.email || "No email")}</small></td><td>${esc(supervisorDirectory ? "Supervisor" : a.facilitatorLabel)}</td><td><span class="pill account-status ${a.disabled ? "disabled" : "active"}">${a.disabled ? "Disabled" : "Active"}</span></td><td>${esc(date(a.updatedAt))}</td><td><div class="account-row-actions"><button type="button" class="btn sm" data-edit="${esc(a.id)}" aria-label="View or edit ${esc(a.user)}">View / Edit</button><button type="button" class="btn sm" data-reset="${esc(a.id)}" aria-label="Reset password for ${esc(a.user)}">Reset password</button><button type="button" class="btn sm ${a.disabled ? "ok" : "danger"}" data-status="${esc(a.id)}" aria-label="${a.disabled ? "Enable" : "Disable"} ${esc(a.user)}">${a.disabled ? "Enable" : "Disable"}</button></div></td></tr>`).join("");
      const empty = view.querySelector("#accountEmpty"); empty.hidden = matches.length > 0;
      empty.textContent = accounts.length ? "No accounts match these filters. Clear the search or change the status filter." : "No accounts yet. Create an account to provide the appropriate workspace access.";
      view.querySelector("#exportAccounts").disabled = !matches.length;
    }
    function workspace() {
      if (!live()) return;
      const unassigned = supervisorDirectory ? [] : available(labels, accounts);
      view.innerHTML = `<div class="stats account-stats" aria-label="Account summary">${[[accounts.length,"Total accounts"],[accounts.filter(a => !a.disabled).length,"Active"],[accounts.filter(a => a.disabled).length,"Disabled"],...(!supervisorDirectory ? [[unassigned.length,"Without accounts"]] : [])].map(([n,l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("")}</div>
        <section class="panel"><div class="toolbar"><div class="account-intro"><h2>Account directory</h2><p class="muted">${supervisorDirectory ? "Manage Supervisor logins for scheduling, reporting and facilitator management. Only administrators can manage these accounts." : "Manage limited-access logins and training assignments."}</p></div><button type="button" class="btn primary" id="createAccount">Create account</button><button type="button" class="btn" id="exportAccounts">Export CSV</button><button type="button" class="btn ghost" id="refreshAccounts">Refresh</button></div>
        <p id="accountNotice" role="status" hidden></p><div class="account-filters"><label>Search accounts<input type="search" id="accountSearch" placeholder="${supervisorDirectory ? 'Name, username or email' : 'Name, username, facilitator or email'}" autocomplete="off" value="${esc(search)}"></label><label>Status<select id="accountFilter"><option value="">All accounts</option><option value="active" ${status === "active" ? "selected" : ""}>Active</option><option value="disabled" ${status === "disabled" ? "selected" : ""}>Disabled</option></select></label></div>
        <p id="accountCount" role="status" aria-live="polite"></p><div class="account-table-scroll" tabindex="0" role="region" aria-label="${accountName} account directory"><table class="tbl account-table"><caption class="sr-only">${accountName} accounts and management actions</caption><thead><tr><th scope="col">Username</th><th scope="col">${supervisorDirectory ? "Account role" : "Assigned facilitator"}</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col">Actions</th></tr></thead><tbody id="accountRows"></tbody></table></div><p id="accountEmpty" class="empty"></p>
        <details class="account-help"><summary>Account management guidance</summary><p>Credentials are handed over manually using an approved private channel. Passwords are never included in exports or activity. Disabling an account blocks sign-in but retains account and training history. Security and assignment changes invalidate sessions; contact updates do not.</p>${!supervisorDirectory ? `<p>Facilitators without accounts: ${unassigned.length ? unassigned.map(esc).join(", ") : "All configured facilitators have accounts."} Disabled accounts retain their assignment; re-enable or reassign them instead of creating a duplicate.</p>` : ""}</details></section>`;
      rows();
      view.querySelector("#accountSearch").oninput = e => { search = e.target.value; rows(); };
      view.querySelector("#accountFilter").onchange = e => { status = e.target.value; rows(); };
      view.querySelector("#createAccount").onclick = e => open("create", null, e.currentTarget);
      view.querySelector("#refreshAccounts").onclick = async e => { e.currentTarget.disabled = true; await load(); };
      view.querySelector("#exportAccounts").onclick = () => {
        const url = URL.createObjectURL(new Blob(["\uFEFF" + csv(filtered(accounts, search, status), accountType)], { type:"text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `${accountType}-accounts.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        notice("Exported the filtered account directory. Credentials are excluded.");
      };
      view.querySelector("#accountRows").onclick = e => {
        const button = e.target.closest("[data-edit],[data-reset],[data-status]"); if (!button) return;
        const a = accounts.find(a => a.id === (button.dataset.edit || button.dataset.reset || button.dataset.status));
        if (a) open(button.dataset.edit ? "edit" : button.dataset.reset ? "reset" : "status", a, button);
      };
    }
    async function load(message, warning) {
      if (loading) return;
      loading = true;
      try { const result = await listAccounts(); if (!live()) return; accounts = result; workspace(); if (message) notice(message); if (warning) notice(warning, true); }
      catch (e) { if (!live()) return; if (!view.querySelector("#accountNotice")) view.innerHTML = '<section class="panel"><p id="accountNotice" role="alert"></p><button class="btn" id="accountRetry">Retry account loading</button></section>'; notice(message ? `${message} The change was saved, but the directory could not refresh: ${e.message}. Refresh the directory; do not repeat the change.${warning ? " " + warning : ""}` : e.message, true); const retry = view.querySelector("#accountRetry"); if (retry) retry.onclick = async () => { retry.disabled = true; if (e.code === "BACKEND_UPDATE_REQUIRED") { try { await S.compatibility(true); } catch (err) { notice(err.message, true); retry.disabled = false; return; } } await load(); }; const refresh = view.querySelector("#refreshAccounts"); if (refresh) refresh.disabled = false; }
            finally { loading = false; }
          }
    async function activity(a, page = 1) {
      const token = ++activityGeneration, container = drawer.querySelector("#accountActivity");
      container.innerHTML = '<p role="status">Loading recorded activity…</p>';
      try {
        const result = await S.activity({ target:a.id, page });
        if (!live() || !drawer || token !== activityGeneration) return;
        const items = result.items.filter(item => item.target === a.id);
        container.innerHTML = `<p class="muted">Recorded changes only; not a complete compliance ledger.</p>${items.length ? `<ol class="account-timeline">${items.map(item => `<li><strong>${esc(item.summary)}</strong><br><small>${esc(date(item.timestamp))} · ${esc(item.actor)}</small></li>`).join("")}</ol>` : '<p>No recorded changes on this page.</p>'}<div class="account-row-actions"><button type="button" class="btn sm" id="activityPrevious" ${page === 1 ? "disabled" : ""}>Previous</button><span>Page ${page}</span><button type="button" class="btn sm" id="activityNext" ${!result.hasMore ? "disabled" : ""}>Next</button></div>`;
        container.querySelector("#activityPrevious").onclick = () => activity(a, page - 1);
        container.querySelector("#activityNext").onclick = () => activity(a, page + 1);
      } catch (e) { if (live() && drawer && token === activityGeneration) { container.innerHTML = '<p role="alert"></p><button type="button" class="btn sm">Retry activity</button>'; container.querySelector("p").textContent = e.message; container.querySelector("button").onclick = () => activity(a, page); } }
    }
    function open(kind, a, trigger) {
      if (loading || !close()) return;
      opener = trigger;
      const creating = kind === "create", resetting = kind === "reset", changingStatus = kind === "status", contact = kind === "contact", secret = creating || resetting;
      const choices = available(labels, accounts, a?.id);
      if (a?.facilitatorLabel && !choices.includes(a.facilitatorLabel)) choices.push(a.facilitatorLabel);
      const title = contact ? "Contact details" : creating ? `Create ${accountName.toLowerCase()} account` : resetting ? "Reset password" : changingStatus ? `${a.disabled ? "Enable" : "Disable"} account` : "Account details";
      drawer = document.createElement("dialog"); drawer.className = "account-drawer"; drawer.setAttribute("aria-labelledby", "accountDrawerTitle");
      drawer.innerHTML = `<header class="account-drawer-heading"><div><p class="eyebrow">${accountName} management</p><h2 id="accountDrawerTitle">${title}</h2>${a ? `<p>${esc(a.user)} · <span class="pill account-status ${a.disabled ? "disabled" : "active"}">${a.disabled ? "Disabled" : "Active"}</span></p>` : ""}</div><button type="button" class="btn ghost" id="closeAccount" aria-label="Close account details">Close</button></header>
        <form id="accountForm" class="account-form"><p id="accountFormError" role="alert" class="alert" hidden></p>
        ${creating ? '<label>Username<input name="username" type="text" required minlength="3" maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._@\\-]{2,99}" autocomplete="off" aria-describedby="usernameHelp"><small id="usernameHelp">3–100 characters: letters, numbers, dot, underscore, @ or hyphen. Start with a letter or number.</small></label>' : ""}
        ${!supervisorDirectory && !resetting && !changingStatus && !contact ? `<label>Assigned facilitator<select name="facilitatorLabel" required><option value="">Select a facilitator</option>${choices.map(label => `<option value="${esc(label)}" ${label === a?.facilitatorLabel ? "selected" : ""}>${esc(label)}</option>`).join("")}</select><small>One account per facilitator, including disabled accounts.</small></label>${!choices.length ? '<p class="alert">All configured facilitators already have accounts. Edit or re-enable an existing account.</p>' : ""}` : ""}
        ${contact || creating ? `<label>Display name<input type="text" name="displayName" required maxlength="100" autocomplete="name" value="${esc(a?.profile?.displayName || "")}"></label><label>Email<input type="email" name="email" maxlength="254" autocomplete="email" value="${esc(a?.profile?.email || "")}"></label><label>Phone<input type="tel" name="phone" maxlength="32" autocomplete="tel" value="${esc(a?.profile?.phone || "")}"></label><p class="muted">Email is used for contact and request notifications when enabled, not sign-in or password recovery.</p>` : ""}
        ${secret ? '<label>New password<input name="password" data-secret type="password" required minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="passwordHelp"><small id="passwordHelp">12–128 characters. Hand over privately; this password will not be retrievable after saving.</small></label><div class="account-row-actions"><button class="btn sm" type="button" id="generatePassword">Generate strong password</button><button class="btn sm" type="button" id="revealPassword" aria-pressed="false">Show password</button><button class="btn sm" type="button" id="copyPassword">Copy password</button></div><p id="passwordNotice" role="status" aria-live="polite"></p>' : ""}
        ${changingStatus ? `<p>${a.disabled ? "Enable sign-in for this account again." : "This account will be unable to sign in. Existing sessions will be invalidated; account and training history will be retained."}</p>` : ""}
        ${contact ? '<p class="account-notice">Contact updates keep existing sessions signed in.</p>' : !creating && !(supervisorDirectory && kind === "edit") ? '<p class="account-notice">Saving invalidates sessions. The account holder must sign in again.</p>' : ""}
        ${!creating && !resetting && !changingStatus ? `<dl class="account-metadata"><dt>Username</dt><dd>${esc(a.user)}</dd><dt>Created</dt><dd>${esc(date(a.createdAt))}</dd><dt>Last updated</dt><dd>${esc(date(a.updatedAt))}</dd></dl>` : ""}
        ${supervisorDirectory && kind === "edit" ? '<p class="account-notice">Supervisor access includes all schedules, booking management and conflict overrides, blocked dates, reporting, facilitator account management and CSAT. Form publishing, shared settings and activity logs remain administrator-only.</p>' : ""}<div class="account-form-actions"><button type="button" class="btn ghost" id="cancelAccount">Cancel</button><button type="submit" class="btn ${changingStatus && !a.disabled ? "danger" : "primary"}" id="saveAccount" ${supervisorDirectory && kind === "edit" ? "hidden" : ""} ${creating && !supervisorDirectory && !choices.length ? "disabled" : ""}>${contact ? "Save contact details" : creating ? "Create account" : resetting ? "Confirm password reset" : changingStatus ? `${a.disabled ? "Enable" : "Disable"} account` : "Save assignment"}</button></div></form>
        ${kind === "edit" ? `<section class="account-activity"><h3>Contact details</h3><p>${esc(a.profile?.displayName || a.user)}<br>${esc(a.profile?.email || "No email")}<br>${esc(a.profile?.phone || "No phone")}</p><button type="button" class="btn" id="editAccountContact">Edit contact details</button></section>${canViewActivity ? '<section class="account-activity"><h3>Account activity</h3><div id="accountActivity"></div></section>' : ""}` : ""}`;
      view.append(drawer); drawer.showModal();
      drawer.querySelector("#closeAccount").onclick = () => close(); drawer.querySelector("#cancelAccount").onclick = () => close();
      drawer.addEventListener("cancel", e => { e.preventDefault(); close(); });
      const form = drawer.querySelector("#accountForm");
      const formChanged = () => {
        dirty = contact ? ["displayName", "email", "phone"].some(key => form.elements[key].value.trim() !== (a.profile?.[key] || "")) : true;
        if (contact) form.querySelector("#saveAccount").disabled = !dirty;
      };
      form.oninput = formChanged; form.onchange = formChanged;
      if (contact) form.querySelector("#saveAccount").disabled = true;
      if (secret) {
        const input = form.querySelector('[name="password"]');
        form.querySelector("#generatePassword").onclick = () => { input.value = password(); dirty = true; form.querySelector("#passwordNotice").textContent = "Strong password generated. Copy it before saving and hand it over privately."; };
        form.querySelector("#revealPassword").onclick = e => { const show = input.type === "password"; input.type = show ? "text" : "password"; e.currentTarget.textContent = show ? "Hide password" : "Show password"; e.currentTarget.setAttribute("aria-pressed", String(show)); };
        form.querySelector("#copyPassword").onclick = async () => {
          if (!input.value) { form.querySelector("#passwordNotice").textContent = "Enter or generate a password first."; return; }
          try { await navigator.clipboard.writeText(input.value); if (live() && form.isConnected) form.querySelector("#passwordNotice").textContent = "Password copied. Hand over privately and clear your clipboard afterward."; }
          catch { if (live() && form.isConnected) { input.focus(); input.select(); form.querySelector("#passwordNotice").textContent = "Clipboard unavailable. Select and copy the password manually."; } }
        };
      }
      form.onsubmit = async e => {
        e.preventDefault(); if (busy || !form.reportValidity()) return;
        const data = new FormData(form), profile = Object.fromEntries(["displayName", "email", "phone"].map(key => [key, String(data.get(key) || "").trim()])), input = contact ? { profile } : creating ? { username:data.get("username"), facilitatorLabel:data.get("facilitatorLabel"), password:data.get("password") } : resetting ? { password:data.get("password") } : changingStatus ? { disabled:!a.disabled } : { facilitatorLabel:data.get("facilitatorLabel") };
        if ((contact || creating) && (!profile.displayName || profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) || profile.phone && !/^[+()\d .-]+$/.test(profile.phone))) {
          const error = form.querySelector("#accountFormError"); error.textContent = "Enter a display name and valid email/phone contact details."; error.hidden = false; return;
        }
        if (creating) { input.profile = profile; if (supervisorDirectory) delete input.facilitatorLabel; }
        if (contact && Object.keys(profile).every(key => profile[key] === (a.profile?.[key] || ""))) return;
        if (!contact && !creating && !resetting && !changingStatus && (supervisorDirectory || input.facilitatorLabel === a.facilitatorLabel)) { form.querySelector("#accountFormError").textContent = "No assignment changes to save."; form.querySelector("#accountFormError").hidden = false; return; }
        if (!contact && !creating && !changingStatus && !confirm(resetting ? `Reset the password for ${a.user}? Existing sessions will be invalidated.` : `Change the assignment for ${a.user}? Existing sessions will be invalidated.`)) return;
        busy = true; drawer.querySelectorAll("button, input, select").forEach(node => { node.disabled = true; });
        try {
          const result = await saveAccount(input, a?.id);
          if (!live()) return;
          busy = false; dirty = false; close(true);
          await load(`${contact ? "Contact details saved" : creating ? "Account created" : resetting ? "Password reset" : changingStatus ? (a.disabled ? "Account enabled" : "Account disabled") : "Assignment saved"}. ${contact ? "Existing sessions remain signed in." : secret ? "Hand over the password privately." : "The account holder must sign in again."}`,  result.auditRecorded === false ? result.warning || "Saved, but activity recording failed. Do not retry the change." : "");
          view.querySelector("#createAccount")?.focus();
        } catch (err) {
          if (live() && drawer) { drawer.querySelectorAll("button, input, select").forEach(node => { node.disabled = false; }); const error = form.querySelector("#accountFormError"); error.textContent = err.message; error.hidden = false; error.setAttribute("tabindex", "-1"); error.focus(); }
        } finally { busy = false; }
      };
      if (kind === "edit") {
        drawer.querySelector("#editAccountContact").onclick = () => open("contact", a, trigger);
        if (canViewActivity) activity(a);
      }
    }
    view.innerHTML = `<p role="status">Loading ${accountName.toLowerCase()} accounts…</p>`;
    await load();
  }
  function deactivate() { cleanup(); cleanup = () => {}; leave = () => true; }
  window.FacilitatorUI = { render, deactivate, canLeave:() => leave(), tools:{ available, filtered, password, csv } };
})();
