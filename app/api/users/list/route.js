import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import User from "@/models/User";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  const gate = await authorize(request, "rbac.user.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const users = await User.find({
      societyId: decoded.societyId,
      isActive: true,
    })
      .select("_id name email role")
      .lean();
    return NextResponse.json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Users list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
