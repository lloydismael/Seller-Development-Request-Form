(function () {
  const CFG = window.FORM_CONFIG, Q = CFG.questions, S = window.BookingStore;
  const answers = {}, otherText = {};
  const container = document.getElementById("questions"), form = document.getElementById("bookingForm");
  const submit = document.getElementById("submitBtn"), error = document.getElementById("formError");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let submitting = false;
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
  const pad = n => String(n).padStart(2,"0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parseYmd = s => { const [y,m,d] = String(s).split("-").map(Number); return new Date(y,m-1,d); };
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || "") && ymd(parseYmd(s)) === s && s >= localToday();
  const initials = s => String(s).replace(/\(.*?\)/g,"").split(/\s+/).filter(w => /^[A-Za-zÑñ]/.test(w) && w.length > 2).map(w => w[0]).slice(0,2).join("").toUpperCase();
  const codeOf = s => (String(s).match(/\(([A-Z]{2,4})\)\s*$/) || [])[1];
  const nameOnly = s => String(s).replace(/\s*\([A-Z]{2,4}\)\s*$/,"");
  const ICON = {
    pin:'<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>',
    video:'<svg viewBox="0 0 24 24"><path d="M3 6h12a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/></svg>',
    clock:'<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2.1-.8 1.3L11 13V6h2z"/></svg>',
    check:'<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
  };
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
    const path = visiblePath(), lengths = routeLengths(), total = Math.max(...lengths);
    const done = path.filter(isAnswered).length, percent = Math.round(done / total * 100);
    const fill = document.getElementById("progressFill");
    fill.style.width = `${percent}%`;
    fill.parentElement.setAttribute("aria-valuenow",String(percent));
    document.getElementById("progressText").textContent = lengths.length === 1 ? `${done} of ${total} answered` : `${done} answered`;
    container.querySelectorAll(".q-card").forEach(card => card.classList.toggle("done",isAnswered(card.dataset.id)));
    submit.disabled = submitting;
  }

  function tileInner(id,label) {
    if (id === "facilitator" || /^sd_|^bo_|^bh_/.test(id)) {
      const code = codeOf(label);
      return `<span class="avatar" aria-hidden="true">${esc(initials(label))}</span><span class="t-body"><span class="t-label">${esc(nameOnly(label))}</span>${code ? `<span class="t-sub">${esc(code)}</span>` : ""}</span>`;
    }
    if (id === "time") {
      const [a,b] = label.split(/\s*-\s*/), range = S.slotRange(label), hrs = (range[1]-range[0])/60;
      return `<span class="t-icon" aria-hidden="true">${ICON.clock}</span><span class="t-body"><span class="t-label">${esc(a)} – ${esc(b)}</span><span class="t-sub">${hrs} hour${hrs === 1 ? "" : "s"}</span></span>`;
    }
    if (id === "venue") {
      const online = /^Online/i.test(label), parts = label.split(",").map(s => s.trim());
      return `<span class="t-icon ${online ? "online" : ""}" aria-hidden="true">${online ? ICON.video : ICON.pin}</span><span class="t-body"><span class="t-label">${esc(online ? label.replace(/^Online via\s*/i,"") : parts[0])}</span><span class="t-sub">${esc(online ? "Online" : parts.slice(1).join(", "))}</span></span>`;
    }
    const m = id === "category" && label.match(/^(.*?)\s*\((.*)\)\s*$/);
    return `<span class="t-body"><span class="t-label">${esc(m ? m[1] : label)}</span>${m ? `<span class="t-sub">${esc(m[2])}</span>` : ""}</span>`;
  }
  function gridClass(id,q) {
    if (id === "venue") return "tiles wide";
    if (id === "facilitator" || /^sd_|^bo_|^bh_/.test(id)) return "tiles people";
    if (id === "category") return "tiles md";
    return q.choices.length <= 4 ? "tiles sm" : "tiles";
  }
  function quickDates() {
    const out = []; let d = new Date();
    while (out.length < 8) {
      d = new Date(d.getFullYear(),d.getMonth(),d.getDate()+1);
      if (d.getDay() !== 0) out.push(d);
    }
    return out;
  }
  function renderQuestion(id,num) {
    const q = Q[id], card = document.createElement("section");
    card.className = "q-card"; card.dataset.id = id;
    const hint = q.type === "multi" ? (q.max ? `Select up to ${q.max}` : "Select all that apply") : "";
    let html = `<header class="q-head"><span class="q-num">${num}</span><h2 class="q-title" id="title-${id}" tabindex="-1">${esc(q.title)}${q.required ? ' <span class="req" aria-label="required">*</span>' : ""}</h2><span class="q-done" aria-hidden="true">${ICON.check}</span></header><p class="hint" id="hint-${id}">${scheduling(id) ? '<span class="avail-hint" role="status"></span>' : hint}</p>`;
    if (scheduling(id)) html += '<button type="button" class="btn retry-btn" hidden>Retry availability</button>';
    const attrs = `aria-labelledby="title-${id}" aria-describedby="hint-${id} error-${id}" ${q.required ? 'aria-required="true"' : ""}`;
    if (id === "participants") {
      html += `<div class="qty"><input type="number" min="1" step="1" inputmode="numeric" class="text-in qty-in" placeholder="e.g. 25" value="${esc(answers[id] || "")}" ${attrs}><div class="chips">${[10,20,30,50,100].map(n => `<button type="button" class="chip ${answers[id] == n ? "on" : ""}" data-qty="${n}" aria-label="${n} participants" aria-pressed="${answers[id] == n}">${n}</button>`).join("")}</div></div>`;
    } else if (q.type === "text") {
      html += id === "recommendations" ? `<textarea class="text-in" rows="3" placeholder="Type your answer" ${attrs}>${esc(answers[id] || "")}</textarea>` : `<input type="text" class="text-in" placeholder="Type your answer" autocomplete="${id === "name" ? "name" : "off"}" value="${esc(answers[id] || "")}" ${attrs}>`;
    } else if (q.type === "date") {
      const cur = answers[id];
      html += `<div class="date-tiles" role="group" aria-labelledby="title-${id}" aria-describedby="error-${id}">${quickDates().map(d => {
        const ds = ymd(d);
        return `<button type="button" class="date-tile ${cur === ds ? "on" : ""}" data-date="${ds}" aria-label="${esc(d.toLocaleDateString("en-PH",{ weekday:"long",month:"long",day:"numeric",year:"numeric" }))}" aria-pressed="${cur === ds}"><span class="dow">${d.toLocaleDateString("en-PH",{ weekday:"short" })}</span><span class="dd">${d.getDate()}</span><span class="mm">${d.toLocaleDateString("en-PH",{ month:"short" })}</span></button>`;
      }).join("")}</div><label class="date-other">Or pick another date<input type="date" class="text-in date-in" min="${localToday()}" value="${esc(cur || "")}" ${attrs}></label>${cur && validDate(cur) ? `<p class="picked">Selected: <b>${esc(parseYmd(cur).toLocaleDateString("en-PH",{ weekday:"long",month:"long",day:"numeric",year:"numeric" }))}</b></p>` : ""}`;
    } else {
      const multi = q.type === "multi", cur = answers[id];
      html += `<div class="${gridClass(id,q)}" role="${multi ? "group" : "radiogroup"}" ${attrs}>`;
      q.choices.map(choiceObj).forEach(c => {
        const checked = multi ? (cur || []).includes(c.label) : cur === c.label;
        html += `<label class="tile ${checked ? "on" : ""}"><input type="${multi ? "checkbox" : "radio"}" name="${id}" value="${esc(c.label)}" aria-label="${esc(c.label)}" ${checked ? "checked" : ""} aria-describedby="hint-${id} error-${id}">${tileInner(id,c.label)}<span class="tag" hidden></span><span class="tick" aria-hidden="true">${ICON.check}</span></label>`;
      });
      if (q.allowOther) html += `<div class="tile other ${cur === "__other__" ? "on" : ""}"><input type="radio" id="other-radio-${id}" name="${id}" value="__other__" aria-labelledby="other-label-${id}" aria-describedby="error-${id}" ${cur === "__other__" ? "checked" : ""}><span class="t-body"><label class="t-label" id="other-label-${id}" for="other-radio-${id}">Other venue</label><input type="text" class="other-in" placeholder="Type the venue" aria-label="Other venue" aria-describedby="error-${id}" value="${esc(otherText[id] || "")}"></span><span class="tick" aria-hidden="true">${ICON.check}</span></div>`;
      html += "</div>";
      if (multi && q.max) html += `<p class="counter">${(cur || []).length} of ${q.max} selected</p>`;
    }
    html += `<p class="err" id="error-${id}" role="alert" hidden>This question is required.</p>`;
    card.innerHTML = html; return card;
  }

  function render() {
    cancelAuto();
    container.replaceChildren(...visiblePath().map((id,i) => renderQuestion(id,i+1)));
    syncOptions(); updateProgress();
  }

  function goNext(fromId) {
    cancelAuto();
    autoTimer = setTimeout(() => {
      if (submitting || form.hidden || invalidReason(fromId)) return;
      const path = visiblePath(), i = path.indexOf(fromId);
      if (i < 0) return;
      const nextId = path.slice(i+1).find(id => !isAnswered(id));
      const target = nextId ? container.querySelector(`[data-id="${nextId}"]`) : form.querySelector(".submit-bar");
      if (!target) return;
      target.scrollIntoView({ behavior:reducedMotion.matches ? "auto" : "smooth",block:"center" });
      if (!reducedMotion.matches && nextId) {
        target.classList.add("pulse"); setTimeout(() => target.classList.remove("pulse"),900);
      }
      (target.querySelector(".text-in:not(.date-in),.q-title,button") || target).focus({ preventScroll:true });
    },120);
  }

  function invalidReason(id) {
    if (Q[id].required && !isAnswered(id)) return "Please answer this question to continue.";
    if (id === "date" && !validDate(answers.date)) return "Choose today or a future training date.";
    if (scheduling(id) && !availabilityReady()) return availabilityState === "error" ? "Availability couldn’t be checked. Please retry or choose another date." : "Please wait while we check availability.";
    if (id === "facilitator" && (avail?.blocked || []).includes(answers.facilitator)) return "Choose an available facilitator.";
    if (id === "time" && !isAnswered("facilitator")) return "Choose a facilitator first.";
    if (id === "time" && (avail?.busy || []).some(b => b.facilitator === answers.facilitator && S.overlaps(b.time,answers.time))) return "Choose an available time.";
    if (id === "participants" && (!Number.isSafeInteger(Number(answers[id])) || Number(answers[id]) < 1)) return "Enter a positive whole number of participants.";
    return "";
  }
  function showError(card,message) {
    const inline = card.querySelector(".err"); inline.textContent = message; inline.hidden = false; card.classList.add("invalid");
    card.querySelectorAll("input,textarea").forEach(el => el.setAttribute("aria-invalid","true"));
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
    cancelAuto(); avail = null; availabilityState = validDate(d) ? "loading" : "idle"; syncOptions(); updateProgress();
    if (!validDate(d)) return;
    try {
      const data = await S.availability(d);
      if (version !== requestVersion || answers.date !== d) return;
      if (!data || data.date !== d || !Array.isArray(data.blocked) || !Array.isArray(data.busy)) throw new Error("Invalid availability response");
      avail = { ...data,date:d }; availabilityState = "ready"; reconcileAvailability();
    } catch {
      if (version !== requestVersion || answers.date !== d) return;
      availabilityState = "error";
    }
    syncOptions(); updateProgress();
  }
  function syncOptions() {
    reconcileAvailability();
    container.querySelectorAll("[data-id]").forEach(card => {
    const id = card.dataset.id, q = Q[id], ready = availabilityReady();
    if (scheduling(id)) {
      card.querySelector(".avail-hint").textContent = availabilityState === "loading" ? "Checking availability…" : availabilityState === "error" ? "We couldn’t check availability. Retry, or choose another date."
        : ready ? `Availability for ${parseYmd(avail.date).toLocaleDateString("en-PH",{ month:"short",day:"numeric" })}. ${id === "facilitator" ? "Unavailable facilitators are disabled." : !isAnswered("facilitator") ? "Choose a facilitator first." : "Booked and overlapping slots are disabled."}` : "Choose a training date first.";
      card.querySelector(".retry-btn").hidden = availabilityState !== "error";
      card.setAttribute("aria-busy",String(availabilityState === "loading"));
    }
    const atMax = q.type === "multi" && q.max && (answers[id] || []).length >= q.max;
    card.querySelectorAll(".tile").forEach(opt => {
      const inp = opt.querySelector("input"), multi = q.type === "multi";
      inp.checked = multi ? (answers[id] || []).includes(inp.value) : answers[id] === inp.value;
      let tag = "", disabled = !!(atMax && !inp.checked);
      if (disabled) tag = "Limit reached";
      if (scheduling(id)) {
        const unavailable = id === "facilitator" ? (avail?.blocked || []).includes(inp.value)
          : (avail?.busy || []).some(b => b.facilitator === answers.facilitator && S.overlaps(b.time,inp.value));
        disabled = !ready || unavailable || (id === "time" && !isAnswered("facilitator"));
        if (unavailable && ready) tag = id === "facilitator" ? "Unavailable" : "Booked";
      }
      inp.disabled = disabled || submitting; opt.classList.toggle("disabled",disabled); opt.classList.toggle("on",inp.checked); opt.classList.toggle("maxed",!!atMax && !inp.checked);
      const badge = opt.querySelector(".tag"); if (badge) { badge.hidden = !tag; badge.textContent = tag; }
    });
    const counter = card.querySelector(".counter"); if (counter) counter.textContent = `${(answers[id] || []).length} of ${q.max} selected`;
    card.querySelectorAll(".chip").forEach(chip => {
      const selected = chip.dataset.qty === answers[id]; chip.classList.toggle("on",selected); chip.setAttribute("aria-pressed",String(selected));
    });
    });
    updateProgress();
  }
  function clearError(card) {
    card.querySelector(".err").hidden = true; card.classList.remove("invalid"); error.hidden = true;
    card.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  }

  container.addEventListener("input",e => {
    const card = e.target.closest("[data-id]"); if (!card || submitting) return;
    const id = card.dataset.id, q = Q[id]; cancelAuto();
    if (e.target.classList.contains("other-in")) {
      otherText[id] = e.target.value; answers[id] = "__other__"; syncOptions();
    } else if (q.type === "date") {
      // Invalidate immediately, even before the date input's change event.
      if (answers[id] !== e.target.value) {
        answers[id] = e.target.value; cancelAuto(); ++requestVersion;
        avail = null; availabilityState = "idle"; syncOptions();
      }
      return;
    } else if (q.type === "text") {
      answers[id] = e.target.value; syncOptions();
    }
    clearError(card); updateProgress();
  });
  container.addEventListener("change",e => {
    const card = e.target.closest("[data-id]"); if (!card || submitting || e.target.disabled) return;
    const id = card.dataset.id, q = Q[id]; cancelAuto();
    if (e.target.classList.contains("date-in")) { setDate(e.target.value); return; }
    if (e.target.type === "checkbox") {
      const checked = [...card.querySelectorAll('input[type="checkbox"]:checked')];
      if (q.max && checked.length > q.max) { e.target.checked = false; return; }
      answers[id] = checked.map(b => b.value);
    } else if (e.target.type === "radio") {
      if (scheduling(id) && (!availabilityReady() || (id === "time" && !isAnswered("facilitator")))) { syncOptions(); return; }
      const before = answers[id];
      answers[id] = e.target.value;
      if (id === "facilitator") reconcileAvailability();
      if ((q.choices || []).map(choiceObj).some(c => c.goto) && before !== answers[id]) {
        clearError(card); render(); goNext(id); return;
      }
    } else return;
    syncOptions(); clearError(card); updateProgress();
    if (e.target.value === "__other__") { card.querySelector(".other-in").focus(); return; }
    if (e.target.type === "radio" || (q.choices.length === 1 && isAnswered(id))) goNext(id);
  });
  function setDate(ds) {
    if (submitting) return;
    answers.date = ds; cancelAuto();
    const card = container.querySelector('[data-id="date"]');
    if (card) card.replaceWith(renderQuestion("date",visiblePath().indexOf("date")+1));
    loadAvailability(); updateProgress();
    if (validDate(ds)) { error.hidden = true; goNext("date"); }
  }
  container.addEventListener("click",e => {
    if (submitting) return;
    const card = e.target.closest("[data-id]"); if (!card) return;
    if (e.target.closest(".retry-btn")) { loadAvailability(); return; }
    const date = e.target.closest(".date-tile"); if (date) { setDate(date.dataset.date); return; }
    const chip = e.target.closest(".chip");
    if (chip) {
      answers[card.dataset.id] = chip.dataset.qty; card.querySelector(".qty-in").value = chip.dataset.qty;
      clearError(card); syncOptions(); goNext(card.dataset.id);
    }
    const other = e.target.closest(".tile.other");
    if (other && !e.target.matches("input,label")) {
      other.querySelector('input[type="radio"]').click();
    }
  });
  form.addEventListener("keydown",e => {
    if (e.isComposing || e.key !== "Enter" || ["TEXTAREA","BUTTON","A"].includes(e.target.tagName)) return;
    e.preventDefault(); if (submitting) return;
    const card = e.target.closest("[data-id]");
    if (card && isAnswered(card.dataset.id)) goNext(card.dataset.id);
  });
  form.addEventListener("submit",async e => {
    e.preventDefault(); cancelAuto(); if (submitting) return;
    syncOptions(); error.hidden = true;
    const path = visiblePath(); let firstBad;
    path.forEach(id => {
      const card = container.querySelector(`[data-id="${id}"]`), reason = invalidReason(id);
      if (reason) { showError(card,reason); if (!firstBad) firstBad = card; }
      else clearError(card);
    });
    if (firstBad) {
      firstBad.scrollIntoView({ behavior:reducedMotion.matches ? "auto" : "smooth",block:"center" });
      (firstBad.querySelector('input:checked:not(:disabled),textarea,input:not(:disabled)') || firstBad.querySelector(".q-title")).focus({ preventScroll:true });
      return;
    }
    const rec = { answers:{} };
    path.forEach(id => { const v = valueOf(id); rec.answers[Q[id].title] = v; if (Q[id].field) rec[Q[id].field] = v; });
    submitting = true; container.inert = true; form.setAttribute("aria-busy","true");
    container.querySelectorAll("input,textarea,button").forEach(el => el.disabled = true);
    error.hidden = true; updateProgress(); submit.textContent = "Submitting…";
    try {
      await S.create(rec);
      form.hidden = true; document.getElementById("progressWrap").hidden = true; document.getElementById("thanks").hidden = false;
      document.getElementById("summary").innerHTML = Object.entries(rec.answers).map(([k,v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
      window.scrollTo({ top:0,behavior:reducedMotion.matches ? "auto" : "smooth" });
      document.querySelector("#thanks h2").focus({ preventScroll:true });
    } catch (err) {
      if (err.status === 409) {
        delete answers.time; await loadAvailability();
        error.textContent = `That slot is no longer available. ${err.message} Please choose another date, facilitator, or time.`;
      } else error.textContent = `Submission failed: ${err.message}. Your answers are still here. Please try again.`;
      error.hidden = false; error.focus();
    } finally {
      submitting = false; container.inert = false; form.removeAttribute("aria-busy");
      container.querySelectorAll("input,textarea,button").forEach(el => el.disabled = false);
      syncOptions(); submit.textContent = "Submit request"; updateProgress();
    }
  });
  document.getElementById("againBtn").addEventListener("click",() => {
    if (submitting) return;
    cancelAuto(); ++requestVersion;
    Object.keys(answers).forEach(k => delete answers[k]); Object.keys(otherText).forEach(k => delete otherText[k]);
    avail = null; availabilityState = "idle"; error.hidden = true;
    document.getElementById("thanks").hidden = true; document.getElementById("progressWrap").hidden = false;
    form.hidden = false; render(); window.scrollTo({ top:0,behavior:reducedMotion.matches ? "auto" : "smooth" });
    container.querySelector(".text-in").focus({ preventScroll:true });
  });
  document.getElementById("formTitle").textContent = CFG.title; document.title = CFG.title;
  if (["localhost","127.0.0.1","[::1]"].includes(location.hostname) && new URLSearchParams(location.search).get("storage") === "local")
    document.querySelector(".admin-btn").href = "/admin/?storage=local";
  render();
})();