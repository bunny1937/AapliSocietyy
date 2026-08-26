// POST /api/onboarding/activate
//
// Step 2 of the app onboarding flow. Sets the username + password ONCE, and in
// doing so activates every flat sitting under that email.
//
// This is the app-side sibling of /api/onboarding/set-credentials. It exists
// separately rather than reusing that route because the web route assumes a
// single-flat, single-token, cookie-redirect flow, while the app needs:
//   - the multi-flat summary back in the response, to render the "3 flats
//     activated" confirmation;
//   - no cookie (the app holds a bearer token);
//   - the split-account repair, so legacy imports are healed on activation.
//
// Rules are IDENTICAL to the website so a member gets the same answer either
// way - deliberately duplicated as named constants rather than loosened.

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Society from "@/models/Society";
import Shop from "@/models/Shop";
import { verifyToken } from "@/lib/jwt";
import { passwordPolicyProblem } from "@/lib/password-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USERNAME_RE = /^[a-z0-9_-]{4,30}$/;

// Blocked usernames. Someone claiming "admin" or "security" inside a society
// portal is a social-engineering problem waiting to happen.
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "superadmin", "root", "system", "support",
  "security", "guard", "watchman", "secretary", "treasurer", "accountant",
  "auditor", "society", "aaplisociety", "help", "billing", "noreply",
  "no-reply", "postmaster", "webmaster", "test", "null", "undefined",
]);

// Rejected outright regardless of the letter+digit rule. These are the
// passwords that actually show up in society portals.
const WEAK_PASSWORDS = new Set([
  "password1", "passw0rd", "abcd1234", "admin123", "member123", "welcome1",
  "qwerty123", "123456a", "a123456", "pass1234", "society1", "flat1234",
]);

