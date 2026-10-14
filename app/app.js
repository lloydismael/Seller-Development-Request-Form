(async function () {
  const S = window.BookingStore, schema = window.FormSchema;
  const preview = new URLSearchParams(location.search).get("preview") === "draft";
  let CFG, Q, formVersion, loaded = false, stale = false, loading = false;
  const answers = {}, otherText = {};
  const container = document.getElementById("questions"), form = document.getElementById("bookingForm");
  const submit = document.getElementById("submitBtn"), error = document.getElementById("formError");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let submitting = false, activeQuestionId, requestorComplete = false;
  let autoTimer, avail = null, availabilityState = "idle", requestVersion = 0, confirmationVersion = 0;
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
    return Array.isArray(v) ? v.slice() : (v ?? "");
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
      if (q.field === "requestor" && q.required && (!requestorComplete || invalidReason(id))) break;
      if (opts.some(c => c.goto)) {
        if (!isAnswered(id) && q.required) break;
        id = opts.find(c => c.label === valueOf(id))?.goto || q.next;
      } else id = q.next;
    }
    return path;
  }

  // Estimate remaining branches from configuration, not a hardcoded question count.
  function routeLengths(id = CFG.start, seen = new Set()) {
    if (!id || !Q[id] || seen.has(id)) return [0];
    const visited = new Set(seen).add(id), q = Q[id], opts = (q.choices || []).map(choiceObj);
    const selected = opts.find(c => c.label === valueOf(id));
    const destinations = opts.some(c => c.goto)
      ? (selected ? [selected.goto || q.next] : [...opts.map(c => c.goto || q.next), ...(!q.required || q.allowOther ? [q.next] : [])]) : [q.next];
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
    const complete = path.every(id => !invalidReason(id) && !(Q[id].field === "requestor" && Q[id].required && !requestorComplete));
    submit.hidden = !loaded || stale || !complete;
    submit.disabled = submitting || !loaded || preview || stale || !complete;
  }

  function tileInner(id,label) {
    if (Q[id].field === "facilitator" || Q[id].field === "director") {
      const code = codeOf(label);
      return `<span class="avatar" aria-hidden="true">${esc(initials(label))}</span><span class="t-body"><span class="t-label">${esc(nameOnly(label))}</span>${code ? `<span class="t-sub">${esc(code)}</span>` : ""}</span>`;
    }
    if (id === "time") {
      const [a,b] = label.split(/\s*-\s*/), range = S.slotRange(label), hrs = (range[1]-range[0])/60;
      return `<span class="t-icon" aria-hidden="true">${ICON.clock}</span><span class="t-body"><span class="t-label">${esc(a)} – ${esc(b)}</span><span class="t-sub">${hrs} hour${hrs === 1 ? "" : "s"}</span></span>`;
    }
    if (Q[id].field === "venue") {
      const online = /^Online/i.test(label), parts = label.split(",").map(s => s.trim());
      return `<span class="t-icon ${online ? "online" : ""}" aria-hidden="true">${online ? ICON.video : ICON.pin}</span><span class="t-body"><span class="t-label">${esc(online ? label.replace(/^Online via\s*/i,"") : parts[0])}</span><span class="t-sub">${esc(online ? "Online" : parts.slice(1).join(", "))}</span></span>`;
    }
    const m = Q[id].field === "category" && label.match(/^(.*?)\s*\((.*)\)\s*$/);
    return `<span class="t-body"><span class="t-label">${esc(m ? m[1] : label)}</span>${m ? `<span class="t-sub">${esc(m[2])}</span>` : ""}</span>`;
  }
  function gridClass(id,q) {
    if (q.field === "venue") return "tiles wide";
    if (q.field === "facilitator" || q.field === "director") return "tiles people";
    if (q.field === "category") return "tiles md";
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
    const hint = q.type === "multi" ? [q.min ? `Select at least ${q.min}` : "", q.max ? `Select up to ${q.max}` : "Select all that apply"].filter(Boolean).join(". ") : "";
    let html = `<header class="q-head"><span class="q-num">${num}</span><h2 class="q-title" id="title-${id}" tabindex="-1">${esc(q.title)}${q.required ? ' <span class="req" aria-label="required">*</span>' : ""}</h2><span class="q-done" aria-hidden="true">${ICON.check}</span></header><p class="hint" id="hint-${id}">${scheduling(id) ? '<span class="avail-hint" role="status"></span>' : esc(hint)}</p><p class="hint" id="help-${id}">${esc(q.help || "")}</p>`;
    if (scheduling(id)) html += '<button type="button" class="btn retry-btn" hidden>Retry availability</button>';
    const attrs = `aria-labelledby="title-${id}" aria-describedby="hint-${id} help-${id} error-${id}" ${q.required ? 'aria-required="true"' : ""}`;
    const placeholder = esc(q.placeholder ?? "Type your answer");
    if (["text", "textarea", "email", "number"].includes(q.type)) {
      const bounds = q.type === "number" ? `min="${q.min ?? (q.field === "participants" ? 1 : -1000000)}" max="${q.max ?? 1000000}" step="${q.field === "participants" ? "1" : "any"}"` : 'maxlength="200"';
      html += q.type === "textarea" ? `<textarea class="text-in" rows="3" maxlength="2000" placeholder="${placeholder}" ${attrs}>${esc(answers[id] ?? "")}</textarea>` : `<input type="${q.type}" class="text-in" ${bounds} placeholder="${placeholder}" autocomplete="${q.type === "email" ? "email" : q.field === "requestor" ? "name" : "off"}" value="${esc(answers[id] ?? "")}" ${attrs}>`;
    } else if (q.type === "date" && id !== "date") {
      html += `<input type="date" class="text-in" value="${esc(answers[id] || "")}" ${attrs}>`;
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
      if (q.allowOther) html += `<div class="tile other ${cur === "__other__" ? "on" : ""}"><input type="radio" id="other-radio-${id}" name="${id}" value="__other__" aria-labelledby="other-label-${id}" aria-describedby="help-${id} error-${id}" ${cur === "__other__" ? "checked" : ""}><span class="t-body"><label class="t-label" id="other-label-${id}" for="other-radio-${id}">Other</label><input type="text" class="other-in" maxlength="200" placeholder="${esc(q.placeholder || "Specify another answer")}" aria-label="${esc(q.title)} — Other" aria-describedby="help-${id} error-${id}" value="${esc(otherText[id] || "")}"></span><span class="tick" aria-hidden="true">${ICON.check}</span></div>`;
      html += "</div>";
      if (multi && q.max) html += `<p class="counter">${(cur || []).length} of ${q.max} selected</p>`;
    }
    html += `<p class="err" id="error-${id}" role="alert" hidden>This question is required.</p>`;
    card.innerHTML = html; return card;
  }

  function render() {
    cancelAuto();
    const path = visiblePath(), active = new Set(path), nodes = [];
    Object.keys(answers).forEach(id => { if (!active.has(id)) { delete answers[id]; delete otherText[id]; } });
    let section;
    // order is presentation metadata, not permission to rewrite the validated graph.
    path.forEach((id, i) => {
      const next = Q[id].section;
      if (next && next !== section) {
        const definition = CFG.sections.find(s => s.id === next);
        const heading = document.createElement("header"); heading.className = "form-section";
        const title = document.createElement("h2"); title.textContent = definition.title; heading.append(title);
        if (definition.description) { const description = document.createElement("p"); description.textContent = definition.description; heading.append(description); }
        nodes.push(heading);
      }
      section = next; nodes.push(renderQuestion(id,i+1));
    });
    container.replaceChildren(...nodes);
    document.body.classList.toggle("form-start",path.length === 1 && Q[path[0]].field === "requestor" && Q[path[0]].required);
    highlightQuestion(active.has(activeQuestionId) ? activeQuestionId : path.find(id => !isAnswered(id)) || path[0]);
    syncOptions(); updateProgress();
  }

  function highlightQuestion(id) {
    activeQuestionId = id;
    container.querySelectorAll(".q-card").forEach(card => {
      const active = card.dataset.id === id;
      card.classList.toggle("is-active",active);
      if (active) card.setAttribute("aria-current","step");
      else card.removeAttribute("aria-current");
    });
  }
  container.addEventListener("focusin",e => {
    const card = e.target.closest(".q-card");
    if (card) highlightQuestion(card.dataset.id);
  });

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
    const q = Q[id], value = valueOf(id);
    if (!isAnswered(id)) return q.required ? "Please answer this question to continue." : "";
    if (q.type === "number" && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1000000 || (q.min !== undefined && value < q.min) || (q.max !== undefined && value > q.max) || (q.field === "participants" && (!Number.isSafeInteger(value) || value < 1)))) return "Enter a valid number within the allowed bounds" + (q.field === "participants" ? " (positive whole participants)." : ".");
    if (q.type === "multi" && (!Array.isArray(value) || new Set(value).size !== value.length || value.some(v => !q.choices.map(choiceObj).some(c => c.label === v)) || value.length < (q.min || 0) || value.length > (q.max || q.choices.length))) return "Choose the allowed number of listed options.";
    if (!["number", "multi"].includes(q.type)) {
      if (typeof value !== "string" || !value.trim() || value.length > (q.type === "textarea" ? 2000 : 200) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value)) return "Enter plain text within the allowed length; HTML is not supported.";
      if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "Enter a valid email address.";
      if (q.type === "date" && !schema.validDate(value)) return "Enter a valid calendar date.";
      if (q.type === "choice" && !q.allowOther && !q.choices.map(choiceObj).some(c => c.label === value.trim())) return "Choose a listed option.";
    }
    if (id === "date" && !validDate(answers.date)) return "Choose today or a future training date.";
    if (scheduling(id) && !availabilityReady()) return availabilityState === "error" ? "Availability couldn’t be checked. Please retry or choose another date." : "Please wait while we check availability.";
    if (id === "facilitator" && (avail?.blocked || []).includes(answers.facilitator)) return "Choose an available facilitator.";
    if (id === "time" && !isAnswered("facilitator")) return "Choose a facilitator first.";
    if (id === "time" && (avail?.busy || []).some(b => b.facilitator === answers.facilitator && S.overlaps(b.time,answers.time))) return "Choose an available time.";
    return "";
  }
  function showError(card,message) {
    const inline = card.querySelector(".err"); inline.textContent = message; inline.hidden = false; card.classList.add("invalid");
    card.querySelectorAll("input,textarea").forEach(el => el.setAttribute("aria-invalid","true"));
  }

  // Answer invalidation must work even when scheduling cards are off-screen.
  function reconcileAvailability() {
    // Availability can change after selection. Keep the answer visible and report
    // invalidReason instead of silently resetting the user's selected slot.
    if (availabilityReady() && (invalidReason("facilitator") || invalidReason("time"))) cancelAuto();
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
      const selected = Number(chip.dataset.qty) === answers[id]; chip.classList.toggle("on",selected); chip.setAttribute("aria-pressed",String(selected));
    });
    });
    updateProgress();
  }
  function clearError(card) {
    card.querySelector(".err").hidden = true; card.classList.remove("invalid");
    card.querySelectorAll("[aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
  }

  container.addEventListener("input",e => {
    const card = e.target.closest("[data-id]"); if (!card || submitting) return;
    const id = card.dataset.id, q = Q[id]; cancelAuto();
    if (e.target.classList.contains("other-in")) {
      const before = visiblePath().join("|");
      otherText[id] = e.target.value; answers[id] = "__other__";
      if (before !== visiblePath().join("|")) {
        const position = e.target.selectionStart;
        render();
        const input = container.querySelector(`[data-id="${id}"] .other-in`);
        input.focus({ preventScroll:true }); input.setSelectionRange(position,position);
        return;
      }
      syncOptions();
    } else if (q.type === "date") {
      // Invalidate immediately, even before the date input's change event.
      if (answers[id] !== e.target.value) {
        answers[id] = e.target.value;
        if (id === "date") { cancelAuto(); ++requestVersion; avail = null; availabilityState = "idle"; }
        if (id === "date") loadAvailability();
        else syncOptions();
      }
      clearError(card); updateProgress();
      return;
    } else if (["text", "textarea", "email", "number"].includes(q.type)) {
      const before = visiblePath().join("|");
      answers[id] = q.type === "number" ? (e.target.value === "" ? "" : e.target.valueAsNumber) : e.target.value;
      if (q.field === "requestor" && invalidReason(id)) requestorComplete = false;
      if (before !== visiblePath().join("|")) {
        const start = e.target.selectionStart, end = e.target.selectionEnd;
        render();
        const input = container.querySelector(`[data-id="${id}"] .text-in`);
        input.focus({ preventScroll:true });
        if (start !== null && end !== null) input.setSelectionRange(start,end);
        return;
      }
      syncOptions();
    }
    clearError(card); updateProgress();
  });
  function completeRequestor(e) {
    const card = e.target.closest(".q-card");
    if (!card || submitting || Q[card.dataset.id].field !== "requestor" || !Q[card.dataset.id].required) return;
    const id = card.dataset.id;
    if (invalidReason(id)) {
      if (e.type === "keydown") showError(card,invalidReason(id));
      return;
    }
    if (requestorComplete) return;
    requestorComplete = true;
    render(); goNext(id);
  }
  container.addEventListener("focusout",completeRequestor);
  container.addEventListener("keydown",e => {
    if (e.key === "Enter" && !e.isComposing && e.target.matches("input.text-in") && Q[e.target.closest(".q-card")?.dataset.id]?.field === "requestor") {
      e.preventDefault(); completeRequestor(e);
    }
  });
  container.addEventListener("change",e => {
    const card = e.target.closest("[data-id]"); if (!card || submitting || e.target.disabled) return;
    const id = card.dataset.id, q = Q[id]; cancelAuto();
    if (e.target.classList.contains("date-in")) { setDate(e.target.value); return; }
    if (q.type === "date") { answers[id] = e.target.value; clearError(card); updateProgress(); return; }
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
    if (e.target.type === "radio" || (q.choices?.length === 1 && isAnswered(id))) goNext(id);
  });
  function setDate(ds) {
    if (submitting) return;
    answers.date = ds; cancelAuto();
    const card = container.querySelector('[data-id="date"]');
    if (card) card.replaceWith(renderQuestion("date",visiblePath().indexOf("date")+1));
    highlightQuestion("date");
    loadAvailability(); updateProgress();
    if (validDate(ds)) { error.hidden = true; goNext("date"); }
  }
  container.addEventListener("click",e => {
    if (submitting) return;
    const card = e.target.closest("[data-id]"); if (!card) return;
    highlightQuestion(card.dataset.id);
    if (e.target.closest(".retry-btn")) { loadAvailability(); return; }
    const date = e.target.closest(".date-tile"); if (date) { setDate(date.dataset.date); return; }
    const chip = e.target.closest(".chip");
    if (chip) {
      answers[card.dataset.id] = Number(chip.dataset.qty); card.querySelector(".qty-in").value = chip.dataset.qty;
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
    e.preventDefault(); cancelAuto(); if (submitting || preview || stale || !loaded) return;
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
    const answerValues = {};
    path.forEach(id => { if (isAnswered(id)) answerValues[id] = valueOf(id); });
    let validated;
    try { validated = schema.submission(CFG, answerValues); }
    catch (err) { error.textContent = err.message; error.hidden = false; error.focus(); return; }
    const rec = { formVersion, answerValues:validated.answerValues };
    submitting = true; container.inert = true; form.setAttribute("aria-busy","true");
    container.querySelectorAll("input,textarea,button").forEach(el => el.disabled = true);
    error.hidden = true; updateProgress(); submit.textContent = "Submitting…";
    try {
      await window.RequestHistory?.ready;
      const saved = await S.create(rec);
      form.hidden = true; document.getElementById("progressWrap").hidden = true; document.getElementById("thanks").hidden = false;
      const snapshot = saved?.answerSnapshot || validated.answerSnapshot;
      document.getElementById("summary").innerHTML = snapshot.map(({title, value}) => `<tr><th scope="row">${esc(title)}</th><td>${esc(Array.isArray(value) ? value.join("; ") : value)}</td></tr>`).join("");
      const warning = document.getElementById("saveWarning");
      warning.textContent = saved?.warning || (saved?.auditRecorded === false ? "Booking saved, but activity recording failed. Do not resubmit this booking." : ""); warning.hidden = !warning.textContent;
      window.scrollTo({ top:0,behavior:reducedMotion.matches ? "auto" : "smooth" });
      document.querySelector("#thanks h2").focus({ preventScroll:true });
      const version = ++confirmationVersion;
      void window.RequestHistory?.verifySaved(saved.id, () => version === confirmationVersion);
    } catch (err) {
      if (err.status === 409 && ["FORM_EXPIRED", "FORM_VERSION_CONFLICT", "STALE_FORM"].includes(err.code)) {
        stale = true; document.getElementById("refreshFormBtn").hidden = false;
        error.textContent = `This form has changed. ${err.message} Load the latest form explicitly before submitting. Your current answers remain visible until you refresh.`;
      } else if (err.status === 409) {
        await loadAvailability();
        error.textContent = `Scheduling conflict: ${err.message} Your selections have been retained. Choose an available date, facilitator, or time.`;
      } else error.textContent = `Submission failed: ${err.message} Your answers are still here. No automatic retry was made.`;
      error.hidden = false; error.focus();
    } finally {
      submitting = false; container.inert = false; form.removeAttribute("aria-busy");
      container.querySelectorAll("input,textarea,button").forEach(el => el.disabled = false);
      syncOptions(); submit.textContent = "Submit request"; updateProgress();
    }
  });
  document.getElementById("againBtn").addEventListener("click",() => {
    if (submitting || preview) return;
    ++confirmationVersion;
    cancelAuto(); ++requestVersion;
    Object.keys(answers).forEach(k => delete answers[k]); Object.keys(otherText).forEach(k => delete otherText[k]);
    avail = null; availabilityState = "idle"; error.hidden = true;
    document.getElementById("thanks").hidden = true; document.getElementById("progressWrap").hidden = false;
    requestorComplete = false;
    form.hidden = false; render(); window.scrollTo({ top:0,behavior:reducedMotion.matches ? "auto" : "smooth" });
    (container.querySelector(".text-in,.q-title") || container).focus({ preventScroll:true });
  });
  function applyTheme(theme) {
    // Tokens have passed FormSchema.validate. No arbitrary style declarations.
    const root = document.documentElement;
    root.style.setProperty("--primary", theme.primary);
    root.style.setProperty("--primary-2", theme.primary);
    root.style.setProperty("--bg", theme.background);
    const rgb = theme.primary.slice(1).match(/../g).map(c => parseInt(c,16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    root.style.setProperty("--primary-ink", .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] > .179 ? "#111827" : "#ffffff");
    root.dataset.density = theme.density; root.dataset.width = theme.width; root.dataset.cardStyle = theme.cardStyle;
    root.dataset.glass = theme.glassEnabled ? "enabled" : "disabled";
    root.style.setProperty("--glass-alpha", String(1 - theme.glassTransparency / 100));
    root.style.setProperty("--glass-blur", `${theme.glassBlur}px`);
  }
  async function loadForm() {
    if (loading || submitting) return;
    loading = true; loaded = false; cancelAuto(); ++requestVersion;
    form.hidden = true; submit.disabled = true; document.getElementById("progressWrap").hidden = true;
    document.getElementById("thanks").hidden = true;
    const panel = document.getElementById("formLoad"), message = document.getElementById("loadMessage"), retry = document.getElementById("retryFormBtn");
    panel.hidden = false; panel.setAttribute("aria-busy","true"); message.textContent = preview ? "Loading authenticated draft preview…" : "Loading the published form…"; retry.hidden = true;
    try {
      if (!schema || !S) throw new Error("The shared form schema or transport could not be loaded.");
      // Draft endpoint itself authenticates. No source/sessionStorage override.
      const response = preview ? await S.formDraft() : await S.formConfig();
      if (!response || typeof response.version !== "string" || !response.version || (preview && (typeof response.revision !== "string" || !response.revision))) throw new Error("Invalid form configuration response.");
      const config = schema.validate(response.config);
      CFG = config; Q = config.questions; formVersion = response.version;
      Object.keys(answers).forEach(k => delete answers[k]); Object.keys(otherText).forEach(k => delete otherText[k]);
      avail = null; availabilityState = "idle"; stale = false; loaded = true; requestorComplete = false;
      document.getElementById("refreshFormBtn").hidden = true; error.hidden = true;
      document.getElementById("formTitle").textContent = CFG.title; document.title = preview ? `Draft preview — ${CFG.title}` : CFG.title;
      applyTheme(CFG.theme); render(); panel.hidden = true; form.hidden = false;
      document.getElementById("progressWrap").hidden = false;
      document.getElementById("previewBanner").hidden = !preview;
      submit.textContent = preview ? "Submissions disabled in preview" : "Submit request";
    } catch (err) {
      loaded = false; container.replaceChildren();
      message.textContent = `The ${preview ? "authenticated draft" : "published form"} could not be loaded: ${err.message} The form is unavailable until loading succeeds.`;
      retry.hidden = false;
    } finally { loading = false; panel.setAttribute("aria-busy","false"); }
  }
  document.getElementById("retryFormBtn").addEventListener("click",loadForm);
  document.getElementById("refreshFormBtn").addEventListener("click",loadForm);
  if (["localhost","127.0.0.1","[::1]"].includes(location.hostname) && new URLSearchParams(location.search).get("storage") === "local")
    document.querySelector(".admin-btn").href = "/admin/?storage=local";
  await loadForm();
})();