/* Repository runs use canonical assets; API-only packages require build copies.
 * Do not catch asset errors or silently fall back to stale generated defaults. */
const fs = require("node:fs");
const path = require("node:path");
const canonical = path.resolve(__dirname, "../../app");
const directory = fs.existsSync(canonical) ? canonical : path.join(__dirname, "form-assets");
module.exports = {
  schema: require(path.join(directory, "form-schema.js")),
  defaults: require(path.join(directory, "form-config.js"))
};