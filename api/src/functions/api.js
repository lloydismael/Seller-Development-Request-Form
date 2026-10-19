const { app } = require("@azure/functions");
const { randomUUID } = require("crypto");
const store = require("../store");
const anonymous = require("../anonymous");
const { findConflicts, conflictMessage, isActive, inBlock } = require("../rules");
const { isAdmin, adminUser, authenticateIdentity, getIdentity, getProfile, updateProfile, changePassword, issueToken, sessionCookie, TTL } = require("../auth");
const forms = require("../forms");
const audit = require("../audit");
const csat = require("../csat");
const accounts = require("../accounts");
const { schema } = require("../form-assets-loader");

const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });
const DENIED = json(401, { error: "Administrator sign-in required." });
const STATUSES = ["Pending", "Approved", "Completed", "Rejected", "Cancelled"];
const EDITABLE = ["status", "trainingDate", "facilitator", "time", "venue", "participants", "topic", "adminNotes"];
const clean = v => {
  if (v !== undefined && v !== null && typeof v !== "string")
    throw Object.assign(new Error("Text fields must be strings."), { statusCode:400, expose:true });
  return (v ?? "").trim().slice(0, 2000);
};
async function body(req) {
  let value;
  try { value = await req.json(); } catch { return null; }
  schema.size(value);
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
const safeIdentity = who => who ? { id:who.id, user:who.user, provider:who.provider, role:who.role, facilitatorLabel:who.facilitatorLabel || "",
  profile:{ displayName:who.profile?.displayName || "", email:who.profile?.email || "", phone:who.profile?.phone || "" } } : null;

// All browser admin writes (including login/logout) require a non-simple header.
// A missing Origin is allowed for same-origin fetch/CLI; cross-origin requests
// still cannot set this header without preflight. No permissive CORS is added.
function sameOrigin(req, admin = true) {
  if (admin && req.headers.get("x-admin-request") !== "1") return false;
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || (!admin && site === "same-site")) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin), requestUrl = new URL(req.url);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    // An explicit allowlist is authoritative when a linked proxy rewrites hosts.
    const configured = process.env.ADMIN_ALLOWED_ORIGINS;
    if (configured !== undefined) {
      const origins = configured.split(",").map(value => value.trim());
      if (!origins.length || origins.some(value => {
        const allowed = new URL(value);
        return allowed.protocol !== "https:" || allowed.origin !== value;
      })) return false;
      return origins.includes(origin);
    }
    // Without an allowlist, retain exact host checks for local/development use.
    const forwarded = req.headers.get("x-forwarded-host"), host = forwarded || req.headers.get("host") || requestUrl.host;
    if (!host || host !== host.trim() || /[,\s/@\\?#]/.test(host)) return false;
    const proto = req.headers.get("x-forwarded-proto") || requestUrl.protocol.slice(0, -1);
    if (!["https", "http"].includes(proto)) return false;
    const expected = new URL(proto + "://" + host);
    return expected.host === host.toLowerCase() && parsed.origin === expected.origin;
  } catch { return false; }
}
const privateRoutes = new Set(["bookingItem", "blocks", "blockItem", "authProfile", "authPassword", "formDraft", "formPublish", "activity"]);
function http(name, definition) {
  const handler = definition.handler;
  app.http(name, { ...definition, handler:async (req, context) => {
    try {
      if ((name === "myRequests" || name === "myRequest" || (name === "bookings" && req.method === "POST")) && !sameOrigin(req, false))
        return json(403, { error:"Request origin is not allowed." });
      const csatPrivate = ["trainingSessions", "trainingSession", "trainingComplete", "trainingDecision", "trainingSharing", "trainingAttendees", "trainingInvitation"].includes(name);
      const accountPrivate = name === "facilitatorAccounts" || name === "facilitatorAccount";
      const csatPublic = name === "csatSurvey" || name === "csatSubmit";
      if (csatPrivate && !await getIdentity(req)) return DENIED;
      if (accountPrivate && !await isAdmin(req)) return DENIED;
      if (!["GET", "HEAD"].includes(req?.method) && (csatPrivate || accountPrivate || csatPublic) && !sameOrigin(req, !csatPublic)) return json(403, { error:"Request origin is not allowed." });
      const privateRoute = privateRoutes.has(name) || (name === "bookings" && req.method === "GET");
      const selfService = name === "authProfile" || name === "authPassword";
      if (privateRoute && !(selfService ? await getIdentity(req) : await isAdmin(req))) return DENIED;
      if (!["GET", "HEAD"].includes(req?.method) && (privateRoute || name === "authLogin" || name === "authLogout") && !sameOrigin(req))
        return json(403, { error:"Admin request origin is not allowed or X-Admin-Request: 1 is missing. Open the admin page on an approved application domain and retry." });
      return await handler(req, context);
    } catch (e) {
      const status = [400, 401, 403, 404, 409, 429, 503].includes(e.statusCode) ? e.statusCode : 500;
      const messages = { 403:"Access denied.", 404:"Record or invitation not found.", 401:"Sign-in required.", 409:"Record or form changed. Refresh the latest form/draft and retry. Bookings require its formVersion and stable-ID answerValues.", 429:"Too many attempts; retry later.", 503:"Backend unavailable. Retry later.", 500:"Unable to complete the request. Retry later." };
      // Never log exceptions, bodies, cookies or credentials.
      if (status >= 500) context?.error?.("API operation failed: " + name);
      return json(status, { error:status === 400 ? (e.expose ? "Invalid request. " + String(e.message).slice(0, 300) : "Invalid request. Check the supplied fields and retry.") : status === 409 ? "Record changed. Reload the latest record/draft and retry." : messages[status],
        ...(status === 409 ? { code:"RECORD_CONFLICT" } : {}) });
    }
  } });
}
async function audited(req, status, value, action, target, summary, actor) {
  try { await audit.append(action, actor === undefined ? await adminUser(req) : actor, target, summary); }
  catch {
    // Separate collections cannot commit together. The operation is saved, not
    // rolled back; the UI must display this warning and must not blindly retry.
    return { ...json(status, { ...value, warning:"Mutation saved, but activity recording failed. Do not retry the mutation.", auditRecorded:false }), headers:{ "Cache-Control":"no-store", "X-Audit-Recorded":"false" } };
  }
  return json(status, value);
}

