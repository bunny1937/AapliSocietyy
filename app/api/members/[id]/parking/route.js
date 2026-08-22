// POST /api/members/[id]/parking
//
// Admin-direct add / edit / remove of a flat's parking slots.
//
// Parking is BILLABLE (non-Stilt slots attract a monthly charge via the
// parking billing heads — see lib/calculate-member-bill.js), so this endpoint
// does two things the read-only screens never could:
//
//   1. Applies the change through the SAME applyProfileEditPayload() the
//      mobile approval queue uses, including the "Stilt is never billed" rule.
//   2. Optionally re-runs the current period's bill through the shared
//      recalculation helper, which refuses to touch a bill that already has a
//      payment against it.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import AuditLog from "@/models/AuditLog";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { applyProfileEditPayload } from "@/lib/profile-edit-apply";
import { parkingSlotSchema } from "@/lib/validators";
import { recalcMemberBillForPeriod, BillLockedError } from "@/lib/billing/memberBillRecalc";

const ACTIONS = new Set(["Add", "Edit", "Remove"]);

export async function POST(request, { params }) {
  try {
    const gate = await authorize(request, "member.member.update");
    if (!gate.ok) return gate.response;
    await connectDB();

    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "The parking details did not reach the server. Please try again.", code: "BAD_BODY" },
        { status: 400 },
      );
    }

    const action = String(body.action || "");
    if (!ACTIONS.has(action)) {
      return NextResponse.json(
        { error: "Say whether this is an Add, an Edit or a Remove.", code: "BAD_ACTION" },
        { status: 400 },
      );
    }

    let payload = { ...(body.payload ?? {}) };
    if (action !== "Remove") {
      const shape = action === "Add" ? parkingSlotSchema : parkingSlotSchema.partial();
      const parsed = shape.safeParse(payload);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({
          field: i.path.join(".") || "form",
          message: i.message,
        }));
        return NextResponse.json(
          { error: issues[0]?.message || "Those parking details could not be saved.", code: "VALIDATION_ERROR", issues },
          { status: 400 },
        );
      }
      payload = { ...parsed.data };
    }
    // applyProfileEditPayload identifies the slot by slotId (or slotNumber) and
    // takes the rename from `newSlotNumber` / `slotNumber` — pass both through
    // untouched so an Edit can rename as well as retype a slot.
    if (body.slotId) payload.slotId = body.slotId;
    if (body.newSlotNumber !== undefined) payload.newSlotNumber = body.newSlotNumber;

    if (action !== "Add" && !payload.slotId && !payload.slotNumber) {
      return NextResponse.json(
        { error: "Which parking slot? No slot was identified.", code: "NO_TARGET" },
        { status: 400 },
      );
    }

    const member = await Member.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
    if (!member) {
      return NextResponse.json({ error: "That flat could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }

    const before = (member.parkingSlots || []).map((p) => p.toObject?.() ?? p);

    // A duplicate slot number on the same flat is always a data-entry mistake,
    // and it makes the Edit-by-slotNumber path ambiguous later.
    if (action === "Add") {
      const clash = before.some(
        (p) => String(p.slotNumber).trim().toLowerCase() === String(payload.slotNumber).trim().toLowerCase(),
      );
      if (clash) {
        return NextResponse.json(
          {
            error: `This flat already has a parking slot numbered ${payload.slotNumber}.`,
            code: "DUPLICATE_SLOT",
            hint: "Use a different slot number, or edit the existing one.",
          },
          { status: 409 },
        );
      }
    }

    try {
      applyProfileEditPayload(member, { section: "Parking", action, payload });
    } catch (err) {
      if (err?.code === "PARKING_SLOT_NOT_FOUND") {
        return NextResponse.json(
          {
            error: "That parking slot is no longer on this flat — someone may have removed it already.",
            code: err.code,
            hint: "Refresh the flat and try again.",
          },
          { status: 404 },
        );
      }
      throw err;
    }

    member.lastModifiedBy = decoded.userId;
    await member.save();
    await cache.delPattern(`members:list:${societyId}:*`);

    let billRecalculated = false;
    let recalcNote = null;
    if (body.recalcBillPeriodId) {
      const result = await recalcMemberBillForPeriod({
        member,
        societyId,
        billPeriodId: body.recalcBillPeriodId,
        performedBy: decoded.userId,
        reason: `Parking ${action.toLowerCase()} — bill charges recalculated from BillingHeads for period ${body.recalcBillPeriodId}`,
      });
      billRecalculated = result.recalculated;
      recalcNote = result.reason ?? null;
    }

    await AuditLog.create({
      userId: decoded.userId,
      societyId,
      action: `MEMBER_PARKING_${action.toUpperCase()}`,
      oldData: { parkingSlots: before },
      newData: { parkingSlots: member.parkingSlots },
      timestamp: new Date(),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      parkingSlots: member.parkingSlots,
      billRecalculated,
      recalcNote,
      message:
        action === "Add"
          ? "Parking slot added."
          : action === "Remove"
            ? "Parking slot removed."
            : "Parking slot updated.",
    });
  } catch (error) {
    if (error instanceof BillLockedError) {
      // The slot change itself is already saved — only the bill rewrite was
      // refused, and the admin needs to be told exactly that.
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          hint: "The parking change was saved. Only the existing bill was left alone.",
        },
        { status: error.status },
      );
    }
    console.error("members/[id]/parking error:", error);
    return NextResponse.json(
      { error: error?.message || "This change could not be saved.", code: "PARKING_UPDATE_FAILED" },
      { status: 500 },
    );
  }
}
