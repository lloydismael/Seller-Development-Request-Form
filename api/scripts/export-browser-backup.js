/* One-shot local backup receiver. Not an API endpoint and never deployed. */
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const origin = "http://localhost:3000";
const target = path.join(__dirname,"..",".migration","localhost-3000-snapshot.json");
const server = http.createServer(async (req,res) => {
  if (req.headers.origin !== origin || req.url !== "/backup") { res.writeHead(403); res.end(); return; }
  res.setHeader("Access-Control-Allow-Origin",origin);
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST" || req.headers["content-type"] !== "application/json") { res.writeHead(405); res.end(); return; }
  const chunks = []; let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) throw new Error("Backup too large");
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!Array.isArray(data.bookings) || !Array.isArray(data.blocks)) throw new Error("Invalid snapshot");
    await fs.mkdir(path.dirname(target),{recursive:true});
    // Never overwrite an earlier backup, even on a repeated request.
    await fs.writeFile(target,JSON.stringify(data,null,2),{flag:"wx"});
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({saved:true,bookings:data.bookings.length,blocks:data.blocks.length}));
    console.log(`Private backup saved: ${data.bookings.length} bookings, ${data.blocks.length} blocks.`);
    server.close();
  } catch (err) {
    res.writeHead(400); res.end(JSON.stringify({saved:false,error:err.code === "EEXIST" ? "Backup already exists; originals unchanged." : "Backup failed; originals unchanged."}));
  }
});
server.listen(7072,"127.0.0.1",()=>console.log("One-shot backup receiver listening on loopback port 7072."));
// Safety timeout; not a persistent public service.
setTimeout(()=>server.close(),120000).unref();