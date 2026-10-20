(function () {
  const M = window.ReportingModel;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
  const number = value => new Intl.NumberFormat("en-PH", { maximumFractionDigits:1 }).format(value);
  const percent = value => value === null ? "—" : `${number(value)}%`;
  const state = { filters:{}, sort:"trainingDate", direction:1, page:0, csat:null, csatMessage:"", loading:false, updated:null };
  let generation = 0;
  const fields = { status:"Status", facilitator:"Facilitator", category:"Category", division:"Sales division" };
  const dimensions = { category:"Training categories", topic:"Training topics", division:"Sales divisions", director:"Directors / officers / heads", facilitator:"Facilitator workload", venue:"Training venues" };
  const columns = [["Training date", "trainingDate"], ["Status", "status"], ["Topic", "topic"], ["Facilitator", "facilitator"], ["Requestor", "requestor"], ["Division", "division"]];
  const exportColumns = [["ID", "id"], ...columns, ["Time", "time"], ["Category", "category"], ["Director / Officer / Head", "director"], ["Venue", "venue"], ["Participants", "participants"], ["Created", "createdAt"], ["Updated", "updatedAt"], ["Admin notes", "adminNotes"], ["Recorded answers", "answerSnapshot"]];
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type:"text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function dataTable(items, caption, total) {
    return `<details class="report-data"><summary>View all values (${items.length})</summary><div class="report-scroll" tabindex="0" role="region" aria-label="${esc(caption)} data"><table><caption>${esc(caption)}</caption><thead><tr><th scope="col">Group</th><th scope="col">Bookings</th><th scope="col">Share</th></tr></thead><tbody>${items.map(item => `<tr><th scope="row">${esc(item.name)}</th><td>${number(item.count)}</td><td>${percent(total ? item.count / total * 100 : null)}</td></tr>`).join("")}</tbody></table></div></details>`;
  }
  function bars(items, caption, total, kind = "") {
    const maximum = Math.max(1, ...items.map(item => item.count));
    const visible = items.slice(0, 8);
    return `<section class="report-card ${kind}"><header><h2>${esc(caption)}</h2><p>${items.length > 8 ? `Top 8 of ${items.length} groups; all values below.` : "Booking count and share of filtered records."}</p></header>${total ? `<ol class="report-bars">${visible.map(item => `<li class="${kind === 'report-status' && M.statuses.includes(item.name) ? `report-status-${item.name.toLowerCase()}` : ''}"><div class="report-bar-label"><span>${esc(item.name)}</span><strong>${number(item.count)} <small>${percent(item.count / total * 100)}</small></strong></div><div class="report-track" aria-hidden="true"><div class="report-fill" style="width:${item.count / maximum * 100}%"></div></div></li>`).join("")}</ol>${dataTable(items, caption, total)}` : '<p class="report-empty">No bookings to compare in this selection.</p>'}</section>`;
  }
  function trend(items, total) {
    let chartItems = items;
    let yearly = false;
    if (items.length > 24) {
      yearly = true; const years = new Map();
      items.forEach(item => years.set(item.name.slice(0, 4), (years.get(item.name.slice(0, 4)) || 0) + item.count));
      chartItems = [...years].map(([name, count]) => ({ name, count }));
    }
    const max = Math.max(1, ...chartItems.map(item => item.count));
    const points = chartItems.map((item, index) => ({ ...item, x:48 + index / Math.max(1, chartItems.length - 1) * 660, y:180 - item.count / max * 140 }));
    const line = points.map(point => `${point.x},${point.y}`).join(" ");
    return `<section class="report-card report-trend"><header><h2>Bookings over time</h2><p>${yearly ? "Yearly totals · periods over 24 months" : "Monthly totals · months without bookings shown as zero"}</p></header>${items.length ? `<svg class="report-line-chart" viewBox="0 0 740 230" role="img" aria-label="${esc(`Booking volume across ${chartItems.length} ${yearly ? "years" : "months"}. Exact values in the table below.`)}"><title>Training booking volume</title>${[0, .5, 1].map(fraction => `<line x1="48" x2="708" y1="${180 - fraction * 140}" y2="${180 - fraction * 140}" class="report-gridline"/><text x="35" y="${184 - fraction * 140}" text-anchor="end">${number(max * fraction)}</text>`).join("")}<polygon points="48,180 ${line} ${points[points.length - 1].x},180" class="report-area"/><polyline points="${line}" class="report-line"/>${points.map((point, index) => `<circle cx="${point.x}" cy="${point.y}" r="4" class="report-point"><title>${esc(point.name)}: ${point.count} bookings</title></circle>${index === 0 || index === points.length - 1 || (points.length <= 12 && index % 2 === 0) ? `<text x="${point.x}" y="211" text-anchor="middle">${esc(point.name)}</text>` : ""}`).join("")}</svg>${dataTable(items, "Monthly booking volume", total)}` : '<p class="report-empty">No dated bookings to visualize.</p>'}</section>`;
  }
  function render(view, ctx) {
    deactivate();
    if (ctx.identity?.role === "facilitator") return;
    state.updated = ctx.snapshot || state.updated || new Date().toISOString();
    state.csat = null; state.csatMessage = "";
    const id = generation;
    const live = () => generation === id && view.isConnected;
    view.classList.add("reporting-view");
    const report = M.summarize(ctx.bookings, ctx.blocks, state.filters);
    const choices = key => [...new Set(ctx.bookings.map(row => M.label(row[key])))].sort();
    const filterText = Object.entries(state.filters).filter(([, value]) => value).map(([key, value]) => `${fields[key] || ({ from:"From", to:"To", q:"Search" })[key]}: ${value}`).join(" · ") || "All dates · All bookings";
    view.innerHTML = `<section class="report-banner"><div><p class="eyebrow">Training report</p><h2>Performance at a glance</h2><p>A clear picture of requests, delivery and team demand.</p></div><div class="report-actions"><button type="button" class="btn ghost" id="reportRefresh">Refresh data</button><button type="button" class="btn" id="reportPrint">Print / Save PDF</button><button type="button" class="btn primary" id="reportSummary">Export summary CSV</button></div></section>
      <nav class="report-navigation" aria-label="Report sections"><a href="#reportOverview">Overview</a><a href="#reportDemand">Training demand</a><a href="#reportFeedback">Feedback</a><a href="#reportDetails">Records</a></nav>
      <section class="report-card report-filter-card" aria-labelledby="reportFilterTitle"><header><h2 id="reportFilterTitle">Choose your report</h2><p>Filter by training date. Charts, records and exports use the same selection.</p></header><form id="reportFilters" class="report-filters"><label>From<input type="date" name="from" value="${esc(state.filters.from)}"></label><label>To<input type="date" name="to" value="${esc(state.filters.to)}"></label>${Object.entries(fields).map(([key, title]) => `<label>${title}<select name="${key}"><option value="">${({ status:"All statuses", facilitator:"All facilitators", category:"All categories", division:"All sales divisions" })[key]}</option>${choices(key).map(value => `<option value="${esc(value)}" ${state.filters[key] === value ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>`).join("")}<label class="report-search">Search records<input type="search" name="q" placeholder="Topic, requestor, venue or booking ID" value="${esc(state.filters.q)}"></label><div class="report-filter-actions"><button class="btn primary" type="submit">Apply filters</button><button class="btn ghost" type="button" id="reportReset">Reset</button></div></form><p id="reportFilterError" class="alert" role="alert" hidden></p></section>
      <div class="report-meta"><p role="status" id="reportCount">${number(report.rows.length)} of ${number(ctx.bookings.length)} bookings · ${esc(filterText)}</p><p>Snapshot: ${esc(new Date(state.updated).toLocaleString("en-PH"))}</p></div>
      <section id="reportOverview" class="report-kpis" aria-label="Report key metrics">${[
        ["Total bookings", number(report.rows.length), "All matching request statuses"],
        ["Completed", number(report.completed), `${percent(report.completionRate)} of matching bookings`],
        ["Pending review", number(report.pending), "Requests awaiting a decision"],
        ["Reserved training hours", number(report.hours), "Approved + Completed · valid time slots"],
        ["Related blocked ranges", number(report.blocks.length), "Intersecting dates · not unavailable-day totals"]
      ].map(([title, value, note], index) => `<article class="report-kpi report-kpi-${index}"><div class="report-kpi-heading"><h2>${title}</h2><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${['M5 4h14v16H5zM9 8h6M9 12h6M9 16h3', 'm5 12 4 4L19 6', 'M12 8v4l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M4 5h16v15H4zM8 3v4m8-4v4M4 10h16', 'M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18'][index]}"/></svg></div><strong>${value}</strong><p>${note}</p></article>`).join("")}</section>
      ${report.rows.length ? `<aside class="report-insight" aria-label="Report highlights"><span class="report-insight-label">In this report</span><p><strong>${number(report.pending)}</strong> requests await review. <strong>${esc(report.breakdowns.topic[0]?.name || 'Not recorded')}</strong> is the most requested topic (${number(report.breakdowns.topic[0]?.count || 0)} bookings). <strong>${percent(report.completionRate)}</strong> of bookings are completed.</p></aside>` : ""}
      ${!report.rows.length ? '<p class="account-notice">No bookings match these filters. Try a wider date range or reset filters.</p>' : ""}
      ${report.missingDates ? `<p class="account-notice">${report.missingDates} booking(s) have no valid training date and are excluded from the trend chart. Setting a date range excludes these records from the report.</p>` : ""}
      <div class="report-grid report-overview-grid">${trend(report.trend, report.rows.length)}${bars(report.status, "Booking status", report.rows.length, "report-status")}</div>
      <section id="reportDemand" class="report-section" aria-labelledby="reportDemandTitle"><div class="report-section-title"><div><p class="eyebrow">Demand & workload</p><h2 id="reportDemandTitle">Where training is needed</h2><p>Compare topics and the teams delivering them.</p></div><span class="report-section-tag">${number(report.rows.length)} bookings</span></div><div class="report-grid">${['topic', 'facilitator'].map(key => bars(report.breakdowns[key], dimensions[key], report.rows.length)).join("")}</div><details class="report-breakdowns"><summary>Explore categories, divisions, leaders and venues <span>4 breakdowns</span></summary><div class="report-grid">${['category', 'division', 'director', 'venue'].map(key => bars(report.breakdowns[key], dimensions[key], report.rows.length)).join("")}</div></details></section>
      <section id="reportFeedback" class="report-card" aria-labelledby="reportCsatTitle"><header class="report-section-heading"><div><h2 id="reportCsatTitle">Training feedback / CSAT</h2><p>Phone Videography only · follows the filtered bookings’ training dates, not response submission dates.</p></div><button type="button" class="btn" id="reportLoadCsat" ${state.loading || ctx.mode !== "api" ? "disabled" : ""}>${state.loading ? "Loading feedback…" : "Load / refresh CSAT"}</button></header><div id="reportCsat" aria-live="polite">${csatMarkup(ctx.mode)}</div></section>
      <section id="reportDetails" class="report-card"><header class="report-section-heading"><div><h2>Booking records</h2><p>Sortable records for reconciliation. CSV includes every matching booking, not just this page.</p></div><button type="button" class="btn" id="reportExport" ${report.rows.length ? "" : "disabled"}>Export booking CSV</button></header><div id="reportRecords"></div></section>
      <section class="report-card"><header><h2>Related blocked-date ranges</h2><p>Ranges overlapping the date selection. Category, division, status and search filters limit this list to facilitators in matching bookings.</p></header>${report.blocks.length ? `<div class="report-scroll" tabindex="0" role="region" aria-label="Blocked date report"><table><caption>Related blocked dates (${report.blocks.length} ranges)</caption><thead><tr><th scope="col">Facilitator</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Reason</th></tr></thead><tbody>${report.blocks.map(block => `<tr><th scope="row">${esc(M.label(block.facilitator))}</th><td>${esc(block.startDate)}</td><td>${esc(block.endDate || block.startDate)}</td><td>${esc(block.reason || "Not recorded")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="report-empty">No related blocked ranges.</p>'}</section>
      <footer class="report-footnote">Reporting is read-only. Completion rate = Completed ÷ all filtered bookings. Reserved hours are summed per booking (overrides may overlap), not unique capacity or attendance. Missing group values are “Not recorded”. CSAT counts submissions, not unique attendees; shared links allow repeat responses. Accounts, activity and form configuration remain in their dedicated workspaces.</footer>`;
    function refreshCsat() {
      if (!live()) return;
      view.querySelector("#reportCsat").innerHTML = csatMarkup(ctx.mode);
      const button = view.querySelector("#reportLoadCsat"); button.disabled = state.loading || ctx.mode !== "api";
      button.textContent = state.loading ? "Loading feedback…" : "Load / refresh CSAT";
    }
    function drawRecords() {
      const sorted = [...report.rows].sort((a, b) => M.label(a[state.sort]).localeCompare(M.label(b[state.sort])) * state.direction || M.label(a.id).localeCompare(M.label(b.id)));
      const pages = Math.max(1, Math.ceil(sorted.length / 25)); state.page = Math.min(state.page, pages - 1);
      const rows = sorted.slice(state.page * 25, state.page * 25 + 25);
      view.querySelector("#reportRecords").innerHTML = `${rows.length ? `<div class="report-scroll" tabindex="0" role="region" aria-label="Booking report records"><table class="report-record-table"><caption>Filtered booking records · page ${state.page + 1} of ${pages}</caption><thead><tr>${columns.map(([title, key]) => `<th scope="col" aria-sort="${state.sort === key ? (state.direction === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-report-sort="${key}">${title}${state.sort === key ? (state.direction === 1 ? " ↑" : " ↓") : ""}</button></th>`).join("")}<th scope="col">Details</th></tr></thead><tbody>${rows.map(row => `<tr>${columns.map(([, key]) => `<td>${key === "status" ? `<span class="pill ${M.statuses.includes(row.status) ? esc(row.status) : ""}">${esc(M.label(row.status))}</span>` : esc(M.label(row[key]))}</td>`).join("")}<td><button type="button" class="btn sm" data-report-open="${esc(row.id)}" aria-label="View booking ${esc(row.id)}">View</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="report-empty">No matching records.</p>'}<div class="report-pagination"><p role="status">${rows.length ? `${state.page * 25 + 1}–${state.page * 25 + rows.length}` : "0"} of ${sorted.length} records · page ${state.page + 1} of ${pages}</p><button type="button" class="btn ghost" id="reportPrev" ${state.page === 0 ? "disabled" : ""}>Previous</button><button type="button" class="btn ghost" id="reportNext" ${state.page >= pages - 1 ? "disabled" : ""}>Next</button></div>`;
      view.querySelectorAll("[data-report-sort]").forEach(button => { button.onclick = () => {
        const key = button.dataset.reportSort; state.direction = state.sort === key ? -state.direction : 1; state.sort = key; state.page = 0; drawRecords();
        view.querySelector(`[data-report-sort="${key}"]`).focus();
      }; });
      view.querySelectorAll("[data-report-open]").forEach(button => { button.onclick = () => ctx.openBooking(button.dataset.reportOpen); });
      for (const [name, delta] of [["Prev", -1], ["Next", 1]]) view.querySelector(`#report${name}`).onclick = () => { state.page += delta; drawRecords(); view.querySelector(".report-scroll")?.focus(); };
    }
    drawRecords();
    view.querySelector("#reportFilters").onsubmit = event => {
      event.preventDefault(); const filters = Object.fromEntries(new FormData(event.currentTarget));
      const error = view.querySelector("#reportFilterError");
      if (filters.from && !M.validDate(filters.from) || filters.to && !M.validDate(filters.to) || filters.from && filters.to && filters.from > filters.to) {
        error.textContent = "Enter a valid date range with From on or before To."; error.hidden = false; view.querySelector('[name="from"]').focus(); return;
      }
      state.filters = filters; state.page = 0; state.csat = null; state.csatMessage = "";
      render(view, ctx); view.querySelector("#reportCount").setAttribute("tabindex", "-1"); view.querySelector("#reportCount").focus();
    };
    view.querySelector("#reportReset").onclick = () => { state.filters = {}; state.page = 0; state.csat = null; state.csatMessage = ""; render(view, ctx); view.querySelector('[name="from"]').focus(); };
    view.querySelector("#reportRefresh").onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      try {
        const [bookings, blocks] = await Promise.all([ctx.S.list(), ctx.S.listBlocks()]);
        if (!live()) return;
        state.updated = new Date().toISOString(); state.csat = null; state.csatMessage = "";
        ctx.updateData(bookings, blocks);
        render(view, { ...ctx, bookings, blocks, snapshot:state.updated }); view.querySelector("#reportRefresh").focus();
      } catch (error) { if (live()) { ctx.toast(`Refresh failed: ${error.message}`); button.disabled = false; } }
    };
    view.querySelector("#reportExport").onclick = () => download("booking-report.csv", M.csv(exportColumns.map(([title]) => title), report.rows.map(row => exportColumns.map(([, key]) => typeof row[key] === "object" ? JSON.stringify(row[key]) : row[key]))));
    view.querySelector("#reportSummary").onclick = () => {
      const rows = [["Report", "Filters", filterText], ["Report", "Snapshot", state.updated], ["Metrics", "Total bookings", report.rows.length], ["Metrics", "Completed", report.completed], ["Metrics", "Completion rate (%)", report.completionRate], ["Metrics", "Pending", report.pending], ["Metrics", "Reserved hours", report.hours], ["Metrics", "Related blocked ranges", report.blocks.length]];
      for (const [name, items] of [["Status", report.status], ["Monthly volume", report.trend], ...Object.entries(report.breakdowns)]) items.forEach(item => rows.push([name, item.name, item.count]));
      report.blocks.forEach(block => rows.push(["Blocked range", M.label(block.facilitator), `${block.startDate} to ${block.endDate || block.startDate}: ${block.reason || "Not recorded"}`]));
      rows.push(["CSAT", "Coverage", state.csatMessage || "Not loaded"]);
      if (state.csat) {
        rows.push(["CSAT", "Responses", state.csat.responses], ["CSAT", "Shared submissions", state.csat.shared], ["CSAT", "Individual submissions", state.csat.individual]);
        state.csat.ratings.forEach(item => rows.push(["CSAT", `${item.name} (${item.count} ratings; / 5)`, item.average]));
      }
      download("reporting-summary.csv", M.csv(["Section", "Metric / group", "Value"], rows));
    };
    view.querySelector("#reportPrint").onclick = () => {
      const details = [...view.querySelectorAll(".report-data, .report-breakdowns")], previouslyOpen = details.map(detail => detail.open);
      details.forEach(detail => { detail.open = true; });
      const printRecords = document.createElement("div"); printRecords.className = "report-print-records";
      printRecords.innerHTML = `<table><caption>All ${report.rows.length} matching bookings</caption><thead><tr>${columns.map(([title]) => `<th scope="col">${title}</th>`).join("")}</tr></thead><tbody>${report.rows.map(row => `<tr>${columns.map(([, key]) => `<td>${esc(M.label(row[key]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      view.querySelector("#reportRecords").append(printRecords);
      document.body.classList.add("printing-report");
      const restore = () => { document.body.classList.remove("printing-report"); printRecords.remove(); details.forEach((detail, index) => { detail.open = previouslyOpen[index]; }); };
      window.addEventListener("afterprint", restore, { once:true });
      window.print();
    };
    view.querySelector("#reportLoadCsat").onclick = async () => {
      state.loading = true; state.csat = null; state.csatMessage = "Loading matching training feedback…"; refreshCsat();
      try {
        const sessions = (await ctx.S.trainingSessions()).filter(session => report.rows.some(row => row.id === session.id) && session.topic === "Phone Videography");
        if (!live()) return;
        const details = []; let index = 0, failed = 0;
        await Promise.all(Array.from({ length:Math.min(4, sessions.length) }, async () => {
          while (live() && index < sessions.length) {
            const session = sessions[index++];
            try {
              const detail = await ctx.S.trainingSession(session.id);
              // Retain aggregates only, not respondent names, emails, or survey answers.
              details.push({ averages:detail.averages, attendees:{ length:detail.attendees.length }, responses:detail.responses.map(response => ({ source:response.source })) });
            } catch { failed++; }
          }
        }));
        if (!live()) return;
        state.csat = M.csatSummary(details);
        state.csatMessage = `${details.length} of ${sessions.length} matching eligible sessions loaded.${failed ? ` ${failed} failed; values are partial. Retry loading CSAT.` : ""}`;
      } catch (error) { if (live()) state.csatMessage = `Feedback unavailable: ${error.message}`; }
      finally { if (live()) { state.loading = false; refreshCsat(); } }
    };
  }
  function csatMarkup(mode) {
    if (mode !== "api") return '<p class="report-empty">CSAT is unavailable in local-storage demo mode. Booking reporting remains available.</p>';
    if (!state.csat) return `<p class="report-empty">${esc(state.csatMessage || "Load feedback on demand to include response-weighted ratings in this report and its summary export.")}</p>`;
    const summary = state.csat;
    return `<p class="account-notice">${esc(state.csatMessage)}</p><div class="report-csat-stats"><p><strong>${number(summary.responses)}</strong> submissions</p><p><strong>${summary.average === null ? "—" : number(summary.average) + " / 5"}</strong> average across rating answers</p><p><strong>${number(summary.shared)}</strong> shared · <strong>${number(summary.individual)}</strong> individual</p><p><strong>${number(summary.attendees)}</strong> registered legacy attendees</p></div>${summary.ratings.length ? `<div class="report-scroll" tabindex="0" role="region" aria-label="CSAT rating averages"><table><caption>Response-weighted rating averages (1–5)</caption><thead><tr><th scope="col">Rating question</th><th scope="col">Average / 5</th><th scope="col">Rating answers</th></tr></thead><tbody>${summary.ratings.map(item => `<tr><th scope="row">${esc(item.name)}</th><td><div class="report-rating"><strong>${item.average.toFixed(2)}</strong><span class="report-track" aria-hidden="true"><span class="report-fill" style="width:${item.average / 5 * 100}%"></span></span></div></td><td>${number(item.count)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="report-empty">No rating responses in the loaded sessions.</p>'}`;
  }
  function deactivate() { generation++; state.loading = false; document.querySelector("#view")?.classList.remove("reporting-view"); }
  window.ReportingUI = { render, deactivate };
})();
