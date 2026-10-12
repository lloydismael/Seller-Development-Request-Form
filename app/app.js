(function () {
  const CFG = window.FORM_CONFIG, Q = CFG.questions, S = window.BookingStore;
  const answers = {}, otherText = {};
  const container = document.getElementById("questions");
  const form = document.getElementById("bookingForm");
  let avail = null; // availability for the selected date

  const choiceObj = c => (typeof c === "string" ? { label: c } : c);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const isAnswered = id => {
    const v = answers[id];
    if (Array.isArray(v)) return v.length > 0;
    if (v === "__other__") return !!(otherText[id] || "").trim();
    return v !== undefined && String(v).trim() !== "";
  };
  const valueOf = id => {
    let v = answers[id];
    if (v === "__other__") v = (otherText[id] || "").trim();
    return Array.isArray(v) ? v.join("; ") : (v ?? "");
  };

  // Follow branching rules based on current answers.
  function visiblePath() {
    const path = [], seen = new Set();
    let id = CFG.start;
    while (id && Q[id] && !seen.has(id)) {
      seen.add(id); path.push(id);
      const q = Q[id], opts = (q.choices || []).map(choiceObj);
      if (opts.some(c => c.goto)) {
        if (!isAnswered(id)) break;
        const sel = opts.find(c => c.label === answers[id]);
        id = (sel && sel.goto) || q.next;
      } else id = q.next;
    }
    return path;
  }

  function renderQuestion(id, num) {
    const q = Q[id], card = document.createElement("div");
    card.className = "q-card"; card.dataset.id = id;
    let html = `<div class="q-title"><span class="num">${num}.</span> ${esc(q.title)}${q.required ? ' <span class="req">*</span>' : ""}</div>`;
    if (q.type === "multi" && q.max) html += `<div class="hint">Select up to ${q.max} options.</div>`;
    if (id === "facilitator" || id === "time") html += `<div class="hint avail-hint"></div>`;

    if (q.type === "text") {
      html += `<input type="text" class="text-in" placeholder="Enter your answer" value="${esc(answers[id] || "")}">`;
    } else if (q.type === "date") {
      html += `<input type="date" class="text-in date-in" min="${new Date().toISOString().slice(0, 10)}" value="${esc(answers[id] || "")}">`;
    } else {
      const multi = q.type === "multi", cur = answers[id];
      html += `<div class="options">`;
      q.choices.map(choiceObj).forEach(c => {
        const checked = multi ? (cur || []).includes(c.label) : cur === c.label;
        html += `<label class="opt"><input type="${multi ? "checkbox" : "radio"}" name="${id}" value="${esc(c.label)}" ${checked ? "checked" : ""}><span>${esc(c.label)}</span><span class="tag" hidden></span></label>`;
      });
      if (q.allowOther) {
        html += `<label class="opt other"><input type="radio" name="${id}" value="__other__" ${cur === "__other__" ? "checked" : ""}><span>Other</span>
                 <input type="text" class="other-in" placeholder="Other answer" value="${esc(otherText[id] || "")}"></label>`;
      }
      html += `</div>`;
    }
    html += `<div class="err" hidden>This question is required.</div>`;
    card.innerHTML = html;
    return card;
  }

  function render() {
    container.innerHTML = "";
    visiblePath().forEach((id, i) => container.appendChild(renderQuestion(id, i + 1)));
    applyAvailability();
  }

  // ---------- facilitator availability ----------
  async function loadAvailability() {
    const d = answers.date;
    if (!d) { avail = null; applyAvailability(); return; }
    try {
      const data = await S.availability(d);
      if (answers.date === d) { avail = data; applyAvailability(); }
    } catch { avail = null; applyAvailability(); }
  }
  function setDisabled(opt, input, dis, tag) {
    input.disabled = dis; if (dis) input.checked = false;
    opt.classList.toggle("disabled", dis);
    const t = opt.querySelector(".tag"); if (t) { t.hidden = !dis; t.textContent = tag; }
  }
  function applyAvailability() {
    const fc = container.querySelector('[data-id="facilitator"]'), tc = container.querySelector('[data-id="time"]');
    const blocked = new Set((avail && avail.blocked) || []);
    if (fc) {
      fc.querySelector(".avail-hint").textContent = avail ? `Availability shown for ${avail.date}.` : "Select a training date to see availability.";
      fc.querySelectorAll(".opt").forEach(o => {
        const inp = o.querySelector("input"), dis = blocked.has(inp.value);
        setDisabled(o, inp, dis, "Unavailable");
        if (dis && answers.facilitator === inp.value) delete answers.facilitator;
      });
    }
    if (tc) {
      const f = answers.facilitator;
      tc.querySelector(".avail-hint").textContent = f && avail ? `Slots already booked for ${f} are disabled.` : "";
      tc.querySelectorAll(".opt").forEach(o => {
        const inp = o.querySelector("input");
        const dis = !!(avail && f && avail.busy.some(b => b.facilitator === f && S.overlaps(b.time, inp.value)));
        setDisabled(o, inp, dis, "Booked");
        if (dis && answers.time === inp.value) delete answers.time;
      });
    }
  }

  // ---------- events ----------
  container.addEventListener("input", e => {
    const card = e.target.closest(".q-card"); if (!card) return;
    const id = card.dataset.id, q = Q[id];
    if (e.target.classList.contains("other-in")) {
      otherText[id] = e.target.value; answers[id] = "__other__";
      card.querySelector('input[value="__other__"]').checked = true;
    } else if (q.type === "text" || q.type === "date") {
      answers[id] = e.target.value;
      if (id === "date") loadAvailability();
    }
    card.querySelector(".err").hidden = true; card.classList.remove("invalid");
  });

  container.addEventListener("change", e => {
    const card = e.target.closest(".q-card"); if (!card) return;
    const id = card.dataset.id, q = Q[id];
    if (q.type === "multi") {
      const boxes = [...card.querySelectorAll('input[type="checkbox"]')];
      if (q.max && boxes.filter(b => b.checked).length > q.max) { e.target.checked = false; return; }
      answers[id] = boxes.filter(b => b.checked).map(b => b.value);
      if (q.max) boxes.forEach(b => (b.disabled = !b.checked && answers[id].length >= q.max));
    } else if (e.target.type === "radio") {
      const before = answers[id];
      answers[id] = e.target.value;
      if (e.target.value === "__other__") card.querySelector(".other-in").focus();
      if (q.choices.map(choiceObj).some(c => c.goto) && before !== answers[id]) { render(); return; }
      if (id === "facilitator") applyAvailability();
    }
    card.querySelector(".err").hidden = true; card.classList.remove("invalid");
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const path = visiblePath();
    let firstBad = null;
    path.forEach(id => {
      const card = container.querySelector(`[data-id="${id}"]`);
      const bad = Q[id].required && !isAnswered(id);
      card.querySelector(".err").hidden = !bad; card.classList.toggle("invalid", bad);
      if (bad && !firstBad) firstBad = card;
    });
    if (firstBad) { firstBad.scrollIntoView({ behavior: "smooth", block: "center" }); return; }

    const rec = { answers: {} };
    path.forEach(id => {
      const v = valueOf(id);
      rec.answers[Q[id].title] = v;
      if (Q[id].field) rec[Q[id].field] = v;
    });

    const btn = document.getElementById("submitBtn");
    btn.disabled = true; btn.textContent = "Submitting...";
    try {
      await S.create(rec);
      showThanks(rec);
    } catch (err) {
      alert(err.status === 409 ? "That slot is no longer available:\n\n" + err.message + "\n\nPlease choose another facilitator, date or time." : "Submission failed: " + err.message);
      if (err.status === 409) loadAvailability();
    } finally { btn.disabled = false; btn.textContent = "Submit"; }
  });

  function showThanks(rec) {
    form.hidden = true;
    document.getElementById("thanks").hidden = false;
    document.getElementById("summary").innerHTML = Object.entries(rec.answers)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.getElementById("againBtn").addEventListener("click", () => {
    Object.keys(answers).forEach(k => delete answers[k]);
    Object.keys(otherText).forEach(k => delete otherText[k]);
    avail = null;
    document.getElementById("thanks").hidden = true; form.hidden = false;
    render();
  });

  document.getElementById("formTitle").textContent = CFG.title;
  document.title = CFG.title;
  render();
})();
