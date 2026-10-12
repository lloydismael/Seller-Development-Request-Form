const { app } = require("@azure/functions");
const { randomUUID } = require("crypto");
const store = require("../store");
const { findConflicts, conflictMessage, isActive, inBlock } = require("../rules");
const { isAdmin, adminUser, checkCredentials, issueToken, sessionCookie, TTL } = require("../auth");

const json = (status, body) => ({ status, jsonBody: body });
const DENIED = json(401, { error: "Administrator sign-in required." });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["Pending", "Approved", "Completed", "Rejected", "Cancelled"];
const BOOKING_FIELDS = ["requestor", "division", "director", "category", "topic", "trainingDate", "facilitator", "time", "venue", "participants", "recommendations"];
const EDITABLE = ["status", "trainingDate", "facilitator", "time", "venue", "participants", "topic", "adminNotes"];
const clean = v => String(v ?? "").trim().slice(0, 2000);
async function body(req) { try { return await req.json(); } catch { return null; } }

app.http("health", {
  methods: ["GET"], authLevel: "anonymous", route: "health",
  handler: async () => json(200, { ok: true, storage: store.kind })
});

// Public: submit a booking. Admin: list all bookings.
app.http("bookings", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "bookings",
  handler: async (req) => {
    if (req.method === "GET") return isAdmin(req) ? json(200, await store.bookings.list()) : DENIED;

    const b = await body(req);
    if (!b) return json(400, { error: "Invalid JSON body." });
    const rec = {};
    BOOKING_FIELDS.forEach(k => (rec[k] = clean(b[k])));
    const missing = ["requestor", "division", "category", "trainingDate", "facilitator", "time", "venue"].filter(k => !rec[k]);
    if (missing.length) return json(400, { error: "Missing required fields: " + missing.join(", ") });
    if (!DATE_RE.test(rec.trainingDate)) return json(400, { error: "trainingDate must be YYYY-MM-DD." });

    const [all, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
    const c = findConflicts(all, blocks, rec);
    if (c.length) return json(409, { error: conflictMessage(c) });

    rec.answers = {};
    if (b.answers && typeof b.answers === "object") Object.entries(b.answers).slice(0, 50).forEach(([k, v]) => (rec.answers[clean(k)] = clean(v)));
    Object.assign(rec, { id: randomUUID(), status: "Pending", adminNotes: "", createdAt: new Date().toISOString() });
    await store.bookings.put(rec);
    return json(201, rec);
  }
});

// Admin: update / delete a booking
app.http("bookingItem", {
  methods: ["PUT", "DELETE"], authLevel: "anonymous", route: "bookings/{id}",
  handler: async (req) => {
    if (!isAdmin(req)) return DENIED;
    const id = req.params.id;
    const existing = await store.bookings.get(id);
    if (!existing) return json(404, { error: "Booking not found." });

    if (req.method === "DELETE") { await store.bookings.remove(id); return json(200, { ok: true }); }

    const p = await body(req);
    if (!p) return json(400, { error: "Invalid JSON body." });
    const next = { ...existing };
    EDITABLE.forEach(k => { if (p[k] !== undefined) next[k] = clean(p[k]); });
    if (!STATUSES.includes(next.status)) return json(400, { error: "Invalid status." });
    if (!DATE_RE.test(next.trainingDate)) return json(400, { error: "trainingDate must be YYYY-MM-DD." });

    if (!p.force && isActive(next.status)) {
      const [all, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
      const c = findConflicts(all, blocks, next, id);
      if (c.length) return json(409, { error: conflictMessage(c) });
    }
    next.updatedAt = new Date().toISOString();
    next.updatedBy = adminUser(req) || "admin";
    await store.bookings.put(next);
    return json(200, next);
  }
});

// Public: busy slots for a date (no personal data exposed)
app.http("availability", {
  methods: ["GET"], authLevel: "anonymous", route: "availability",
  handler: async (req) => {
    const date = req.query.get("date") || "";
    if (!DATE_RE.test(date)) return json(400, { error: "date must be YYYY-MM-DD." });
    const [all, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
    return json(200, {
      date,
      busy: all.filter(b => isActive(b.status) && b.trainingDate === date).map(b => ({ facilitator: b.facilitator, time: b.time })),
      blocked: [...new Set(blocks.filter(x => inBlock(x, date)).map(x => x.facilitator))]
    });
  }
});

// Admin: blocked dates (leave / unavailability)
app.http("blocks", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "blocks",
  handler: async (req) => {
    if (!isAdmin(req)) return DENIED;
    if (req.method === "GET") return json(200, await store.blocks.list());
    const b = await body(req);
    if (!b) return json(400, { error: "Invalid JSON body." });
    const rec = { facilitator: clean(b.facilitator), startDate: clean(b.startDate), endDate: clean(b.endDate || b.startDate), reason: clean(b.reason) };
    if (!rec.facilitator || !DATE_RE.test(rec.startDate) || !DATE_RE.test(rec.endDate) || rec.endDate < rec.startDate)
      return json(400, { error: "facilitator and a valid date range are required." });
    Object.assign(rec, { id: randomUUID(), createdAt: new Date().toISOString(), createdBy: adminUser(req) || "admin" });
    await store.blocks.put(rec);
    return json(201, rec);
  }
});

app.http("blockItem", {
  methods: ["DELETE"], authLevel: "anonymous", route: "blocks/{id}",
  handler: async (req) => {
    if (!isAdmin(req)) return DENIED;
    await store.blocks.remove(req.params.id);
    return json(200, { ok: true });
  }
});

// ---------- admin authentication ----------
app.http("authLogin", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/login",
  handler: async (req) => {
    const b = await body(req);
    const u = clean(b && b.username), p = String((b && b.password) ?? "");
    if (!checkCredentials(u, p)) {
      await new Promise(r => setTimeout(r, 600)); // slow down guessing
      return json(401, { error: "Invalid username or password." });
    }
    return { status: 200, jsonBody: { user: u }, cookies: [sessionCookie(req, issueToken(u), TTL)] };
  }
});

app.http("authLogout", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/logout",
  handler: async (req) => ({ status: 200, jsonBody: { ok: true }, cookies: [sessionCookie(req, "", 0)] })
});

app.http("authMe", {
  methods: ["GET"], authLevel: "anonymous", route: "auth/me",
  handler: async (req) => json(200, { user: adminUser(req) })
});
