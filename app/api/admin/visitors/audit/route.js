// app/api/admin/visitors/audit/route.js
// GET — Admin/Secretary read-only view of the offline visitor-entry audit trail.
//   ?action=VISITOR_ENTRY_FLAGGED  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD  ?page=1
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import AuditLog from "@/models/AuditLog";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
const OFFLINE_ACTIONS = [
  "VISITOR_OFFLINE_ENTRY",
  "VISITOR_ENTRY_CONFIRMED",
  "VISITOR_ENTRY_FLAGGED",
];
export async function GET(request) {
  const gate = await authorize(request, "visitor.audit.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      100,
      parseInt(searchParams.get("limit") || "25", 10),
    );
    const query = {
      societyId: gate.context.societyId,
      action: OFFLINE_ACTIONS.includes(action)
        ? action
        : { $in: OFFLINE_ACTIONS },
    };
    if (from || to) {
      query.timestamp = {};
      if (from) query.timestamp.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.timestamp.$lte = end;
      }
    }
    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("userId", "name gateLabel email")
        .lean(),
      AuditLog.countDocuments(query),
    ]);
    return NextResponse.json({
      success: true,
      logs,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch (err) {
    console.error("Visitor audit error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
