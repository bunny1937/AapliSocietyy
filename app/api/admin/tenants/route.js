// GET /api/admin/tenants - flat-wise tenancy overview for the admin.
//
// Returns ONE entry per flat that has any tenancy signal (a live
// Member.currentTenant, past tenantHistory, or any TenantRequest), so the
// admin UI can render owner -> flat -> tenant cards with Active / Inactive /
// Requests sections instead of a bare pending-approval list.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import TenantRequest from "@/models/TenantRequest";
import { authorize } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const gate = await authorize(request, "member.tenantRequests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const societyId = gate.context.societyId;

    const [members, requests] = await Promise.all([
      Member.find({ societyId, isDeleted: { $ne: true } })
        .select("flatNo wing ownerName ownershipType currentTenant tenantHistory")
        .lean(),
      TenantRequest.find({ societyId }).sort({ createdAt: -1 }).limit(500).lean(),
    ]);

    const byMember = new Map();
    for (const r of requests) {
      const key = String(r.memberId);
      if (!byMember.has(key)) byMember.set(key, []);
      byMember.get(key).push({ ...r, _id: String(r._id) });
    }

    const flats = [];
    for (const m of members) {
      const mine = byMember.get(String(m._id)) || [];
      const history = m.tenantHistory || [];
      if (!m.currentTenant && history.length === 0 && mine.length === 0) continue;

      const pending = mine.filter((r) => r.status === "Pending");
      const approved = mine.find((r) => r.status === "Approved") || null;

      flats.push({
        memberId: String(m._id),
        flatNo: m.flatNo || "",
        wing: m.wing || "",
        ownerName: m.ownerName || "",
        ownershipType: m.ownershipType || "",
        currentTenant: m.currentTenant || null,
        state: m.currentTenant ? "Active" : pending.length ? "Requests" : "Inactive",
        activeRequest: approved,
        pendingRequests: pending,
        allRequests: mine,
        pastTenants: history,
        counts: { pending: pending.length, past: history.length, total: mine.length },
      });
    }

    const rank = { Requests: 0, Active: 1, Inactive: 2 };
    flats.sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        String(a.wing).localeCompare(String(b.wing)) ||
        String(a.flatNo).localeCompare(String(b.flatNo), undefined, { numeric: true }),
    );

    return NextResponse.json({
      success: true,
      flats,
      summary: {
        active: flats.filter((f) => f.state === "Active").length,
        requests: flats.filter((f) => f.state === "Requests").length,
        inactive: flats.filter((f) => f.state === "Inactive").length,
      },
    });
  } catch (err) {
    console.error("Admin tenants list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
