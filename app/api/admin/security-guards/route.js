// app/api/admin/security-guards/route.js
// Admin: create and list security guard accounts.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { authorize } from "@/lib/rbac/authorize";
import { ensureAdminAssignment } from "@/lib/rbac/ensure-admin-assignment";
import { passwordPolicyProblem } from "@/lib/password-policy";
function isPlausiblePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
export async function GET(request) {
  const gate = await authorize(request, "security.guard.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const guards = await User.find({
      role: "Security",
      societyId: gate.context.societyId,
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .select("name username gateLabel phone createdAt isActive")
      .lean();
    return NextResponse.json({ success: true, guards });
  } catch (err) {
    console.error("List guards error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function POST(request) {
  const gate = await authorize(request, "security.guard.create");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json();
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const gateLabel = String(body.gateLabel || "").trim();
    const phone = String(body.phone || "").trim();
    if (!name || !username || !password)
      return NextResponse.json(
        { error: "name, username, password required" },
        { status: 400 },
      );
    if (gateLabel.length > 50)
      return NextResponse.json(
        { error: "Gate label must be 50 characters or less" },
        { status: 400 },
      );
    // Phone is strongly recommended: it powers the guard one-tap call fallback.
    if (phone && !isPlausiblePhone(phone))
      return NextResponse.json(
        { error: "Enter a valid contact number for the guard" },
        { status: 400 },
      );
    const pwProblem = passwordPolicyProblem(password);
    if (pwProblem)
      return NextResponse.json({ error: pwProblem }, { status: 400 });
    if (!/^[a-z0-9_]{4,30}$/.test(username))
      return NextResponse.json(
        { error: "Username: 4-30 chars, letters/numbers/underscore only" },
        { status: 400 },
      );
    const exists = await User.findOne({ username }).lean();
    if (exists)
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    const hashed = await bcrypt.hash(password, 10);
    const guard = await User.create({
      name,
      username,
      password: hashed,
      role: "Security",
      societyId: gate.context.societyId,
      gateLabel: gateLabel || "Main Gate",
      phone,
      isActive: true,
    });
    // The login route no longer accepts the bare root role string (see
    // app/api/auth/login/route.js) — without this a guard signing in through
    // the general login page (rather than /api/security/auth/login, which
    // mints its own token independent of RoleAssignment) would find zero
    // profiles.
    await ensureAdminAssignment({
      userId: guard._id,
      societyId: gate.context.societyId,
      legacyRole: "Security",
    });
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_CREATED", null, {
      id: guard._id.toString(),
      name: guard.name,
      username: guard.username,
      gateLabel: guard.gateLabel,
      role: guard.role,
    });
    return NextResponse.json({
      success: true,
      guard: {
        id: guard._id.toString(),
        name: guard.name,
        username: guard.username,
        gateLabel: guard.gateLabel,
        phone: guard.phone || "",
      },
    });
  } catch (err) {
    if (isDuplicateKeyError(err))
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    console.error("Create guard error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
