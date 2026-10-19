/* Run in the repository before packaging api/. No production install hook. */
const fs = require("node:fs");
const path = require("node:path");
function build() {
  const source = path.resolve(__dirname, "../../app");
  const destination = path.resolve(__dirname, "../src/form-assets");
  const files = ["form-config.js", "form-schema.js", "csat-config.js", "csat-schema.js"];
  // Read both first: missing canonical source must fail before changing copies.
  const assets = files.map(name => fs.readFileSync(path.join(source, name)));
  fs.mkdirSync(destination, { recursive:true });
  files.forEach((name, index) => fs.writeFileSync(path.join(destination, name), assets[index]));
}
if (require.main === module) build();
module.exports = { build };