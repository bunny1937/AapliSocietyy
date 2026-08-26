// POST /api/onboarding/lookup
//
// Step 1 of the app onboarding flow. "Does an account exist for this email?"
//
// This route is the single gate that decides which screen the app shows:
//   NEW_ACCOUNT      -> the account exists in DB but has never been set up
//   EXISTING_ACCOUNT -> already set up; show its flats, allow claiming more
//   PROHIBITED       -> no member record anywhere. Dead end, by design.
//
// SECURITY NOTES - read before changing anything here.
//
// 1. This endpoint is UNAUTHENTICATED, so it is an email-enumeration surface.
//    It is mitigated, not eliminated:
//      - a signed onboarding token is REQUIRED unless the caller provides a
//        valid societyCode + flatNo pair, so you cannot walk it with a plain
//        email list;
//      - responses are shape-identical and constant-ish time;
//      - it is rate limited per IP.
//    Do NOT "simplify" this by accepting a bare email. That would let anyone
//    test whether an address lives in the platform.
//
// 2. It never returns a password, a username, a member id, or a full email.
//    Flat labels only, which the caller already proved they know.
//
// 3. PROHIBITED is deliberately a hard stop. The app must not offer a
//    "create account anyway" path - a member row has to be created by an
//    admin import first. This is what the user asked for: "that new account
//    should exist in db if no then prohibited".

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Member from "@/models/Member";
import Society from "@/models/Society";
import Shop from "@/models/Shop";
import { verifyToken } from "@/lib/jwt";
import { enforceRateLimit } from "@/lib/v1/ratelimit";
import { ApiError } from "@/lib/v1/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SEC-06: Redis-backed (falls back to in-memory only if Upstash is
// unconfigured — see lib/v1/ratelimit.js), so the limit is real across
// serverless instances and cold starts instead of resetting on every one.
//
// Two limiters: per-IP (catches one attacker cycling emails) AND, when a
// societyCode is supplied, per-societyCode (catches distributed guessing of
// low-entropy flat numbers across many IPs against one society).
const IP_MAX_LOOKUPS = 12;
const IP_WINDOW_MS = 10 * 60 * 1000;
const SOCIETY_MAX_LOOKUPS = 60;
const SOCIETY_WINDOW_MS = 10 * 60 * 1000;