http("facilitatorAccounts", {
  methods:["GET", "POST"], authLevel:"anonymous", route:"manage/facilitators",
  handler:async req => {
    const who = await getIdentity(req), input = req.method === "GET" ? null : await body(req);
    if (req.method === "POST" && !input) return json(400, { error:"Account fields required." });
    const value = await accounts.manageFacilitators(who, input);
    return req.method === "GET" ? json(200, value) : audited(req, 201, value, "facilitator.create", value.id, "Facilitator account created", who.user);
  }
});
http("facilitatorAccount", {
  methods:["PUT"], authLevel:"anonymous", route:"manage/facilitators/{id}",
  handler:async req => {
    const who = await getIdentity(req), input = await body(req);
    if (!input) return json(400, { error:"Account fields required." });
    const value = await accounts.manageFacilitators(who, input, req.params.id);
    return audited(req, 200, value, "facilitator.update", value.id, "Facilitator account updated; sessions invalidated", who.user);
  }
});
http("trainingSessions", { methods:["GET"], authLevel:"anonymous", route:"training-sessions", handler:async req => json(200, await csat.list(await getIdentity(req))) });
http("trainingSession", { methods:["GET"], authLevel:"anonymous", route:"training-sessions/{id}", handler:async req => json(200, await csat.detail(req.params.id, await getIdentity(req))) });
http("trainingDecision", {
  methods:["POST"], authLevel:"anonymous", route:"training-sessions/{id}/decision",
  handler:async req => {
    const who = await getIdentity(req), input = await body(req);
    if (!input || Object.keys(input).some(k => k !== "action")) return json(400, { error:"Invalid booking decision." });
    const value = await csat.decide(req.params.id, who, input.action);
    return audited(req, 200, value, "training." + input.action, req.params.id, "Booking request " + (input.action === "accept" ? "accepted" : "declined"), who.user);
  }
});
http("trainingComplete", {
  methods:["POST"], authLevel:"anonymous", route:"training-sessions/{id}/complete",
  handler:async req => {
    const who = await getIdentity(req), input = await body(req);
    if (!input || Object.keys(input).some(k => k !== "activateLegacy") || (input.activateLegacy !== undefined && typeof input.activateLegacy !== "boolean")) return json(400, { error:"Invalid completion request." });
    const value = await csat.complete(req.params.id, who, input.activateLegacy === true);
    return audited(req, 200, value, "training.complete", req.params.id, "Phone Videography completed; CSAT activated", who.user);
  }
});
http("trainingSharing", {
  methods:["GET", "POST"], authLevel:"anonymous", route:"training-sessions/{id}/sharing",
  handler:async req => {
    const who = await getIdentity(req);
    if (req.method === "GET") return json(200, await csat.sharing(req.params.id, who));
    const input = await body(req);
    if (!input || Object.keys(input).some(k => k !== "action") || typeof input.action !== "string") return json(400, { error:"Invalid sharing action." });
    const result = await csat.sharing(req.params.id, who, input.action);
    return audited(req, 200, result, "sharing." + input.action, req.params.id, "Session sharing access updated", who.user);
  }
});
http("trainingAttendees", {
  methods:["POST"], authLevel:"anonymous", route:"training-sessions/{id}/attendees",
  handler:async req => {
    const who = await getIdentity(req), value = await csat.addAttendee(req.params.id, who, await body(req));
    return audited(req, 201, value, "attendee.create", req.params.id, "Attendee registered", who.user);
  }
});
http("trainingInvitation", {
  methods:["POST"], authLevel:"anonymous", route:"training-sessions/{id}/attendees/{attendeeId}/invitation",
  handler:async req => {
    const who = await getIdentity(req), input = await body(req);
    if (!input || Object.keys(input).some(k => k !== "action")) return json(400, { error:"Invalid invitation action." });
    const value = await csat.invitation(req.params.id, req.params.attendeeId, who, input.action);
    return audited(req, 200, value, "invitation." + input.action, req.params.id, "Attendee invitation updated", who.user);
  }
});
// Invitation tokens travel in POST bodies, never URLs/server request logs.
http("csatSurvey", { methods:["POST"], authLevel:"anonymous", route:"csat/resolve", handler:async req => { const input = await body(req); return json(200, await csat.survey(input?.token, input?.attemptId)); } });
http("csatSubmit", { methods:["POST"], authLevel:"anonymous", route:"csat/submit", handler:async req => { const input = await body(req); return json(200, await csat.submit(input?.token, input?.answers, input?.attemptId)); } });

