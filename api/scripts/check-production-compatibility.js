const contract = require("../../app/api-contract");
async function check(fetcher = fetch) {
  const response = await fetcher("https://sellerdevelopmentrf.clouditechsolution.com/api/health", { redirect:"error", cache:"no-store", signal:AbortSignal.timeout(15000) });
  if (!response.ok || !(response.headers.get("content-type") || "").includes("json")) throw new Error("Production API health contract unavailable.");
  const value = await response.json();
  if (value.storage !== "table" || !contract.compatible(value)) throw new Error("Production backend is incompatible. Deploy the independent Functions API before this frontend release.");
  return true;
}
if (require.main === module) check().then(() => console.log("Production API compatibility verified.")).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { check };
