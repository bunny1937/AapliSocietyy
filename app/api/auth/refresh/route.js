import { NextResponse } from "next/server";
import { verifyToken, signToken } from "@/lib/jwt";

export async function POST(request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    const decoded = verifyToken(token);

    if (!decoded) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const newToken = signToken({
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      societyId: decoded.societyId,
    });

    return NextResponse.json({
      token: newToken,
      message: "Token refreshed successfully",
    });
  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json(
      { error: "Token refresh failed" },
      { status: 500 }
    );
  }
}