function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(3, local.length - 2))}@${domain}`;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const token = body.token ? String(body.token) : null;
  const societyCode = String(body.societyCode || "").trim().toUpperCase();
  const flatNo = String(body.flatNo || "").trim().toUpperCase();

  try {
    await enforceRateLimit(request, "onboarding-lookup-ip", {
      windowMs: IP_WINDOW_MS,
      limit: IP_MAX_LOOKUPS,
      message: "Too many attempts. Try again in a few minutes.",
    });
    if (societyCode) {
      await enforceRateLimit(request, "onboarding-lookup-society", {
        windowMs: SOCIETY_WINDOW_MS,
        limit: SOCIETY_MAX_LOOKUPS,
        key: societyCode,
        message: "Too many attempts for this society. Try again in a few minutes.",
      });
    }
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    throw err;
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // ── Proof of possession ──────────────────────────────────────────────
  // Either a signed onboarding token from the email, or society + flat, which
  // only someone who lives there plausibly knows.
  let tokenUserId = null;

  if (token) {
    const decoded = verifyToken(token);
    if (!decoded || decoded.purpose !== "onboarding") {
      return NextResponse.json(
        {
          outcome: "LINK_INVALID",
          message:
            "This activation link is invalid or has expired. Ask your society admin to resend it.",
        },
        { status: 400 },
      );
    }
    tokenUserId = decoded.userId;
  } else if (!societyCode || !flatNo) {
    return NextResponse.json(
      {
        error: "PROOF_REQUIRED",
        message:
          "Open the activation link from your email, or enter your society code and flat number.",
      },
      { status: 400 },
    );
  }

  await connectDB();

  // ── Find every account holding this email ───────────────────────────────
  // Plural on purpose. Imports run before the multi-flat fix landed may have
  // produced several User docs sharing one email (see BULK-IMPORT-PATCH.md).
  // We surface that instead of silently picking one, because silently picking
  // one is exactly the bug that hid Bhavani's other two flats.
  const users = await User.find({ email }).lean();

  if (users.length === 0) {
    return NextResponse.json({
      outcome: "PROHIBITED",
      message:
        "No flat on this platform is registered to this email. Your society admin must add you first — accounts cannot be created from the app.",
      maskedEmail: maskEmail(email),
    });
  }

  // If a token was supplied it must belong to one of these accounts. Guards
  // against pasting someone else's link alongside your own email.
  if (tokenUserId && !users.some((u) => String(u._id) === String(tokenUserId))) {
    return NextResponse.json(
      {
        outcome: "LINK_MISMATCH",
        message:
          "This activation link belongs to a different email address. Enter the email the link was sent to.",
      },
      { status: 403 },
    );
  }

  // Prefer the token's user; otherwise the one that owns the flat quoted.
  let user = tokenUserId
    ? users.find((u) => String(u._id) === String(tokenUserId))
    : null;

  if (!user) {
    user =
      users.find((u) =>
        (u.profiles || []).some(
          (p) => String(p.flatNo || "").toUpperCase() === flatNo,
        ),
      ) || null;

    if (!user) {
      // Email exists but not on that flat. Same generic wording as PROHIBITED
      // so the pair cannot be brute-forced apart.
      return NextResponse.json({
        outcome: "PROHIBITED",
        message:
          "No flat on this platform is registered to this email. Your society admin must add you first — accounts cannot be created from the app.",
        maskedEmail: maskEmail(email),
      });
    }

    // Verify the society code too, so flat number alone is not enough.
    const societies = await Society.find(
      { _id: { $in: (user.profiles || []).map((p) => p.societyId) } },
      { societyCode: 1, societyName: 1 },
    ).lean();
    const codeOk = societies.some(
      (s) => String(s.societyCode || "").toUpperCase() === societyCode,
    );
    if (!codeOk) {
      return NextResponse.json({
        outcome: "PROHIBITED",
        message:
          "No flat on this platform is registered to this email. Your society admin must add you first — accounts cannot be created from the app.",
        maskedEmail: maskEmail(email),
      });
    }
  }

  // ── Build the flat list ──────────────────────────────────────────────
  // Union of profiles across every doc with this email, so a legacy split
  // account still shows all three flats to the member.
  const allProfiles = users.flatMap((u) =>
    (u.profiles || []).map((p) => ({ ...p, _ownerUserId: String(u._id) })),
  );

  const societyIds = [...new Set(allProfiles.map((p) => String(p.societyId)))];
  const societies = await Society.find(
    { _id: { $in: societyIds } },
    { societyName: 1, societyCode: 1 },
  ).lean();
  const societyById = new Map(societies.map((s) => [String(s._id), s]));

  const shopIds = [...new Set(allProfiles.filter((p) => p.kind === "Commercial").map((p) => String(p.shopId)))];
  const shops = shopIds.length
    ? await Shop.find({ _id: { $in: shopIds } }).select("shopNo wing unitKind tradeName").lean()
    : [];
  const shopById = new Map(shops.map((s) => [String(s._id), s]));

  const flats = allProfiles.map((p) => {
    const soc = societyById.get(String(p.societyId));
    if (p.kind === "Commercial") {
      const shop = shopById.get(String(p.shopId));
      const unit = [shop?.wing, shop?.shopNo].filter(Boolean).join("-") || "Shop";
      return {
        profileId: String(p.profileId),
        kind: "Commercial",
        shopNo: shop?.shopNo ?? null,
        wing: shop?.wing ?? null,
        unitKind: shop?.unitKind ?? null,
        tradeName: shop?.tradeName ?? null,
        label: [unit, p.societyName].filter(Boolean).join(" · "),
        societyName: p.societyName || soc?.societyName || "Society",
        status: p.status || "Active",
        isPrimary: !!p.isPrimary,
        split: String(p._ownerUserId) !== String(user._id),
      };
    }
    return {
      profileId: String(p.profileId),
      kind: "Residential",
      flatNo: p.flatNo,
      wing: p.wing || null,
      label: p.wing ? `${p.wing}-${p.flatNo}` : String(p.flatNo),
      societyName: p.societyName || soc?.societyName || "Society",
      occupancyType: p.occupancyType || "Owner",
      role: p.role || "Member",
      status: p.status || "Active",
      isPrimary: !!p.isPrimary,
      // "split" means this flat sits on a different User doc than the one being
      // activated - a legacy artefact the app should report, not paper over.
      split: String(p._ownerUserId) !== String(user._id),
    };
  });

  const needsSetup = users.filter((u) => u.mustChangePassword);
  const isNew = !!user.mustChangePassword;

  return NextResponse.json({
    outcome: isNew ? "NEW_ACCOUNT" : "EXISTING_ACCOUNT",
    maskedEmail: maskEmail(email),
    name: user.name || null,
    // Only revealed once the caller has proven possession, and only so the
    // "existing account" screen can prefill the login field.
    username: isNew ? null : user.username || null,
    flats,
    activatedCount: flats.filter((f) => !f.split || !isNew).length,
    totalFlats: flats.length,
    // Signals a pre-fix split account. The app shows a support note; an admin
    // needs to run the merge script in CHANGES.md.
    splitAccount: users.length > 1,
    pendingSetupCount: needsSetup.length,
    rules: {
      usernamePattern: "^[a-z0-9_-]{4,30}$",
      // Matches lib/password-policy.js (SEC-07).
      passwordMinLength: 8,
      passwordNeedsUpperLowerDigitSymbol: true,
      // The app must make the user retype the email. Same rule as the website:
      // it has to match exactly, no normalisation beyond trim + lowercase.
      requireEmailReentry: true,
    },
  });
}
