(async function () {
  const S = window.BookingStore, Q = window.FORM_CONFIG.questions;
  const FACS = Q.facilitator.choices.slice();
  const TIMES = Q.time.choices.slice();
  const CATS = Q.category.choices.map(c => c.label);
  const VENUES = Q.venue.choices.slice();
  const STATUSES = ["Pending", "Approved", "Completed", "Rejected", "Cancelled"];
  const PALETTE = ["#4f6bed", "#c239b3", "#0b8a5a", "#d4730c", "#8764b8", "#038387", "#a4262c"];
  const HALVES = [{ key: "AM", range: [540, 720] }, { key: "PM", range: [780, 1020] }];

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const startOfWeek = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
  const fmtDate = s => (s ? parse(s).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }) : "—");
  const today = ymd(new Date());
  const color = f => { const i = FACS.indexOf(f); return PALETTE[(i < 0 ? FACS.length : i) % PALETTE.length]; };
  const first = f => String(f || "?").split(" ")[0];
  const shortTime = t => String(t || "").replace(/:00/g, "").replace(/\s/g, "");
  const startMin = b => S.slotRange(b.time)[0] || 0;
  const byDate = (a, b) => (a.trainingDate || "").localeCompare(b.trainingDate || "") || startMin(a) - startMin(b);
  const active = b => S.isActive(b.status);
  const title = b => b.topic || b.category || "Training";
  const opts = (list, sel, blank) => (blank !== undefined ? `<option value="">${esc(blank)}</option>` : "") +
    list.map(v => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");

  let bookings = [], blocks = [], mode = "local";
  const st = {
    tab: "dashboard", month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calFac: "", calStatus: "active", week: startOfWeek(new Date()),
    q: "", fStatus: "", fCat: "", fFac: "", fWhen: "upcoming", prefillDate: ""
  };

  const blocksOn = (date, fac) => blocks.filter(x => (!fac || x.facilitator === fac) && date >= x.startDate && date <= (x.endDate || x.startDate));
  const hasConflict = b => active(b) && S.findConflicts(bookings, blocks, b, b.id).length > 0;
  function slotState(fac, date, range) {
    const bl = blocksOn(date, fac);
    if (bl.length) return { s: "blocked", items: [], label: "Blocked", tip: bl.map(x => x.reason || "Unavailable").join(", ") };
    const items = bookings.filter(b => active(b) && b.facilitator === fac && b.trainingDate === date &&
      (([a, c]) => a < range[1] && range[0] < c)(S.slotRange(b.time)));
    if (!items.length) return { s: "free", items, label: "Free", tip: "Available" };
    const confirmed = items.some(i => i.status === "Approved" || i.status === "Completed");
    return { s: confirmed ? "booked" : "pending", items, label: confirmed ? "Booked" : "Pending",
      tip: items.map(i => `${i.time} – ${title(i)} (${i.status})`).join("\n") };
  }
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }

  // ---------- auth ----------
  function showLogin() {
    return new Promise(resolve => {
      $("#gate").hidden = false;
      const local = ["localhost", "127.0.0.1"].includes(location.hostname);
      if (local) {  // show default credentials only when running locally
        const d = S.defaultAdmin;
        $("#defaultCreds").hidden = false;
        $("#defaultCreds").innerHTML = `<b>Default admin credentials</b><br>Username: <code>${esc(d.username)}</code> &nbsp; Password: <code>${esc(d.password)}</code>
          <br><button type="button" class="btn sm" id="useDefault">Use default credentials</button>`;
        $("#useDefault").onclick = () => { $("#lUser").value = d.username; $("#lPass").value = d.password; $("#lPass").focus(); };
      }
      $("#lUser").focus();
      $("#loginForm").onsubmit = async e => {
        e.preventDefault();
        const btn = $("#loginBtn"); btn.disabled = true; btn.textContent = "Logging in...";
        $("#loginErr").hidden = true;
        try {
          const r = await S.login($("#lUser").value.trim(), $("#lPass").value);
          $("#gate").hidden = true; $("#lPass").value = "";
          resolve(r.user);
        } catch (err) {
          $("#loginErr").textContent = err.status === 401 ? "Invalid username or password." : err.message;
          $("#loginErr").hidden = false; $("#lPass").select();
        } finally { btn.disabled = false; btn.textContent = "Log in"; }
      };
    });
  }

  // ---------- data ----------
  async function reload() {
    try {
      [bookings, blocks] = await Promise.all([S.list(), S.listBlocks()]);
    } catch (e) {
      if (e.status === 401) { location.reload(); return; }
      $("#view").innerHTML = `<div class="alert">Could not load data: ${esc(e.message)}</div>`;
      return;
    }
    render();
  }
  async function saveBooking(id, patch) {
    try { await S.update(id, patch); }
    catch (e) {
      if (e.status !== 409) { alert(e.message); return false; }
      if (!confirm(`Scheduling conflict:\n\n${e.message}\n\nSave anyway?`)) return false;
      await S.update(id, { ...patch, force: true });
    }
    await reload(); toast("Booking updated"); return true;
  }

  // ---------- shell ----------
  try { mode = await S.mode(); }
  catch (err) {
    // Port 3000 is the static preview, not an API proxy. Use the local
    // full-stack endpoint so authentication cookies remain same-origin.
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) && location.port === "3000") {
      const live = new URL(location.href); live.port = "4281";
      location.replace(live.href);
      return;
    }
    $("#gate").hidden = false;
    $("#loginErr").textContent = err.message;
    $("#loginErr").hidden = false;
    $("#loginForm").onsubmit = e => { e.preventDefault(); location.reload(); };
    $("#loginBtn").textContent = "Retry connection";
    return;
  }
  let user = (await S.me()).user;
  if (!user) user = await showLogin();
  $("#app").hidden = false;
  $("#userName").textContent = user;
  $("#modeBadge").textContent = mode === "api" ? "Live API" : "Local storage";
  $("#modeBadge").classList.toggle("local", mode !== "api");
  $("#logoutBtn").onclick = async () => { await S.logout(); location.reload(); };
  if (mode === "local") {
    $("#devBar").hidden = false;
    $("#seedBtn").onclick = () => { if (confirm("Replace local data with sample bookings?")) { seedSample(); reload(); } };
    $("#clearBtn").onclick = () => { if (confirm("Delete all locally stored bookings and blocked dates?")) { S.replaceLocal([], []); reload(); } };
  }
  document.querySelectorAll(".tab").forEach(b => (b.onclick = () => { st.tab = b.dataset.tab; render(); }));

  $("#view").addEventListener("click", async e => {
    const t = e.target.closest("[data-act],[data-open],[data-day],[data-nav],[data-wnav],[data-delblock]");
    if (!t) return;
    e.stopPropagation();
    if (t.dataset.act) await saveBooking(t.dataset.id, { status: t.dataset.act });
    else if (t.dataset.open) openBooking(t.dataset.open);
    else if (t.dataset.day) openDay(t.dataset.day);
    else if (t.dataset.nav) {
      const n = +t.dataset.nav, m = st.month;
      st.month = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + n, 1);
      render();
    } else if (t.dataset.wnav) {
      const n = +t.dataset.wnav; st.week = n === 0 ? startOfWeek(new Date()) : addDays(st.week, 7 * n); render();
    } else if (t.dataset.delblock) {
      if (confirm("Remove this blocked date?")) { await S.removeBlock(t.dataset.delblock); await reload(); toast("Blocked date removed"); }
    }
  });

  function render() {
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === st.tab));
    const v = $("#view");
    ({ dashboard, calendar, availability, bookings: bookingsView, blocks: blocksView })[st.tab](v);
  }

  // ---------- shared fragments ----------
  function rowHtml(b, quick) {
    const d = b.trainingDate ? parse(b.trainingDate) : null;
    return `<div class="row" data-open="${esc(b.id)}">
      <div class="dbadge"><small>${d ? d.toLocaleDateString("en-PH", { month: "short" }) : ""}</small><b>${d ? d.getDate() : "?"}</b></div>
      <div class="main"><div class="t">${hasConflict(b) ? '<span class="warnicon" title="Conflict">⚠ </span>' : ""}${esc(title(b))}</div>
        <div class="s">${esc(b.time)} · <span style="color:${color(b.facilitator)}">●</span> ${esc(b.facilitator)} · ${esc(b.requestor)} (${esc(b.division)})</div></div>
      <span class="pill ${esc(b.status)}">${esc(b.status)}</span>
      ${quick && b.status === "Pending" ? `<button class="btn sm ok" data-act="Approved" data-id="${esc(b.id)}">Approve</button><button class="btn sm danger" data-act="Rejected" data-id="${esc(b.id)}">Reject</button>` : ""}
    </div>`;
  }
  const empty = msg => `<div class="empty">${esc(msg)}</div>`;
  const stat = (l, n, cls = "") => `<div class="stat ${cls}"><div class="n">${n}</div><div class="l">${esc(l)}</div></div>`;
  function bars(rows, colorFn) {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return rows.map(([k, n]) => `<div class="bar"><span class="lbl" title="${esc(k)}">${esc(k)}</span>
      <div class="track"><div class="fill" style="width:${(n / max) * 100}%;${colorFn ? `background:${colorFn(k)}` : ""}"></div></div><b>${n}</b></div>`).join("");
  }
  const legend = () => `<div class="legend">${FACS.map(f => `<span><i style="background:${color(f)}"></i>${esc(f)}</span>`).join("")}
    <span><i style="background:#ccc"></i>Blocked</span><span><i style="border:1px dashed #999"></i><em>Pending (dashed)</em></span></div>`;

  // ---------- Dashboard ----------
  function dashboard(v) {
    const act = bookings.filter(active);
    const upcoming = act.filter(b => b.trainingDate >= today).sort(byDate);
    const pending = bookings.filter(b => b.status === "Pending").sort(byDate);
    const in14 = ymd(addDays(new Date(), 14));
    const next14 = upcoming.filter(b => b.trainingDate <= in14);
    const thisMonth = act.filter(b => (b.trainingDate || "").startsWith(today.slice(0, 7)));
    const conflicts = bookings.filter(hasConflict);
    v.innerHTML = `
      <div class="stats">${stat("Total requests", bookings.length)}${stat("Pending approval", pending.length, "warn")}
        ${stat("Upcoming sessions", upcoming.length)}${stat("Sessions this month", thisMonth.length)}
        ${stat("Conflicts", conflicts.length, conflicts.length ? "bad" : "")}</div>
      <div class="grid2">
        <div class="panel"><h3>Pending approval</h3>${pending.length ? pending.slice(0, 10).map(b => rowHtml(b, true)).join("") : empty("No pending requests.")}</div>
        <div class="panel"><h3>Next 14 days</h3>${next14.length ? next14.map(b => rowHtml(b)).join("") : empty("Nothing scheduled in the next 14 days.")}</div>
        <div class="panel"><h3>Upcoming sessions by facilitator</h3>${bars(FACS.map(f => [f, upcoming.filter(b => b.facilitator === f).length]), color)}</div>
        <div class="panel"><h3>Requests by training category</h3>${bars(CATS.map(c => [c, bookings.filter(b => b.category === c).length]))}</div>
      </div>
      ${conflicts.length ? `<div class="panel"><h3>⚠ Conflicts to resolve</h3>${conflicts.sort(byDate).map(b => rowHtml(b)).join("")}</div>` : ""}`;
  }

  // ---------- Calendar ----------
  function calendar(v) {
    const m = st.month, firstDay = new Date(m.getFullYear(), m.getMonth(), 1);
    const days = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    const start = addDays(firstDay, -firstDay.getDay());
    const cellsN = Math.ceil((firstDay.getDay() + days) / 7) * 7;
    const filt = b => (!st.calFac || b.facilitator === st.calFac) &&
      (st.calStatus === "all" || (st.calStatus === "active" ? active(b) : b.status === st.calStatus));
    let cells = "";
    for (let i = 0; i < cellsN; i++) {
      const d = addDays(start, i), ds = ymd(d);
      const items = bookings.filter(b => b.trainingDate === ds && filt(b)).sort(byDate);
      const chips = [
        ...blocksOn(ds, st.calFac).map(x => `<div class="chip blocked" title="${esc(x.facilitator + ": " + (x.reason || "Unavailable"))}">Off: ${esc(first(x.facilitator))}</div>`),
        ...items.map(b => `<div class="chip st-${esc(b.status.toLowerCase())}" style="--c:${color(b.facilitator)}" data-open="${esc(b.id)}"
            title="${esc(`${b.time}\n${b.facilitator}\n${title(b)}\n${b.venue}\nStatus: ${b.status}`)}">${hasConflict(b) ? "⚠ " : ""}${esc(shortTime(b.time))} ${esc(first(b.facilitator))}</div>`)
      ];
      cells += `<div class="day ${d.getMonth() !== m.getMonth() ? "out" : ""} ${ds === today ? "today" : ""}" data-day="${ds}">
        <div class="dnum">${d.getDate()}</div>${chips.slice(0, 4).join("")}${chips.length > 4 ? `<div class="more">+${chips.length - 4} more</div>` : ""}</div>`;
    }
    v.innerHTML = `
      <div class="toolbar">
        <button class="btn" data-nav="-1">‹</button><button class="btn" data-nav="0">Today</button><button class="btn" data-nav="1">›</button>
        <h2>${m.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h2><span class="spacer"></span>
        <select id="calFac">${opts(FACS, st.calFac, "All facilitators")}</select>
        <select id="calStatus">
          <option value="active" ${st.calStatus === "active" ? "selected" : ""}>Active (Pending/Approved/Completed)</option>
          <option value="all" ${st.calStatus === "all" ? "selected" : ""}>All statuses</option>
          ${STATUSES.map(s => `<option ${st.calStatus === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      ${legend()}
      <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="dow">${d}</div>`).join("")}${cells}</div>
      <p class="muted small">Click a booking to view/edit it. Click a day to see all bookings and facilitator availability for that date.</p>`;
    $("#calFac").onchange = e => { st.calFac = e.target.value; render(); };
    $("#calStatus").onchange = e => { st.calStatus = e.target.value; render(); };
  }

  function daySlotTable(ds) {
    return `<table class="slotgrid"><thead><tr><th>Facilitator</th>${TIMES.map(t => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>
      ${FACS.map(f => `<tr><td style="text-align:left"><span class="dot" style="background:${color(f)}"></span>${esc(f)}</td>
        ${TIMES.map(t => { const s = slotState(f, ds, S.slotRange(t)); return `<td class="s-${s.s}" title="${esc(s.tip)}">${s.label}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table>`;
  }

  function openDay(ds) {
    const items = bookings.filter(b => b.trainingDate === ds).sort(byDate);
    openModal(`<h2>${fmtDate(ds)}</h2>
      <h3 style="margin-top:16px">Bookings (${items.length})</h3>
      ${items.length ? items.map(b => rowHtml(b, true)).join("") : empty("No bookings on this date.")}
      <h3 style="margin-top:18px">Facilitator availability</h3>${daySlotTable(ds)}
      <div class="modal-actions"><button class="btn" id="blockDayBtn">Block a facilitator on this date</button></div>`);
    $("#modalBody").onclick = async e => {
      const t = e.target.closest("[data-act],[data-open]"); if (!t) return;
      if (t.dataset.act) { if (await saveBooking(t.dataset.id, { status: t.dataset.act })) openDay(ds); }
      else openBooking(t.dataset.open);
    };
    $("#blockDayBtn").onclick = () => { st.prefillDate = ds; st.tab = "blocks"; closeModal(); render(); };
  }

  // ---------- Facilitator availability ----------
  function availability(v) {
    const days = [...Array(7)].map((_, i) => addDays(st.week, i));
    const wkEnd = ymd(days[6]), wkStart = ymd(days[0]);
    const rows = FACS.map(f => {
      const n = bookings.filter(b => active(b) && b.facilitator === f && b.trainingDate >= wkStart && b.trainingDate <= wkEnd).length;
      return `<tr><td class="fac"><span class="dot" style="background:${color(f)}"></span>${esc(f)}<small>${n} session${n === 1 ? "" : "s"} this week</small></td>
        ${days.map(d => {
          const ds = ymd(d);
          return `<td><div class="halves">${HALVES.map(h => {
            const s = slotState(f, ds, h.range);
            const open = s.items.length ? `data-open="${esc(s.items[0].id)}"` : "";
            const lbl = s.items.length ? `${s.label}: ${esc(s.items.map(i => shortTime(i.time)).join(", "))}` : s.label;
            return `<div class="half s-${s.s}" ${open} title="${esc(s.tip)}">${h.key} · ${lbl}</div>`;
          }).join("")}</div></td>`;
        }).join("")}</tr>`;
    }).join("");
    v.innerHTML = `
      <div class="toolbar">
        <button class="btn" data-wnav="-1">‹</button><button class="btn" data-wnav="0">This week</button><button class="btn" data-wnav="1">›</button>
        <h2>${days[0].toLocaleDateString("en-PH", { month: "short", day: "numeric" })} – ${days[6].toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</h2>
      </div>
      <div class="legend"><span><i class="s-free"></i>Free</span><span><i class="s-pending"></i>Pending request</span>
        <span><i class="s-booked"></i>Booked (approved)</span><span><i class="s-blocked"></i>Blocked / on leave</span>
        <span>AM = 9:00 AM–12:00 PM · PM = 1:00 PM–5:00 PM</span></div>
      <div class="panel"><table class="avail"><thead><tr><th></th>
        ${days.map(d => `<th class="${ymd(d) === today ? "today" : ""}">${d.toLocaleDateString("en-PH", { weekday: "short" })}<br>${d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</th>`).join("")}
      </tr></thead><tbody>${rows}</tbody></table></div>
      <div class="panel"><h3>Find an available facilitator</h3>
        <div class="finder">
          <label>Date<input type="date" id="fDate" value="${today}"></label>
          <label>Time slot<select id="fTime">${opts(TIMES, TIMES[0])}</select></label>
          <button class="btn primary" id="fGo">Check</button>
        </div>
        <div id="fResult" class="result"></div>
      </div>`;
    const check = () => {
      const d = $("#fDate").value, t = $("#fTime").value; if (!d) return;
      $("#fResult").innerHTML = FACS.map(f => {
        const c = S.findConflicts(bookings, blocks, { trainingDate: d, time: t, facilitator: f });
        return c.length
          ? `<div class="s-booked">✖ <b>${esc(f)}</b> – ${esc(S.conflictMessage(c))}</div>`
          : `<div class="s-free">✔ <b>${esc(f)}</b> – available on ${fmtDate(d)}, ${esc(t)}</div>`;
      }).join("");
    };
    $("#fGo").onclick = check; check();
  }

  // ---------- Bookings list ----------
  function filtered() {
    const q = st.q.toLowerCase();
    return bookings.filter(b =>
      (!st.fStatus || b.status === st.fStatus) && (!st.fCat || b.category === st.fCat) && (!st.fFac || b.facilitator === st.fFac) &&
      (st.fWhen === "all" || (st.fWhen === "upcoming" ? b.trainingDate >= today : b.trainingDate < today)) &&
      (!q || [b.requestor, b.division, b.director, b.category, b.topic, b.facilitator, b.venue, b.time, b.trainingDate, b.status]
        .some(x => String(x || "").toLowerCase().includes(q)))
    ).sort((a, b) => (st.fWhen === "past" ? -1 : 1) * byDate(a, b));
  }
  function bookingsView(v) {
    v.innerHTML = `
      <div class="toolbar">
        <input type="search" id="bq" placeholder="Search requestor, topic, venue…" value="${esc(st.q)}" style="min-width:240px">
        <select id="bWhen"><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All dates</option></select>
        <select id="bStatus">${opts(STATUSES, st.fStatus, "All statuses")}</select>
        <select id="bCat">${opts(CATS, st.fCat, "All categories")}</select>
        <select id="bFac">${opts(FACS, st.fFac, "All facilitators")}</select>
        <span class="spacer"></span><button class="btn" id="bExport">Export CSV</button>
      </div>
      <div class="panel" style="padding:0"><div id="bTable"></div></div>`;
    $("#bWhen").value = st.fWhen;
    const bind = (id, key) => ($(id).oninput = e => { st[key] = e.target.value; table(); });
    bind("#bq", "q"); bind("#bWhen", "fWhen"); bind("#bStatus", "fStatus"); bind("#bCat", "fCat"); bind("#bFac", "fFac");
    $("#bExport").onclick = () => exportCsv(filtered());
    table();
  }
  function table() {
    const rows = filtered();
    $("#bTable").innerHTML = `<div style="padding:10px 12px" class="count">${rows.length} booking${rows.length === 1 ? "" : "s"}</div>
      <table class="tbl"><thead><tr><th>Date</th><th>Time</th><th>Facilitator</th><th>Category / Topic</th><th>Requestor</th><th>Venue</th><th>Pax</th><th>Status</th></tr></thead>
      <tbody>${rows.map(b => `<tr data-open="${esc(b.id)}">
        <td>${hasConflict(b) ? '<span class="warnicon" title="Conflict">⚠ </span>' : ""}${fmtDate(b.trainingDate)}</td><td>${esc(b.time)}</td>
        <td><span class="dot" style="background:${color(b.facilitator)}"></span>${esc(b.facilitator)}</td>
        <td><b>${esc(b.category)}</b><br><span class="muted">${esc(b.topic)}</span></td>
        <td>${esc(b.requestor)}<br><span class="muted">${esc(b.division)}${b.director ? " · " + esc(b.director) : ""}</span></td>
        <td>${esc(b.venue)}</td><td>${esc(b.participants)}</td><td><span class="pill ${esc(b.status)}">${esc(b.status)}</span></td></tr>`).join("")
        || `<tr><td colspan="8">${empty("No bookings match the filters.")}</td></tr>`}</tbody></table>`;
  }
  function exportCsv(rows) {
    if (!rows.length) return alert("Nothing to export.");
    const cols = [["Status", "status"], ["Training Date", "trainingDate"], ["Time", "time"], ["Facilitator", "facilitator"], ["Category", "category"],
      ["Topic", "topic"], ["Requestor", "requestor"], ["Division", "division"], ["Director / Officer / Head", "director"], ["Venue", "venue"],
      ["Participants", "participants"], ["Recommendations", "recommendations"], ["Admin Notes", "adminNotes"], ["Submitted", "createdAt"], ["Booking ID", "id"]];
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.map(c => q(c[0])).join(","), ...rows.map(r => cols.map(c => q(r[c[1]])).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = `bookings-${today}.csv`; a.click();
  }

  // ---------- Blocked dates ----------
  function blocksView(v) {
    const list = blocks.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    v.innerHTML = `
      <div class="panel"><h3>Block a facilitator (leave, holiday, other commitments)</h3>
        <div class="finder">
          <label>Facilitator<select id="blFac">${opts(["All facilitators", ...FACS], "")}</select></label>
          <label>From<input type="date" id="blFrom" value="${st.prefillDate || today}"></label>
          <label>To<input type="date" id="blTo" value="${st.prefillDate || today}"></label>
          <label style="flex:1;min-width:200px">Reason<input type="text" id="blReason" placeholder="e.g. Vacation leave"></label>
          <button class="btn primary" id="blAdd">Add</button>
        </div>
        <div id="blWarn"></div>
      </div>
      <div class="panel" style="padding:0"><table class="tbl"><thead><tr><th>Facilitator</th><th>From</th><th>To</th><th>Reason</th><th></th></tr></thead>
        <tbody>${list.map(x => `<tr><td><span class="dot" style="background:${color(x.facilitator)}"></span>${esc(x.facilitator)}</td>
          <td>${fmtDate(x.startDate)}</td><td>${fmtDate(x.endDate || x.startDate)}</td><td>${esc(x.reason)}</td>
          <td><button class="btn sm danger" data-delblock="${esc(x.id)}">Remove</button></td></tr>`).join("")
          || `<tr><td colspan="5">${empty("No blocked dates.")}</td></tr>`}</tbody></table></div>`;
    st.prefillDate = "";
    $("#blAdd").onclick = async () => {
      const from = $("#blFrom").value, to = $("#blTo").value || from, reason = $("#blReason").value.trim();
      if (!from || to < from) return alert("Please enter a valid date range.");
      const facs = $("#blFac").value === "All facilitators" ? FACS : [$("#blFac").value];
      const affected = bookings.filter(b => active(b) && facs.includes(b.facilitator) && b.trainingDate >= from && b.trainingDate <= to);
      if (affected.length && !confirm(`${affected.length} active booking(s) fall in this range and will be flagged as conflicts. Continue?`)) return;
      for (const f of facs) await S.addBlock({ facilitator: f, startDate: from, endDate: to, reason });
      await reload(); toast("Blocked date added");
    };
  }

  // ---------- Booking detail / edit ----------
  function openBooking(id) {
    const b = bookings.find(x => x.id === id); if (!b) return;
    const answers = b.answers && Object.keys(b.answers).length ? b.answers : {
      "Name of Requestor": b.requestor, "Sales Division": b.division, "Director / Officer / Head": b.director,
      "Training Category": b.category, "Topic": b.topic, "Expected Number of Participants": b.participants,
      "Request or Recommendations for the Training": b.recommendations
    };
    const venueList = VENUES.includes(b.venue) ? VENUES : [b.venue, ...VENUES];
    openModal(`
      <h2>${esc(title(b))}</h2>
      <p class="muted">${esc(b.category)} · requested by ${esc(b.requestor)} · submitted ${b.createdAt ? new Date(b.createdAt).toLocaleString("en-PH") : "—"}
        ${b.updatedAt ? `<br>Last updated ${new Date(b.updatedAt).toLocaleString("en-PH")} by ${esc(b.updatedBy || "admin")}` : ""}</p>
      <h3>Schedule &amp; status</h3>
      <div class="form-grid">
        <label>Status<select id="eStatus">${opts(STATUSES, b.status)}</select></label>
        <label>Training date<input type="date" id="eDate" value="${esc(b.trainingDate)}"></label>
        <label>Facilitator<select id="eFac">${opts(FACS, b.facilitator)}</select></label>
        <label>Time<select id="eTime">${opts(TIMES, b.time)}</select></label>
        <label class="full">Venue<select id="eVenue">${opts(venueList, b.venue)}</select></label>
        <label class="full">Admin notes<textarea id="eNotes" placeholder="Internal notes (not visible to requestor)">${esc(b.adminNotes)}</textarea></label>
      </div>
      <div id="eConflict"></div>
      <h3 style="margin-top:14px">Original submission</h3>
      <table class="kv">${Object.entries(answers).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>
      <div class="modal-actions">
        <button class="btn danger" id="eDelete">Delete</button><span class="spacer"></span>
        <button class="btn" id="eCancel">Close</button><button class="btn primary" id="eSave">Save changes</button>
      </div>`);
    const draft = () => ({ status: $("#eStatus").value, trainingDate: $("#eDate").value, facilitator: $("#eFac").value,
      time: $("#eTime").value, venue: $("#eVenue").value, adminNotes: $("#eNotes").value });
    const showConflicts = () => {
      const c = S.findConflicts(bookings, blocks, draft(), b.id);
      $("#eConflict").innerHTML = c.length ? `<div class="alert">⚠ ${esc(S.conflictMessage(c))}</div>` :
        (S.isActive(draft().status) ? `<div class="alert ok">✔ No scheduling conflicts.</div>` : "");
    };
    ["#eStatus", "#eDate", "#eFac", "#eTime"].forEach(s => ($(s).onchange = showConflicts));
    showConflicts();
    $("#modalBody").onclick = null;
    $("#eCancel").onclick = closeModal;
    $("#eSave").onclick = async () => { if (await saveBooking(b.id, draft())) closeModal(); };
    $("#eDelete").onclick = async () => {
      if (!confirm("Permanently delete this booking?")) return;
      try { await S.remove(b.id); closeModal(); await reload(); toast("Booking deleted"); } catch (e) { alert(e.message); }
    };
  }

  // ---------- modal ----------
  function openModal(html) { $("#modalBody").innerHTML = html; $("#modal").hidden = false; }
  function closeModal() { $("#modal").hidden = true; $("#modalBody").innerHTML = ""; }
  $("#modalClose").onclick = closeModal;
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

  // ---------- sample data (local mode only) ----------
  function seedSample() {
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const divisions = Q.division.choices.map(c => c.label);
    const out = [], bl = [];
    const fac0 = FACS[0];
    const leave = ymd(addDays(new Date(), 6));
    bl.push({ id: "blk-1", facilitator: fac0, startDate: leave, endDate: ymd(addDays(new Date(), 7)), reason: "Vacation leave", createdAt: new Date().toISOString() });
    let tries = 0;
    while (out.length < 28 && tries++ < 500) {
      const d = addDays(new Date(), Math.floor(Math.random() * 60) - 15);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const divIdx = Math.floor(Math.random() * divisions.length);
      const divQ = Q[Q.division.choices[divIdx].goto];
      const catC = pick(Q.category.choices), topicQ = Q[catC.goto];
      const rec = {
        id: "sample-" + out.length, createdAt: new Date().toISOString(), adminNotes: "",
        requestor: pick(["Maria Santos", "Juan Dela Cruz", "Ana Reyes", "Mark Villanueva", "Grace Lim", "Paolo Garcia"]),
        division: divisions[divIdx], director: pick(divQ.choices), category: catC.label, topic: pick(topicQ.choices),
        trainingDate: ymd(d), facilitator: pick(FACS), time: pick(TIMES), venue: pick(VENUES),
        participants: String(10 + Math.floor(Math.random() * 40)), recommendations: "N/A",
        status: ymd(d) < today ? pick(["Completed", "Completed", "Cancelled"]) : pick(["Pending", "Approved", "Approved", "Rejected"])
      };
      if (S.findConflicts(out, bl, rec).length) continue;
      out.push(rec);
    }
    S.replaceLocal(out, bl);
  }

  st.tab = "dashboard";
  await reload();
})();
