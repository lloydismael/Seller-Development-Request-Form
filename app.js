(function () {
  const CFG = window.FORM_CONFIG;
  const Q = CFG.questions;
  const answers = {};          // id -> string | string[]
  const otherText = {};        // id -> "Other" free text
  const container = document.getElementById("questions");
  const form = document.getElementById("bookingForm");

  const choiceObj = c => (typeof c === "string" ? { label: c } : c);
  const isAnswered = (id) => {
    const v = answers[id];
    if (Array.isArray(v)) return v.length > 0;
    if (v === "__other__") return !!(otherText[id] || "").trim();
    return v !== undefined && String(v).trim() !== "";
  };

  // Walk the branching path based on current answers.
  function visiblePath() {
    const path = []; const seen = new Set();
    let id = CFG.start;
    while (id && Q[id] && !seen.has(id)) {
      seen.add(id); path.push(id);
      const q = Q[id];
      const branches = (q.choices || []).map(choiceObj).some(c => c.goto);
      if (branches) {
        if (!isAnswered(id)) break;               // wait until the branching question is answered
        const sel = (q.choices || []).map(choiceObj).find(c => c.label === answers[id]);
        id = (sel && sel.goto) || q.next;
      } else {
        id = q.next;
      }
    }
    return path;
  }

  const esc = s => String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function renderQuestion(id, num) {
    const q = Q[id];
    const card = document.createElement("div");
    card.className = "q-card"; card.dataset.id = id;
    let hint = "";
    if (q.type === "multi" && q.max) hint = `<div class="hint">Select up to ${q.max} option${q.max > 1 ? "s" : ""}.</div>`;
    let html = `<div class="q-title"><span class="num">${num}.</span> ${esc(q.title)}${q.required ? ' <span class="req">*</span>' : ""}</div>${hint}`;

    if (q.type === "text") {
      html += `<input type="text" class="text-in" placeholder="Enter your answer" value="${esc(answers[id] || "")}">`;
    } else if (q.type === "date") {
      html += `<input type="date" class="text-in date-in" value="${esc(answers[id] || "")}">`;
    } else {
      const multi = q.type === "multi";
      const cur = answers[id];
      html += `<div class="options">`;
      q.choices.map(choiceObj).forEach((c, i) => {
        const checked = multi ? (cur || []).includes(c.label) : cur === c.label;
        html += `<label class="opt"><input type="${multi ? "checkbox" : "radio"}" name="${id}" value="${esc(c.label)}" ${checked ? "checked" : ""}><span>${esc(c.label)}</span></label>`;
      });
      if (q.allowOther) {
        const oc = cur === "__other__";
        html += `<label class="opt other"><input type="radio" name="${id}" value="__other__" ${oc ? "checked" : ""}><span>Other</span>
                 <input type="text" class="other-in" placeholder="Other answer" value="${esc(otherText[id] || "")}"></label>`;
      }
      html += `</div>`;
    }
    html += `<div class="err" hidden>This question is required.</div>`;
    card.innerHTML = html;
    return card;
  }

  function render() {
    const path = visiblePath();
    container.innerHTML = "";
    path.forEach((id, i) => container.appendChild(renderQuestion(id, i + 1)));
  }

  // Event handling (delegated)
  container.addEventListener("input", e => {
    const card = e.target.closest(".q-card"); if (!card) return;
    const id = card.dataset.id; const q = Q[id];
    if (e.target.classList.contains("other-in")) {
      otherText[id] = e.target.value;
      answers[id] = "__other__";
      card.querySelector('input[value="__other__"]').checked = true;
    } else if (q.type === "text" || q.type === "date") {
      answers[id] = e.target.value;
    }
    card.querySelector(".err").hidden = true;
  });

  container.addEventListener("change", e => {
    const card = e.target.closest(".q-card"); if (!card) return;
    const id = card.dataset.id; const q = Q[id];
    if (q.type === "multi") {
      const boxes = [...card.querySelectorAll('input[type="checkbox"]')];
      if (q.max && boxes.filter(b => b.checked).length > q.max) { e.target.checked = false; return; }
      answers[id] = boxes.filter(b => b.checked).map(b => b.value);
      if (q.max) boxes.forEach(b => b.disabled = !b.checked && answers[id].length >= q.max);
    } else if (e.target.type === "radio") {
      const before = answers[id];
      answers[id] = e.target.value;
      if (e.target.value === "__other__") card.querySelector(".other-in").focus();
      const branches = q.choices.map(choiceObj).some(c => c.goto);
      if (branches && before !== answers[id]) { render(); return; }   // re-route
    }
    card.querySelector(".err").hidden = true;
  });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const path = visiblePath();
    let firstBad = null;
    path.forEach(id => {
      const card = container.querySelector(`[data-id="${id}"]`);
      const bad = Q[id].required && !isAnswered(id);
      card.querySelector(".err").hidden = !bad;
      card.classList.toggle("invalid", bad);
      if (bad && !firstBad) firstBad = card;
    });
    // The last question on the path must be an end question (path fully resolved)
    if (firstBad) { firstBad.scrollIntoView({ behavior: "smooth", block: "center" }); return; }

    // Build submission only from questions on the active path
    const result = { submittedAt: new Date().toISOString(), answers: {} };
    path.forEach(id => {
      let v = answers[id];
      if (v === "__other__") v = otherText[id].trim();
      if (Array.isArray(v)) v = v.join("; ");
      result.answers[Q[id].title] = v;
    });

    const btn = document.getElementById("submitBtn");
    btn.disabled = true; btn.textContent = "Submitting...";
    try {
      if (CFG.submitUrl) {
        const r = await fetch(CFG.submitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
        if (!r.ok) throw new Error("HTTP " + r.status);
      }
      const store = JSON.parse(localStorage.getItem("sdrf_bookings") || "[]");
      store.push(result); localStorage.setItem("sdrf_bookings", JSON.stringify(store));
      showThanks(result);
    } catch (err) {
      alert("Submission failed: " + err.message);
      btn.disabled = false; btn.textContent = "Submit";
    }
  });

  function showThanks(result) {
    form.hidden = true;
    const t = document.getElementById("thanks");
    t.hidden = false;
    document.getElementById("summary").innerHTML = Object.entries(result.answers)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.getElementById("againBtn").addEventListener("click", () => {
    Object.keys(answers).forEach(k => delete answers[k]);
    Object.keys(otherText).forEach(k => delete otherText[k]);
    document.getElementById("thanks").hidden = true;
    form.hidden = false;
    const btn = document.getElementById("submitBtn"); btn.disabled = false; btn.textContent = "Submit";
    render();
  });

  document.getElementById("exportBtn").addEventListener("click", () => {
    const rows = JSON.parse(localStorage.getItem("sdrf_bookings") || "[]");
    if (!rows.length) return alert("No bookings stored in this browser yet.");
    const cols = ["submittedAt", ...new Set(rows.flatMap(r => Object.keys(r.answers)))];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.map(q).join(","), ...rows.map(r => cols.map(c => q(c === "submittedAt" ? r.submittedAt : r.answers[c])).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = "bookings.csv"; a.click();
  });

  document.getElementById("formTitle").textContent = CFG.title;
  document.title = CFG.title;
  render();
})();
