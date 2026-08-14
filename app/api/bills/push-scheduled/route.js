import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { cronAuthorized } from "@/lib/v1/config";
import {
  recomputeScheduledBill,
  generateBillsForMembers,
} from "@/lib/billing/generationService";
import renderBillHtml from "@/lib/bill-renderer";
import { notifyBillCreated } from "@/lib/v1/notify";
import cache from "@/lib/cache";
import { isCommercialUnit } from "@/lib/commercial/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give the function room; the old default meant a large batch could be killed
// mid-loop, leaving some bills flipped and some not.
export const maxDuration = 300;

// ## Why this route was reported as "Failed (timeout)" by cron-job.org
//
// It was not failing. The bills were being pushed correctly — the 5:31 arrival
// notification proves the work completed. cron-job.org simply gives up waiting
// for the HTTP response after ~30 seconds and records a timeout, while the
// Vercel function keeps running to completion.
//
// That is worse than a real failure, because:
//   - the scheduler's success/failure log is now useless as a health signal
//   - cron-job.org retries jobs it believes failed, so a slow run could be
//     executed twice concurrently, each doing the same recompute
//   - you cannot tell a genuine outage from the normal case
//
// Three changes fix it:
//
//   1. BOUNDED BATCHES. Process at most BATCH_SIZE bills per invocation and
//      return immediately with { hasMore }. A run now finishes in seconds.
//   2. SELF-CHAINING. If there is more to do, kick off the next chunk with a
//      fire-and-forget request to this same route and return without waiting.
//      One scheduler tick still drains the whole queue; the scheduler just
//      isn't held open while it happens.
//   3. IN-FLIGHT GUARD. A short cache lock stops an overlapping retry from
//      double-processing the same bills.
//
// The per-bill work itself is also cheaper: Society documents are fetched once
// per society instead of once per bill, and the backfill's per-bill
// Bill.findById lookups are replaced with a single batched query.

const BATCH_SIZE = 25;
const LOCK_KEY = "cron:push-scheduled:lock";
const LOCK_TTL_SECONDS = 120;

