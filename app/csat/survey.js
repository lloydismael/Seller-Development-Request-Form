(async function () {
  const view = document.querySelector("#survey"), config = window.CsatConfig;
  const token = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  const answers = {}; let step = 0, busy = false, session, timer, generation = 0, mode = "individual", attemptId = crypto.randomUUID();
  const cancelAdvance = () => { clearTimeout(timer); generation++; };
  function route() {
    const branch = Object.hasOwn(config.branches, answers.division) ? config.branches[answers.division] : null;
    return [
      { id:"name", title:"FULL NAME", type:"text", section:"BASIC INFORMATION", max:200 },
      { id:"division", title:"DIVISION", type:"choice", section:"BASIC INFORMATION", choices:config.divisions },
      ...(branch ? [{ id:"director", title:branch.question, type:"choice", section:branch.title, helper:branch.subtitle, choices:branch.choices }] : []),
      ...config.ratings.map(q => ({ ...q, type:"rating", section:"POST-EVALUATION SURVEY" })),
      ...config.texts.map(q => ({ ...q, type:"textarea", section:"YOUR FEEDBACK", max:2000 }))
    ];
  }
  function valid(q) {
    const value = answers[q.id];
    if (q.type === "rating") return Number.isInteger(value) && value >= 1 && value <= 5;
    if (q.type === "choice") return q.choices.some(c => c.id === value);
    return typeof value === "string" && !!value.trim() && value.length <= q.max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  }
  fetch("/api/health", { cache:"no-store" }).then(r => r.json()).then(data => {
    if (data.dataset === "shared-production") { const warning = document.createElement("p"); warning.setAttribute("role", "alert"); warning.textContent = "LOCAL CODE / LIVE DATA — survey submissions are saved in production."; warning.style.cssText = "background:#fef3c7;color:#713f12;padding:12px;text-align:center"; document.body.prepend(warning); }
  }).catch(() => {});
  const appearance = (async () => {
    try {
      const r = await fetch("/api/form-config", { cache:"no-store", credentials:"same-origin", signal:AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const data = await r.json();
      if (data.config?.theme) window.BookingAppearance?.apply(data.config.theme);
    } catch { /* Shared default colors remain usable if appearance is unavailable. */ }
    finally { window.BookingAppearance?.reveal(); }
  })();
  async function request(path, body) {
    const response = await fetch(`/api/csat/${path}`, { method:"POST", credentials:"same-origin", mode:"same-origin", cache:"no-store", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ token, ...(mode === "shared" ? { attemptId } : {}), ...body }), signal:AbortSignal.timeout(15000) });
    const data = (response.headers.get("content-type") || "").includes("json") ? await response.json() : null;
    if (!response.ok || !data) throw new Error(data?.error || "Survey unavailable. Retry without submitting a new response.");
    return data;
  }
  const header = () => `<header class="survey-heading"><p class="eyebrow">SELLER DEVELOPMENT · CSAT</p><h1>${esc(config.title)}</h1><p class="muted">${esc(config.subtitle)}</p><p class="session-context">${esc(session?.trainingDate)} · ${esc(session?.facilitator)}</p></header>`;
  function message(text) { cancelAdvance(); view.innerHTML = header() + `<section class="panel terminal"><span class="terminal-mark" aria-hidden="true">✓</span><h2>Training feedback</h2><p role="status">${esc(text)}</p></section>`; }
  function success(text) {
    message(text);
    if (mode !== "shared") return;
    const button = document.createElement("button"); button.type = "button"; button.className = "btn primary"; button.textContent = "Submit another response";
    button.onclick = async () => {
      if (busy) return; busy = true; button.disabled = true;
      const nextId = crypto.randomUUID();
      try {
        const state = await request("resolve", { attemptId:nextId });
        if (state.state !== "open") { message("This session is no longer accepting responses."); return; }
        for (const key of Object.keys(answers)) delete answers[key];
        attemptId = nextId; step = 0; render();
      } catch (e) { message(e.message); } finally { busy = false; }
    };
    view.querySelector(".terminal").append(button);
  }
  function error(e) { const p = view.querySelector("#slideError"); if (p) { p.textContent = e.message; p.hidden = false; p.focus(); } }
  function render(direction = "forward") {
    cancelAdvance();
    const slides = route(); step = Math.max(0, Math.min(step, slides.length - 1));
    const q = slides[step], last = step === slides.length - 1;
    const completed = slides.filter(valid).length;
    let control;
    if (q.type === "rating") control = `<fieldset class="rating-group"><legend class="sr-only">${esc(q.title)}</legend><div class="rating-tiles">${[1,2,3,4,5].map(n => `<label class="rating-tile"><input type="radio" name="${q.id}" value="${n}" aria-label="${n}${n === 1 ? ' — ' + esc(config.lowLabel) : n === 5 ? ' — ' + esc(config.highLabel) : ''}" ${answers[q.id] === n ? "checked" : ""}><span class="rating-face" aria-hidden="true">${n}</span><span class="rating-label">${n === 1 ? esc(config.lowLabel) : n === 5 ? esc(config.highLabel) : 'Rating ' + n}</span><span class="selection-mark" aria-hidden="true">✓</span></label>`).join("")}</div></fieldset><p class="helper">${esc(config.instruction)}</p><p id="ratingConfirmation" class="confirmation" role="status">Select a rating to continue automatically. Use Next to confirm keyboard changes.</p>`;
    else if (q.type === "choice") control = `<fieldset class="choice-group"><legend class="sr-only">${esc(q.title)}</legend>${q.choices.map(c => `<label class="choice-tile"><input type="radio" name="${q.id}" value="${esc(c.id)}" ${answers[q.id] === c.id ? "checked" : ""}><span>${esc(c.label)}</span></label>`).join("")}</fieldset>`;
    else control = `<label class="sr-only" for="answerInput">${esc(q.title)}</label>${q.type === "textarea" ? `<textarea id="answerInput" name="${q.id}" maxlength="${q.max}" rows="5" placeholder="Share your feedback…">${esc(answers[q.id])}</textarea>` : `<input id="answerInput" name="${q.id}" maxlength="${q.max}" autocomplete="name" placeholder="Enter your full name" value="${esc(answers[q.id])}">`}<p class="helper" id="characterCount">${String(answers[q.id] || "").length} / ${q.max} characters</p>`;
    view.innerHTML = `${header()}<div class="survey-progress"><div class="progress-meta"><span>Question ${step + 1} of ${slides.length}</span><span id="answeredCount">${completed} answered</span></div><progress id="completionProgress" max="${slides.length}" value="${completed}" aria-label="Survey completion"></progress></div><section class="panel carousel-card ${direction}" aria-labelledby="questionTitle"><p class="eyebrow">${esc(q.section)}</p><h2 id="questionTitle" tabindex="-1">${esc(q.title)} <span class="required" aria-label="required">*</span></h2>${q.helper ? `<p class="helper">${esc(q.helper)}</p>` : ""}<form novalidate>${control}<p id="slideError" class="alert" role="alert" tabindex="-1" hidden></p><div class="survey-actions"><button type="button" class="btn" id="back" ${step ? "" : "disabled"}>← Back</button><span class="step-marker">${step + 1} / ${slides.length}</span><button class="btn primary" type="submit">${last ? "Submit feedback" : "Next →"}</button></div></form></section><p class="privacy-note">Your name and responses are visible to administrators and the assigned facilitator. Do not include sensitive information. Contact your training administrator about retention or deletion.</p>`;
    const form = view.querySelector("form"), id = q.id;
    function capture() {
      const value = new FormData(form).get(id);
      if (id === "division" && value !== answers.division) delete answers.director;
      answers[id] = q.type === "rating" ? value === null ? undefined : Number(value) : value ?? "";
      const count = route().filter(valid).length;
      view.querySelector("#answeredCount").textContent = `${count} answered`;
      view.querySelector("#completionProgress").value = count;
      const counter = view.querySelector("#characterCount");
      if (counter) counter.textContent = `${String(answers[id]).length} / ${q.max} characters`;
      view.querySelector("#slideError").hidden = true;
    }
    form.addEventListener("input", capture);
    form.addEventListener("change", capture);
    view.querySelector("#back").onclick = () => { if (busy || !step) return; capture(); step--; render("backward"); };
    function next() {
      cancelAdvance(); capture();
      if (!valid(q)) { error(new Error(q.type === "text" || q.type === "textarea" ? "Please enter an answer before continuing." : "Please choose an answer before continuing.")); return; }
      step++; render();
    }
    if (q.type === "rating") {
      form.addEventListener("keydown", e => {
        if (e.target.matches('input[type="radio"]')) {
          cancelAdvance();
          if (e.key === "Enter") { e.preventDefault(); next(); }
          if (e.key === " ") view.querySelector("#ratingConfirmation").textContent = "Rating selected. Press Next or Enter to continue.";
        }
      });
      form.addEventListener("click", e => {
        const input = e.target.closest('input[type="radio"]');
        if (!input || e.detail === 0 || busy) return;
        capture(); cancelAdvance(); const expected = generation;
        view.querySelector("#ratingConfirmation").textContent = `Rating ${answers[id]} selected — continuing…`;
        timer = setTimeout(() => { if (!busy && generation === expected && route()[step]?.id === id) next(); }, 650);
      });
    }
    form.onsubmit = async e => {
      e.preventDefault(); if (busy) return; cancelAdvance(); capture();
      if (!last) { next(); return; }
      const invalid = route().findIndex(slide => !valid(slide));
      if (invalid !== -1) { step = invalid; render(); error(new Error("Please complete this answer before submitting.")); return; }
      try {
        window.CsatSchema.validate(answers);
        busy = true; form.querySelectorAll("button,input,textarea").forEach(b => { b.disabled = true; });
        form.querySelector('button[type="submit"]').textContent = "Saving feedback…";
        await request("submit", { answers }); success("Thank you! Your feedback has been saved. It helps us make future learning sessions better.");
      } catch (err) {
        // Resolve a lost response before enabling a retry of the same invitation.
        try { const state = await request("resolve"); if (state.state === "answered") { success("Thank you! Your feedback has been saved."); return; } if (state.state === "closed") { message("This session is not accepting responses."); return; } } catch { /* Keep answers in memory for retry. */ }
        error(err); form.querySelectorAll("button,input,textarea").forEach(b => { b.disabled = false; });
        form.querySelector('button[type="submit"]').textContent = "Submit feedback";
      } finally { busy = false; }
    };
    view.querySelector("#questionTitle").focus({ preventScroll:true });
  }
  window.addEventListener("pagehide", cancelAdvance);
  try {
    const data = await request("resolve"); session = data.session; mode = data.mode || "individual";
    if (data.state === "answered") message("This invitation has already been answered. Thank you.");
    else if (data.state === "closed") message("This session is not accepting responses. Contact the training facilitator.");
    else render();
  } catch (e) { message(e.message); }
})();
