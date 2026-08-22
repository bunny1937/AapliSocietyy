// PATCH /api/members/[id]/status
//
// The two switches the admin screens described but could never actually throw:
//
//   flat   - membershipStatus / isActive. An inactive flat is left out of bill
//            runs; nothing about the flat's data is deleted.
//   login  - enable / disable / pause the resident's app + web login.
//
// The login half is deliberately profile-aware. One person can hold flats in
// several societies on ONE account (models/User.js profiles[]), so switching
// off "the login" for one flat must not lock them out of another society's
// flat. When the account has more than one active profile, only THIS flat's
// profile is deactivated; only a single-profile account is switched off
// wholesale. The response says which of the two happened, in words.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { bumpSessionEpoch } from "@/lib/rbac/session";

const MEMBERSHIP_STATUSES = ["Active", "Inactive", "Suspended", "Blocked", "Exited"];
const LOGIN_ACTIONS = ["enable", "disable", "pause"];

/** The login account behind a flat, whichever way it was linked. */
async function findMemberUser(member, societyId) {
  if (member.userId) {
    const byId = await User.findById(member.userId);
    if (byId) return byId;
  }
  return User.findOne({
    profiles: { $elemMatch: { memberId: member._id, societyId } },
  });
}

export async function PATCH(request, { params }) {
  try {
    const gate = await authorize(request, "member.member.update");
    if (!gate.ok) return gate.response;
    await connectDB();

    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "The change did not reach the server. Please try again.", code: "BAD_BODY" },
        { status: 400 },
      );
    }

    const member = await Member.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
    if (!member) {
      return NextResponse.json({ error: "That flat could not be found.", code: "NOT_FOUND" }, { status: 404 });
    }

    const done = [];

    // ---- Flat status ------------------------------------------------------
    if (body.membershipStatus !== undefined || body.isActive !== undefined) {
      if (
        body.membershipStatus !== undefined &&
        !MEMBERSHIP_STATUSES.includes(body.membershipStatus)
      ) {
        return NextResponse.json(
          {
            error: `"${body.membershipStatus}" is not a flat status.`,
            code: "BAD_STATUS",
            hint: `Use one of: ${MEMBERSHIP_STATUSES.join(", ")}.`,
          },
          { status: 400 },
        );
      }

      const before = { membershipStatus: member.membershipStatus, isActive: member.isActive };

      if (body.membershipStatus !== undefined) {
        member.membershipStatus = body.membershipStatus;
        // isActive is what the bill run reads, so keep the two honest with each
        // other unless the caller set isActive explicitly.
        if (body.isActive === undefined) member.isActive = body.membershipStatus === "Active";
      }
      if (body.isActive !== undefined) member.isActive = body.isActive === true;

      member.lastModifiedBy = decoded.userId;
      await member.save();

      await AuditLog.create({
        userId: decoded.userId,
        societyId,
        action: "MEMBER_STATUS_CHANGED",
        oldData: before,
        newData: { membershipStatus: member.membershipStatus, isActive: member.isActive },
        timestamp: new Date(),
      }).catch(() => {});

      done.push(
        member.isActive
          ? `${member.flatNo} is active again and will be included in the next bill run.`
          : `${member.flatNo} is marked ${member.membershipStatus} and will be left out of bill runs.`,
      );
    }

    // ---- Login control ----------------------------------------------------
    let loginScope = null;
    if (body.login !== undefined) {
      if (!LOGIN_ACTIONS.includes(body.login)) {
        return NextResponse.json(
          {
            error: `"${body.login}" is not a login action.`,
            code: "BAD_LOGIN_ACTION",
            hint: `Use one of: ${LOGIN_ACTIONS.join(", ")}.`,
          },
          { status: 400 },
        );
      }

      const user = await findMemberUser(member, societyId);
      if (!user) {
        return NextResponse.json(
          {
            error: "This flat has no login account yet, so there is nothing to switch on or off.",
            code: "NO_LOGIN_ACCOUNT",
            hint: "Create the resident's login first, then come back.",
          },
          { status: 409 },
        );
      }

      let until = null;
      if (body.login === "pause") {
        until = body.pausedUntil ? new Date(body.pausedUntil) : null;
        if (!until || Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
          return NextResponse.json(
            {
              error: "Pick a date in the future to pause this login until.",
              code: "BAD_PAUSE_DATE",
            },
            { status: 400 },
          );
        }
      }

      const activeProfiles = (user.profiles ?? []).filter((p) => p.status === "Active");
      const thisProfile = (user.profiles ?? []).find(
        (p) => String(p.memberId) === String(member._id) && String(p.societyId) === String(societyId),
      );
      // More than one active profile means this account is also somebody's
      // login for another flat or society — switch off only this flat's door.
      const perProfile = activeProfiles.length > 1 && !!thisProfile;
      loginScope = perProfile ? "profile" : "account";

      const before = {
        isActive: user.isActive,
        loginPausedUntil: user.loginPausedUntil,
        profileStatus: thisProfile?.status ?? null,
      };

      if (perProfile) {
        if (body.login === "enable") {
          thisProfile.status = "Active";
          done.push(`${member.flatNo} can be signed in to again.`);
        } else {
          // A timed pause has no per-profile equivalent (the date lives on the
          // account), so on a multi-flat account both "disable" and "pause"
          // deactivate this flat's profile and the reason records why.
          thisProfile.status = "Inactive";
          done.push(
            `${member.flatNo} has been closed to this resident's login. Their other flats are unaffected.`,
          );
        }
        user.loginBlockedReason = body.reason || user.loginBlockedReason || null;
        await user.save();
      } else if (body.login === "enable") {
        user.isActive = true;
        user.loginPausedUntil = null;
        user.loginBlockedReason = null;
        await user.save();
        done.push("This resident can sign in again.");
      } else if (body.login === "pause") {
        user.loginPausedUntil = until;
        user.loginBlockedReason = body.reason || null;
        await user.save();
        done.push(
          `This resident cannot sign in until ${until.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}. It lifts on its own.`,
        );
      } else {
        user.isActive = false;
        user.loginPausedUntil = null;
        user.loginBlockedReason = body.reason || null;
        await user.save();
        done.push("This resident's login is switched off until you switch it back on.");
      }

      // Kill any session already open, otherwise the block only takes effect
      // whenever their current token happens to expire.
      if (body.login !== "enable") await bumpSessionEpoch(String(user._id)).catch(() => {});

      await AuditLog.create({
        userId: decoded.userId,
        societyId,
        action: `MEMBER_LOGIN_${body.login.toUpperCase()}`,
        oldData: before,
        newData: {
          scope: loginScope,
          isActive: user.isActive,
          loginPausedUntil: user.loginPausedUntil,
          reason: body.reason || null,
        },
        timestamp: new Date(),
      }).catch(() => {});
    }

    if (!done.length) {
      return NextResponse.json(
        {
          error: "Nothing was sent to change.",
          code: "EMPTY_UPDATE",
          hint: "Send a flat status, or a login action.",
        },
        { status: 400 },
      );
    }

    await cache.delPattern(`members:list:${societyId}:*`);

    return NextResponse.json({
      success: true,
      loginScope,
      member: {
        id: String(member._id),
        flatNo: member.flatNo,
        wing: member.wing,
        isActive: member.isActive,
        membershipStatus: member.membershipStatus,
      },
      message: done.join(" "),
    });
  } catch (error) {
    console.error("members/[id]/status error:", error);
    return NextResponse.json(
      { error: error?.message || "This change could not be saved.", code: "STATUS_UPDATE_FAILED" },
      { status: 500 },
    );
  }
}
