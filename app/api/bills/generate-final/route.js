import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Shop from "@/models/Shop";
import Society from "@/models/Society";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { notifyBillCreated } from "@/lib/v1/notify";
import { mapLimit } from "@/lib/concurrency";
import { ndjsonResponse } from "@/lib/ndjson-stream";
import { transactionDeleteFilterForRegenerate } from "@/lib/billing/regenerateFilter";
import { authorize } from "@/lib/rbac/authorize";

// Each member's bill generation was previously awaited one at a time — for
// 84 members at ~2.5s/member (several sequential Mongo round trips each,
// crossing regions between the Vercel function and the DB) that serialized
// to 3-4 minutes, right up against the 5-minute function limit, with zero
// feedback to the admin waiting on it. Different members never touch each
// other's Bill/Member/Transaction docs, so generating them concurrently is
// safe — only cap concurrency to avoid exhausting the DB connection pool.
const CONCURRENCY = 8;

// Ledger V2: THIN WRAPPER over the shared GenerationService. Contains no
// billing math of its own — charges/interest/totals are recomputed from
// BillingHeads inside generateBill(). The request body's `bills` array is
// used ONLY to select which members to generate for; any client-supplied
// amounts are ignored, same policy as /api/billing/generate.
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const {
      billMonth,
      billYear,
      bills,
      forceRegenerate,
      publishMode = "config",
      scheduledPushDate = null,
      billSeries = "RESIDENTIAL",
    } = await request.json();
    if (billMonth === undefined || !billYear || !bills) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    if (!["RESIDENTIAL", "COMMERCIAL"].includes(billSeries)) {
      return NextResponse.json({ error: "billSeries must be RESIDENTIAL or COMMERCIAL" }, { status: 400 });
    }
    if (!["config", "now", "schedule"].includes(publishMode)) {
      return NextResponse.json({ error: "publishMode must be config, now, or schedule" }, { status: 400 });
    }
    if (publishMode === "schedule") {
      const d = new Date(scheduledPushDate);
      if (!scheduledPushDate || Number.isNaN(d.getTime()) || d <= new Date()) {
        return NextResponse.json({ error: "Choose a future scheduled push date" }, { status: 400 });
      }
    }
    const month = billMonth + 1; // client sends 0-indexed month
    const billPeriodId = `${billYear}-${String(month).padStart(2, "0")}`;
    const societyId = decoded.societyId;

    // Block generation for periods that have locked historical bills.
    const historicalExists = await Bill.findOne({
      societyId,
      billPeriodId,
      billSeries,
      $or: [{ isHistoricalArchive: true }, { importedFrom: "BulkImport" }, { isLocked: true }],
      isDeleted: { $ne: true },
    });
    if (historicalExists) {
      return NextResponse.json(
        {
          error: `Cannot generate bills for ${billPeriodId} — this period has locked historical (imported) records. Historical bills are immutable audit records.`,
          isHistoricalPeriod: true,
        },
        { status: 409 },
      );
    }

    const existing = await Bill.findOne({ societyId, billPeriodId, billSeries });
    if (existing) {
      if (!forceRegenerate) {
        return NextResponse.json(
          { error: `${billSeries === "COMMERCIAL" ? "Commercial bills" : "Bills"} for ${billPeriodId} already exist`, canForce: true },
          { status: 409 },
        );
      }
      // Explicit admin-confirmed regeneration — delete and recreate via the
      // same canonical engine, never patch financial values in place. Only
      // THIS series' bills/transactions are touched.
      const staleBillIds = (
        await Bill.find({ societyId, billPeriodId, billSeries }).select("_id").lean()
      ).map((b) => b._id);
      await Bill.deleteMany({ societyId, billPeriodId, billSeries });
      await Transaction.deleteMany(
        transactionDeleteFilterForRegenerate(societyId, billPeriodId, staleBillIds),
      );
    }

    const memberIds = [...new Set(bills.map((b) => String(b.memberId)).filter(Boolean))];
    if (!memberIds.length)
      return NextResponse.json({ error: "No members to generate for" }, { status: 400 });

    const society = await Society.findById(societyId).lean();

    async function generateOneMember(memberId) {
      const bill = await generateBill({
        societyId,
        memberId,
        year: billYear,
        month,
        performedBy: decoded.userId,
        publishMode,
        scheduledFor: scheduledPushDate,
        billClass: billSeries,
      });

      // `memberId` is the unit id — a Shop._id on the commercial path (a shop
      // has no Member row). Always fetching from Member here returned null
      // for every commercial bill and fed a blank object into rendering,
      // notification and the advance-credit step below. Normalised to the
      // same field names bill-renderer.js already expects, so nothing
      // downstream needs a billSeries-aware branch of its own.
      const unit =
        billSeries === "COMMERCIAL"
          ? await Shop.findById(memberId)
              .select("shopNo wing ownerName ownerPhone ownerEmail ownerMemberId areaSqft")
              .lean()
          : await Member.findById(memberId)
              .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary advanceCredit openingBalance")
              .lean();
      const member =
        unit && billSeries === "COMMERCIAL"
          ? {
              flatNo: unit.shopNo,
              wing: unit.wing,
              ownerName: unit.ownerName,
              carpetAreaSqft: unit.areaSqft,
              contactNumber: unit.ownerPhone,
              emailPrimary: unit.ownerEmail,
              advanceCredit: 0, // shops carry no advance-credit concept
              openingBalance: 0,
              ownerMemberId: unit.ownerMemberId ? String(unit.ownerMemberId) : null,
            }
          : unit;
      const breakdown =
        bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
      const unitFilter = billSeries === "COMMERCIAL" ? { shopId: memberId } : { memberId };
      const [unpaidBills, recentTransactions] = await Promise.all([
        Bill.find({
          societyId,
          ...unitFilter,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
          billPeriodId: { $ne: billPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .lean(),
        Transaction.find({ societyId, ...unitFilter }).sort({ date: -1 }).limit(10).lean(),
      ]);
      const renderResult = renderBillHtml(null, society, member, {
        breakdown,
        totalAmount: bill.currentCharges,
        previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
        prevRemPrincipal: bill.openingPrincipal,
        prevRemInt: bill.openingInterest,
        precomputedCurrInt: bill.currentInterest,
        precomputedMonthInterest: bill.billInterestBalance,
        balanceAmount: bill.balanceAmount,
        status: bill.status,
        billPeriod: billPeriodId,
        billDate: new Date(billYear, billMonth, 1),
        dueDate: bill.dueDate,
        unpaidBills,
        recentTransactions,
      });
      await Bill.updateOne({ _id: bill._id }, { $set: { billHtml: renderResult.billHtml || renderResult.html } });

      const lastTxn = await Transaction.findOne({ societyId, isReversed: false, ...unitFilter })
        .sort({ date: -1, createdAt: -1 })
        .lean();
      const prevBal = parseFloat((lastTxn?.balanceAfterTransaction ?? member?.openingBalance ?? 0).toFixed(2));
      await Transaction.create({
        transactionId: Transaction.generateTransactionId(),
        date: bill.generatedAt || new Date(),
        // Transaction.memberId is required — a shop with no linked owner has
        // no member id to give it, so it falls back to the shop's own id
        // (same convention Bill.memberId uses). shopId is the field every
        // commercial lookup actually keys on.
        memberId: billSeries === "COMMERCIAL" ? member?.ownerMemberId || memberId : memberId,
        shopId: billSeries === "COMMERCIAL" ? memberId : null,
        billSeries,
        societyId,
        type: "Debit",
        category: "Maintenance",
        description: `Bill generated for ${billPeriodId}`,
        amount: bill.totalBillDue,
        balanceAfterTransaction: parseFloat((prevBal + bill.totalBillDue).toFixed(2)),
        paymentMode: "System",
        referenceId: bill._id,
        referenceModel: "Bill",
        billPeriodId,
        createdBy: decoded.userId,
      });

      // Apply any stored advance credit THROUGH the AllocationEngine — no
      // independent advance math here. Skip Scheduled bills (not yet live).
      if (bill.status !== "Scheduled" && (member?.advanceCredit || 0) > 0) {
        const applied = Math.min(parseFloat(member.advanceCredit.toFixed(2)), bill.totalBillDue);
        if (applied > 0) {
          const ar = await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: decoded.userId });
          await Bill.updateOne({ _id: bill._id }, { $inc: { advanceApplied: applied }, $set: { status: ar.balanceAmount > 0 ? "Unpaid" : "Paid" } });
          await Member.updateOne({ _id: memberId }, { $inc: { advanceCredit: -applied } });
        }
      }

      // Notify the owning member if the shop is linked to one — a shop id has
      // no device tokens / notification recipient of its own.
      const notifyTargetId = billSeries === "COMMERCIAL" ? member?.ownerMemberId || null : memberId;
      if (bill.status !== "Scheduled" && notifyTargetId) {
        await notifyBillCreated({ billId: bill._id, societyId, memberId: notifyTargetId, amount: bill.totalBillDue, period: billPeriodId });
      }
      return { billId: bill._id, flat: `${member?.wing || ""}-${member?.flatNo || ""}`, ownerName: member?.ownerName };
    }

    function classifyError(err, memberId) {
      if (err.code === "P4_DUPLICATE") return { memberId, error: `Bill already exists for ${billPeriodId}` };
      if (err.code === "MEMBER_NOT_FOUND") return { memberId, error: "Member not found" };
      if (err.code === "SHOP_NOT_FOUND") return { memberId, error: "Shop not found" };
      if (err.code && /^[BP]\d/.test(err.code)) return { memberId, error: `Invariant ${err.code}: ${err.message}` };
      console.error(`Error creating bill for ${memberId}:`, err);
      return { memberId, error: err.message };
    }

    return ndjsonResponse(async (emit) => {
      const createdBills = [];
      const errors = [];

      await mapLimit(memberIds, CONCURRENCY, generateOneMember, (settled, memberId, done, total) => {
        if (settled.status === "fulfilled") {
          createdBills.push(settled.value.billId);
          emit({ type: "progress", done, total, memberId, flat: settled.value.flat, ownerName: settled.value.ownerName, ok: true });
        } else {
          errors.push(classifyError(settled.reason, memberId));
          emit({ type: "progress", done, total, memberId, ok: false, error: settled.reason.message });
        }
      });

      await cache.delPattern(`billing:list:${societyId}:*`);
      await cache.del(`billing:generated:${societyId}`);
      await cache.del(`payments:outstanding:${societyId}`);
      await cache.del(`admin:stats:global`);
      // New bills for every member in this run - the mobile app's per-member
      // cache must not serve last period's bills/ledger after this.
      await cache.delPattern(`v1:bills:${societyId}:member:*`);
      await cache.delPattern(`v1:ledger:${societyId}:member:*`);

      return {
        success: true,
        message: `Generated ${createdBills.length} bill(s)`,
        billPeriodId,
        billSeries,
        count: createdBills.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        publishMode,
        scheduledPushDate: publishMode === "schedule" ? scheduledPushDate : null,
      };
    });
  } catch (error) {
    console.error("Generate final bills error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
