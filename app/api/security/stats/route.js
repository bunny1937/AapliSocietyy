// app/api/security/stats/route.js
// GET — Live gate stats for the security dashboard.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import { requireSecurity } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
function toId(id) {
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
}
export async function GET(request) {
  const gate = await authorize(request, "visitor.gate.view");
  if (!gate.ok) return gate.response;
  const auth = requireSecurity(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const societyId = auth.user.societyId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [byStatusToday, insideNow, pendingNow, totalToday] = await Promise.all([
      Visitor.aggregate([
        { $match: { societyId: toId(societyId), createdAt: { $gte: startOfDay } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Visitor.countDocuments({ societyId, status: "Entered" }),
      Visitor.countDocuments({ societyId, status: "Pending" }),
      Visitor.countDocuments({ societyId, createdAt: { $gte: startOfDay } }),
    ]);
    const statusMap = byStatusToday.reduce((acc, r) => {
      acc[r._id] = r.count;
      return acc;
    }, {});
    return NextResponse.json({
      success: true,
      stats: {
        totalToday,
        insideNow,
        pendingNow,
        approvedToday: statusMap.Approved || 0,
        enteredToday: statusMap.Entered || 0,
        exitedToday: statusMap.Exited || 0,
        rejectedToday: statusMap.Rejected || 0,
        expiredToday: statusMap.Expired || 0,
      },
    });
  } catch (err) {
    console.error("Security stats error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
