(function (root) {
  const statuses = ["Pending", "Approved", "Completed", "Rejected", "Cancelled"];
  const label = value => String(value ?? "").trim() || "Not recorded";
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function matches(row, filters = {}) {
    return (!filters.from && !filters.to || validDate(row.trainingDate)) &&
      (!filters.from || row.trainingDate >= filters.from) && (!filters.to || row.trainingDate <= filters.to) &&
      ["status", "facilitator", "category", "division"].every(key => !filters[key] || label(row[key]) === filters[key]) &&
      (!filters.q || [row.requestor, row.topic, row.category, row.facilitator, row.division, row.director, row.venue, row.id]
        .some(value => String(value || "").toLowerCase().includes(filters.q.toLowerCase().trim())));
  }
  function group(rows, key) {
    const counts = new Map();
    rows.forEach(row => { const name = label(row[key]); counts.set(name, (counts.get(name) || 0) + 1); });
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  function summarize(bookings, blocks, filters = {}) {
    const rows = bookings.filter(row => matches(row, filters));
    const selectedFacilitators = new Set(rows.map(row => row.facilitator));
    // Block ranges intersect the report period; booking-only filters determine the related facilitators.
    const scoped = Boolean(filters.status || filters.category || filters.division || filters.q);
    const relatedBlocks = blocks.filter(block => (!filters.facilitator || label(block.facilitator) === filters.facilitator) &&
      (!scoped || selectedFacilitators.has(block.facilitator)) && (!filters.from || (block.endDate || block.startDate) >= filters.from) &&
      (!filters.to || block.startDate <= filters.to));
    const counts = group(rows, "status");
    const status = [...statuses, ...counts.map(item => item.name).filter(name => !statuses.includes(name))]
      .map(name => ({ name, count: counts.find(item => item.name === name)?.count || 0 }));
    const monthCounts = new Map();
    rows.filter(row => validDate(row.trainingDate)).forEach(row => {
      const month = row.trainingDate.slice(0, 7); monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    });
    const months = [...monthCounts.keys()].sort(), trend = [];
    if (months.length) {
      let [year, month] = months[0].split("-").map(Number);
      const last = months[months.length - 1];
      while (`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` <= last) {
        const name = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
        trend.push({ name, count: monthCounts.get(name) || 0 });
        if (++month === 13) { month = 1; year++; }
      }
    }
    const completed = rows.filter(row => row.status === "Completed").length;
    const reserved = rows.filter(row => ["Approved", "Completed"].includes(row.status));
    return { rows, blocks:relatedBlocks, status, trend, completed, completionRate:rows.length ? completed / rows.length * 100 : null,
      pending:rows.filter(row => row.status === "Pending").length,
      hours:reserved.reduce((sum, row) => {
        const minutes = value => { const m = String(value).trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i); return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] < 60 ? (+m[1] % 12 + (m[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + +m[2] : NaN; };
        const [start, end] = String(row.time || "").split(/\s*-\s*/).map(minutes);
        return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60 : 0);
      }, 0), missingDates:rows.filter(row => !validDate(row.trainingDate)).length,
      breakdowns:Object.fromEntries(["category", "topic", "division", "director", "facilitator", "venue"].map(key => [key, group(rows, key)])) };
  }
  function csatSummary(details) {
    const ratings = new Map(); let responses = 0, shared = 0, individual = 0, attendees = 0;
    details.forEach(detail => {
      responses += detail.responses.length; attendees += detail.attendees.length;
      shared += detail.responses.filter(response => response.source === "shared").length;
      individual += detail.responses.filter(response => response.source === "individual").length;
      detail.averages.forEach(item => {
        if (!Number.isFinite(item.average) || !Number.isFinite(item.count) || item.count <= 0) return;
        const aggregate = ratings.get(item.id) || { id:item.id, name:item.title, total:0, count:0 };
        aggregate.total += item.average * item.count; aggregate.count += item.count; ratings.set(item.id, aggregate);
      });
    });
    const list = [...ratings.values()].map(item => ({ ...item, average:item.total / item.count }));
    const count = list.reduce((sum, item) => sum + item.count, 0);
    return { responses, shared, individual, attendees, ratings:list,
      average:count ? list.reduce((sum, item) => sum + item.total, 0) / count : null };
  }
  function csv(headers, rows) {
    const cell = value => {
      let text = String(value ?? "");
      if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return "\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
  }
  const model = { statuses, label, validDate, matches, group, summarize, csatSummary, csv };
  if (typeof module !== "undefined" && module.exports) module.exports = model;
  else root.ReportingModel = model;
})(typeof window === "undefined" ? globalThis : window);
