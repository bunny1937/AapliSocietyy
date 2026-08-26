// app/api/bills/scheduled-runs/route.js
//
// Admin-facing control for models/ScheduledBillRun — the queue "Push &
// schedule" writes to. Until this route existed, that queue was invisible:
// no screen showed it, no button touched it, and the only way to force a
// run early or retry a failed one was a developer hitting a raw cron URL
// with a bearer token in a terminal. This is what /admin/generate-bills'
// <ScheduledBillCard/> calls instead.
//
// GET  -> list this society's scheduled runs (for the card to render).
// POST -> { action: "run-now" | "cancel", id }.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import ScheduledBillRun from "@/models/ScheduledBillRun";
import { processScheduledBillRun } from "@/lib/billing/scheduledBillRuns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request) {
  const gate = await authorize(request, "billing.bill.generate");
  if (!gate.ok) return gate.response;
  const societyId = gate.context.societyId;

  await connectDB();
  const runs = await ScheduledBillRun.find({ societyId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  return NextResponse.json({ success: true, runs });
}

export async function POST(request) {
  const gate = await authorize(request, "billing.bill.generate");
  if (!gate.ok) return gate.response;
  const societyId = gate.context.societyId;
  const userId = gate.context.userId;

  const body = await request.json().catch(() => ({}));
  const { action, id, runAt } = body || {};
  if (!id || !["run-now", "cancel", "reschedule"].includes(action)) {
    return NextResponse.json({ error: "action and id are required" }, { status: 400 });
  }

  await connectDB();

  if (action === "reschedule") {
    const nextRunAt = new Date(runAt);
    if (Number.isNaN(nextRunAt.getTime())) {
      return NextResponse.json({ error: "Pick a valid date" }, { status: 400 });
    }
    const run = await ScheduledBillRun.findOneAndUpdate(
      { _id: id, societyId, status: { $in: ["SCHEDULED", "FAILED"] } },
      { $set: { runAt: nextRunAt, status: "SCHEDULED", error: null } },
      { new: true },
    ).lean();
    if (!run) {
      return NextResponse.json(
        { error: "Nothing to reschedule — it may already be running or finished." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, run });
  }

  if (action === "cancel") {
    const run = await ScheduledBillRun.findOneAndUpdate(
      { _id: id, societyId, status: "SCHEDULED" },
      { $set: { status: "CANCELLED", cancelledBy: userId, cancelledAt: new Date() } },
      { new: true },
    ).lean();
    if (!run) {
      return NextResponse.json(
        { error: "Nothing to cancel — it may have already run or been cancelled." },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, run });
  }

  // action === "run-now": force it regardless of runAt, whether it's still
  // SCHEDULED (admin doesn't want to wait) or FAILED (retry). Same atomic
  // claim pattern as claimNextDue, just without the runAt<=now gate.
  const run = await ScheduledBillRun.findOneAndUpdate(
    { _id: id, societyId, status: { $in: ["SCHEDULED", "FAILED"] } },
    { $set: { status: "RUNNING", startedAt: new Date(), lockedAt: new Date() } },
    { new: true },
  ).lean();
  if (!run) {
    return NextResponse.json(
      { error: "Nothing to run — it may already be running or finished." },
      { status: 409 },
    );
  }

  const result = await processScheduledBillRun({ ...run, performedBy: userId });
  return NextResponse.json({ success: true, ...result });
}
