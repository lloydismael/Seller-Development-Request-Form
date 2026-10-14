(function () {
  const S = window.BookingStore;
  const preview = new URLSearchParams(location.search).get("preview") === "draft";
  const dialog = document.getElementById("requestHistory"), content = document.getElementById("historyContent");
  const message = document.getElementById("historyMessage"), more = document.getElementById("historyMoreBtn");
  const retry = document.getElementById("historyRetryBtn"), back = document.getElementById("historyBackBtn");
  let cursor = null, generation = 0, retryAction, opener;
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function busy(text) {
    const version = ++generation;
    message.textContent = text; content.setAttribute("aria-busy", "true");
    more.hidden = true; retry.hidden = true; back.hidden = true;
    return version;
  }
  function failed(err, action) {
    message.textContent = `History could not be loaded: ${err.message} Your saved requests have not been changed.`;
    retryAction = action; retry.hidden = false;
  }
  async function list(append = false) {
    const version = busy("Loading requests…");
    if (!append) { content.replaceChildren(); cursor = null; }
    try {
      const result = await S.myRequests(append ? cursor : undefined);
      if (version !== generation) return;
      if (!Array.isArray(result.items)) throw new Error("Invalid history response.");
      for (const item of result.items) {
        const card = node("article", undefined, "history-item");
        card.append(node("h3", item.category || "Booking request"));
        card.append(node("p", `Status: ${item.status || "Pending"}`));
        card.append(node("p", [item.trainingDate, item.time, item.facilitator].filter(Boolean).join(" · ")));
        card.append(node("p", `Submitted: ${item.createdAt || "Unknown"}`));
        const button = node("button", "View request", "btn"); button.type = "button";
        button.setAttribute("aria-label", `View request submitted ${item.createdAt || item.id}`);
        button.addEventListener("click", () => detail(item.id)); card.append(button); content.append(card);
      }
      cursor = result.nextCursor || null; more.hidden = !cursor;
      message.textContent = content.children.length ? "Requests are shown newest first. Status reflects the latest saved update." : "No requests are linked to this browser yet. Older requests and requests from other browsers cannot be recovered here.";
    } catch (err) { if (version === generation) failed(err, () => list(append)); }
    finally { if (version === generation) content.setAttribute("aria-busy", "false"); }
  }
  async function detail(id) {
    const version = busy("Loading request…"); content.replaceChildren();
    try {
      const item = await S.myRequest(id);
      if (version !== generation) return;
      content.append(node("h3", `Request ${item.id}`));
      content.append(node("p", `Status: ${item.status || "Pending"}`));
      content.append(node("p", `Submitted: ${item.createdAt || "Unknown"}`));
      if (item.updatedAt) content.append(node("p", `Last updated: ${item.updatedAt}`));
      const table = node("table", undefined, "summary"), body = node("tbody");
      for (const answer of item.answerSnapshot || []) {
        const row = node("tr"), title = node("th", answer.title); title.scope = "row";
        row.append(title, node("td", Array.isArray(answer.value) ? answer.value.join("; ") : String(answer.value ?? ""))); body.append(row);
      }
      table.append(body); content.append(table); message.textContent = "Submitted answers are read-only.";
    } catch (err) { if (version === generation) failed(err, () => detail(id)); }
    finally { if (version === generation) { content.setAttribute("aria-busy", "false"); back.hidden = false; } }
  }
  for (const id of ["historyBtn", "thanksHistoryBtn"]) {
    const button = document.getElementById(id); button.hidden = preview;
    button.addEventListener("click", () => {
      opener = button; dialog.showModal(); document.getElementById("historyTitle").focus(); list();
    });
  }
  document.getElementById("closeHistoryBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { ++generation; opener?.focus(); });
  more.addEventListener("click", () => list(true)); retry.addEventListener("click", () => retryAction?.());
  back.addEventListener("click", () => list());
  const ready = preview ? Promise.resolve() : S.myRequests().catch(() => undefined);
  window.RequestHistory = {
    ready,
    async verifySaved(id, isCurrent = () => true) {
      const warning = document.getElementById("saveWarning");
      try { await S.myRequest(id); }
      catch (_) {
        if (!isCurrent()) return;
        const text = "Your request was saved, but access through this browser's history could not be confirmed. Allow cookies and retry My requests. Do not resubmit.";
        warning.textContent = [warning.textContent, text].filter(Boolean).join(" "); warning.hidden = false;
      }
    }
  };
})();
