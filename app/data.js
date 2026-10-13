/*
 * BookingStore – shared data layer for the public form and the admin portal.
 *  - "api" mode:   uses the Azure Functions API (/api/*) – run with `swa start` or on Azure.
 *  - "local" mode: falls back to browser localStorage (plain static server, UI testing only).
 */
(function () {
  const LS_B = "sdrf_bookings_v2", LS_BL = "sdrf_blocks_v1", SS_ADMIN = "sdrf_admin_session";
  // Default admin credentials used ONLY in local (no-API) mode. In API mode the server checks
  // ADMIN_USERNAME / ADMIN_PASSWORD (same defaults) – see api/src/auth.js.
  const DEFAULT_ADMIN = { username: "admin", password: "Admin@123" };

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
  const fail = (status, msg) => Object.assign(new Error(msg), { status });

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
    const r = await fetch(url, {
      method, credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json() : null;
    if (!r.ok || (!data && r.status !== 204 && method !== "DELETE")) {
      throw fail(r.status, (data && data.error) || (r.status === 401 || r.status === 403 ? "Session expired – please log in again." : `Request failed (${r.status})`));
    }
    return data;
  }
  const isApi = async () => (await mode()) === "api";

  window.BookingStore = {
    slotRange, overlaps, isActive, findConflicts, conflictMessage, availabilityFor, mode,

    async create(b) {
      if (await isApi()) return api("POST", "/api/bookings", b);
      const all = read(LS_B), c = findConflicts(all, read(LS_BL), b);
      if (c.length) throw fail(409, conflictMessage(c));
      const rec = { ...b, id: uid(), status: "Pending", createdAt: new Date().toISOString(), adminNotes: "" };
      all.push(rec); write(LS_B, all); return rec;
    },
    async list() { return (await isApi()) ? api("GET", "/api/bookings") : read(LS_B); },
    async update(id, patch) {
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
      if (await isApi()) return api("DELETE", `/api/bookings/${encodeURIComponent(id)}`);
      write(LS_B, read(LS_B).filter(x => x.id !== id));
    },
    async availability(date) {
      if (await isApi()) return api("GET", `/api/availability?date=${encodeURIComponent(date)}`);
      return availabilityFor(read(LS_B), read(LS_BL), date);
    },
    async listBlocks() { return (await isApi()) ? api("GET", "/api/blocks") : read(LS_BL); },
    async addBlock(x) {
      if (await isApi()) return api("POST", "/api/blocks", x);
      const rec = { ...x, id: uid(), createdAt: new Date().toISOString() };
      write(LS_BL, [...read(LS_BL), rec]); return rec;
    },
    async removeBlock(id) {
      if (await isApi()) return api("DELETE", `/api/blocks/${encodeURIComponent(id)}`);
      write(LS_BL, read(LS_BL).filter(x => x.id !== id));
    },
    // ---------- admin auth ----------
    defaultAdmin: DEFAULT_ADMIN,
    async login(username, password) {
      if (await isApi()) return api("POST", "/api/auth/login", { username, password });
      if (username === DEFAULT_ADMIN.username && password === DEFAULT_ADMIN.password) {
        sessionStorage.setItem(SS_ADMIN, username); return { user: username };
      }
      throw fail(401, "Invalid username or password.");
    },
    async me() {
      if (await isApi()) { try { return await api("GET", "/api/auth/me"); } catch { return { user: null }; } }
      return { user: sessionStorage.getItem(SS_ADMIN) };
    },
    async logout() {
      if (await isApi()) { try { await api("POST", "/api/auth/logout"); } catch { /* ignore */ } }
      sessionStorage.removeItem(SS_ADMIN);
    },
    // local-mode helpers (sample data / reset)
    replaceLocal(bookings, blocks) {
      if (!localOnly) throw fail(403, "Browser data replacement is available only in explicit local UI testing mode.");
      write(LS_B, bookings); write(LS_BL, blocks);
    }
  };
})();
