const fs = require("node:fs");
const path = require("node:path");
const source = require.resolve("qrcode-generator");
const destination = path.resolve(__dirname, "../../app/vendor/qrcode.js");
fs.mkdirSync(path.dirname(destination), { recursive:true });
fs.copyFileSync(source, destination);
