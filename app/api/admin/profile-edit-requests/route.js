// GET /api/admin/profile-edit-requests?status=Pending — list profile edit
// requests for the admin's society. `status` defaults to "Pending"; pass
// status=all for every status. Each item is enriched with a `member`
// summary (flatNo/wing/ownerName) so the admin UI doesn't need a second
// round trip per row.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import Member from "@/models/Member";
import Shop from "@/models/Shop";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  const gate = await authorize(request, "member.profileEditRequest.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "Pending";
    const query = { societyId: gate.context.societyId };
    if (status !== "all") query.status = status;
    const items = await ProfileEditRequest.find(query).sort({ createdAt: -1 }).limit(200).lean();
    const memberIds = [...new Set(items.filter((i) => i.memberId).map((i) => String(i.memberId)))];
    const shopIds = [...new Set(items.filter((i) => i.shopId).map((i) => String(i.shopId)))];
    const [members, shops] = await Promise.all([
      Member.find({ _id: { $in: memberIds } }).select("flatNo wing ownerName").lean(),
      Shop.find({ _id: { $in: shopIds } }).select("tradeName shopNo wing").lean(),
    ]);
    const memberById = new Map(members.map((m) => [String(m._id), m]));
    const shopById = new Map(shops.map((s) => [String(s._id), s]));
    return NextResponse.json({
      success: true,
      items: items.map((item) => ({
        ...item,
        member: item.memberId ? memberById.get(String(item.memberId)) || null : null,
        shop: item.shopId ? shopById.get(String(item.shopId)) || null : null,
      })),
    });
  } catch (err) {
    console.error("Profile edit requests list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
