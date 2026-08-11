// app/api/admin/security-guards/[id]/route.js
// Admin: update, reset password, or remove a security guard.
//   PATCH  { isActive?, gateLabel?, phone?, name? }
//   POST   { action: "reset-password", password? }  -> returns temp password if generated
//   DELETE -> soft-delete (isDeleted + deactivate)
import { NextResponse } from "next/server";
import crypto from "crypto";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { authorize } from "@/lib/rbac/authorize";
function isPlausiblePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
async function loadGuard(id, societyId) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return User.findOne({
    _id: id,
    role: "Security",
    societyId,
    isDeleted: { $ne: true },
  });
}
export async function PATCH(request, { params }) {
  const gate = await authorize(request, "security.guard.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const guard = await loadGuard(id, gate.context.societyId);
    if (!guard)
      return NextResponse.json({ error: "Guard not found" }, { status: 404 });
    const body = await request.json();
    const updates = {};
    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
    if (typeof body.gateLabel === "string") {
      const g = body.gateLabel.trim();
      if (g.length > 50)
        return NextResponse.json({ error: "Gate label too long" }, { status: 400 });
      updates.gateLabel = g || "Main Gate";
    }
    if (typeof body.name === "string" && body.name.trim())
      updates.name = body.name.trim();
    if (typeof body.phone === "string") {
      if (body.phone && !isPlausiblePhone(body.phone))
        return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
      updates.phone = body.phone.trim();
    }
    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    const before = {
      isActive: guard.isActive,
      gateLabel: guard.gateLabel,
      phone: guard.phone,
      name: guard.name,
    };
    Object.assign(guard, updates);
    await guard.save();
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_UPDATED", before, {
      id: guard._id.toString(),
      ...updates,
    });
    return NextResponse.json({
      success: true,
      guard: {
        id: guard._id.toString(),
        name: guard.name,
        username: guard.username,
        gateLabel: guard.gateLabel,
        phone: guard.phone || "",
        isActive: guard.isActive,
      },
    });
  } catch (err) {
    console.error("Update guard error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function POST(request, { params }) {
  const gate = await authorize(request, "security.guard.resetPin");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const guard = await loadGuard(id, gate.context.societyId);
    if (!guard)
      return NextResponse.json({ error: "Guard not found" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.action !== "reset-password")
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    // Either accept an admin-supplied password or generate a strong temp one.
    let newPassword = String(body.password || "");
    let generated = false;
    if (!newPassword) {
      newPassword = generatePassword();
      generated = true;
    } else if (
      newPassword.length < 8 ||
      !/[a-zA-Z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      return NextResponse.json(
        { error: "Password must be 8+ chars with a letter and a number" },
        { status: 400 },
      );
    }
    guard.password = await bcrypt.hash(newPassword, 10);
    await guard.save();
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_PASSWORD_RESET", null, {
      id: guard._id.toString(),
      username: guard.username,
    });
    // Show the temp password exactly once (only when generated).
    return NextResponse.json({
      success: true,
      username: guard.username,
      tempPassword: generated ? newPassword : undefined,
    });
  } catch (err) {
    console.error("Reset guard password error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function DELETE(request, { params }) {
  const gate = await authorize(request, "security.guard.delete");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const guard = await loadGuard(id, gate.context.societyId);
    if (!guard)
      return NextResponse.json({ error: "Guard not found" }, { status: 404 });
    guard.isDeleted = true;
    guard.isActive = false;
    await guard.save();
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_DELETED", null, {
      id: guard._id.toString(),
      username: guard.username,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete guard error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
function generatePassword() {
  // 10-char temp password guaranteed to contain a letter and a digit.
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  let out = letters[crypto.randomInt(letters.length)] + digits[crypto.randomInt(digits.length)];
  for (let i = 0; i < 8; i++) out += all[crypto.randomInt(all.length)];
  return out
    .split("")
    .sort(() => crypto.randomInt(3) - 1)
    .join("");
}
