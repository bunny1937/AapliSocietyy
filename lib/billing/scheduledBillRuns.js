// lib/billing/scheduledBillRuns.js
//
// One place that actually turns a models/ScheduledBillRun document into real
// bills. Used by BOTH:
//   - the daily cron drain (app/api/v1/cron/billing-admin-reminders) — picks
//     up runs whose runAt has passed, automatically, no human involved.
//   - the admin "Push now" button (app/api/bills/scheduled-runs) — the same
//     work, triggered on demand for a non-technical admin who doesn't want
//     to wait for the scheduled date, or whose run failed and needs a retry.
//
// Both callers must go through processScheduledBillRun() so there is exactly
// one code path that generates bills, notifies members, and updates run
// status — no drift between the automatic and manual triggers.

import Bill from "@/models/Bill";
import Member from "@/models/Member";
import ScheduledBillRun from "@/models/ScheduledBillRun";
import { generateBillsForMembers } from "@/lib/billing/generationService";
import { notifyBillCreated } from "@/lib/v1/notify";
import { isCommercialUnit } from "@/lib/commercial/constants";
import cache from "@/lib/cache";

/**
 * @param {object} run - a ScheduledBillRun doc (or .lean() object) already
 *   claimed/locked by the caller (status set to RUNNING before this is called).
 * @returns {{ generated: number, failed: number }}
 */
export async function processScheduledBillRun(run) {
  try {
    const [year, month] = run.periodId.split("-").map(Number);
    const activeMembers = await Member.find({
      societyId: run.societyId,
      isDeleted: { $ne: true },
    })
      .select("_id flatType")
      .lean();
    const seriesMembers =
      run.billSeries === "COMMERCIAL"
        ? activeMembers.filter((m) => isCommercialUnit(m))
        : activeMembers.filter((m) => !isCommercialUnit(m));
    const result = await generateBillsForMembers({
      societyId: run.societyId,
      memberIds: seriesMembers.map((m) => String(m._id)),
      year,
      month, // periodId is "YYYY-MM" 1-based, matching generateBillsForMembers's expected month
      performedBy: run.performedBy || "Cron",
      publishMode: "now",
      billClass: run.billSeries || "RESIDENTIAL",
    });

    const generatedIds = result.generated.map((g) => g.billId);
    const amounts = new Map(
      (await Bill.find({ _id: { $in: generatedIds } }).select("totalBillDue").lean()).map(
        (b) => [String(b._id), b.totalBillDue || 0],
      ),
    );
    for (const g of result.generated) {
      await notifyBillCreated({
        billId: g.billId,
        societyId: run.societyId,
        memberId: g.memberId,
        amount: amounts.get(String(g.billId)) || 0,
      }).catch((err) =>
        console.error("[SCHEDULED-BILL-RUN] notify failed for", g.billId, err.message),
      );
    }

    await ScheduledBillRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: "COMPLETED",
          completedAt: new Date(),
          billsCreated: result.generated.length,
        },
      },
    );
    await Promise.all([
      cache.del(`billing:generated:${run.societyId}`),
      cache.del(`payments:outstanding:${run.societyId}`),
      cache.delPattern(`v1:bills:${run.societyId}:member:*`),
      cache.delPattern(`v1:ledger:${run.societyId}:member:*`),
    ]);
    return { generated: result.generated.length, failed: result.failed.length };
  } catch (err) {
    console.error("[SCHEDULED-BILL-RUN] run failed for", run._id, err.message);
    await ScheduledBillRun.updateOne(
      { _id: run._id },
      { $set: { status: "FAILED", error: err.message } },
    );
    return { generated: 0, failed: 1 };
  }
}

/** Drains every currently-due run. Used by the cron only. */
export async function drainDueScheduledBillRuns() {
  let generated = 0;
  let failed = 0;
  let run;
  while ((run = await ScheduledBillRun.claimNextDue())) {
    const result = await processScheduledBillRun(run);
    generated += result.generated;
    failed += result.failed;
  }
  return { generated, failed };
}