http("health", {
  methods: ["GET"], authLevel: "anonymous", route: "health",
  handler: async () => {
    try { await store.checkConnection(); return json(200, { ok:true, storage:store.kind }); }
    catch { return json(503, { ok:false, error:"Storage is unavailable. Check backend storage configuration and permissions." }); }
  }
});

// Public: submit a booking. Admin: list all bookings.
http("bookings", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "bookings",
  handler: async (req) => {
    if (req.method === "GET") return await isAdmin(req) ? json(200, (await store.bookings.list()).map(anonymous.withoutOwner)) : DENIED;

    const browser = anonymous.identity(req);
    const b = await body(req);
    if (!b) return json(400, { error: "Invalid JSON body." });
    let rec;
    try { rec = await forms.booking(b); }
    catch (e) {
      if (e.statusCode === 409) return json(409, { code:"FORM_EXPIRED", error:"This form is outdated. Refresh the published form and submit formVersion with answerValues." });
      throw e;
    }
    // Date-only new bookings use UTC, independent of host/browser time zone.
    // Admin edits below deliberately permit valid historical calendar dates.
    if (rec.trainingDate < new Date().toISOString().slice(0, 10))
      return json(400, { error:"Choose today or a future training date (UTC)." });

    const [all, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
    const c = findConflicts(all, blocks, rec);
    if (c.length) return json(409, { code:"SLOT_CONFLICT", error: conflictMessage(c) });

    Object.assign(rec, { id: randomUUID(), status: "Pending", adminNotes: "", createdAt: new Date().toISOString(), ownerHash:browser.ownerHash });
    schema.size(rec);
    csat.initializeSharing(rec);
    await store.bookings.put(rec);
    const result = await audited(req, 201, { ...anonymous.withoutOwner(rec), historyAvailable:browser.recognized }, "booking.create", rec.id, "Booking submitted", "anonymous");
    return { ...result, cookies:[anonymous.cookie(req, browser.token)] };
  }
});

