/*
 * BookingStore – shared data layer for the public form and the admin portal.
 *  - "api" mode:   uses the Azure Functions API (/api/*) – run with `swa start` or on Azure.
 *  - "local" mode: falls back to browser localStorage (plain static server, UI testing only).
 */
(function () {
  const LS_B = "sdrf_bookings_v2", LS_BL = "sdrf_blocks_v1";
  // Demo identity is memory-only. Never persist credentials or session overrides.
  const DEFAULT_ADMIN = { username: "admin", password: "Admin@123" };
  let demoUser = null;
  const preview = new URLSearchParams(location.search).get("preview") === "draft";

  // ---------- scheduling rules (keep in sync with api/src/rules.js) ----------
  function toMin(t) {
    const m = String(t).trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!m) return NaN;
    let h = (+m[1]) % 12; if (m[3].toUpperCase() === "PM") h += 12;
    return h * 60 + (+m[2]);
  }
  function slotRange(s) { const p = String(s || "").split(/\s*-\s*/); return [toMin(p[0]), toMin(p[1])]; }
  function overlaps(a, b) { const [a1, a2] = slotRange(a), [b1, b2] = slotRange(b); return a1 < b2 && b1 < a2; }
  const isActive = s => !["Rejected", "Cancelled"].includes(s);
  const inBlock = (x, date) => date >= x.startDate && date <= (x.endDate || x.startDate);

  function findConflicts(bookings, blocks, b, ignoreId) {
    const out = [];
    if (!b.trainingDate || !b.facilitator || (b.status && !isActive(b.status))) return out;
    blocks.filter(x => x.facilitator === b.facilitator && inBlock(x, b.trainingDate))
      .forEach(x => out.push({ type: "block", item: x }));
    bookings.filter(x => x.id !== ignoreId && isActive(x.status) && x.facilitator === b.facilitator &&
      x.trainingDate === b.trainingDate && b.time && x.time && overlaps(x.time, b.time))
      .forEach(x => out.push({ type: "booking", item: x }));
    return out;
  }
  function conflictMessage(c) {
    return c.map(x => x.type === "block"
      ? `${x.item.facilitator} is unavailable on this date (${x.item.reason || "blocked"}).`
      : `${x.item.facilitator} is already booked ${x.item.time} on ${x.item.trainingDate}.`).join("\n");
  }
  function availabilityFor(bookings, blocks, date) {
    return {
      date,
      busy: bookings.filter(b => isActive(b.status) && b.trainingDate === date).map(b => ({ facilitator: b.facilitator, time: b.time })),
      blocked: [...new Set(blocks.filter(x => inBlock(x, date)).map(x => x.facilitator))]
    };
  }

  // ---------- transport ----------
  const read = k => JSON.parse(localStorage.getItem(k) || "[]");
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const fail = (status, msg, metadata = {}) => Object.assign(new Error(msg), { status, ...metadata });
  const unavailable = () => { throw fail(503, "Account settings, form drafts, publishing and activity are unavailable in browser demo mode. Use the authenticated API.", { code:"DEMO_UNAVAILABLE" }); };
  const writable = () => { if (preview) throw fail(403, "Draft preview is read-only. Submissions and mutations are disabled.", { code:"PREVIEW_READ_ONLY" }); };
  function defaultForm() {
    if (!window.FormSchema || !window.FORM_CONFIG) throw fail(503, "Default form schema is unavailable.");
    return { config:window.FormSchema.validate(window.FORM_CONFIG), version:"browser-demo-default" };
  }

  const isLocalHost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  // Static UI testing is deliberately opt-in; full-stack local testing defaults to API.
  const localOnly = isLocalHost && new URLSearchParams(location.search).get("storage") === "local";
  let modeP;
  function mode() {
    if (localOnly) return Promise.resolve("local");
    return modeP || (modeP = fetch("/api/health", { cache:"no-store", signal:AbortSignal.timeout(10000) })
      .then(async r => {
        if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) throw new Error("API unavailable");
        const data = await r.json();
        if (data.ok !== true || (!isLocalHost && data.storage !== "table")) throw new Error("Shared storage unavailable");
        return "api";
      })
      .catch(() => {
        modeP = null;
        throw fail(503, "Shared booking storage is unavailable. Please retry; no response has been saved in this browser.");
      }));
  }
  async function api(method, url, body) {
    if (!["GET", "HEAD"].includes(method)) writable();
    const r = await fetch(url, {
      method, credentials: "same-origin", mode:"same-origin", cache:"no-store",
      ...(url.startsWith("/api/my-requests") ? { signal:AbortSignal.timeout(10000) } : {}),
      headers: { Accept:"application/json", ...(!["GET", "HEAD"].includes(method) ? { "X-Admin-Request":"1", "Content-Type":"application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json() : null;
    if (!r.ok || (!data && r.status !== 204 && method !== "DELETE")) {
      const message = (data && data.error) || (r.status === 401 || r.status === 403 ? "Session expired – please log in again." : `Request failed (${r.status})`);
      // Current backend has a generic form/CAS 409 and a separate slot message.
      // Prefer an explicit server code when available; do not mistake every 409 for a slot conflict.
      const code = data?.code || (r.status === 409 ? (/^Record or form changed\./.test(message) || /formVersion|form is outdated|form changed.*latest form/i.test(message) ? "FORM_EXPIRED" : "SLOT_CONFLICT") : undefined);
      throw fail(r.status, message, { code, response:data, retryAfter:r.headers.get("retry-after") });
    }
    if (data && r.headers.get("x-audit-recorded") === "false") {
      data.auditRecorded = false;
      data.warning ||= "Mutation saved, but activity recording failed. Do not retry the mutation.";
    }
    return data;
  }
  const isApi = async () => (await mode()) === "api";

  const LS_OWNER = "sdrf_history_owner_v1";
  function localOwner() {
    let owner = localStorage.getItem(LS_OWNER);
    if (!owner) { owner = uid(); localStorage.setItem(LS_OWNER, owner); }
    return owner;
  }
  function historyRecord(b, detail = false) {
    const out = {};
    for (const key of ["id", "createdAt", "updatedAt", "status", "trainingDate", "time", "facilitator", "category"])
      if (b[key] !== undefined) out[key] = b[key];
    if (detail) out.answerSnapshot = b.answerSnapshot || [];
    return out;
  }

  window.BookingStore = {
    slotRange, overlaps, isActive, findConflicts, conflictMessage, availabilityFor, mode,

    async create(b) {
      writable();
      if (await isApi()) return api("POST", "/api/bookings", b);
      const live = defaultForm();
      if (b.formVersion !== live.version) throw fail(409, "The demo form expired. Refresh the form.", { code:"FORM_EXPIRED" });
      const validated = window.FormSchema.submission(live.config, b.answerValues);
      const all = read(LS_B), c = findConflicts(all, read(LS_BL), validated);
      if (c.length) throw fail(409, conflictMessage(c), { code:"SLOT_CONFLICT" });
      const rec = { ...validated, formVersion:live.version, id: uid(), status: "Pending", createdAt: new Date().toISOString(), adminNotes: "", historyOwner:localOwner() };
      all.push(rec); write(LS_B, all); return rec;
    },
    async myRequests(cursor) {
      if (preview) throw fail(403, "Request history is unavailable in draft preview.");
      if (await isApi()) return api("GET", `/api/my-requests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      const recognized = !!localStorage.getItem(LS_OWNER), owner = localOwner();
      const offset = cursor ? Number(cursor) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, "Invalid history cursor.");
      const all = read(LS_B).filter(b => b.historyOwner === owner).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return { items:all.slice(offset, offset + 20).map(b => historyRecord(b)), nextCursor:offset + 20 < all.length ? String(offset + 20) : null, recognized };
    },
    async myRequest(id) {
      if (preview) throw fail(403, "Request history is unavailable in draft preview.");
      if (await isApi()) return api("GET", `/api/my-requests/${encodeURIComponent(id)}`);
      const owner = localStorage.getItem(LS_OWNER);
      const booking = owner && read(LS_B).find(b => b.id === id && b.historyOwner === owner);
      if (!booking) throw fail(404, "Request not found in this browser's history.");
      return historyRecord(booking, true);
    },
    async list() { return (await isApi()) ? api("GET", "/api/bookings") : read(LS_B); },
    async update(id, patch) {
      writable();
      if (await isApi()) return api("PUT", `/api/bookings/${encodeURIComponent(id)}`, patch);
      const all = read(LS_B), i = all.findIndex(x => x.id === id);
      if (i < 0) throw fail(404, "Booking not found.");
      const { force, ...p } = patch;
      const next = { ...all[i], ...p, updatedAt: new Date().toISOString(), updatedBy: "Local developer" };
      const c = findConflicts(all, read(LS_BL), next, id);
      if (c.length && !force) throw fail(409, conflictMessage(c));
      all[i] = next; write(LS_B, all); return next;
    },
    async remove(id) {
      writable();
      if (await isApi()) return api("DELETE", `/api/bookings/${encodeURIComponent(id)}`);
      write(LS_B, read(LS_B).filter(x => x.id !== id));
    },
    async availability(date) {
      if (await isApi()) return api("GET", `/api/availability?date=${encodeURIComponent(date)}`);
      return availabilityFor(read(LS_B), read(LS_BL), date);
    },
    async listBlocks() { return (await isApi()) ? api("GET", "/api/blocks") : read(LS_BL); },
    async addBlock(x) {
      writable();
      if (await isApi()) return api("POST", "/api/blocks", x);
      const rec = { ...x, id: uid(), createdAt: new Date().toISOString() };
      write(LS_BL, [...read(LS_BL), rec]); return rec;
    },
    async removeBlock(id) {
      writable();
      if (await isApi()) return api("DELETE", `/api/blocks/${encodeURIComponent(id)}`);
      write(LS_BL, read(LS_BL).filter(x => x.id !== id));
    },
    // ---------- admin auth ----------
    defaultAdmin: DEFAULT_ADMIN,
    async login(username, password) {
      writable();
      if (await isApi()) return api("POST", "/api/auth/login", { username, password });
      if (username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
        demoUser = username; return { user: username, provider:"demo" };
      }
      throw fail(401, "Invalid username or password.");
    },
    async me() {
      if (await isApi()) return api("GET", "/api/auth/me");
      return { user: demoUser, provider:"demo" };
    },
    async logout() {
      writable();
      if (await isApi()) return api("POST", "/api/auth/logout", {});
      demoUser = null; return { ok:true };
    },
    async profile() { return (await isApi()) ? api("GET", "/api/auth/profile") : unavailable(); },
    async updateProfile(profile) { writable(); return (await isApi()) ? api("PUT", "/api/auth/profile", profile) : unavailable(); },
    async changePassword(currentPassword, newPassword, confirmPassword) {
      writable();
      const body = typeof currentPassword === "object" ? currentPassword : { currentPassword, newPassword, confirmPassword };
      return (await isApi()) ? api("POST", "/api/auth/password", body) : unavailable();
    },
    async formConfig() { return (await isApi()) ? api("GET", "/api/form-config") : defaultForm(); },
    async formDraft() { return (await isApi()) ? api("GET", "/api/manage/form-draft") : unavailable(); },
    async saveFormDraft(config, revision) {
      writable();
      return (await isApi()) ? api("PUT", "/api/manage/form-draft", { config, revision }) : unavailable();
    },
    async publishForm(revision) { writable(); return (await isApi()) ? api("POST", "/api/manage/form-publish", { revision }) : unavailable(); },
    async activity(query = {}) {
      if (!await isApi()) return unavailable();
      const params = new URLSearchParams();
      Object.entries(query).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") params.set(key, String(value)); });
      return api("GET", `/api/manage/activity?${params}`);
    },
    // local-mode helpers (sample data / reset)
    replaceLocal(bookings, blocks) {
      writable();
      if (!localOnly) throw fail(403, "Browser data replacement is available only in explicit local UI testing mode.");
      write(LS_B, bookings); write(LS_BL, blocks);
    }
  };
})();
