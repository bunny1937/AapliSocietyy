// POST /api/onboarding/set-credentials
// Body: { token, username, email, password }
// Public (no auth) - the token is the credential. Re-entering the email is
// a lightweight confirmation that the person completing this is actually
// the account owner (the verify endpoint never reveals the full email).
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { verifyToken } from "@/lib/jwt";
import { passwordPolicyProblem } from "@/lib/password-policy";
const USERNAME_RE = /^[a-z0-9_-]{4,30}$/;
export async function POST(request) {
  try {
    const { token, username, email, password } = await request.json();
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });
    const decoded = verifyToken(token);
    if (!decoded || decoded.purpose !== "onboarding") {
      return NextResponse.json({ error: "This link is invalid or has expired." }, { status: 400 });
    }
    const normalizedUsername = String(username || "").trim().toLowerCase();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const rawPassword = String(password || "");
    if (!USERNAME_RE.test(normalizedUsername)) {
      return NextResponse.json(
        { error: "Username must be 4-30 characters: letters, numbers, underscore, or hyphen only." },
        { status: 400 },
      );
    }
    const pwProblem = passwordPolicyProblem(rawPassword);
    if (pwProblem) {
      return NextResponse.json({ error: pwProblem }, { status: 400 });
    }
    await connectDB();
    const user = await User.findById(decoded.userId);
    if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
    if (!user.mustChangePassword) {
      return NextResponse.json({ error: "This account has already been set up — please log in." }, { status: 400 });
    }
    if (String(user.email || "").trim().toLowerCase() !== normalizedEmail) {
      return NextResponse.json({ error: "Email does not match our records." }, { status: 400 });
    }
    const usernameTaken = await User.findOne({ username: normalizedUsername, _id: { $ne: user._id } }).lean();
    if (usernameTaken) {
      return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
    }
    user.username = normalizedUsername;
    user.password = await bcrypt.hash(rawPassword, 10);
    user.mustChangePassword = false;
    await user.save();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Set-credentials error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
