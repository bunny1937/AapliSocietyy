const cron = require("node-cron");
const fetch = require("node-fetch");

// Run every day at 12:01 AM
cron.schedule("1 0 * * *", async () => {
  console.log("[CRON] Running daily interest calculation...");
  try {
    const res = await fetch(
      "http://localhost:3000/api/ledger/calculate-interest",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Add admin token for auth
        },
      }
    );
    const data = await res.json();
    console.log("[CRON] Interest calculation result:", data);
  } catch (error) {
    console.error("[CRON] Interest calculation failed:", error);
  }
});
