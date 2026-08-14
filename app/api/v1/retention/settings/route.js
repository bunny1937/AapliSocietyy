import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import RetentionSetting from "@/models/RetentionSetting";
import { RETENTION_POLICIES } from "@/lib/retention/policies";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET / PUT /api/retention/settings
 *
 * Per-society retention configuration, owned by that society's own admin.
 *
 * This is the answer to "if I set it to true it affects all societies". There
 * is no longer any switch that turns deletion ON globally. The only global
 * control left (`RETENTION_PURGE_ENABLED=false`) can turn everything OFF.
 * Turning anything on happens here, one society at a time, by that society.
 */

function shape(setting) {
  return {
    enabled: Boolean(setting?.enabled),
    maxPurgePerNight: setting?.maxPurgePerNight ?? 5000,
    downloadGraceDays: setting?.downloadGraceDays ?? 30,
    notifyEmails: setting?.notifyEmails ?? [],
    enabledAt: setting?.enabledAt ?? null,
    enabledBy: setting?.enabledBy ?? null,
    lastScanAt: setting?.lastScanAt ?? null,
    lastPurgeAt: setting?.lastPurgeAt ?? null,
    policies: RETENTION_POLICIES.map((p) => {
      const o = setting?.policies?.find((x) => x.policyId === p.id);
      return {
        policyId: p.id,
        label: p.label,
        // Hard-coded in code, not editable: complaints and payment imports can
        // never be auto-deleted. The UI should render these disabled with the
        // reason shown, not simply hide them — an admin should be able to see
        // that the protection exists.
        canEverPurge: p.purgeable,
        lockedReason: p.purgeable
          ? null
          : p.id === "complaints"
            ? "Complaints are evidence in disputes and are never deleted automatically."
            : "Financial records are never deleted automatically.",
        purgeEnabled: Boolean(o?.purgeEnabled && p.purgeable),
        archiveAfterDays: o?.archiveAfterDays ?? p.archiveAfterDays,
        defaultArchiveAfterDays: p.archiveAfterDays,
        ttlBackstopDays: p.ttlBackstopDays,
      };
    }),
  };
}

export async function GET(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;

    const setting = await RetentionSetting.findOne({
      societyId: auth.user.societyId,
    }).lean();

    return NextResponse.json({
      success: true,
      // Surfaced so the UI can explain why toggles appear to do nothing.
      platformKillSwitchActive: process.env.RETENTION_PURGE_ENABLED === "false",
      settings: shape(setting),
    });
  } catch (error) {
    console.error("Retention settings GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    await connectDB();
    const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
    if (!auth.valid) return auth;
    const { societyId, userId, name } = auth.user;

    const body = await request.json();
    const patch = {};

    if (typeof body.enabled === "boolean") {
      patch.enabled = body.enabled;
      if (body.enabled) {
        // Retention is a legal posture. Record who authorised it.
        patch.enabledBy = name || userId || "unknown";
        patch.enabledAt = new Date();
      }
    }

    if (Number.isFinite(body.maxPurgePerNight)) {
      // Clamped: 100 is a sane floor, 50k stops a typo becoming a mass delete.
      patch.maxPurgePerNight = Math.min(50000, Math.max(100, body.maxPurgePerNight));
    }
    if (Number.isFinite(body.downloadGraceDays)) {
      patch.downloadGraceDays = Math.min(365, Math.max(7, body.downloadGraceDays));
    }
    if (Array.isArray(body.notifyEmails)) {
      patch.notifyEmails = [
        ...new Set(
          body.notifyEmails
            .map((e) => String(e).trim().toLowerCase())
            .filter((e) => e.includes("@")),
        ),
      ].slice(0, 10);
    }

    if (Array.isArray(body.policies)) {
      patch.policies = body.policies
        .map((p) => {
          const def = RETENTION_POLICIES.find((x) => x.id === p.policyId);
          if (!def) return null;
          return {
            policyId: def.id,
            // The code-level veto is applied on write as well as on read, so a
            // crafted request cannot persist purgeEnabled on a locked policy.
            purgeEnabled: def.purgeable ? Boolean(p.purgeEnabled) : false,
            archiveAfterDays: Number.isFinite(p.archiveAfterDays)
              ? // Never allow archiving sooner than 7 days, and never later
                // than the TTL backstop — past that, Mongo would delete the
                // rows before the admin was ever offered a copy.
                Math.min(def.ttlBackstopDays - 1, Math.max(7, p.archiveAfterDays))
              : null,
          };
        })
        .filter(Boolean);
    }

    const updated = await RetentionSetting.findOneAndUpdate(
      { societyId },
      { $set: patch },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    return NextResponse.json({ success: true, settings: shape(updated) });
  } catch (error) {
    console.error("Retention settings PUT error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
