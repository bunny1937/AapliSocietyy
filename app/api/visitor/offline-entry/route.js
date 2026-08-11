// app/api/visitor/offline-entry/route.js
// Records a visitor the guard has ALREADY let in (the offline / network-down
// fallback). Creates the visitor as already "Entered", fires a different,
// high-priority "someone entered to meet you" notification, and logs everything.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import { notifyOfflineEntry } from "@/lib/visitor-notify";
const ALLOWED_PURPOSES = [
  "Guest",
  "Delivery",
  "Domestic Help",
  "Vendor",
  "Cab",
  "Other",
];
const MEMBER_FIELDS =
  "flatNo wing ownerName ownershipType currentTenant whatsappNumber contactNumber alternateContact emailPrimary emailSecondary";
export async function POST(request) {
  const gate = await authorize(request, "visitor.visitor.offlineEntry");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const photo = String(body.photo || "").trim();
    const purpose = String(body.purpose || "").trim();
    const purposeNote = String(body.purposeNote || "").trim();
    const note = String(body.note || "").trim();
    const memberId = String(body.memberId || "").trim();
    const flatNo = String(body.flatNo || "").trim();
    const wing = String(body.wing || "").trim();
    const clientRef = String(body.clientRef || "").trim();
    if (!name || !ALLOWED_PURPOSES.includes(purpose)) {
      return NextResponse.json(
        { error: "name and a valid purpose are required" },
        { status: 400 },
      );
    }
    // Resolve the flat: by id first, otherwise by wing + flatNo (offline-friendly).
    const baseQuery = {
      societyId: gate.context.societyId,
      isDeleted: { $ne: true },
    };
    let member = null;
    if (memberId) {
      member = await Member.findOne(Object.assign({ _id: memberId }, baseQuery))
        .select(MEMBER_FIELDS)
        .lean();
    }
    if (!member && flatNo) {
      const q = Object.assign({ flatNo }, baseQuery);
      if (wing) q.wing = wing;
      const matches = await Member.find(q)
        .select(MEMBER_FIELDS)
        .limit(2)
        .lean();
      if (matches.length === 1) member = matches[0];
    }
    if (!member) {
      // 422 => client keeps it queued and asks the guard to fix the flat.
      return NextResponse.json(
        { error: "Could not match that flat. Pick the exact flat and retry." },
        { status: 422 },
      );
    }
    const queuedAt = body.queuedAt ? new Date(body.queuedAt) : new Date();
    // De-dupe: if this device entry was already synced, return the existing row.
    if (clientRef) {
      const existing = await Visitor.findOne({
        societyId: gate.context.societyId,
        "offlineMeta.clientRef": clientRef,
      }).lean();
      if (existing) {
        return NextResponse.json({
          success: true,
          deduped: true,
          visitor: {
            id: existing._id,
            status: existing.status,
            name: existing.name,
          },
          notified: true,
        });
      }
    }
    const visitor = await Visitor.create({
      societyId: gate.context.societyId,
      memberId: member._id,
      name,
      phone,
      photo,
      purpose,
      purposeNote,
      status: "Entered", // they have physically entered already
      entryMethod: "OfflineEntry",
      entryTime: queuedAt,
      enteredBy: gate.context.userId,
      gateLabel: gate.context.gateLabel || "Main Gate",
      offlineMeta: {
        wasOffline: true,
        queuedAt,
        syncedAt: new Date(),
        note,
        clientRef,
        confirmation: { status: "Pending", at: null, by: null },
      },
    });
    // Different, high-priority alert: "X has ENTERED to meet you".
    let notifyResult = { steps: [], anyReachable: false };
    try {
      const society = await Society.findById(gate.context.societyId)
        .select("name")
        .lean();
      notifyResult = await notifyOfflineEntry({
        society: society || { _id: gate.context.societyId },
        member,
        visitor,
        guard: {
          name: gate.context.name || "Security",
          phone: gate.context.phone || "",
        },
      });
      if (notifyResult.steps && notifyResult.steps.length) {
        visitor.escalation = visitor.escalation || {};
        visitor.escalation.history = (visitor.escalation.history || []).concat(
          notifyResult.steps.map((s) =>
            Object.assign({}, s, { at: new Date() }),
          ),
        );
        visitor.escalation.lastNotifiedAt = new Date();
        await visitor.save();
      }
    } catch (e) {
      // Never fail the entry just because a notification channel hiccuped.
      console.error("offline-entry notify error", e && e.message);
    }
    await logAudit(
      gate.context.userId,
      gate.context.societyId,
      "VISITOR_OFFLINE_ENTRY",
      null,
      {
        id: String(visitor._id),
        memberId: String(member._id),
        flatNo: member.flatNo,
        wing: member.wing,
        name: visitor.name,
        purpose: visitor.purpose,
        wasOffline: true,
        queuedAt,
        note,
        clientRef,
      },
    );
    const notified = !!(
      notifyResult.anyReachable || (notifyResult.steps || []).some((s) => s.ok)
    );
    return NextResponse.json({
      success: true,
      visitor: { id: visitor._id, status: visitor.status, name: visitor.name },
      notified,
    });
  } catch (err) {
    console.error("Offline entry error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
