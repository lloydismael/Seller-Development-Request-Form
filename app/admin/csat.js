(function () {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  let generation = 0;
  async function render(tab, view, ctx) {
    const current = ++generation, { S, identity, labels } = ctx;
    const live = () => current === generation && view.isConnected;
    const error = e => { if (live()) { const p = document.createElement("p"); p.className = "alert"; p.setAttribute("role", "alert"); p.textContent = e.message; view.prepend(p); } };
    const warn = value => { if (value?.auditRecorded === false) error(new Error(value.warning)); };
    view.innerHTML = '<p role="status">Loading…</p>';
    try {
      if (tab === "facilitators") {
        const accounts = await S.facilitators();
        if (!live()) return;
        const options = selected => [...new Set([...labels, selected].filter(Boolean))].map(label => `<option ${label === selected ? "selected" : ""}>${esc(label)}</option>`).join("");
        view.innerHTML = `<section class="panel"><h2>Facilitator accounts</h2><p>Assign a login to a training facilitator. Credentials are handed over manually; password resets and account changes invalidate existing sessions.</p>
          <form id="newFacilitator" class="form-grid"><label>Username<input name="username" required minlength="3" maxlength="100" autocomplete="off"></label><label>Initial password<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><label>Assigned facilitator<select name="facilitatorLabel">${options("")}</select></label><button class="btn primary">Create account</button></form></section>
          ${accounts.map(a => `<section class="panel"><h3>${esc(a.user)}</h3><form data-account="${esc(a.id)}" class="form-grid"><label>Assigned facilitator<select name="facilitatorLabel">${options(a.facilitatorLabel)}</select></label><label>Reset password (leave blank to keep)<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password"></label><label><input type="checkbox" name="disabled" ${a.disabled ? "checked" : ""}> Disabled</label><button class="btn">Save account</button></form></section>`).join("")}`;
        view.querySelectorAll("form").forEach(form => { form.onsubmit = async e => {
          e.preventDefault(); const button = form.querySelector("button"); button.disabled = true;
          const data = new FormData(form), input = { facilitatorLabel:data.get("facilitatorLabel") };
          if (form.dataset.account) { input.disabled = data.has("disabled"); if (data.get("password")) input.password = data.get("password"); }
          else { input.username = data.get("username"); input.password = data.get("password"); }
          try { const value = await S.saveFacilitator(input, form.dataset.account); form.reset(); await render(tab, view, ctx); warn(value); }
          catch (err) { error(err); } finally { button.disabled = false; }
        }; });
        return;
      }
      const sessions = await S.trainingSessions();
      if (!live()) return;
      view.innerHTML = `<section class="panel"><h2>${identity.role === "facilitator" ? "My assigned training" : "Training CSAT"}</h2><p>Phone Videography surveys open after approved training is completed. Share one session link or QR with all attendees; registration is optional for legacy invitations.</p>${sessions.length ? sessions.map(b => `<div class="panel"><h3>${esc(b.topic)}</h3><p>${esc(b.trainingDate)} · ${esc(b.time)} · ${esc(b.facilitator)} · ${esc(b.status)}</p><p>${esc(b.requestor)} · ${esc(b.venue)}</p>${b.status === "Pending" ? `<button class="btn primary" data-accept="${esc(b.id)}">Accept request</button> <button class="btn" data-decline="${esc(b.id)}">Decline request</button>` : ""} ${b.topic === "Phone Videography" ? `<button class="btn" data-session="${esc(b.id)}">Attendees and CSAT</button>` : '<p class="muted">CSAT is not available for this module.</p>'}</div>`).join("") : '<p>No assigned sessions.</p>'}</section>`;
      for (const action of ["accept", "decline"]) view.querySelectorAll(`[data-${action}]`).forEach(button => {
        button.onclick = async () => {
          if (!confirm(`${action === "accept" ? "Accept and approve" : "Decline and reject"} this booking request?`)) return;
          view.querySelectorAll(`[data-accept="${button.dataset[action]}"],[data-decline="${button.dataset[action]}"]`).forEach(b => { b.disabled = true; });
          try { const value = await S.decideTraining(button.dataset[action], action); await render(tab, view, ctx); warn(value); }
          catch (e) { await render(tab, view, ctx); error(e); }
        };
      });
      view.querySelectorAll("[data-session]").forEach(button => { button.onclick = () => detail(button.dataset.session); });
      async function detail(id, issued) {
        try {
          const data = await S.trainingSession(id);
          const share = await S.trainingSharing(id);
          if (!live()) return;
          const b = data.session;
          view.innerHTML = `<section class="panel"><button class="btn" id="backSessions">Back to sessions</button><h2>${esc(b.topic)}</h2><p>${esc(b.trainingDate)} · ${esc(b.facilitator)} · ${esc(b.status)}</p>
            <p role="status">CSAT: ${b.csatOpen ? "Open" : b.csatActivatedAt ? "Closed" : "Not activated"}. ${data.responses.length} total submissions (${data.responses.filter(r => r.source === "shared").length} shared-link responses).</p>
            ${b.status === "Approved" || (identity.role === "admin" && b.status === "Completed" && !b.csatActivatedAt) ? '<button class="btn primary" id="completeSession">Complete / activate CSAT</button>' : ""}
            <section class="csat-sharing"><h3>Session CSAT link and QR</h3><p>No attendee registration needed. Multiple responses are allowed. Sharing is ${esc(share.state)}; responses open after completion.</p><div id="sharedControls"></div><div>${share.state === "revoked" ? '<button class="btn" data-share="reactivate">Reactivate sharing</button>' : '<button class="btn" data-share="rotate">Rotate link and QR</button><button class="btn" data-share="revoke">Revoke shared access</button>'}</div></section>
            <details><summary>Legacy individual invitations (${data.attendees.length} registered attendees)</summary>
            <h3>Register legacy attendee (optional)</h3><form id="addAttendee" class="form-grid"><label>Name<input name="name" required maxlength="200"></label><label>Email (optional; no automatic delivery)<input name="email" type="email" maxlength="254"></label><button class="btn">Add attendee</button></form>
            <p>Each attendee gets one unique bearer link, distributed manually. Anyone holding that link can answer. Reissuing invalidates the old link; answered invitations cannot be reset.</p>
            ${issued?.link ? `<label>Copy this attendee link now (it is not stored in readable form)<input id="issuedLink" readonly value="${esc(new URL(issued.link, location.origin).href)}"></label><button class="btn" id="copyLink">Copy link</button><button class="btn" id="downloadLink">Download link</button>` : ""}
            ${data.attendees.map(a => `<div class="panel"><strong>${esc(a.name)}</strong> ${esc(a.email)} — ${esc(a.invitationState)} ${a.invitationState !== "answered" ? `${b.csatOpen ? `<button class="btn sm" data-issue="${esc(a.id)}">${a.invitationState === "issued" ? "Reissue" : "Issue"} link</button>` : ""} ${a.invitationState === "issued" ? `<button class="btn sm" data-revoke="${esc(a.id)}">Revoke</button>` : ""}` : ""}</div>`).join("")}
            </details><h3>Rating averages</h3>${data.averages.map(a => `<p>${esc(a.title)} <strong>${a.average === null ? "No responses" : a.average.toFixed(2) + " / 5"}</strong> (${a.count})</p>`).join("")}
            <h3>Responses</h3>${data.responses.map(r => `<details><summary>${esc(r.answers.name)} — ${r.source === "shared" ? "shared link" : "registered as " + esc(r.attendeeName)} · ${esc(r.submittedAt)}</summary><dl>${r.answerSnapshot.map(a => `<dt>${esc(a.title)}</dt><dd>${esc(a.value)}</dd>`).join("")}</dl></details>`).join("")}</section>`;
          window.CsatShare.mount(view.querySelector("#sharedControls"), share);
          view.querySelectorAll("[data-share]").forEach(button => { button.onclick = async () => {
            if (!confirm("Change shared access? Rotation/reactivation invalidates the previous QR and link; revocation blocks shared submissions. Existing individual invitations are unchanged.")) return;
            button.disabled = true;
            try { const value = await S.trainingSharing(id, button.dataset.share); await detail(id); warn(value); }
            catch (e) { error(e); button.disabled = false; }
          }; });
          view.querySelector("#backSessions").onclick = () => render(tab, view, ctx);
          const complete = view.querySelector("#completeSession");
          if (complete) complete.onclick = async () => { if (!confirm("Mark this session complete and activate its CSAT invitations?")) return; complete.disabled = true; try { const value = await S.completeTraining(id, b.status === "Completed"); await detail(id); warn(value); } catch (e) { error(e); complete.disabled = false; } };
          const form = view.querySelector("#addAttendee");
          form.onsubmit = async e => { e.preventDefault(); const button = form.querySelector("button"); button.disabled = true; try { const f = new FormData(form), value = await S.addAttendee(id, { name:f.get("name"), email:f.get("email") }); await detail(id); warn(value); } catch (e) { error(e); button.disabled = false; } };
          for (const action of ["issue", "revoke"]) view.querySelectorAll(`[data-${action}]`).forEach(button => { button.onclick = async () => { if (action === "issue" && button.textContent === "Reissue link" && !confirm("Invalidate the previous invitation?")) return; button.disabled = true; try { const value = await S.invitation(id, button.dataset[action], action); await detail(id, value); warn(value); } catch (e) { error(e); button.disabled = false; } }; });
          const download = view.querySelector("#downloadLink");
          if (download) download.onclick = () => {
            const url = URL.createObjectURL(new Blob([view.querySelector("#issuedLink").value + "\n"], { type:"text/plain" }));
            const a = document.createElement("a"); a.href = url; a.download = "csat-invitation.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          };
          const copy = view.querySelector("#copyLink");
          if (copy) copy.onclick = async () => { const input = view.querySelector("#issuedLink"); input.select(); try { await navigator.clipboard.writeText(input.value); copy.textContent = "Copied"; } catch { error(new Error("Select the link and copy it manually.")); } };
        } catch (e) { error(e); }
      }
    } catch (e) { error(e); }
  }
  window.CsatUI = { render, deactivate() { generation++; } };
})();
