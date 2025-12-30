const cron = require("node-cron");
const fetch = require("node-fetch");

// ✅ JOB 1: Mark overdue bills (runs at 12:01 AM daily)
cron.schedule("1 0 * * *", async () => {
  console.log("[CRON] Marking overdue bills...");
  try {
    const res = await fetch("http://localhost:3000/api/bills/mark-overdue", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    console.log("[CRON] Mark overdue result:", data);
  } catch (error) {
    console.error("[CRON] Mark overdue failed:", error);
  }
});

// ✅ JOB 2: Calculate interest (runs at 12:05 AM daily)
cron.schedule("5 0 * * *", async () => {
  console.log("[CRON] Running interest calculation...");
  try {
    const res = await fetch(
      "http://localhost:3000/api/ledger/calculate-interest",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    const data = await res.json();
    console.log("[CRON] Interest calculation result:", data);
  } catch (error) {
    console.error("[CRON] Interest calculation failed:", error);
  }
});

console.log("✅ Cron jobs scheduled:");
console.log("  - Mark overdue bills: 12:01 AM daily");
console.log("  - Calculate interest: 12:05 AM daily");
