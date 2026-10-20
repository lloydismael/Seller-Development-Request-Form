(async function () {
  const S = window.BookingStore;
  const choiceLabel = c => typeof c === "string" ? c : c.label;
  let Q, FACS = [], TIMES = [], CATS = [], VENUES = [], sourceConfig;
  function applyConfig(config) {
    sourceConfig = window.FormSchema.validate(config);
    window.BookingAppearance.apply(sourceConfig.theme);
    Q = sourceConfig.questions;
    const choices = field => Object.values(Q).filter(q => q.field === field).flatMap(q => (q.choices || []).map(choiceLabel));
    FACS = [...new Set(choices("facilitator"))]; TIMES = [...new Set(choices("time"))];
    CATS = [...new Set(choices("category"))]; VENUES = [...new Set(choices("venue"))];
  }
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
    list.map(choiceLabel).map(v => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");
  const historical = (list, value) => value && !list.includes(value) ? [value, ...list] : list;
  const auditWarning = r => { if (r?.auditRecorded === false) {
    const notice = document.createElement("div"); notice.className = "alert"; notice.setAttribute("role", "alert");
    notice.textContent = "Change saved, but activity recording failed. Do not retry the saved change.";
    $("#view").prepend(notice);
  } };

  let bookings = [], blocks = [], mode = "local";
  const st = {
    tab: "dashboard", dashboardSelection: "", month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    calFac: "", calStatus: "active", week: startOfWeek(new Date()),
    q: "", fStatus: "", fCat: "", fFac: "", fConflict: "", fWhen: "upcoming", prefillDate: ""
  };

  const blocksOn = (date, fac) => blocks.filter(x => (!fac || x.facilitator === fac) && date >= x.startDate && date <= (x.endDate || x.startDate));
  const conflictsFor = (b, id = b.id) => window.AdminConflicts.find(bookings, blocks, b, id);
  const hasConflict = b => conflictsFor(b).length > 0;
  const conflictBadges = b => [...new Set(conflictsFor(b).map(c => c.type))].map(type => `<span class="conflict-badge ${type}">⚠ ${esc(window.AdminConflicts.label(type))}</span>`).join(" ");
  const conflictDetails = (b, id = b.id) => conflictsFor(b, id).map(c => `<li><strong>${esc(window.AdminConflicts.label(c.type))}</strong>: ${c.type === "block" ? esc(c.item.reason || "Blocked date") : `${esc(c.item.time)} · ${esc(c.item.requestor || title(c.item))} · ${esc(c.item.status)} <button type="button" class="btn sm" data-conflict-open="${esc(c.item.id)}">View booking</button>`}</li>`).join("");
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
          resolve(r);
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
      if (identity?.role === "facilitator") { render(); return; }
      [bookings, blocks] = await Promise.all([S.list(), S.listBlocks()]);
    } catch (e) {
      if (e.status === 401) { location.reload(); return; }
      $("#view").innerHTML = `<div class="alert">Could not load data: ${esc(e.message)}</div>`;
      return;
    }
    render();
  }
  async function saveBooking(id, patch) {
    const booking = bookings.find(b => b.id === id);
    const next = { ...booking, ...patch };
    const competing = conflictsFor(next, id).filter(c => c.type !== "block" && c.item.status === "Pending");
    if (patch.status === "Approved" && booking?.status !== "Approved" && competing.length && !confirm(`Approve this request while ${competing.length} overlapping pending request(s) exist?\n\n${competing.map(c => `${c.item.requestor || title(c.item)} · ${c.item.time}`).join("\n")}\n\nThose requests remain pending and cannot be approved into this reserved slot without an explicit override.`)) return false;
    let result;
    try { result = await S.update(id, patch); }
    catch (e) {
      if (e.status !== 409 || e.code !== "SLOT_CONFLICT") { alert(e.message); return false; }
      if (!confirm(`Scheduling conflict:\n\n${e.message}\n\nSave anyway?`)) return false;
      try { result = await S.update(id, { ...patch, force: true }); }
      catch (err) { alert(err.message); return false; }
    }
    await reload(); toast("Booking updated"); auditWarning(result); return true;
  }

  // ---------- shell ----------
  const pages = {
    dashboard: ["Dashboard", "A clear view of your training requests and upcoming sessions."],
    calendar: ["Calendar", "Plan ahead with a shared view of training sessions and time off."],
    availability: ["Facilitator availability", "Find the right facilitator and an available time for your session."],
    bookings: ["Bookings", "Review requests, manage schedules and export your booking records."],
    blocks: ["Blocked dates", "Keep availability accurate with leave, holidays and other commitments."],
    csat: ["CSAT / Training", "Complete assigned training, share CSAT links and QR codes, and review responses."],
    facilitators: ["Facilitator accounts", "Create and manage limited-access facilitator logins."],
    profile: ["My profile", "Your account details and security, in one place."],
    builder: ["Form builder", "Shape the booking experience with safe drafts and publishing."],
    activity: ["Activity log", "Follow changes across bookings, accounts and your booking form."],
    settings: ["Settings", "Personalize shared appearance and find your workspace preferences and tools."]
  };
  function closeNavigation(restoreFocus = false) {
    $(".topbar").classList.remove("nav-open");
    $("#navToggle").setAttribute("aria-expanded", "false");
    if (restoreFocus) $("#navToggle").focus();
  }
  $("#navToggle").onclick = () => {
    const open = $("#navToggle").getAttribute("aria-expanded") !== "true";
    $(".topbar").classList.toggle("nav-open", open);
    $("#navToggle").setAttribute("aria-expanded", String(open));
  };
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $(".topbar").classList.contains("nav-open") && $("#modal").hidden) closeNavigation(true);
  });
  let user, identity;
  try {
    mode = await S.mode();
    try { applyConfig(mode === "api" ? (await S.formConfig()).config : window.FORM_CONFIG); }
    catch { /* initialize offers configuration retry after sign-in. */ }
    finally { window.BookingAppearance?.reveal(); }
    identity = await S.me(); user = identity.user;
  }
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
  } finally { window.BookingAppearance?.reveal(); }
  if (!user) { identity = await showLogin(); user = identity.user; }
  if (identity.role === "facilitator") {
    st.tab = "csat";
    document.querySelectorAll(".tab").forEach(button => { button.hidden = !["csat", "profile"].includes(button.dataset.tab); });
  }
  $("#app").hidden = false;
  $("#userName").textContent = identity.profile?.displayName || user;
  $("#modeBadge").textContent = mode === "api" ? "Live API" : "Local storage";
  $("#modeBadge").classList.toggle("local", mode !== "api");
  $("#logoutBtn").onclick = async () => {
    if (!window.SettingsUI.canLeave() || window.FacilitatorUI?.canLeave() === false) return;
    const btn = $("#logoutBtn"); btn.disabled = true;
    try { await S.logout(); location.reload(); }
    catch { toast("Logout failed. Your session may still be active. Please retry."); }
    finally { btn.disabled = false; }
  };
  if (mode === "local") {
    $("#devBar").hidden = false;
    $("#seedBtn").onclick = () => { if (!window.SettingsUI.canLeave()) return; if (confirm("Replace local data with sample bookings?")) { seedSample(); reload(); } };
    $("#clearBtn").onclick = () => { if (confirm("Delete all locally stored bookings and blocked dates?")) { S.replaceLocal([], []); reload(); } };
  }
  document.querySelectorAll(".tab").forEach(b => (b.onclick = () => {
    if (b.dataset.tab === st.tab) { closeNavigation(true); return; }
    if (!window.SettingsUI.canLeave() || window.FacilitatorUI?.canLeave() === false) return;
    st.tab = b.dataset.tab; render(); closeNavigation();
    $("#view").focus();
  }));
  $(".user a").onclick = e => {
    if (!window.SettingsUI.canLeave() || window.FacilitatorUI?.canLeave() === false) { e.preventDefault(); return; }
    window.SettingsUI.deactivate();
    window.FacilitatorUI?.deactivate();
  };

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
      if (confirm("Remove this blocked date?")) {
        try { const r = await S.removeBlock(t.dataset.delblock); await reload(); toast("Blocked date removed"); auditWarning(r); }
        catch (err) { toast(err.message); }
      }
    }
  });

  function accessibleActions(root) {
    root.querySelectorAll("[data-open],[data-day]").forEach(el => {
      el.tabIndex = 0;
      if (el.tagName === "DIV") el.setAttribute("role", "button");
      el.setAttribute("aria-label", el.dataset.day ? `View ${fmtDate(el.dataset.day)}` : `View booking: ${el.title || el.textContent.trim()}`);
    });
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (!e.target.matches("[data-open],[data-day]")) return;
    e.preventDefault(); e.target.click();
  });
  function render() {
    if (identity?.role === "facilitator" && !["csat", "profile"].includes(st.tab)) st.tab = "csat";
    window.CsatUI?.deactivate();
    const [pageTitle, description] = pages[st.tab];
    $("#pageTitle").textContent = pageTitle;
    $("#pageDescription").textContent = description;
    document.querySelectorAll(".tab").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === st.tab);
      if (b.dataset.tab === st.tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    const v = $("#view");
    if (["csat", "facilitators"].includes(st.tab)) {
      window.SettingsUI.deactivate();
      window.CsatUI.render(st.tab, v, { S, identity, labels:FACS });
      return;
    }
    if (["profile", "builder", "activity", "settings"].includes(st.tab)) {
      window.SettingsUI.render(st.tab, v, { S, toast, mode, config:sourceConfig, navigate: tab => document.querySelector(`[data-tab="${tab}"]`).click(), onPublished: result => applyConfig(result.config),
        onProfile: account => { $("#userName").textContent = account.profile?.displayName || account.user; } });
      return;
    }
    window.SettingsUI.deactivate();
    if (!Q) { initialize(); return; }
    ({ dashboard, calendar, availability, bookings: bookingsView, blocks: blocksView })[st.tab](v);
    accessibleActions(v);
  }

  // ---------- shared fragments ----------
  function rowHtml(b, quick) {
    const d = b.trainingDate ? parse(b.trainingDate) : null;
    return `<div class="row" data-open="${esc(b.id)}">
      <div class="dbadge"><small>${d ? d.toLocaleDateString("en-PH", { month: "short" }) : ""}</small><b>${d ? d.getDate() : "?"}</b></div>
      <div class="main"><div class="t">${hasConflict(b) ? '<span class="warnicon" title="Conflict">⚠ </span>' : ""}${esc(title(b))}</div>
        <div class="s">${esc(b.time)} · <span class="dot" style="background:${color(b.facilitator)}"></span> ${esc(b.facilitator)} · ${esc(b.requestor)} (${esc(b.division)})</div></div>
      <span class="pill ${esc(b.status)}">${esc(b.status)}</span>${conflictBadges(b)}
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
    <span><i class="legend-blocked"></i>Blocked</span><span><i class="legend-pending"></i><em>Pending (dashed)</em></span></div>`;

  // ---------- Dashboard ----------
  function dashboard(v) {
    const act = bookings.filter(active);
    const upcoming = act.filter(b => b.trainingDate >= today).sort(byDate);
    const pending = bookings.filter(b => b.status === "Pending").sort(byDate);
    const in14 = ymd(addDays(new Date(), 14));
    const next14 = upcoming.filter(b => b.trainingDate <= in14);
    const thisMonth = act.filter(b => (b.trainingDate || "").startsWith(today.slice(0, 7)));
    const conflicts = bookings.filter(hasConflict);
    const competingCount = conflicts.filter(b => conflictsFor(b).some(c => c.type === "competing")).length;
    const confirmedCount = conflicts.filter(b => conflictsFor(b).some(c => ["reserved", "confirmed"].includes(c.type))).length;
    const groups = window.AdminConflicts.groups(bookings, blocks).sort((a, b) => a.date.localeCompare(b.date));
    const selections = {
      total: { label:"Total requests", items:bookings },
      pending: { label:"Pending approval", items:pending, tone:"warn" },
      upcoming: { label:"Upcoming sessions", items:upcoming },
      month: { label:"Sessions this month", items:thisMonth },
      conflicts: { label:"Conflicts", items:conflicts, tone:conflicts.length ? "bad" : "" }
    };
    v.innerHTML = `
      <div class="stats dashboard-tiles" role="group" aria-label="Filter dashboard bookings">${Object.entries(selections).map(([key, selection]) => `<button type="button" class="stat dashboard-tile ${selection.tone || ""}" data-dashboard-tile="${key}" aria-pressed="false" aria-controls="dashboardResults"><span class="n">${selection.items.length}</span><span class="l">${esc(selection.label)}</span><span class="tile-selected-mark" aria-hidden="true">✓ Selected</span></button>`).join("")}</div>
      <p id="dashboardSelectionStatus" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
      <section id="dashboardResults" class="panel dashboard-results" aria-labelledby="dashboardResultsTitle" hidden></section>
      <p class="muted">${competingCount} bookings in competing pending requests · ${confirmedCount} bookings overlapping confirmed reservations. Counts show unique affected bookings; categories may overlap.</p>
      <div class="grid2">
        <div class="panel"><h3>Pending approval</h3>${pending.length ? pending.slice(0, 10).map(b => rowHtml(b, true)).join("") : empty("No pending requests.")}</div>
        <div class="panel"><h3>Next 14 days</h3>${next14.length ? next14.map(b => rowHtml(b)).join("") : empty("Nothing scheduled in the next 14 days.")}</div>
        <div class="panel"><h3>Upcoming sessions by facilitator</h3>${bars(FACS.map(f => [f, upcoming.filter(b => b.facilitator === f).length]), color)}</div>
        <div class="panel"><h3>Requests by training category</h3>${bars(CATS.map(c => [c, bookings.filter(b => b.category === c).length]))}</div>
      </div>
      ${conflicts.length ? `<section class="panel"><h3>⚠ Conflicts to resolve</h3><p class="muted">Pending overlaps need review but do not reserve slots. Confirmed overlaps prevent normal approval.</p>${groups.map(group => `<section class="conflict-group"><h4>${esc(group.facilitator)} · ${fmtDate(group.date)}</h4>${group.items.sort(byDate).map(b => `<div class="conflict-item">${rowHtml(b)}<button type="button" class="btn sm" data-open="${esc(b.id)}" aria-label="View booking for ${esc(b.requestor || title(b))}">View booking</button></div>`).join("")}</section>`).join("")}</section>` : ""}`;
    function updateSelection() {
      const selection = selections[st.dashboardSelection];
      v.querySelectorAll("[data-dashboard-tile]").forEach(button => {
        const selected = button.dataset.dashboardTile === st.dashboardSelection;
        button.setAttribute("aria-pressed", String(selected));
        button.classList.toggle("selected", selected);
      });
      const result = v.querySelector("#dashboardResults");
      result.hidden = !selection;
      if (!selection) {
        result.innerHTML = "";
        v.querySelector("#dashboardSelectionStatus").textContent = "Selection cleared. Dashboard overview shown.";
        return;
      }
      const selectedRows = [...selection.items].sort(byDate);
      const content = st.dashboardSelection === "conflicts"
        ? groups.map(group => `<section class="conflict-group"><h4>${esc(group.facilitator)} · ${fmtDate(group.date)}</h4>${group.items.map(b => rowHtml(b)).join("")}</section>`).join("")
        : selectedRows.map(b => rowHtml(b, st.dashboardSelection === "pending")).join("");
      result.innerHTML = `<div class="toolbar"><h3 id="dashboardResultsTitle">${esc(selection.label)} · ${selection.items.length} booking${selection.items.length === 1 ? "" : "s"}</h3><span class="spacer"></span><button type="button" class="btn ghost" id="clearDashboardSelection">Clear selection</button></div>${content || empty("No bookings in this category.")}`;
      result.querySelectorAll("[data-open]").forEach(row => row.classList.add("dashboard-match"));
      accessibleActions(result);
      v.querySelector("#dashboardSelectionStatus").textContent = `${selection.label}: ${selection.items.length} matching bookings highlighted.`;
      result.querySelector("#clearDashboardSelection").onclick = () => {
        const key = st.dashboardSelection;
        st.dashboardSelection = "";
        updateSelection();
        v.querySelector(`[data-dashboard-tile="${key}"]`).focus();
      };
    }
    v.querySelectorAll("[data-dashboard-tile]").forEach(button => {
      button.onclick = () => {
        st.dashboardSelection = st.dashboardSelection === button.dataset.dashboardTile ? "" : button.dataset.dashboardTile;
        updateSelection();
      };
    });
    updateSelection();
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
        <button class="btn" data-nav="-1" aria-label="Previous month">‹</button><button class="btn" data-nav="0">Today</button><button class="btn" data-nav="1" aria-label="Next month">›</button>
        <h2>${m.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</h2><span class="spacer"></span>
        <select id="calFac" aria-label="Filter calendar by facilitator">${opts(FACS, st.calFac, "All facilitators")}</select>
        <select id="calStatus" aria-label="Filter calendar by status">
          <option value="active" ${st.calStatus === "active" ? "selected" : ""}>Active (Pending/Approved/Completed)</option>
          <option value="all" ${st.calStatus === "all" ? "selected" : ""}>All statuses</option>
          ${STATUSES.map(s => `<option ${st.calStatus === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      ${legend()}
      <div class="cal-scroll"><div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => `<div class="dow">${d}</div>`).join("")}${cells}</div></div>
      <p class="muted small">Click a booking to view/edit it. Click a day to see all bookings and facilitator availability for that date.</p>`;
    $("#calFac").onchange = e => { st.calFac = e.target.value; render(); };
    $("#calStatus").onchange = e => { st.calStatus = e.target.value; render(); };
  }

  function daySlotTable(ds) {
    return `<table class="slotgrid"><thead><tr><th>Facilitator</th>${TIMES.map(t => `<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>
      ${FACS.map(f => `<tr><td class="fac"><span class="dot" style="background:${color(f)}"></span>${esc(f)}</td>
        ${TIMES.map(t => { const s = slotState(f, ds, S.slotRange(t)); return `<td class="s-${s.s}" title="${esc(s.tip)}">${s.label}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table>`;
  }

  function openDay(ds) {
    const items = bookings.filter(b => b.trainingDate === ds).sort(byDate);
    openModal(`<h2>${fmtDate(ds)}</h2>
      <h3 class="section-heading">Bookings (${items.length})</h3>
      ${items.length ? items.map(b => rowHtml(b, true)).join("") : empty("No bookings on this date.")}
      <h3 class="section-heading">Facilitator availability</h3><div class="slot-table-scroll">${daySlotTable(ds)}</div>
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
        <button class="btn" data-wnav="-1" aria-label="Previous week">‹</button><button class="btn" data-wnav="0">This week</button><button class="btn" data-wnav="1" aria-label="Next week">›</button>
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
      (!st.fConflict || hasConflict(b)) &&
      (st.fWhen === "all" || (st.fWhen === "upcoming" ? b.trainingDate >= today : b.trainingDate < today)) &&
      (!q || [b.requestor, b.division, b.director, b.category, b.topic, b.facilitator, b.venue, b.time, b.trainingDate, b.status]
        .some(x => String(x || "").toLowerCase().includes(q)))
    ).sort((a, b) => (st.fWhen === "past" ? -1 : 1) * byDate(a, b));
  }
  function bookingsView(v) {
    v.innerHTML = `
      <div class="toolbar">
        <input type="search" id="bq" class="search-control" aria-label="Search bookings" placeholder="Search requestor, topic, venue…" value="${esc(st.q)}">
        <select id="bWhen" aria-label="Filter by date range"><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All dates</option></select>
        <select id="bStatus" aria-label="Filter by status">${opts(STATUSES, st.fStatus, "All statuses")}</select>
        <select id="bCat" aria-label="Filter by category">${opts(CATS, st.fCat, "All categories")}</select>
        <select id="bFac" aria-label="Filter by facilitator">${opts(FACS, st.fFac, "All facilitators")}</select>
        <select id="bConflict" aria-label="Filter by conflict"><option value="">All bookings</option><option value="conflicts" ${st.fConflict ? "selected" : ""}>Conflicts only</option></select>
        <span class="spacer"></span><button class="btn" id="bExport">Export CSV</button>
      </div>
      <div class="panel table-panel"><div id="bTable"></div></div>`;
    $("#bWhen").value = st.fWhen;
    const bind = (id, key) => ($(id).oninput = e => { st[key] = e.target.value; table(); });
    bind("#bq", "q"); bind("#bWhen", "fWhen"); bind("#bStatus", "fStatus"); bind("#bCat", "fCat"); bind("#bFac", "fFac"); bind("#bConflict", "fConflict");
    $("#bExport").onclick = () => exportCsv(filtered());
    table();
  }
  function table() {
    const rows = filtered();
    $("#bTable").innerHTML = `<div class="table-count count">${rows.length} booking${rows.length === 1 ? "" : "s"}</div>
      <table class="tbl"><thead><tr><th>Date</th><th>Time</th><th>Facilitator</th><th>Category / Topic</th><th>Requestor</th><th>Venue</th><th>Pax</th><th>Status</th></tr></thead>
      <tbody>${rows.map(b => `<tr data-open="${esc(b.id)}">
        <td>${hasConflict(b) ? '<span class="warnicon" title="Conflict">⚠ </span>' : ""}${fmtDate(b.trainingDate)}</td><td>${esc(b.time)}</td>
        <td><span class="dot" style="background:${color(b.facilitator)}"></span>${esc(b.facilitator)}</td>
        <td><b>${esc(b.category)}</b><br><span class="muted">${esc(b.topic)}</span></td>
        <td>${esc(b.requestor)}<br><span class="muted">${esc(b.division)}${b.director ? " · " + esc(b.director) : ""}</span></td>
        <td>${esc(b.venue)}</td><td>${esc(b.participants)}</td><td><span class="pill ${esc(b.status)}">${esc(b.status)}</span><div class="conflict-badges">${conflictBadges(b)}</div></td></tr>`).join("")
        || `<tr><td colspan="8">${empty("No bookings match the filters.")}</td></tr>`}</tbody></table>`;
    accessibleActions($("#bTable"));
  }
  function exportCsv(rows) {
    if (!rows.length) return alert("Nothing to export.");
    const cols = [["Status", "status"], ["Training Date", "trainingDate"], ["Time", "time"], ["Facilitator", "facilitator"], ["Category", "category"],
      ["Topic", "topic"], ["Requestor", "requestor"], ["Division", "division"], ["Director / Officer / Head", "director"], ["Venue", "venue"],
      ["Participants", "participants"], ["Recommendations", "recommendations"], ["Admin Notes", "adminNotes"], ["Submitted", "createdAt"], ["Booking ID", "id"],
      ["Form version", "formVersion"], ["Custom answers JSON", "customAnswers"]];
    const q = v => { let text = String(v ?? ""); if (/^[\s\u0000-\u001f]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text; return `"${text.replace(/"/g, '""')}"`; };
    rows = rows.map(r => ({ ...r, customAnswers: JSON.stringify(Array.isArray(r.answerSnapshot) ? r.answerSnapshot : r.answers || {}) }));
    const csv = [cols.map(c => q(c[0])).join(","), ...rows.map(r => cols.map(c => q(r[c[1]])).join(","))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" }));
    a.download = `bookings-${today}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
          <label class="reason-control">Reason<input type="text" id="blReason" placeholder="e.g. Vacation leave"></label>
          <button class="btn primary" id="blAdd">Add</button>
        </div>
        <div id="blWarn"></div>
      </div>
      <div class="panel table-panel"><table class="tbl"><thead><tr><th>Facilitator</th><th>From</th><th>To</th><th>Reason</th><th></th></tr></thead>
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
      let auditFailed = false;
      const btn = $("#blAdd"); btn.disabled = true;
      try {
        for (const f of facs) { const r = await S.addBlock({ facilitator: f, startDate: from, endDate: to, reason }); auditFailed ||= r?.auditRecorded === false; }
        await reload(); toast("Blocked date added"); if (auditFailed) auditWarning({ auditRecorded:false });
      } catch (err) { toast("Could not finish adding blocked dates. Review the list before retrying: " + err.message); await reload(); if (auditFailed) auditWarning({ auditRecorded:false }); }
      finally { btn.disabled = false; }
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
    const answerRows = Array.isArray(b.answerSnapshot) ? b.answerSnapshot.map(a => [a.title, a.value, a.id]) : Object.entries(answers);
    const answerText = value => Array.isArray(value) ? value.join("; ") : typeof value === "object" && value !== null ? JSON.stringify(value) : value;
    const venueList = historical(VENUES, b.venue);
    openModal(`
      <h2>${esc(title(b))}</h2>
      <p class="muted">${esc(b.category)} · requested by ${esc(b.requestor)} · submitted ${b.createdAt ? new Date(b.createdAt).toLocaleString("en-PH") : "—"}
        ${b.updatedAt ? `<br>Last updated ${new Date(b.updatedAt).toLocaleString("en-PH")} by ${esc(b.updatedBy || "admin")}` : ""}</p>
      <h3>Schedule &amp; status</h3>
      <div class="form-grid">
        <label>Status<select id="eStatus">${opts(STATUSES, b.status)}</select></label>
        <label>Training date<input type="date" id="eDate" value="${esc(b.trainingDate)}"></label>
        <label>Facilitator<select id="eFac">${opts(historical(FACS, b.facilitator), b.facilitator)}</select></label>
        <label>Time<select id="eTime">${opts(historical(TIMES, b.time), b.time)}</select></label>
        <label class="full">Venue<select id="eVenue">${opts(venueList, b.venue)}</select></label>
        <label class="full">Admin notes<textarea id="eNotes" placeholder="Internal notes (not visible to requestor)">${esc(b.adminNotes)}</textarea></label>
      </div>
      <div id="eConflict"></div>
      <h3 class="section-heading">Original submission</h3>
      ${b.formVersion ? `<p class="muted small">Form version: ${esc(b.formVersion)}</p>` : ""}
      <table class="kv">${answerRows.map(([k, v, key]) => `<tr><th>${esc(k)}${key ? `<small class="answer-id">${esc(key)}</small>` : ""}</th><td>${esc(answerText(v))}</td></tr>`).join("")}</table>
      <div class="modal-actions">
        <button class="btn danger" id="eDelete">Delete</button><span class="spacer"></span>
        <button class="btn" id="eCancel">Close</button><button class="btn primary" id="eSave">Save changes</button>
      </div>`);
    const draft = () => ({ status: $("#eStatus").value, trainingDate: $("#eDate").value, facilitator: $("#eFac").value,
      time: $("#eTime").value, venue: $("#eVenue").value, adminNotes: $("#eNotes").value });
    const showConflicts = () => {
      const c = conflictsFor(draft(), b.id);
      $("#eConflict").innerHTML = c.length ? `<div class="alert"><strong>⚠ Schedule conflicts</strong><ul class="conflict-details">${conflictDetails(draft(), b.id)}</ul><p>Competing pending requests do not reserve time. Review them before approval.</p></div>` :
        (S.isActive(draft().status) ? `<div class="alert ok">✔ No scheduling conflicts.</div>` : "");
    };
    ["#eStatus", "#eDate", "#eFac", "#eTime"].forEach(s => ($(s).onchange = showConflicts));
    showConflicts();
    $("#modalBody").onclick = e => {
      const button = e.target.closest("[data-conflict-open]");
      if (!button) return;
      if (JSON.stringify(draft()) !== JSON.stringify({ status:b.status, trainingDate:b.trainingDate, facilitator:b.facilitator, time:b.time, venue:b.venue, adminNotes:b.adminNotes || "" }) && !confirm("Discard unsaved booking edits and view the conflicting booking?")) return;
      openBooking(button.dataset.conflictOpen);
    };
    $("#eCancel").onclick = closeModal;
    $("#eSave").onclick = async () => { if (await saveBooking(b.id, draft())) closeModal(); };
    $("#eDelete").onclick = async () => {
      if (!confirm("Permanently delete this booking?")) return;
      try { const r = await S.remove(b.id); closeModal(); await reload(); toast("Booking deleted"); auditWarning(r); } catch (e) { alert(e.message); }
    };
  }

  // ---------- modal ----------
  let modalReturnFocus;
  function openModal(html) {
    if ($("#modal").hidden) modalReturnFocus = document.activeElement;
    $("#modalBody").innerHTML = html;
    accessibleActions($("#modalBody"));
    const heading = $("#modalBody h2");
    if (heading) { heading.id = "modalTitle"; $(".modal-box").setAttribute("aria-labelledby", "modalTitle"); }
    else $(".modal-box").removeAttribute("aria-labelledby");
    $("#modal").hidden = false;
    $("#app").inert = true; $("#themeToggle").inert = true;
    $("#modalClose").focus();
  }
  function closeModal() {
    $("#modal").hidden = true; $("#modalBody").innerHTML = "";
    $("#app").inert = false; $("#themeToggle").inert = false;
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
    else $("#view").focus();
  }
  $("#modalClose").onclick = closeModal;
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });
  document.addEventListener("keydown", e => {
    if ($("#modal").hidden) return;
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const controls = [...$(".modal-box").querySelectorAll('button, input:not([type="hidden"]), select, textarea, a[href], [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---------- sample data (local mode only) ----------
  function seedSample() {
    if (JSON.stringify(sourceConfig) !== JSON.stringify(window.FormSchema.validate(window.FORM_CONFIG))) {
      toast("Sample data is available only with the original form schema."); return;
    }
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const divisions = Q.division.choices.map(choiceLabel);
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
        division: divisions[divIdx], director: choiceLabel(pick(divQ.choices)), category: choiceLabel(catC), topic: choiceLabel(pick(topicQ.choices)),
        trainingDate: ymd(d), facilitator: pick(FACS), time: pick(TIMES), venue: pick(VENUES),
        participants: String(10 + Math.floor(Math.random() * 40)), recommendations: "N/A",
        status: ymd(d) < today ? pick(["Completed", "Completed", "Cancelled"]) : pick(["Pending", "Approved", "Approved", "Rejected"])
      };
      if (S.findConflicts(out, bl, rec).length) continue;
      out.push(rec);
    }
    S.replaceLocal(out, bl);
  }

  async function initialize() {
    try {
      if (!sourceConfig) applyConfig(mode === "api" ? (await S.formConfig()).config : window.FORM_CONFIG);
      await reload();
    } catch (err) {
      $("#view").innerHTML = `<div class="alert" role="alert">Could not load form configuration: ${esc(err.message)}. No default configuration was substituted.</div><button class="btn" id="retryConfig">Retry configuration</button>`;
      $("#retryConfig").onclick = initialize;
    }
  }
  await initialize();
})();