function passwordProblem(pw, { username, email, name, flats }) {
  const policyIssue = passwordPolicyProblem(pw);
  if (policyIssue) return policyIssue;
  const lower = pw.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) {
    return "That password is too common. Choose something only you would pick.";
  }
  if (username && lower.includes(String(username).toLowerCase())) {
    return "Password cannot contain your username.";
  }
  if (email && lower.includes(String(email).split("@")[0].toLowerCase())) {
    return "Password cannot contain your email address.";
  }
  if (name) {
    const first = String(name).trim().split(/\s+/)[0].toLowerCase();
    if (first.length >= 4 && lower.includes(first)) {
      return "Password cannot contain your name.";
    }
  }
  // A flat number is public information inside the building.
  for (const f of flats || []) {
    const flat = String(f.flatNo || "").toLowerCase();
    if (flat.length >= 3 && lower.includes(flat)) {
      return "Password cannot contain your flat number.";
    }
  }
  if (/^(.)\1+$/.test(pw)) {
    return "Password cannot be a single repeated character.";
  }
  return null;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = String(body.token || "");
  const username = String(body.username || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const confirmPassword = String(body.confirmPassword || "");

  // ── Token ─────────────────────────────────────────────────────────────
  const decoded = verifyToken(token);
  if (!decoded || decoded.purpose !== "onboarding") {
    return NextResponse.json(
      { error: "This activation link is invalid or has expired." },
      { status: 400 },
    );
  }

  // ── Shape checks before touching the database ────────────────────────────
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      {
        error:
          "Username must be 4–30 characters, lowercase letters, numbers, hyphen or underscore only.",
        field: "username",
      },
      { status: 400 },
    );
  }
  if (RESERVED_USERNAMES.has(username)) {
    return NextResponse.json(
      { error: "That username is reserved. Please choose another.", field: "username" },
      { status: 400 },
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: "The two passwords do not match.", field: "confirmPassword" },
      { status: 400 },
    );
  }

  await connectDB();

  const user = await User.findById(decoded.userId);
  if (!user) {
    return NextResponse.json(
      { error: "This account no longer exists. Contact your society admin." },
      { status: 404 },
    );
  }
  if (!user.mustChangePassword) {
    return NextResponse.json(
      {
        error: "This account has already been set up — please log in.",
        alreadySetUp: true,
      },
      { status: 400 },
    );
  }

  // Re-entered email must match exactly. Same rule and wording as the website.
  if (email !== String(user.email || "").toLowerCase()) {
    return NextResponse.json(
      { error: "Email does not match our records.", field: "email" },
      { status: 400 },
    );
  }

  // ── Every account sharing this email ────────────────────────────────────
  // If a pre-fix import split Bhavani across three User docs, activating one
  // of them would leave the other two stranded with mustChangePassword: true
  // and no token. We merge them here - this is the self-healing path for data
  // already in production.
  const siblings = await User.find({
    email: user.email,
    _id: { $ne: user._id },
  });

  const password_hash = await bcrypt.hash(password, 10);

  const flatsForPolicy = [
    ...(user.profiles || []),
    ...siblings.flatMap((s) => s.profiles || []),
  ];

  const pwProblem = passwordProblem(password, {
    username,
    email,
    name: user.name,
    flats: flatsForPolicy,
  });
  if (pwProblem) {
    return NextResponse.json({ error: pwProblem, field: "password" }, { status: 400 });
  }

  // Username uniqueness. The unique+sparse index is the real guarantee; this
  // check exists to return a friendly message instead of a duplicate-key error.
  const clash = await User.findOne({ username, _id: { $ne: user._id } }).lean();
  if (clash) {
    return NextResponse.json(
      { error: "That username is already taken.", field: "username" },
      { status: 409 },
    );
  }

  const session = await mongoose.startSession();
  let mergedCount = 0;

  try {
    await session.withTransaction(async () => {
      // Absorb sibling profiles into the account being activated.
      if (siblings.length > 0) {
        const existingKeys = new Set(
          (user.profiles || []).map(
            (p) => `${p.societyId}:${p.wing || ""}:${p.flatNo}`,
          ),
        );
        for (const sib of siblings) {
          for (const p of sib.profiles || []) {
            const key = `${p.societyId}:${p.wing || ""}:${p.flatNo}`;
            if (existingKeys.has(key)) continue;
            existingKeys.add(key);
            user.profiles.push({
              ...(p.toObject ? p.toObject() : p),
              profileId: new mongoose.Types.ObjectId(),
              isPrimary: false,
            });
            mergedCount += 1;
          }
        }
        // Deactivate the shells rather than deleting them, so any historical
        // reference (audit rows, receipts) still resolves. They can never be
        // logged into: isActive false is checked by /api/auth/login.
        await User.updateMany(
          { _id: { $in: siblings.map((s) => s._id) } },
          {
            $set: {
              isActive: false,
              mustChangePassword: false,
              mergedIntoUserId: user._id,
              mergedAt: new Date(),
            },
            $unset: { username: "" },
          },
          { session },
        );
      }

      // Exactly one profile carries isPrimary.
      if (!user.profiles.some((p) => p.isPrimary) && user.profiles.length > 0) {
        user.profiles[0].isPrimary = true;
      }

      user.username = username;
      user.password = password_hash;
      user.mustChangePassword = false;
      user.isActive = true;
      // Force the flat picker on the next login rather than resuming whatever
      // profile happened to be active.
      user.activeProfileId = undefined;
      await user.save({ session });
    });
  } finally {
    await session.endSession();
  }

  // ── Response ────────────────────────────────────────────────────────
  // No cookie and no session token. Activation is not authentication - the app
  // sends the member to the login screen, which is where the flat picker
  // lives. One place that issues sessions, not two.
  const societyIds = [...new Set(user.profiles.map((p) => String(p.societyId)))];
  const societies = await Society.find(
    { _id: { $in: societyIds } },
    { societyName: 1 },
  ).lean();
  const nameById = new Map(societies.map((s) => [String(s._id), s.societyName]));
  const shopIds = [...new Set(user.profiles.filter((p) => p.kind === "Commercial").map((p) => String(p.shopId)))];
  const shops = shopIds.length
    ? await Shop.find({ _id: { $in: shopIds } }).select("shopNo wing tradeName").lean()
    : [];
  const shopById = new Map(shops.map((s) => [String(s._id), s]));

  return NextResponse.json({
    success: true,
    username: user.username,
    name: user.name,
    activatedFlats: user.profiles.map((p) => {
      if (p.kind === "Commercial") {
        const shop = shopById.get(String(p.shopId));
        const label = [shop?.wing, shop?.shopNo].filter(Boolean).join("-") || "Shop";
        return {
          profileId: String(p.profileId),
          kind: "Commercial",
          label,
          shopNo: shop?.shopNo ?? null,
          wing: shop?.wing ?? null,
          tradeName: shop?.tradeName ?? null,
          societyName: p.societyName || nameById.get(String(p.societyId)) || "Society",
          isPrimary: !!p.isPrimary,
        };
      }
      return {
        profileId: String(p.profileId),
        kind: "Residential",
        label: p.wing ? `${p.wing}-${p.flatNo}` : String(p.flatNo),
        flatNo: p.flatNo,
        wing: p.wing || null,
        societyName: p.societyName || nameById.get(String(p.societyId)) || "Society",
        occupancyType: p.occupancyType || "Owner",
        isPrimary: !!p.isPrimary,
      };
    }),
    mergedCount,
    message:
      user.profiles.length > 1
        ? `Your account is ready. All ${user.profiles.length} units are active under this one login — you will pick which one to open each time you sign in.`
        : "Your account is ready. You can sign in now.",
  });
}