// Initialize/renew the browser capability early, before parallel submissions.
http("myRequests", {
  methods:["GET"], authLevel:"anonymous", route:"my-requests",
  handler:async req => {
    const page = anonymous.pagination(req.query), browser = anonymous.identity(req);
    const result = browser.recognized ? await store.bookings.listOwned(browser.ownerHash, page) : { items:[], hasMore:false };
    return { ...json(200, { items:result.items.map(anonymous.summary),
      nextCursor:result.hasMore ? anonymous.cursor(result.items[result.items.length - 1]) : null, recognized:browser.recognized }),
      cookies:[anonymous.cookie(req, browser.token)] };
  }
});
http("myRequest", {
  methods:["GET"], authLevel:"anonymous", route:"my-requests/{id}",
  handler:async req => {
    const browser = anonymous.identity(req), id = req.params.id;
    if (!browser.recognized || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      return json(404, { error:"Booking not found." });
    const record = await store.bookings.get(id);
    if (!record || record.ownerHash !== browser.ownerHash) return json(404, { error:"Booking not found." });
    const share = await csat.ownedSharing(record);
    return { ...json(200, { ...anonymous.detail(record), ...(share ? { csatShare:share } : {}) }), cookies:[anonymous.cookie(req, browser.token)] };
  }
});

// Admin: update / delete a booking
http("bookingItem", {
  methods: ["PUT", "DELETE"], authLevel: "anonymous", route: "bookings/{id}",
  handler: async (req) => {
    if (!await isAdmin(req)) return DENIED;
    const id = req.params.id;
    const current = await store.bookings.getWithVersion(id);
    const existing = current?.value;
    if (!existing || existing.recordType) return json(404, { error: "Booking not found." });

    const actor = await adminUser(req);
    if (req.method === "DELETE") { await store.bookings.remove(id); return audited(req, 200, { ok:true }, "booking.delete", id, "Booking deleted", actor); }

    const p = await body(req);
    if (!p) return json(400, { error: "Invalid JSON body." });
    if (p.force !== undefined && typeof p.force !== "boolean") return json(400, { error:"force must be boolean." });
    const next = { ...existing };
    EDITABLE.forEach(k => {
      if (p[k] !== undefined) next[k] = clean(k === "participants" && typeof p[k] === "number" && Number.isFinite(p[k]) ? String(p[k]) : p[k]);
    });
    if (!STATUSES.includes(next.status)) return json(400, { error: "Invalid status." });
    if (!schema.validDate(next.trainingDate)) return json(400, { error: "trainingDate must be a valid YYYY-MM-DD calendar date." });
    if (!schema.validTime(next.time)) return json(400, { error:"Invalid training time range." });

    if (!p.force && isActive(next.status)) {
      const [all, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
      const c = findConflicts(all, blocks, next, id);
      if (c.length) return json(409, { code:"SLOT_CONFLICT", error: conflictMessage(c) });
    }
    next.updatedAt = new Date().toISOString();
    next.updatedBy = actor || "admin";
    schema.size(next);
    csat.transition(existing, next, await getIdentity(req));
    await store.bookings.compareAndSwap(id, next, current.version);
    return audited(req, 200, anonymous.withoutOwner(next), "booking.update", id, "Updated fields: " + EDITABLE.filter(k => p[k] !== undefined).join(", "), actor);
  }
});

// Public: busy slots for a date (no personal data exposed)
http("availability", {
  methods: ["GET"], authLevel: "anonymous", route: "availability",
  handler: async (req) => {
    const date = req.query.get("date") || "";
    if (!schema.validDate(date)) return json(400, { error: "date must be YYYY-MM-DD." });
    const [all, blocks] = await Promise.all([store.bookings.list(), store.blocks.list()]);
    return json(200, {
      date,
      busy: all.filter(b => isActive(b.status) && b.trainingDate === date).map(b => ({ facilitator: b.facilitator, time: b.time })),
      blocked: [...new Set(blocks.filter(x => inBlock(x, date)).map(x => x.facilitator))]
    });
  }
});

// Admin: blocked dates (leave / unavailability)
http("blocks", {
  methods: ["GET", "POST"], authLevel: "anonymous", route: "blocks",
  handler: async (req) => {
    if (!await isAdmin(req)) return DENIED;
    if (req.method === "GET") return json(200, await store.blocks.list());
    const b = await body(req);
    if (!b) return json(400, { error: "Invalid JSON body." });
    const rec = { facilitator: clean(b.facilitator), startDate: clean(b.startDate), endDate: clean(b.endDate || b.startDate), reason: clean(b.reason) };
    if (!rec.facilitator || !schema.validDate(rec.startDate) || !schema.validDate(rec.endDate) || rec.endDate < rec.startDate)
      return json(400, { error: "facilitator and a valid date range are required." });
    const actor = await adminUser(req);
    Object.assign(rec, { id: randomUUID(), createdAt: new Date().toISOString(), createdBy: actor || "admin" });
    schema.size(rec);
    await store.blocks.put(rec);
    return audited(req, 201, rec, "block.create", rec.id, "Availability block created", actor);
  }
});

http("blockItem", {
  methods: ["DELETE"], authLevel: "anonymous", route: "blocks/{id}",
  handler: async (req) => {
    if (!await isAdmin(req)) return DENIED;
    const actor = await adminUser(req);
    await store.blocks.remove(req.params.id);
    return audited(req, 200, { ok:true }, "block.delete", req.params.id, "Availability block deleted", actor);
  }
});

// ---------- admin authentication ----------
http("authLogin", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/login",
  handler: async (req) => {
    const b = await body(req);
    const u = clean(b && b.username), p = (b && b.password) ?? "";
    // Actual auth export takes (username, password), not req. Its snapshot must
    // issue the token directly; no credential version reread after verification.
    const who = await authenticateIdentity(u, p);
    if (!who) {
      await new Promise(r => setTimeout(r, 600)); // slow down guessing
      return json(401, { error: "Invalid username or password." });
    }
    return { ...json(200, safeIdentity(who)), cookies: [sessionCookie(req, issueToken(who.user, who.credentialVersion), TTL)] };
  }
});

http("authLogout", {
  methods: ["POST"], authLevel: "anonymous", route: "auth/logout",
  handler: async (req) => ({ ...json(200, { ok: true }), cookies: [sessionCookie(req, "", 0)] })
});

http("authMe", {
  methods: ["GET"], authLevel: "anonymous", route: "auth/me",
  handler: async (req) => json(200, safeIdentity(await getIdentity(req)) || { user:null })
});

http("authProfile", {
  methods:["GET", "PUT"], authLevel:"anonymous", route:"auth/profile",
  handler:async req => {
    if (req.method === "GET") return json(200, safeIdentity(await getProfile(req)));
    const actor = await adminUser(req), identity = safeIdentity(await updateProfile(req, await body(req)));
    return audited(req, 200, identity, "profile.update", identity.id, "Profile updated", actor);
  }
});
http("authPassword", {
  methods:["POST"], authLevel:"anonymous", route:"auth/password",
  handler:async req => {
    const actor = await adminUser(req), identity = await changePassword(req, await body(req));
    return { ...await audited(req, 200, { ok:true }, "password.change", identity.id, "Password changed; sessions invalidated", actor), cookies:[sessionCookie(req, "", 0)] };
  }
});
http("formConfig", {
  methods:["GET"], authLevel:"anonymous", route:"form-config",
  handler:async () => json(200, await forms.published())
});
http("formDraft", {
  methods:["GET", "PUT"], authLevel:"anonymous", route:"manage/form-draft",
  handler:async req => {
    if (req.method === "GET") return json(200, await forms.draft());
    const actor = await adminUser(req), result = await forms.saveDraft(await body(req));
    return audited(req, 200, result, "form.draft", result.revision, "Form draft saved", actor);
  }
});
http("formPublish", {
  methods:["POST"], authLevel:"anonymous", route:"manage/form-publish",
  handler:async req => {
    const actor = await adminUser(req), result = await forms.publish(await body(req));
    return audited(req, 200, result, "form.publish", result.version, "Form published", actor);
  }
});
http("activity", {
  methods:["GET"], authLevel:"anonymous", route:"manage/activity",
  handler:async req => json(200, await audit.list(req.query))
});
