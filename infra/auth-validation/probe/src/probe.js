const { app } = require("@azure/functions");

// Data-free test only: no storage SDK, credentials, cookies or personal records.
app.http("authValidationProbe", {
  methods: ["GET"],
  authLevel: "anonymous", // Platform AuthV2 requires the trusted SWA before this handler runs.
  route: "auth-validation",
  handler: async request => {
    let roles = [];
    try {
      const value = request.headers.get("x-ms-client-principal");
      const principal = value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : null;
      if (principal && Array.isArray(principal.userRoles)) roles = principal.userRoles;
    } catch { /* Report only a boolean, never echo identity headers or tokens. */ }
    return {
      status: 200,
      headers: { "Cache-Control": "no-store" },
      jsonBody: { ok: true, probe: "isolated-auth-validation", receivedAdminRole: roles.includes("admin") }
    };
  }
});