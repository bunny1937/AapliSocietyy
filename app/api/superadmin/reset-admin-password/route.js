import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Society from "@/models/Society";
import { validateAdminRequest } from "@/lib/admin-middleware";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { passwordPolicyProblem } from "@/lib/password-policy";
function generatePassword() {
  // base64url won't reliably contain a symbol; append one so a
  // freshly-generated password still satisfies the shared policy.
  return randomBytes(8).toString("base64url") + "!";
}
// POST /api/superadmin/reset-admin-password
// Body: { societyId, newPassword? }
// Resets the Admin user password for a society.
// If newPassword provided, uses it. Otherwise generates one.
// Updates both User.password (bcrypt) and Society.credentials.plainPassword (plain for superadmin UI).
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { societyId, newPassword } = await request.json();
    if (!societyId) {
      return NextResponse.json(
        { error: "societyId required" },
        { status: 400 },
      );
    }
    const society = await Society.findById(societyId)
      .select("name credentials")
      .lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }
    const adminEmail = society.credentials?.adminEmail;
    if (!adminEmail) {
      return NextResponse.json(
        { error: "No admin email on record for this society" },
        { status: 404 },
      );
    }
    const plain = newPassword?.trim() || generatePassword();
    const pwProblem = passwordPolicyProblem(plain);
    if (pwProblem) {
      return NextResponse.json({ error: pwProblem }, { status: 400 });
    }
    const hash = await bcrypt.hash(plain, 10);
    // Update User doc
    const user = await User.findOneAndUpdate(
      { email: adminEmail, role: "Admin" },
      { $set: { password: hash, isActive: true } },
      { new: true },
    );
    if (!user) {
      return NextResponse.json(
        { error: `No Admin user found with email ${adminEmail}` },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      adminEmail,
      newPassword: plain,
      societyName: society.name,
    });
  } catch (err) {
    console.error("reset-admin-password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
