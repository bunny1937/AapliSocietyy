import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import Society from "@/models/Society";
import cache from "@/lib/cache";
import { purgeSociety, PAUSE_CACHE_PREFIX, VERIFIED_CACHE_PREFIX } from "@/lib/superadmin/societyPurge";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";
import { createHandover } from "@/lib/superadmin/societyHandover";
import { notifyMembersOfErasure } from "@/lib/superadmin/societyMemberNotice";
import SocietyHandover from "@/models/SocietyHandover";
import { validateGraceDate, graceBounds, validateGraceOverride } from "@/lib/superadmin/societyGrace";
import { breakGlassAuthorized, breakGlassRefusal } from "@/lib/superadmin/breakGlass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// delete-until builds the society's handover bundle inline (75 collections
// plus a multi-sheet workbook) and mails every member. Both are bounded but
// neither is fast on a large society.
export const maxDuration = 300;

// Long enough that "test" and "asked to" do not clear it. An unexplained
// destructive action in a year-old audit log is indistinguishable from a
// mistake, which is how an auditor will read it.
const MIN_BREAK_GLASS_REASON = 20;

async function requireVerification(id, verificationToken) {
  const stored = await cache.get(`${VERIFIED_CACHE_PREFIX}${id}`);
  if (!stored || !verificationToken || stored !== verificationToken) {
    return false;
  }
  return true;
}

