const enabled = process.env.LOCAL_DATA_MODE === "shared-production";
const endpoint = "https://sellerdevelopment.table.core.windows.net/";
const origin = "https://sellerdevelopmentrf.clouditechsolution.com";
if (enabled && (process.env.WEBSITE_SITE_NAME || process.env.STORAGE_TABLE_ENDPOINT !== endpoint ||
    process.env.STORAGE_CONNECTION_STRING || process.env.STORAGE_TEST_FILE || process.env.SHARED_PRODUCTION_ACK !== "LIVE_DATA_WRITES" ||
    process.env.AZURE_TENANT_ID !== "3250f76b-9ac9-409f-a84f-f4867a615ef3" ||
    !process.env.CSAT_SIGNING_KEY || process.env.CSAT_SIGNING_KEY.length < 32 ||
    !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET === process.env.CSAT_SIGNING_KEY ||
    process.env.CSAT_PUBLIC_ORIGIN !== origin)) throw new Error("Shared production mode prerequisites are missing or invalid.");
module.exports = { enabled, endpoint, origin };
