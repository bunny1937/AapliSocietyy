import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import jwt from "jsonwebtoken";
import { getAdminModels } from "@/lib/admin-models";
import cache from "@/lib/cache";
export async function GET(request) {
  try {
    // ✅ Simple JWT validation (no API key required)
    let token = request.cookies.get("admin_token")?.value;
    if (!token) {
      const authHeader = request.headers.get("authorization");
      if (authHeader?.startsWith("Bearer ")) token = authHeader.substring(7);
    }
    if (!token)
      return NextResponse.json({ error: "No token provided" }, { status: 401 });
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    } catch (error) {
      console.error("Token verification failed:", error.message);
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    // Check if SuperAdmin
    if (decoded.role !== "SuperAdmin") {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
    // Fetch stats
    await connectDB();
    const { Export } = await getAdminModels();
    const cacheKey = `admin:stats:global`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const [societyCount, memberCount, billCount, exportCount] =
      await Promise.all([
        Society.countDocuments({ isDeleted: false }),
        Member.countDocuments({}),
        Bill.countDocuments({}),
        Export.countDocuments({ isRestored: false }),
      ]);
    const responseData = {
      success: true,
      societies: societyCount,
      members: memberCount,
      bills: billCount,
      exports: exportCount,
    };
    await cache.set(cacheKey, responseData, 30);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
