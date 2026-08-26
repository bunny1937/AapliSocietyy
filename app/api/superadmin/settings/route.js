import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import PlatformSetting from "@/models/PlatformSetting";
import {
  settingsSnapshot,
  settingDef,
  validateSetting,
  settingsConflicts,
  setting,
  invalidateSettings,
} from "@/lib/platform/settings";
import { ensureSettings } from "@/lib/platform/settingsStore";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET   /api/superadmin/settings   — every setting, its value, and where it came from
// PATCH /api/superadmin/settings   — save one or more; body { changes: {key: value}, reason? }
// DELETE                           — reset one to default; body { key }
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    await ensureSettings(true);

    const rows = await PlatformSetting.find({})
      .select("key updatedAt updatedByEmail previousValue reason")
      .lean();
    const meta = new Map(rows.map((r) => [r.key, r]));

    return NextResponse.json({
      settings: settingsSnapshot().map((s) => {
        const m = meta.get(s.key);
        return {
          ...s,
          updatedAt: m?.updatedAt || null,
          updatedBy: m?.updatedByEmail || null,
          previousValue: m?.previousValue ?? null,
          reason: m?.reason || null,
        };
      }),
    });
  } catch (err) {
    console.error("settings read error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    await ensureSettings(true);

    const body = await request.json().catch(() => ({}));
    const changes = body.changes && typeof body.changes === "object" ? body.changes : null;
    if (!changes || !Object.keys(changes).length) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }

    // Validate every field before writing any of them. A partial save that
    // applied three of four changes would leave the platform in a combination
    // nobody chose — and for these settings that combination can be one where
    // the grace floor sits above the ceiling.
    const validated = {};
    for (const [key, raw] of Object.entries(changes)) {
      const def = settingDef(key);
      if (!def) return NextResponse.json({ error: `Unknown setting: ${key}` }, { status: 400 });

      const result = validateSetting(key, raw);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      validated[key] = result.value;
    }

    // Cross-field rules — a floor above a ceiling is individually legal and
    // jointly incoherent, and would fail silently rather than loudly.
    const conflicts = settingsConflicts(validated);
    if (conflicts.length) {
      return NextResponse.json({ error: conflicts[0], conflicts }, { status: 400 });
    }

    // Changes that widen a limit or disable a safety cost a written reason,
    // recorded against the operator's name. An unexplained kill switch in a
    // year-old audit log is indistinguishable from a mistake.
    const reason = String(body.reason || "").trim();
    const needsReason = Object.keys(validated).filter((k) => settingDef(k).reasonRequired);
    if (needsReason.length && reason.length < 10) {
      return NextResponse.json(
        {
          error: `Changing ${needsReason.map((k) => settingDef(k).label).join(", ")} needs a written reason of at least 10 characters.`,
          code: "REASON_REQUIRED",
          keys: needsReason,
        },
        { status: 400 },
      );
    }

    const actorEmail = validation.admin?.email || validation.admin?.userId || "unknown";
    const applied = [];

    for (const [key, value] of Object.entries(validated)) {
      const previousValue = setting(key);
      await PlatformSetting.updateOne(
        { key },
        {
          $set: {
            value,
            previousValue,
            updatedByUserId: validation.admin?.userId || null,
            updatedByEmail: actorEmail,
            ...(reason ? { reason } : {}),
          },
        },
        { upsert: true },
      );
      applied.push({ key, from: previousValue, to: value });
    }

    invalidateSettings();
    await ensureSettings(true);

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.PLATFORM_SETTING_CHANGED,
      societyId: null,
      societyName: "(platform)",
      actorUserId: validation.admin?.userId,
      details: { applied, reason: reason || null, actorEmail },
    });

    return NextResponse.json({ success: true, applied, settings: settingsSnapshot() });
  } catch (err) {
    console.error("settings write error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    await ensureSettings(true);

    const body = await request.json().catch(() => ({}));
    const key = String(body.key || "");
    const def = settingDef(key);
    if (!def) return NextResponse.json({ error: `Unknown setting: ${key}` }, { status: 400 });

    const previousValue = setting(key);
    await PlatformSetting.deleteOne({ key });
    invalidateSettings();
    await ensureSettings(true);

    // Deleting the row is a reset, not an unset — the value falls back through
    // the environment variable to the code default, so it can never end up
    // undefined.
    const now = setting(key);

    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.PLATFORM_SETTING_CHANGED,
      societyId: null,
      societyName: "(platform)",
      actorUserId: validation.admin?.userId,
      details: { reset: key, from: previousValue, to: now },
    });

    return NextResponse.json({ success: true, key, value: now, settings: settingsSnapshot() });
  } catch (err) {
    console.error("settings reset error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
