// app/api/v1/auth/verify-password/route.js
//
// Confirms the signed-in user's own account password. Nothing more.
//
// This exists for one caller: the app's "Forgot PIN" path. App Lock's PIN is
// device-local and has no server side, so when someone forgets it the only
// thing left that can prove they own the account is the account password.
// Proving it earns the right to set a NEW local PIN — it does not issue a
// token, return a user, or change any state here.
//
// Because it answers "is this password correct?" for an authenticated user,
// it is an online guessing oracle by nature. Two things keep that in hand:
// the caller must already hold a valid access token (so it is not reachable
// by an anonymous attacker at all), and the attempt is rate-limited per user
// per IP, tighter than login.

import bcrypt from "bcryptjs";
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, clientIp } from "@/lib/v1/auth";
import { enforceRateLimit } from "@/lib/v1/ratelimit";
import { User } from "@/lib/v1/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req) => {
  const claims = getClaims(req);

  // Keyed on the user AND the IP: a stolen phone gets 5 tries per 15 minutes
  // against that account, and one IP cannot spread attempts across accounts.
  await enforceRateLimit(req, "verify-password", {
    windowMs: 15 * 60 * 1000,
    limit: 5,
    key: `${claims.userId}:${clientIp(req)}`,
    message: "Too many attempts. Try again in a few minutes.",
  });

  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) throw new ApiError(400, "Password is required");

  const user = await User.findById(claims.userId).select("password passwordHash");
  if (!user) throw new ApiError(401, "User not found");

  const hash = user.password || user.passwordHash;
  // Same 400 whether the account has no hash on file or the password is
  // simply wrong — the caller learns nothing about the account either way.
  if (!hash || !(await bcrypt.compare(password, hash))) {
    throw new ApiError(400, "Password is incorrect");
  }

  return json({ ok: true });
});
