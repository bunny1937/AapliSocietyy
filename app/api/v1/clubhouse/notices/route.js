import { withRoute, json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { z } from "zod";
import { Notice, User } from "@/lib/v1/models";
import { clubhouseContext } from "@/lib/amenities/clubhouseContext";
import { CAPABILITY } from "@/lib/amenities/permissions";
import { notifyNoticePosted } from "@/lib/v1/notify";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lengths match models/Notice.js exactly (title 10–150, description 30–2000).
// Validating them here means the manager gets a readable message on the phone
// instead of a Mongoose validation error after typing a paragraph.
const bodySchema = z.object({
  title: z.string().trim().min(10, "Give the notice a clearer title (at least 10 characters).").max(150),
  description: z.string().trim().min(30, "Add a bit more detail (at least 30 characters).").max(2000),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

// GET / POST /api/v1/clubhouse/notices
//
// Lightweight operational communication: "pool closed this evening, filter
// repair". Published straight to the society through the SAME Notice model,
// cache key and fan-out the website and the member app already use — residents
// see it in their existing notices list, and there is no second announcement
// channel to keep in step.
//
// `type` is fixed to "maintenance": every notice a clubhouse manager needs to
// post is an operational one. Billing, meetings and society-wide announcements
// are not this role's to send, and leaving the field open would have made them
// possible.
const noticesKey = (societyId) => `v1:notices:${societyId}`;

export const GET = withRoute(async (request) => {
  const ctx = await clubhouseContext(request, CAPABILITY.VIEW_AMENITIES);
  await connectDB();

  const notices = await Notice.find({ societyId: ctx.societyId, isDeleted: { $ne: true } })
    .sort({ pinned: -1, createdAt: -1 })
    .limit(30)
    .select("title description type priority pinned createdAt createdByName")
    .lean();

  return json({ notices: notices.map((n) => ({ ...n, _id: String(n._id) })) });
});

export const POST = withRoute(async (request) => {
  // The notice leaf is checked directly: publishing is not an amenity capability,
  // it is a separate grant an Admin can withhold while still handing over the
  // scan desk.
  const ctx = await clubhouseContext(request);
  if (!ctx.permissions.has("amenities.clubhouse.notice")) {
    return json(
      { error: "You do not have permission to publish notices.", code: "FORBIDDEN", requiredPermission: "amenities.clubhouse.notice" },
      { status: 403 },
    );
  }
  await connectDB();

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const author = await User.findById(ctx.userId).select("username").lean();

  const notice = await Notice.create({
    societyId: ctx.societyId,
    createdBy: ctx.userId,
    createdByName: ctx.name || author?.username || "Clubhouse",
    type: "maintenance",
    priority: data.priority || "medium",
    title: data.title,
    description: data.description,
    pinned: false,
  });

  await notifyNoticePosted({
    noticeId: notice._id,
    societyId: ctx.societyId,
    title: notice.title,
    createdBy: ctx.userId,
    createdByName: notice.createdByName,
  });

  // Same invalidation the website notice route performs — without it residents
  // would not see this until the cache's soft TTL expired.
  await cache.del(noticesKey(ctx.societyId));

  return json({ ok: true, notice: { ...notice.toObject(), _id: String(notice._id) } }, { status: 201 });
});