async function handle(req) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const isChained = url.searchParams.get("chain") === "1";

  try {
    await connectDB();

    // Overlap guard. A chained continuation is allowed through because it is
    // the same logical run handing off to itself.
    if (!isChained) {
      const held = await cache.get(LOCK_KEY);
      if (held) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "A push-scheduled run is already in progress",
        });
      }
    }
    await cache.set(LOCK_KEY, String(Date.now()), LOCK_TTL_SECONDS);

    const now = new Date();
    now.setHours(23, 59, 59, 999); // include full day

    // Only take a bounded slice. `.limit(BATCH_SIZE + 1)` lets us detect that
    // more remain without a second countDocuments query.
    const dueSlice = await Bill.find({
      status: "Scheduled",
      scheduledPushDate: { $lte: now },
      isDeleted: { $ne: true },
    })
      .select("_id societyId memberId billPeriodId billMonth billYear billSeries")
      .limit(BATCH_SIZE + 1)
      .lean();

    const hasMore = dueSlice.length > BATCH_SIZE;
    const due = hasMore ? dueSlice.slice(0, BATCH_SIZE) : dueSlice;

    let pushed = 0;
    const errors = [];

    // Group by society+period so we can backfill members who don't yet have
    // a bill for that period (e.g. added after the scheduled batch ran).
    const groups = new Map();
    for (const b of due) {
      const billSeries = b.billSeries || "RESIDENTIAL";
      const key = `${b.societyId}|${b.billPeriodId}|${billSeries}`;
      if (!groups.has(key)) {
        groups.set(key, {
          societyId: b.societyId,
          billMonth: b.billMonth,
          billYear: b.billYear,
          billSeries,
          memberIds: new Set(),
        });
      }
      groups.get(key).memberIds.add(String(b.memberId));
    }

    // A society document is large (15KB of schema) and was being refetched for
    // every single bill. One fetch per distinct society per run instead.
    const societyCache = new Map();
    const getSociety = async (societyId) => {
      const k = String(societyId);
      if (!societyCache.has(k)) {
        societyCache.set(k, await Society.findById(societyId).lean());
      }
      return societyCache.get(k);
    };

    for (const b of due) {
      try {
        const bill = await recomputeScheduledBill(b._id);
        if (!bill) continue;

        const [member, society] = await Promise.all([
          Member.findById(bill.memberId)
            .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary")
            .lean(),
          getSociety(bill.societyId),
        ]);
        const breakdown =
          bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
        const renderResult = renderBillHtml(null, society, member, {
          breakdown,
          totalAmount: bill.currentCharges,
          previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
          prevRemPrincipal: bill.openingPrincipal,
          prevRemInt: bill.openingInterest,
          precomputedCurrInt: bill.currentInterest,
          precomputedMonthInterest: bill.billInterestBalance,
          balanceAmount: bill.balanceAmount,
          status: "Unpaid",
          billPeriod: bill.billPeriodId,
          billDate: new Date(bill.billYear, bill.billMonth, 1),
          dueDate: bill.dueDate,
          unpaidBills: [],
          recentTransactions: [],
        });
        bill.billHtml = renderResult.billHtml || renderResult.html;
        bill.status = "Unpaid";
        bill.scheduledPushDate = null;
        await bill.save();

        // Scheduled bills skip the "bill ready" notification at generation
        // time (they aren't due yet) — send it now that the bill is live.
        await notifyBillCreated({
          billId: bill._id,
          societyId: bill.societyId,
          memberId: bill.memberId,
          amount: bill.totalBillDue,
        });
        pushed++;
      } catch (err) {
        console.error("[PUSH-SCHEDULED] recompute failed for", b._id, err.message);
        errors.push({ billId: b._id, error: err.message });
      }
    }

    let backfilled = 0;
    for (const { societyId, billMonth, billYear, billSeries, memberIds } of groups.values()) {
      const activeMembers = await Member.find({ societyId, isDeleted: { $ne: true } })
        .select("_id flatType")
        .lean();
      const seriesMembers =
        billSeries === "COMMERCIAL"
          ? activeMembers.filter((m) => isCommercialUnit(m))
          : activeMembers.filter((m) => !isCommercialUnit(m));
      const missing = seriesMembers
        .map((m) => String(m._id))
        .filter((id) => !memberIds.has(id));
      if (!missing.length) continue;
      // publishMode "now" — these members are being backfilled INTO a batch
      // that's shipping live in this same run; "config" mode would re-check
      // billPushDay and could reschedule them again if config drifted since
      // the original batch was generated.
      const result = await generateBillsForMembers({
        societyId,
        memberIds: missing,
        year: billYear,
        month: billMonth + 1,
        performedBy: "Cron",
        publishMode: "now",
        billClass: billSeries,
      });

      // One query for all generated bills instead of a findById per bill.
      const generatedIds = result.generated.map((g) => g.billId);
      const amounts = new Map(
        (await Bill.find({ _id: { $in: generatedIds } }).select("totalBillDue").lean()).map(
          (b) => [String(b._id), b.totalBillDue || 0],
        ),
      );

      for (const g of result.generated) {
        await notifyBillCreated({
          billId: g.billId,
          societyId,
          memberId: g.memberId,
          amount: amounts.get(String(g.billId)) || 0,
        }).catch((err) => {
          console.error("[PUSH-SCHEDULED] notify failed for backfilled bill", g.billId, err.message);
        });
        backfilled++;
      }
      if (result.failed.length) {
        for (const f of result.failed) errors.push({ memberId: f.memberId, error: f.reason });
      }
    }

    if (pushed > 0 || backfilled > 0) {
      const societyIds = new Set(due.map((b) => String(b.societyId)));
      await Promise.all(
        [...societyIds].flatMap((sid) => [
          cache.del(`billing:generated:${sid}`),
          cache.del(`payments:outstanding:${sid}`),
          // Every member in this society just had a bill flip Scheduled ->
          // Unpaid (visible for the first time) or got backfilled a new one
          // - the mobile app's per-member bill/ledger cache for the whole
          // society is stale now, not just the members this batch touched.
          cache.delPattern(`v1:bills:${sid}:member:*`),
          cache.delPattern(`v1:ledger:${sid}:member:*`),
        ]),
      );
      await cache.del("admin:stats:global");
    }

    // Hand off the remainder to a fresh invocation and return NOW, so the
    // scheduler sees a fast 200 instead of timing out at 30s.
    if (hasMore) {
      triggerNextChunk(url).catch((err) =>
        console.error("[PUSH-SCHEDULED] chain kickoff failed", err.message),
      );
    } else {
      await cache.del(LOCK_KEY);
    }

    console.log(
      `[PUSH-SCHEDULED] Pushed ${pushed} bills, backfilled ${backfilled} new-member bills, hasMore=${hasMore}`,
    );
    return NextResponse.json({
      success: true,
      pushed,
      backfilled,
      hasMore,
      errors: errors.length ? errors : undefined,
    });
  } catch (error) {
    await cache.del(LOCK_KEY).catch(() => {});
    console.error("[PUSH-SCHEDULED] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Fire-and-forget continuation. We deliberately do NOT await the response —
 * only the connection being accepted. The secret is forwarded so the next
 * chunk passes cronAuthorized().
 */
async function triggerNextChunk(url) {
  const next = new URL(url.toString());
  next.searchParams.set("chain", "1");
  const headers = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  // No await on .json(); we just want the request dispatched.
  await fetch(next.toString(), { method: "GET", headers, cache: "no-store" });
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
