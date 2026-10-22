/* Shared, dependency-free browser/CommonJS schema. Render text with textContent,
 * not HTML. Choice labels are persisted values; order is presentation only,
 * routing uses start / next / choice.goto (an absent next ends the form). */
(function (root, factory) {
  const schema = factory();
  if (typeof module === "object" && module.exports) module.exports = schema;
  if (root) root.FormSchema = schema;
})(typeof window === "object" ? window : null, function () {
  "use strict";
  const MAX_BYTES = 30 * 1024;
  const REQUIRED = ["requestor", "division", "category", "trainingDate", "facilitator", "time", "venue"];
  const FIELDS = [...REQUIRED, "requesterEmail", "director", "topic", "participants", "recommendations"];
  const TYPES = ["text", "textarea", "email", "number", "date", "choice", "multi"];
  const BACKDROPS = Object.freeze(["auto", "soft", "shapes", "aurora", "grid", "waves", "plain"]);
  const GLASS_DEFAULTS = Object.freeze({ glassEnabled:false, glassTransparency:20, glassBlur:12, glassBackdrop:"auto" });
  const unsafe = new Set(["__proto__", "prototype", "constructor"]);
  const fail = message => { throw Object.assign(new Error(message), { statusCode:400, expose:true }); };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const object = o => !!o && typeof o === "object" && !Array.isArray(o);
  function size(value) {
    const encoded = JSON.stringify(value);
    if (!encoded || encoded.length * 2 > MAX_BYTES) fail("JSON must fit within 30 KiB (UTF-16).");
    return value;
  }
  function keys(o, allowed) {
    if (!object(o) || Object.keys(o).some(k => unsafe.has(k) || !allowed.includes(k))) fail("Unknown or unsafe schema property.");
  }
  function id(value) {
    if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || unsafe.has(value)) fail("Invalid stable ID.");
    return value;
  }
  function text(value, max = 200, empty = false) {
    if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(value)) fail("Invalid text or length; HTML is not supported.");
    return value.trim();
  }
  const label = c => typeof c === "string" ? c : c.label;
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function validTime(value) {
    if (typeof value !== "string") return false;
    const m = value.match(/^(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!m || +m[1] < 1 || +m[1] > 12 || +m[4] < 1 || +m[4] > 12 || +m[2] > 59 || +m[5] > 59) return false;
    const minutes = (h, min, ap) => (+h % 12) * 60 + +min + (ap.toUpperCase() === "PM" ? 720 : 0);
    return minutes(m[1], m[2], m[3]) < minutes(m[4], m[5], m[6]);
  }
  function validate(input) {
    size(input);
    keys(input, ["title", "start", "questions", "order", "sections", "theme"]);
    if (!object(input.questions)) fail("questions must be an object.");
    const ids = Object.keys(input.questions);
    if (!ids.length || ids.length > 60) fail("Use 1–60 questions.");
    const out = { title:text(input.title), start:id(input.start), questions:{}, order:input.order || ids,
      sections:input.sections || [], theme:input.theme || { primary:"#0f766e", background:"#f8fafc", density:"comfortable", width:"standard", cardStyle:"outlined" } };
    if (!Array.isArray(out.order) || out.order.length !== ids.length || new Set(out.order).size !== ids.length || out.order.some(k => !own(input.questions, k))) fail("order must contain every question ID exactly once.");
    out.order = out.order.map(id);
    if (!Array.isArray(out.sections) || out.sections.length > 20) fail("Use at most 20 sections.");
    const sectionIds = new Set();
    out.sections = out.sections.map(s => {
      keys(s, ["id", "title", "description"]);
      const v = { id:id(s.id), title:text(s.title) };
      if (sectionIds.has(v.id)) fail("Duplicate section ID.");
      sectionIds.add(v.id);
      if (s.description !== undefined) v.description = text(s.description, 1000, true);
      return v;
    });
    keys(out.theme, ["primary", "background", "darkPrimary", "darkBackground", "density", "width", "cardStyle", ...Object.keys(GLASS_DEFAULTS)]);
    for (const key of ["darkPrimary", "darkBackground"]) {
      if (out.theme[key] !== undefined && (typeof out.theme[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(out.theme[key]))) fail("Invalid theme color: " + key);
    }
    if (![out.theme.primary, out.theme.background].every(v => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) ||
        !["compact", "comfortable"].includes(out.theme.density) || !["narrow", "standard", "wide"].includes(out.theme.width) ||
        !["outlined", "elevated", "flat"].includes(out.theme.cardStyle)) fail("Invalid theme tokens.");
    out.theme = { ...GLASS_DEFAULTS, ...out.theme };
    if (typeof out.theme.glassEnabled !== "boolean") fail("Glass enabled must be boolean.");
    if (!BACKDROPS.includes(out.theme.glassBackdrop)) fail("Invalid page background.");
    for (const [key, max] of [["glassTransparency", 40], ["glassBlur", 20]]) {
      if (typeof out.theme[key] !== "number" || !Number.isFinite(out.theme[key]) || out.theme[key] < 0 || out.theme[key] > max) fail("Invalid glass setting: " + key);
    }
    for (const key of ids) {
      id(key);
      const q = input.questions[key];
      keys(q, ["title", "type", "required", "field", "next", "choices", "allowOther", "max", "min", "section", "help", "placeholder"]);
      if (!TYPES.includes(q.type)) fail("Unsupported question type.");
      const v = { title:text(q.title), type:q.type, required:q.required === undefined ? false : q.required };
      if (unsafe.has(v.title)) fail("Unsafe question title.");
      if (typeof v.required !== "boolean") fail("required must be boolean.");
      if (q.field !== undefined) { if (!FIELDS.includes(q.field)) fail("Unknown booking field mapping."); v.field = q.field; }
      if (q.next !== undefined) v.next = id(q.next);
      if (q.section !== undefined) { v.section = id(q.section); if (!sectionIds.has(v.section)) fail("Unknown section."); }
      for (const k of ["help", "placeholder"]) if (q[k] !== undefined) v[k] = text(q[k], k === "help" ? 1000 : 200, true);
      if (["choice", "multi"].includes(v.type)) {
        if (!Array.isArray(q.choices) || !q.choices.length || q.choices.length > 50) fail("Use 1–50 choices.");
        v.choices = q.choices.map(c => {
          if (typeof c === "string") return text(c);
          keys(c, ["label", "goto"]);
          const option = { label:text(c.label) };
          if (c.goto !== undefined) { if (v.type !== "choice") fail("Only single choice supports branching."); option.goto = id(c.goto); }
          return option;
        });
        if (new Set(v.choices.map(label)).size !== v.choices.length) fail("Choice labels must be unique.");
        if (q.allowOther !== undefined) { if (v.type !== "choice" || typeof q.allowOther !== "boolean") fail("allowOther is single-choice only."); v.allowOther = q.allowOther; }
      } else if (q.choices !== undefined || q.allowOther !== undefined) fail("Choices require choice or multi type.");
      for (const bound of ["min", "max"]) if (q[bound] !== undefined) {
        if (!["number", "multi"].includes(v.type) || !Number.isSafeInteger(q[bound]) || Math.abs(q[bound]) > 1000000 || (v.type === "multi" && (q[bound] < 1 || q[bound] > v.choices.length))) fail("Invalid min/max bound.");
        v[bound] = q[bound];
      }
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) fail("min exceeds max.");
      if (v.field === "participants" && v.type !== "number") fail("participants must be number.");
      if (v.field === "requesterEmail" && (v.type !== "email" || !v.required)) fail("requesterEmail must be a required email question.");
      if (v.field && !["topic"].includes(v.field) && v.type === "multi") fail("Only topic supports a multi-valued booking mapping.");
      out.questions[key] = v;
    }
    const Q = out.questions;
    if (!own(Q, out.start)) fail("Unknown start question.");
    for (const [key, field, type] of [["date", "trainingDate", "date"], ["facilitator", "facilitator", "choice"], ["time", "time", "choice"]]) {
      if (!Q[key] || Q[key].field !== field || Q[key].type !== type || !Q[key].required || Q[key].allowOther) fail("Protected scheduling question: " + key);
    }
    if (!Q.time.choices.every(c => validTime(label(c)))) fail("Time choices must be valid, increasing AM/PM ranges.");
    // Memoized DAG analysis: intersect guaranteed fields at branch joins; union
    // possible fields to reject duplicate mappings on even one active path.
    const visiting = new Set(), memo = new Map();
    function walk(key) {
      if (!key) return { guaranteed:new Set(), possible:new Set() };
      if (!own(Q, key)) fail("Unknown branch target: " + key);
      if (visiting.has(key)) fail("Branch graph must be acyclic.");
      if (memo.has(key)) return memo.get(key);
      visiting.add(key);
      const q = Q[key], targets = q.type === "choice" ? q.choices.map(c => (typeof c === "object" && c.goto) || q.next) : [q.next];
      if (q.type === "choice" && (q.allowOther || !q.required)) targets.push(q.next);
      const children = targets.map(walk), possible = new Set(children.flatMap(c => [...c.possible]));
      const guaranteed = new Set([...children[0].guaranteed].filter(f => children.every(c => c.guaranteed.has(f))));
      if (q.field) {
        if ((q.field === "facilitator" && possible.has("trainingDate")) ||
            (q.field === "time" && (possible.has("trainingDate") || possible.has("facilitator"))))
          fail("Every route must schedule trainingDate before facilitator before time.");
        if (possible.has(q.field)) fail("Duplicate field mapping on a branch: " + q.field);
        possible.add(q.field);
        if (q.required) guaranteed.add(q.field);
      }
      visiting.delete(key);
      const result = { possible, guaranteed }; memo.set(key, result); return result;
    }
    // Validate even dormant next targets and disallow hidden/unreachable questions.
    for (const q of Object.values(Q)) {
      if (q.next && !own(Q, q.next)) fail("Unknown next target.");
      for (const c of q.choices || []) if (typeof c === "object" && c.goto && !own(Q, c.goto)) fail("Unknown choice target.");
    }
    const checked = new Set(), stack = new Set();
    function checkEdges(key) {
      if (stack.has(key)) fail("Branch graph must be acyclic.");
      if (checked.has(key)) return;
      stack.add(key);
      const q = Q[key];
      for (const target of [q.next, ...(q.choices || []).map(c => typeof c === "object" && c.goto)].filter(Boolean)) checkEdges(target);
      stack.delete(key); checked.add(key);
    }
    ids.forEach(checkEdges);
    const result = walk(out.start);
    if (memo.size !== ids.length) fail("Every question must be reachable from start.");
    if (REQUIRED.some(f => !result.guaranteed.has(f))) fail("Every branch must include required fields: " + REQUIRED.join(", "));
    if (result.possible.has("requesterEmail") && !result.guaranteed.has("requesterEmail")) fail("Every branch must include Your Email.");
    for (const field of FIELDS.filter(f => !["director", "topic"].includes(f))) {
      if (Object.values(Q).filter(q => q.field === field).length > 1) fail("Only director/topic may alias exclusive branches.");
    }
    return size(out);
  }
  function submission(config, values) {
    size(values);
    if (!object(values) || Object.keys(values).some(k => unsafe.has(k) || !own(config.questions, k))) fail("answerValues must use known stable question IDs.");
    const fields = {}, answerValues = {}, answers = {}, answerSnapshot = [], active = new Set();
    let key = config.start;
    while (key) {
      if (active.has(key)) fail("Invalid form route.");
      active.add(key);
      const q = config.questions[key], supplied = own(values, key) ? values[key] : undefined;
      let value = supplied;
      const blank = value === undefined || value === null || value === "" || (q.type === "multi" && Array.isArray(value) && !value.length);
      if (blank && q.required) fail("Required answer: " + key);
      if (!blank) {
        if (q.type === "number") {
          if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1000000 || (q.min !== undefined && value < q.min) || (q.max !== undefined && value > q.max) || (q.field === "participants" && (!Number.isSafeInteger(value) || value < 1))) fail("Invalid number: " + key);
        } else if (q.type === "multi") {
          if (!Array.isArray(value) || new Set(value).size !== value.length || value.some(v => typeof v !== "string" || !q.choices.map(label).includes(v)) || value.length < (q.min || 0) || value.length > (q.max || q.choices.length)) fail("Invalid multi answer: " + key);
          value = value.slice();
        } else {
          value = text(value, q.type === "textarea" ? 2000 : q.type === "email" ? 254 : 200);
          if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("Invalid email: " + key);
          if (q.type === "date" && !validDate(value)) fail("Invalid calendar date: " + key);
          if (q.type === "choice" && !q.choices.map(label).includes(value) && !q.allowOther) fail("Invalid choice: " + key);
        }
        if (q.field) fields[q.field] = Array.isArray(value) ? value.join("; ") : String(value);
        answerValues[key] = value;
        // defineProperty avoids prototype setters even for user-edited titles.
        Object.defineProperty(answers, q.title, { value:Array.isArray(value) ? value.join("; ") : String(value), enumerable:true, configurable:true });
        answerSnapshot.push({ id:key, title:q.title, value });
      }
      const option = q.type === "choice" && q.choices.find(c => label(c) === value);
      key = (option && typeof option === "object" && option.goto) || q.next;
    }
    if (Object.keys(values).some(k => !active.has(k))) fail("Answers on inactive branches must be removed.");
    if (REQUIRED.some(f => !fields[f])) fail("Missing essential booking answers.");
    return size({ ...fields, answerValues, answers, answerSnapshot });
  }
  return { MAX_BYTES, REQUIRED, FIELDS, TYPES, GLASS_DEFAULTS, BACKDROPS, validate, submission, validDate, validTime, size };
});