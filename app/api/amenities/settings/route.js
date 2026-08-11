import AmenitySetting from "@/models/amenities/AmenitySetting";
import { settingsUpdateSchema } from "@/lib/amenities/schemas";
import { getSettings, invalidateSettings } from "@/lib/amenities/settingsService";
import { logUpdate } from "@/lib/amenities/activityLog";
import { ACTIVITY_ACTION, FEATURE_FLAG_KEYS } from "@/lib/amenities/constants";
import { CAPABILITY, gate, ok, zodFail, fail, withAmenityRoute } from "@/lib/amenities/apiHelpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/amenities/settings
export const GET = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.VIEW_AMENITIES);
  if (!g.ok) return g.response;

  const settings = await getSettings(g.societyId);
  return ok({
    settings,
    // Sent so the admin UI can render every switch, including flags this
    // society's document predates.
    availableFeatures: FEATURE_FLAG_KEYS,
  });
});

// PATCH /api/amenities/settings
export const PATCH = withAmenityRoute(async (request) => {
  const g = await gate(request, CAPABILITY.MANAGE_SETTINGS);
  if (!g.ok) return g.response;

  const parsed = settingsUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return zodFail(parsed);

  const body = parsed.data;

  // Reject unknown flag names rather than silently writing dead keys that would
  // never be read back.
  if (body.features) {
    const unknown = Object.keys(body.features).filter((k) => !FEATURE_FLAG_KEYS.includes(k));
    if (unknown.length) return fail(422, `Unknown feature flag(s): ${unknown.join(", ")}`);
  }

  // Fail fast on a bad timezone: silently accepting one would corrupt every
  // subsequent day boundary and analytics bucket.
  if (body.timezone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: body.timezone }).format(new Date());
    } catch {
      return fail(422, `"${body.timezone}" is not a valid timezone`);
    }
  }

  const before = await AmenitySetting.findOne({ societyId: g.societyId }).lean();

  const update = { ...body, updatedBy: g.actor.userId };
  // Merge flags rather than replace, so a partial toggle does not wipe the rest.
  if (body.features) {
    update.features = { ...(before?.features || {}), ...body.features };
  }

  const after = await AmenitySetting.findOneAndUpdate(
    { societyId: g.societyId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  invalidateSettings(g.societyId);

  await logUpdate({
    societyId: g.societyId,
    entityType: "SETTINGS",
    entityId: after._id,
    action: ACTIVITY_ACTION.SETTINGS_UPDATED,
    actor: g.actor,
    prev: before || {},
    next: update,
  });

  return ok({ settings: after });
});
