// app/api/admin/visitors/analytics/route.js
// GET — Visitor analytics for Admin/Secretary.
//   ?days=30  -> daily volume, purpose split, peak hours, avg approval time.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  const gate = await authorize(request, "visitor.visitor.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const days = Math.min(
      365,
      Math.max(1, parseInt(searchParams.get("days") || "30", 10)),
    );
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);
    const societyId = new mongoose.Types.ObjectId(String(gate.context.societyId));
    const match = { societyId, createdAt: { $gte: since } };
    const [daily, byPurpose, byHour, byStatus, approvalAgg] = await Promise.all(
      [
        Visitor.aggregate([
          { $match: match },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        Visitor.aggregate([
          { $match: match },
          { $group: { _id: "$purpose", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        Visitor.aggregate([
          { $match: match },
          { $group: { _id: { $hour: "$entryTime" }, count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),
        Visitor.aggregate([
          { $match: match },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        Visitor.aggregate([
          {
            $match: {
              ...match,
              approvedAt: { $ne: null },
              entryTime: { $ne: null },
            },
          },
          {
            $project: {
              mins: {
                $divide: [{ $subtract: ["$approvedAt", "$entryTime"] }, 60000],
              },
            },
          },
          { $group: { _id: null, avgMins: { $avg: "$mins" }, n: { $sum: 1 } } },
        ]),
        Visitor.aggregate([
          { $match: { ...match, entryMethod: "OfflineEntry" } },
          {
            $group: {
              _id: "$offlineMeta.confirmation.status",
              count: { $sum: 1 },
            },
          },
        ]),
      ],
    );
    return NextResponse.json({
      success: true,
      range: { days, since },
      daily,
      byPurpose,
      byHour,
      byStatus: byStatus.reduce((a, r) => ((a[r._id] = r.count), a), {}),
      avgApprovalMinutes: approvalAgg[0]?.avgMins
        ? Math.round(approvalAgg[0].avgMins * 10) / 10
        : null,
    });
  } catch (err) {
    console.error("Visitor analytics error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
