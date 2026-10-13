(function () {
  const CFG = window.FORM_CONFIG, Q = CFG.questions, S = window.BookingStore;
  const answers = {}, otherText = {};
  const container = document.getElementById("questions"), form = document.getElementById("bookingForm");
  const back = document.getElementById("backBtn"), next = document.getElementById("nextBtn");
  const submit = document.getElementById("submitBtn"), error = document.getElementById("formError");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let current = CFG.start, reviewing = false, moving = false, submitting = false;
  let autoTimer, avail = null, availabilityState = "idle", requestVersion = 0;
  const choiceObj = c => typeof c === "string" ? { label:c } : c;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
  const isAnswered = id => {
    const v = answers[id];
    if (Array.isArray(v)) return v.length > 0;
    if (v === "__other__") return !!(otherText[id] || "").trim();
    return v !== undefined && String(v).trim() !== "";
  };
  const valueOf = id => {
    const v = answers[id] === "__other__" ? (otherText[id] || "").trim() : answers[id];
    return Array.isArray(v) ? v.join("; ") : (v ?? "");
  };
  const cancelAuto = () => { clearTimeout(autoTimer); autoTimer = undefined; };
  const scheduling = id => id === "facilitator" || id === "time";
  const availabilityReady = () => availabilityState === "ready" && avail?.date === answers.date;
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };

  function visiblePath() {
    const path = [], seen = new Set();
    let id = CFG.start;
    while (id && Q[id] && !seen.has(id)) {
      seen.add(id); path.push(id);
      const q = Q[id], opts = (q.choices || []).map(choiceObj);
      if (opts.some(c => c.goto)) {
        if (!isAnswered(id)) break;
        id = opts.find(c => c.label === answers[id])?.goto || q.next;
      } else id = q.next;
    }
    return path;
  }

  // Estimate remaining branches from configuration, not a hardcoded question count.
  function routeLengths(id = CFG.start, seen = new Set()) {
    if (!id || !Q[id] || seen.has(id)) return [0];
    const visited = new Set(seen).add(id), q = Q[id], opts = (q.choices || []).map(choiceObj);
    const selected = opts.find(c => c.label === answers[id]);
    const destinations = opts.some(c => c.goto)
      ? (selected ? [selected.goto || q.next] : opts.map(c => c.goto || q.next)) : [q.next];
    return [...new Set(destinations.flatMap(dest => routeLengths(dest,visited).map(n => n+1)))];
  }

  function updateProgress() {
    const path = visiblePath(), lengths = routeLengths(), total = Math.max(...lengths), index = path.indexOf(current);
    const percent = Math.round(path.filter(isAnswered).length / total * 100);
    document.getElementById("stepLabel").textContent = reviewing ? "Review your request" : `Question ${index+1}${lengths.length === 1 ? ` of ${total}` : ""}`;
    document.getElementById("progressLabel").textContent = `${percent}% complete`;
    document.getElementById("formProgress").value = percent;
    back.disabled = moving || submitting || (!reviewing && index === 0);
    next.hidden = reviewing; submit.hidden = !reviewing;
    next.disabled = moving || submitting || (scheduling(current) && !availabilityReady());
    submit.disabled = moving || submitting;
    const last = index === path.length-1 && !Q[current].next && !(Q[current].choices || []).some(c => choiceObj(c).goto);
    next.innerHTML = `${last ? "Review request" : "Continue"} <span aria-hidden="true">→</span>`;
  }

  function renderQuestion(id,num) {
    const q = Q[id], card = document.createElement("section");
    card.className = "q-card"; card.dataset.id = id;
    const choice = q.type === "choice" || q.type === "multi";
    const hint = q.type === "multi" ? (q.max ? `Select up to ${q.max} options, then continue.` : "Select all that apply, then continue.")
      : choice ? "Choose an option to move to the next card. You can always go back."
      : id === "name" ? "Let’s start with you. Who is making this request?"
      : id === "recommendations" ? "Tell us what would make this training useful for your team."
      : q.type === "date" ? "Choose your preferred date. We’ll check the available facilitators."
      : "Enter your answer, then continue when you’re ready.";
    let html = `<div class="question-meta"><span class="question-number">QUESTION ${String(num).padStart(2,"0")}</span>${q.required ? '<span class="required-badge">Required</span>' : ""}</div>`;
    if (choice) html += '<fieldset class="question-group">';
    html += `<${choice ? "legend" : "h2"} class="q-title" id="title-${id}" tabindex="-1">${esc(q.title)}</${choice ? "legend" : "h2"}><p class="hint" id="hint-${id}">${hint}</p>`;
    if (scheduling(id)) html += '<p class="avail-hint" role="status"></p><button type="button" class="btn retry-btn" hidden>Retry availability</button>';
    const attrs = `aria-labelledby="title-${id}" aria-describedby="hint-${id} error-${id}" ${q.required ? 'aria-required="true"' : ""}`;
    if (q.type === "text") {
      if (id === "recommendations") html += `<textarea class="text-in" rows="4" placeholder="Share your goals, requests, or recommendations…" ${attrs}>${esc(answers[id] || "")}</textarea>`;
      else html += `<input type="text" class="text-in" ${id === "name" ? 'autocomplete="name" placeholder="Your full name"' : 'inputmode="numeric" placeholder="e.g. 25"'} value="${esc(answers[id] || "")}" ${attrs}>`;
    } else if (q.type === "date") {
      html += `<input type="date" class="text-in date-in" min="${localToday()}" value="${esc(answers[id] || "")}" ${attrs}>`;
    } else {
      const multi = q.type === "multi", cur = answers[id];
      const compact = q.choices.length > 4 && q.choices.every(c => choiceObj(c).label.length < 40);
      html += `<div class="options${compact ? " compact" : ""}">`;
      q.choices.map(choiceObj).forEach(c => {
        const checked = multi ? (cur || []).includes(c.label) : cur === c.label;
        html += `<label class="opt${checked ? " selected" : ""}"><input type="${multi ? "checkbox" : "radio"}" name="${id}" value="${esc(c.label)}" ${checked ? "checked" : ""} aria-describedby="hint-${id} error-${id}"><span class="option-label">${esc(c.label)}</span><span class="tag" hidden></span><span class="choice-mark" aria-hidden="true">✓</span></label>`;
      });
      if (q.allowOther) html += `<label class="opt other${cur === "__other__" ? " selected" : ""}"><input type="radio" name="${id}" value="__other__" ${cur === "__other__" ? "checked" : ""}><span class="option-label">Other venue</span><span class="choice-mark" aria-hidden="true">✓</span><input type="text" class="other-in" placeholder="Enter your preferred venue" aria-label="Other venue" aria-describedby="error-${id}" value="${esc(otherText[id] || "")}" ${cur === "__other__" ? "" : "hidden"}></label>`;
      html += "</div>";
    }
    html += `<div class="err" id="error-${id}" role="alert" hidden>Please answer this question to continue.</div>`;
    if (choice) html += "</fieldset>";
    card.innerHTML = html; return card;
  }

  function renderReview() {
    const card = document.createElement("section"); card.className = "q-card";
    card.innerHTML = '<div class="question-meta"><span class="question-number">ONE LAST LOOK</span><span class="required-badge">Ready to send</span></div><h2 class="q-title" tabindex="-1">Looking good. Let’s review.</h2><p class="hint">Check the details below. Your request will be sent for approval.</p><dl class="review-list">' + visiblePath().map(id => `<div class="review-row"><div class="review-answer"><dt>${esc(Q[id].title)}</dt><dd>${esc(valueOf(id))}</dd></div><button type="button" class="edit-btn" data-edit="${id}" aria-label="Edit ${esc(Q[id].title)}">Edit</button></div>`).join("") + "</dl>";
    return card;
  }

  function render(focus = false) {
    cancelAuto(); const path = visiblePath();
    if (!path.includes(current)) current = path[path.length-1];
    container.replaceChildren(reviewing ? renderReview() : renderQuestion(current,path.indexOf(current)+1));
    error.hidden = true; syncOptions(); updateProgress();
    document.getElementById("stepAnnouncement").textContent = reviewing ? "Review your request before submitting." : `Question ${path.indexOf(current)+1}. ${Q[current].title}`;
    if (focus && container.getBoundingClientRect().top < 0) document.querySelector(".progress-meta").scrollIntoView({ behavior:reducedMotion.matches ? "auto" : "smooth", block:"start" });
    if (focus && !container.inert) container.querySelector(".q-title").focus({ preventScroll:true });
  }

  async function navigate(id,review = false,direction = 1) {
    cancelAuto(); if (moving || submitting) return;
    moving = true; updateProgress(); container.inert = true;
    try {
      if (!reducedMotion.matches && container.animate) await container.animate([
        { opacity:1,transform:"translateX(0)" }, { opacity:0,transform:`translateX(${-direction*24}px)` }
      ], { duration:120,easing:"ease-in" }).finished;
      current = id; reviewing = review; render(true);
      if (!reducedMotion.matches && container.animate) await container.animate([
        { opacity:0,transform:`translateX(${direction*32}px)` }, { opacity:1,transform:"translateX(0)" }
      ], { duration:250,easing:"cubic-bezier(.22,1,.36,1)" }).finished;
    } finally {
      container.inert = false; moving = false; updateProgress();
      container.querySelector(".q-title").focus({ preventScroll:true });
    }
  }

  function invalidReason(id) {
    if (Q[id].required && !isAnswered(id)) return "Please answer this question to continue.";
    if (id === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(answers.date || "") || answers.date < localToday())) return "Choose today or a future training date.";
    if (scheduling(id) && !availabilityReady()) return availabilityState === "error" ? "Availability couldn’t be checked. Please retry or choose another date." : "Please wait while we check availability.";
    return "";
  }
  function showError(message) {
    const card = container.querySelector("[data-id]");
    if (!card) { error.textContent = message; error.hidden = false; return; }
    const inline = card.querySelector(".err"); inline.textContent = message; inline.hidden = false; card.classList.add("invalid");
    card.querySelectorAll("input,textarea").forEach(el => el.setAttribute("aria-invalid","true"));
    (card.querySelector('input:checked:not(:disabled),textarea,input:not(:disabled)') || card.querySelector(".q-title")).focus();
  }
  async function advance() {
    cancelAuto(); if (moving || submitting || reviewing) return;
    const reason = invalidReason(current); if (reason) { showError(reason); return; }
    const path = visiblePath(), index = path.indexOf(current);
    if (index < path.length-1) { await navigate(path[index+1]); return; }
    const bad = path.find(id => invalidReason(id));
    if (bad) { await navigate(bad); showError(invalidReason(bad)); return; }
    await navigate(current,true);
  }

  // Answer invalidation must work even when scheduling cards are off-screen.
  function reconcileAvailability() {
    if (!availabilityReady()) return;
    let invalidated = false;
    if ((avail.blocked || []).includes(answers.facilitator)) {
      delete answers.facilitator; delete answers.time; invalidated = true;
    }
    if (answers.time && (avail.busy || []).some(b => b.facilitator === answers.facilitator && S.overlaps(b.time,answers.time))) {
      delete answers.time; invalidated = true;
    }
    if (invalidated) cancelAuto();
  }
  async function loadAvailability() {
    const d = answers.date, version = ++requestVersion;
    cancelAuto(); avail = null; availabilityState = d ? "loading" : "idle"; syncOptions(); updateProgress();
    if (!d) return;
    try {
      const data = await S.availability(d);
      if (version !== requestVersion || answers.date !== d) return;
      avail = { ...data,date:d }; availabilityState = "ready"; reconcileAvailability();
    } catch {
      if (version !== requestVersion || answers.date !== d) return;
      availabilityState = "error";
    }
    syncOptions(); updateProgress();
  }
  function syncOptions() {
    const card = container.querySelector("[data-id]"); if (!card) return;
    const id = card.dataset.id, q = Q[id], ready = availabilityReady();
    if (scheduling(id)) {
      card.querySelector(".avail-hint").textContent = availabilityState === "loading" ? "Checking availability…" : availabilityState === "error" ? "We couldn’t check availability. Retry, or go back to choose another date."
        : ready ? `Availability for ${avail.date}. ${id === "facilitator" ? "Unavailable facilitators are disabled." : "Booked and overlapping slots are disabled."}` : "Choose a training date first.";
      card.querySelector(".retry-btn").hidden = availabilityState !== "error";
    }
    const atMax = q.type === "multi" && q.max && (answers[id] || []).length >= q.max;
    card.querySelectorAll(".opt").forEach(opt => {
      const inp = opt.querySelector("input"), multi = q.type === "multi";
      inp.checked = multi ? (answers[id] || []).includes(inp.value) : answers[id] === inp.value;
      let tag = "", disabled = !!(atMax && !inp.checked);
      if (disabled) tag = "Limit reached";
      if (scheduling(id)) {
        const unavailable = id === "facilitator" ? (avail?.blocked || []).includes(inp.value)
          : (avail?.busy || []).some(b => b.facilitator === answers.facilitator && S.overlaps(b.time,inp.value));
        disabled = !ready || unavailable;
        if (unavailable && ready) tag = id === "facilitator" ? "Unavailable" : "Booked";
      }
      inp.disabled = disabled; opt.classList.toggle("disabled",disabled); opt.classList.toggle("selected",inp.checked);
      const badge = opt.querySelector(".tag"); if (badge) { badge.hidden = !tag; badge.textContent = tag; }
      const other = opt.querySelector(".other-in"); if (other) other.hidden = !inp.checked;
    });
  }
  function clearError(card) {
    card.querySelector(".err").hidden = true; card.classList.remove("invalid"); error.hidden = true;
    card.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  }

  container.addEventListener("input",e => {
    const card = e.target.closest("[data-id]"); if (!card || moving || submitting) return;
    const id = card.dataset.id, q = Q[id]; cancelAuto();
    if (e.target.classList.contains("other-in")) {
      otherText[id] = e.target.value; answers[id] = "__other__"; syncOptions();
    } else if (q.type === "text" || q.type === "date") {
      const before = answers[id]; answers[id] = e.target.value;
      if (id === "date" && before !== answers[id]) loadAvailability();
    }
    clearError(card); updateProgress();
  });
  container.addEventListener("change",e => {
    const card = e.target.closest("[data-id]"); if (!card || moving || submitting) return;
    const id = card.dataset.id, q = Q[id]; cancelAuto();
    if (e.target.type === "checkbox") {
      const checked = [...card.querySelectorAll('input[type="checkbox"]:checked')];
      if (q.max && checked.length > q.max) { e.target.checked = false; return; }
      answers[id] = checked.map(b => b.value);
    } else if (e.target.type === "radio") {
      answers[id] = e.target.value;
      if (id === "facilitator") reconcileAvailability();
    } else return;
    syncOptions(); clearError(card); updateProgress();
    if (e.target.value === "__other__") { card.querySelector(".other-in").focus(); return; }
    if (e.target.type === "radio") {
      const selected = answers[id];
      autoTimer = setTimeout(() => {
        if (current === id && answers[id] === selected && !invalidReason(id)) advance();
      },550);
    }
  });
  container.addEventListener("click",e => {
    const edit = e.target.closest("[data-edit]"); if (edit) navigate(edit.dataset.edit,false,-1);
    if (e.target.closest(".retry-btn")) loadAvailability();
  });
  form.addEventListener("keydown",e => {
    if (e.isComposing || e.key !== "Enter" || ["TEXTAREA","BUTTON","A"].includes(e.target.tagName)) return;
    if (!reviewing) { e.preventDefault(); advance(); }
  });
  next.addEventListener("click",advance);
  back.addEventListener("click",() => {
    cancelAuto(); const path = visiblePath(), index = path.indexOf(current);
    if (reviewing) navigate(path[path.length-1],false,-1);
    else if (index > 0) navigate(path[index-1],false,-1);
  });
  form.addEventListener("submit",async e => {
    e.preventDefault(); cancelAuto(); if (!reviewing || moving || submitting) return;
    reconcileAvailability();
    const path = visiblePath(), bad = path.find(id => invalidReason(id));
    if (bad) { await navigate(bad); showError(invalidReason(bad)); return; }
    const rec = { answers:{} };
    path.forEach(id => { const v = valueOf(id); rec.answers[Q[id].title] = v; if (Q[id].field) rec[Q[id].field] = v; });
    submitting = true; container.inert = true; error.hidden = true; updateProgress(); submit.textContent = "Submitting…";
    try {
      await S.create(rec);
      form.hidden = true; document.getElementById("thanks").hidden = false;
      document.getElementById("summary").innerHTML = Object.entries(rec.answers).map(([k,v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
      document.querySelector("#thanks h2").focus();
    } catch (err) {
      submitting = false; container.inert = false;
      if (err.status === 409) {
        await loadAvailability(); const target = !isAnswered("facilitator") ? "facilitator" : "time"; delete answers.time;
        await navigate(target,false,-1); showError(`That slot is no longer available. ${err.message} Please choose another date, facilitator, or time.`);
      } else { error.textContent = `Submission failed: ${err.message}. Your answers are still here. Please try again.`; error.hidden = false; }
    } finally {
      submitting = false; container.inert = false; submit.innerHTML = 'Submit request <span aria-hidden="true">→</span>'; updateProgress();
    }
  });
  document.getElementById("againBtn").addEventListener("click",() => {
    cancelAuto(); ++requestVersion;
    Object.keys(answers).forEach(k => delete answers[k]); Object.keys(otherText).forEach(k => delete otherText[k]);
    avail = null; availabilityState = "idle"; current = CFG.start; reviewing = false;
    document.getElementById("thanks").hidden = true; form.hidden = false; render(true);
  });
  document.getElementById("formTitle").textContent = CFG.title; document.title = CFG.title;
  render();
})();