// POST /api/superadmin/societies/[id]/lifecycle
// Body: { action: "pause" | "pause-until" | "resume" | "delete-until" | "delete-permanently",
//         until?: ISO date string, verificationToken? }
//         | "undo-delete"
//
// pause / pause-until / resume are reversible and need no prior verification.
// delete-until (soft delete + scheduled purge date, restorable until then)
// and delete-permanently (immediate hard delete, matches the old
// delete-society behaviour) both require a verificationToken minted by
// POST .../verify-export within the last 15 minutes (LOOP-05) — the wizard
// cannot reach either without the admin having re-uploaded and matched the
// export first.
export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { action, until, verificationToken } = body;

    const society = await Society.findById(id);
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    switch (action) {
      case "pause": {
        society.lifecycleStatus = "Paused";
        society.pausedAt = new Date();
        society.pausedUntil = undefined;
        await society.save();
        await cache.set(`${PAUSE_CACHE_PREFIX}${id}`, "1", 60 * 60 * 24 * 400); // indefinite, capped at cache's practical ceiling
        await logSocietyLifecycle({ action: SOCIETY_LIFECYCLE_ACTIONS.PAUSED, societyId: id, societyName: society.name, actorUserId: validation.admin?.userId, details: { until: null } });
        return NextResponse.json({ success: true, lifecycleStatus: "Paused" });
      }
      case "pause-until": {
        const untilDate = new Date(until);
        if (!until || Number.isNaN(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
          return NextResponse.json({ error: "A valid future 'until' date is required" }, { status: 400 });
        }
        society.lifecycleStatus = "Paused";
        society.pausedAt = new Date();
        society.pausedUntil = untilDate;
        await society.save();
        const ttlSeconds = Math.ceil((untilDate.getTime() - Date.now()) / 1000);
        await cache.set(`${PAUSE_CACHE_PREFIX}${id}`, "1", ttlSeconds);
        await logSocietyLifecycle({ action: SOCIETY_LIFECYCLE_ACTIONS.PAUSED, societyId: id, societyName: society.name, actorUserId: validation.admin?.userId, details: { until: untilDate.toISOString() } });
        return NextResponse.json({ success: true, lifecycleStatus: "Paused", pausedUntil: untilDate });
      }
      case "resume": {
        society.lifecycleStatus = "Active";
        society.pausedAt = undefined;
        society.pausedUntil = undefined;
        await society.save();
        await cache.del(`${PAUSE_CACHE_PREFIX}${id}`);
        await logSocietyLifecycle({ action: SOCIETY_LIFECYCLE_ACTIONS.RESUMED, societyId: id, societyName: society.name, actorUserId: validation.admin?.userId });
        return NextResponse.json({ success: true, lifecycleStatus: "Active" });
      }
      case "delete-until": {
        if (!(await requireVerification(id, verificationToken))) {
          return NextResponse.json({ error: "Re-verify the export before scheduling deletion" }, { status: 403 });
        }
        // G7 — the window has a floor and a ceiling, enforced here and not
        // only in the date picker. See lib/superadmin/societyGrace.js.
        const overrideDays = society.offboarding?.graceDaysOverride;
        const grace = validateGraceDate(until, Date.now(), { overrideDays });
        if (!grace.ok) {
          return NextResponse.json(
            { error: grace.error, bounds: graceBounds(Date.now(), { overrideDays }) },
            { status: 400 },
          );
        }
        const untilDate = grace.date;
        society.isDeleted = true;
        society.deletedAt = new Date();
        society.deletedByUserId = validation.admin?.userId;
        society.purgeScheduledFor = untilDate;
        society.lifecycleStatus = "Paused"; // soft-deleted societies are also inaccessible
        await society.save();
        await cache.set(`${PAUSE_CACHE_PREFIX}${id}`, "1", 60 * 60 * 24 * 400);
        await logSocietyLifecycle({
          action: SOCIETY_LIFECYCLE_ACTIONS.SOFT_DELETED,
          societyId: id,
          societyName: society.name,
          actorUserId: validation.admin?.userId,
          details: { purgeScheduledFor: untilDate.toISOString(), exportVerifiedAt: society.offboarding?.exportVerifiedAt || null },
        });
        // Everything from here is best-effort and deliberately after the save.
        // The soft delete itself has already succeeded and must not be undone
        // by a mail server being down; each failure is reported back instead so
        // the superadmin can retry it from the wizard.
        let handover = null;
        let handoverError = null;
        try {
          const created = await createHandover({
            societyId: id,
            actorUserId: validation.admin?.userId,
            notify: true,
          });
          if (created) {
            handover = {
              id: String(created.handover._id),
              manifestRoot: created.handover.manifestRoot,
              counts: created.handover.counts,
              recipients: created.recipients,
              emailsSent: created.notify.sent,
            };
            await logSocietyLifecycle({
              action: SOCIETY_LIFECYCLE_ACTIONS.HANDOVER_SENT,
              societyId: id,
              societyName: society.name,
              actorUserId: validation.admin?.userId,
              details: { ...handover, trigger: "delete-until" },
            });
          }
        } catch (err) {
          console.error("delete-until handover error:", err);
          handoverError = err.message;
        }

        // The members whose data this is are told once, here — not by the
        // committee, and not after the fact. See societyMemberNotice.js.
        const memberNotice = await notifyMembersOfErasure({
          societyId: id,
          societyName: society.name,
          erasureDate: untilDate,
        });
        await Society.updateOne(
          { _id: id },
          {
            $set: {
              "offboarding.membersNotifiedAt": new Date(),
              "offboarding.membersNotified": memberNotice,
              ...(handover ? { "offboarding.handoverId": handover.id } : {}),
            },
          },
        );

        return NextResponse.json({
          success: true,
          isDeleted: true,
          purgeScheduledFor: untilDate,
          handover,
          handoverError,
          memberNotice,
        });
      }
      // The grace window is only real if it can actually be used. Without
      // this, "restorable until the purge date" was a promise with no button
      // behind it — app/api/superadmin/societies/restore only rebuilds a
      // society from an uploaded bundle AFTER it has already been destroyed,
      // which is a far worse operation than never destroying it.
      case "undo-delete": {
        if (!society.isDeleted) {
          return NextResponse.json({ error: "This society is not scheduled for deletion" }, { status: 400 });
        }
        society.isDeleted = false;
        society.deletedAt = undefined;
        society.deletedByUserId = undefined;
        society.purgeScheduledFor = undefined;
        society.lifecycleStatus = "Active";
        society.pausedAt = undefined;
        society.pausedUntil = undefined;
        await society.save();
        await cache.del(`${PAUSE_CACHE_PREFIX}${id}`);
        // The handover stays on record — it happened, and the manifest is
        // evidence of what was handed over — but it is no longer the current
        // one, so the reminder cron stops chasing a society that is staying.
        await SocietyHandover.updateMany(
          { societyId: id, status: { $in: ["built", "notified"] } },
          { $set: { status: "superseded" } },
        );
        await logSocietyLifecycle({
          action: SOCIETY_LIFECYCLE_ACTIONS.RESTORED,
          societyId: id,
          societyName: society.name,
          actorUserId: validation.admin?.userId,
          details: { trigger: "undo-delete", within: "grace window" },
        });
        return NextResponse.json({ success: true, isDeleted: false, lifecycleStatus: "Active" });
      }
      // D5 — grant this society longer than the platform ceiling. Only ever
      // longer: the floor is there for the society's benefit, so there is no
      // corresponding way to shorten one. Break-glass, because an extension is
      // a decision to keep personal data past the point we said we would.
      case "set-grace-override": {
        if (!breakGlassAuthorized(validation.admin)) {
          return NextResponse.json(breakGlassRefusal("Extending a grace window"), { status: 403 });
        }
        if (body.days === null || body.days === 0) {
          await Society.updateOne(
            { _id: id },
            {
              $unset: {
                "offboarding.graceDaysOverride": "",
                "offboarding.graceOverrideReason": "",
                "offboarding.graceOverrideByUserId": "",
                "offboarding.graceOverrideAt": "",
              },
            },
          );
          return NextResponse.json({ success: true, graceDaysOverride: null, bounds: graceBounds() });
        }
        const requested = validateGraceOverride(body.days);
        if (!requested.ok) return NextResponse.json({ error: requested.error }, { status: 400 });
        const overrideReason = String(body.reason || "").trim();
        if (overrideReason.length < 10) {
          return NextResponse.json(
            { error: "A written reason is required to hold a society's data longer than the standard window" },
            { status: 400 },
          );
        }
        await Society.updateOne(
          { _id: id },
          {
            $set: {
              "offboarding.graceDaysOverride": requested.days,
              "offboarding.graceOverrideReason": overrideReason,
              "offboarding.graceOverrideByUserId": validation.admin?.userId || null,
              "offboarding.graceOverrideAt": new Date(),
            },
          },
        );
        return NextResponse.json({
          success: true,
          graceDaysOverride: requested.days,
          bounds: graceBounds(Date.now(), { overrideDays: requested.days }),
        });
      }

      // C4 — immediate purge is break-glass, not a menu item.
      //
      // Every protection the scheduled path builds up is bypassed here in one
      // click: no grace window, so nothing can be restored; no wait for the
      // society to collect its records; no notice to the members whose data
      // it is. The scheduled path exists precisely because those things
      // matter, and an action that skips all of them cannot be reached the
      // same way as one that honours them.
      //
      // So it now costs three things: a fresh verification token (as before),
      // a written reason recorded permanently against the operator's name,
      // and — where the society has not collected its records — a separate,
      // explicit acknowledgement that it is being erased without ever having
      // received a copy. That last one is a second key, deliberately, because
      // it is the only failure here that cannot be undone or apologised for.
      case "delete-permanently": {
        // D7 — checked before the verification token, so an unauthorised
        // operator is told they cannot do this at all rather than being sent
        // to re-verify first and refused afterwards.
        if (!breakGlassAuthorized(validation.admin)) {
          return NextResponse.json(breakGlassRefusal("Immediate deletion"), { status: 403 });
        }
        if (!(await requireVerification(id, verificationToken))) {
          return NextResponse.json({ error: "Re-verify the export before deleting" }, { status: 403 });
        }

        const reason = String(body.breakGlassReason || "").trim();
        if (reason.length < MIN_BREAK_GLASS_REASON) {
          return NextResponse.json(
            {
              error: `Immediate deletion needs a written reason of at least ${MIN_BREAK_GLASS_REASON} characters`,
              detail:
                "This skips the grace window, the society's chance to collect its records, and the notice to its members. " +
                "Use 'Delete until date' for an ordinary offboarding. The reason is recorded permanently against your name.",
              code: "REASON_REQUIRED",
            },
            { status: 400 },
          );
        }

        const collected = await SocietyHandover.findOne({
          societyId: id,
          status: { $in: ["downloaded", "confirmed"] },
        })
          .select("status downloadedAt confirmedAt")
          .lean();
        const waived = society.offboarding?.handoverWaivedAt;

        if (!collected && !waived && body.acknowledgeNoHandover !== true) {
          return NextResponse.json(
            {
              error: "This society has never collected a copy of its records",
              detail:
                "Erasing it now destroys the only copy that exists. If that is genuinely intended — a regulator's order, " +
                "or a society that never existed as a real one — confirm explicitly and it will be recorded as such.",
              code: "NO_HANDOVER_COLLECTED",
              requiresAcknowledgement: true,
            },
            { status: 409 },
          );
        }

        const deleted = await purgeSociety(id);
        await logSocietyLifecycle({
          action: SOCIETY_LIFECYCLE_ACTIONS.PURGED,
          societyId: id,
          societyName: society.name,
          actorUserId: validation.admin?.userId,
          details: {
            trigger: "delete-permanently",
            breakGlass: true,
            reason,
            handoverStatus: collected?.status || null,
            handoverCollectedAt: collected?.confirmedAt || collected?.downloadedAt || null,
            handoverWaivedAt: waived || null,
            // The worst case, named in the record rather than inferable from
            // the absence of another field.
            erasedWithoutHandover: !collected && !waived,
            deleted,
            verifiedCounts: society.offboarding?.verifiedCounts || null,
          },
        });
        return NextResponse.json({ success: true, societyName: society.name, deleted });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("society lifecycle error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
