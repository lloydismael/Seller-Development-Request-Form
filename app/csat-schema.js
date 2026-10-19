(function (root) {
  const config = typeof module === "object" && module.exports ? require("./csat-config") : root.CsatConfig;
  const invalid = message => Object.assign(new Error(message), { statusCode:400, expose:true });
  function validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || JSON.stringify(input).length > 12000) throw invalid("Invalid survey answers.");
    const branch = Object.hasOwn(config.branches, input.division) ? config.branches[input.division] : null;
    const keys = ["name", "division", ...(branch ? ["director"] : []), ...config.ratings.map(q => q.id), ...config.texts.map(q => q.id)];
    if (Object.keys(input).some(k => !keys.includes(k))) throw invalid("Unknown or inactive survey answer.");
    const out = {}, snapshot = [];
    const text = (id, title, max) => {
      const value = input[id];
      if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw invalid(`${title} is required (maximum ${max} characters).`);
      out[id] = value.trim(); snapshot.push({ id, title, value:out[id] });
    };
    const choice = (id, title, options) => {
      const selected = options.find(c => c.id === input[id]);
      if (!selected) throw invalid(`Choose a valid ${title}.`);
      out[id] = selected.id; snapshot.push({ id, title, value:selected.label, choiceId:selected.id });
    };
    text("name", "FULL NAME", 200);
    choice("division", "DIVISION", config.divisions);
    if (branch) choice("director", branch.question, branch.choices);
    for (const q of config.ratings) {
      if (!Number.isInteger(input[q.id]) || input[q.id] < 1 || input[q.id] > 5) throw invalid(`${q.title} requires a rating from 1 to 5.`);
      out[q.id] = input[q.id]; snapshot.push({ id:q.id, title:q.title, value:input[q.id] });
    }
    for (const q of config.texts) text(q.id, q.title, 2000);
    return { version:config.version, answers:out, answerSnapshot:snapshot };
  }
  const api = { validate };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CsatSchema = api;
})(typeof window === "object" ? window : globalThis);
