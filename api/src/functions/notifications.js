const { app } = require("@azure/functions");
const notifications = require("../notifications");

app.timer("emailNotifications", {
  schedule:"*/15 * * * * *",
  useMonitor:true,
  runOnStartup:false,
  handler:async (_timer, context) => {
    try {
      const result = await notifications.runWorker();
      if (result.processed) context.log("Email outbox worker", result);
    } catch {
      // Provider/storage errors can contain addresses or request payloads.
      context.error("Email outbox worker failed; inspect durable outbox state and configuration.");
    }
  }
});
