import { withRoute, json } from "@/lib/v1/http";
import { cronAuthorized } from "@/lib/v1/config";
import connectDB from "@/lib/mongodb";
import { setting } from "@/lib/platform/settings";
import cache from "@/lib/cache";
import Society from "@/models/Society";
import { sendEmail } from "@/lib/brevo-email";
import { societyLifecycle, STATE, lifecycleMessage } from "@/lib/entitlements/lifecycle";
import { clearEntitlementSnapshot } from "@/lib/entitlements/snapshot";
import { withCronRun } from "@/lib/ops/cronTracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
const NOTIFIED_PREFIX = "subscription-notified:";
const NOTIFY_COOLDOWN_SECONDS = 24 * 60 * 60;
// A blocked society is chased weekly, not daily. Daily is harassment and gets
// filtered; monthly is too slow to matter.
const BLOCKED_REMINDER_SECONDS = 7 * 24 * 60 * 60;

/**
 * GET /v1/cron/subscription-lifecycle
 *
 * cron-job.org, daily 06:00 IST:
 *   https://aaplisociety.vercel.app/v1/cron/subscription-lifecycle
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * ## This job does not enforce anything
 *
 * Worth being explicit, because a job named "lifecycle" sounds like it should.
 * The states are *derived* from dates in lib/entitlements/lifecycle.js, so a
 * society becomes read-only the instant its clock passes, on every node, with
 * or without this job. If it never runs, nobody gets free access — they simply
 * stop being told what happened.
 *
 * That is the right split. A cron that fails silently and grants free product
 * is a bad design; a cron that fails silently and stops sending email is an
 * ordinary operational problem.
 *
 * ## What it does do
 *
 *   1. tells a society when it crosses into grace, read-only or blocked
 *   2. tells the superadmin, so the blocked queue is not the only signal
 *   3. drops the edge snapshot on a state change, so middleware sees it now
 *      rather than up to a week later
 *
 * `?dryRun=1` reports without sending or clearing.
 */
export const GET = withRoute(async (req) => {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  return json(await withCronRun("subscription-lifecycle", runLifecycle)({ dryRun }));
});

async function runLifecycle({ dryRun }) {
  await connectDB();
  const startedAt = Date.now();

  const societies = await Society.find({ isDeleted: { $ne: true } })
    .select("name contactEmail credentials.adminEmail subscription")
    .lean();

  const results = [];
  const blockedQueue = [];

  for (const society of societies) {
    const lifecycle = societyLifecycle(society);
    if (lifecycle.state === STATE.TRIAL || lifecycle.state === STATE.ACTIVE) continue;

    const id = String(society._id);
    const base = {
      societyId: id,
      societyName: society.name,
      state: lifecycle.state,
      daysInState: lifecycle.daysInState,
    };

    if (lifecycle.state === STATE.BLOCKED) {
      blockedQueue.push({
        ...base,
        contact: society.credentials?.adminEmail || society.contactEmail || null,
        expiredAt: lifecycle.expiredAt,
      });
    }

    // Keyed by state, so crossing a boundary always notifies even if the
    // society was emailed yesterday about the previous one.
    const key = `${NOTIFIED_PREFIX}${id}:${lifecycle.state}`;
    const already = await cache.get(key);
    const cooldown =
      lifecycle.state === STATE.BLOCKED ? BLOCKED_REMINDER_SECONDS : NOTIFY_COOLDOWN_SECONDS;

    if (already) {
      results.push({ ...base, action: "skipped", reason: "already notified" });
      continue;
    }

    if (dryRun) {
      results.push({ ...base, action: "would-notify" });
      continue;
    }

    // A newly-crossed boundary means the cached snapshot describes the
    // previous state. Dropping it makes middleware pick the change up on the
    // next request rather than whenever the week-long TTL expires.
    await clearEntitlementSnapshot(id);

    const recipients = [
      ...new Set(
        [society.credentials?.adminEmail, society.contactEmail]
          .filter(Boolean)
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => e.includes("@")),
      ),
    ];

    let sent = 0;
    const failed = [];
    const html = societyEmailHtml({ society, lifecycle });
    const subject =
      lifecycle.state === STATE.BLOCKED
        ? `${society.name} — account closed, action needed`
        : lifecycle.state === STATE.RESTRICTED
          ? `${society.name} — your account is now read-only`
          : `${society.name} — your subscription has ended`;

    for (const to of recipients) {
      try {
        await sendEmail({ to, subject, html });
        sent++;
      } catch (err) {
        failed.push({ to, error: err.message });
      }
    }

    await cache.set(key, "1", cooldown);
    results.push({ ...base, action: "notified", recipients, sent, failed });
  }

  // One digest rather than one mail per society: a superadmin with eleven
  // blocked societies needs a list, not eleven emails.
  let queueAlert = { sent: 0, skipped: "nothing blocked" };
  if (!dryRun && blockedQueue.length) {
    const to = (setting("ENTITLEMENT_ALERT_EMAIL") || process.env.SUPER_ADMIN_EMAIL || "")
      .trim()
      .toLowerCase();
    const key = `${NOTIFIED_PREFIX}queue-digest`;
    if (!to || !to.includes("@")) {
      queueAlert = { sent: 0, skipped: "no recipient configured" };
    } else if (await cache.get(key)) {
      queueAlert = { sent: 0, skipped: "digest already sent this week" };
    } else {
      try {
        await sendEmail({
          to,
          subject: `${blockedQueue.length} society(s) blocked — renew or offboard`,
          html: queueDigestHtml(blockedQueue),
        });
        await cache.set(key, "1", BLOCKED_REMINDER_SECONDS);
        queueAlert = { sent: 1, societies: blockedQueue.length };
      } catch (err) {
        queueAlert = { sent: 0, error: err.message };
      }
    }
  }

  return {
    ok: true,
    dryRun,
    considered: societies.length,
    notified: results.filter((r) => r.action === "notified").length,
    blocked: blockedQueue.length,
    queueAlert,
    results,
    tookMs: Date.now() - startedAt,
  };
}

function societyEmailHtml({ society, lifecycle }) {
  const blocked = lifecycle.state === STATE.BLOCKED;
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 16px;font-size:18px">${society.name}</h2>
    <p style="font-size:14.5px;line-height:1.7">${lifecycleMessage(lifecycle, society.name)}</p>

    ${
      blocked
        ? `<div style="background:#fef2f2;border-left:3px solid #ef4444;padding:12px 16px;font-size:13.5px;line-height:1.7;margin:20px 0">
             <strong>Nothing has been deleted.</strong> All of your society's records are still here
             and will stay here. You can renew at any time, or download a complete copy and close
             the account.
           </div>`
        : `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;font-size:13.5px;line-height:1.7;margin:20px 0">
             You can still view and export everything. Renewing restores full access immediately.
           </div>`
    }

    <p style="margin:24px 0">
      <a href="${APP_URL}/subscription" style="background:#111;color:#fff;padding:11px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">
        ${blocked ? "Renew or download our records" : "Renew subscription"}
      </a>
    </p>

    <p style="color:#666;font-size:12px;line-height:1.6;margin-top:24px">
      Residents are unaffected — they can still sign in and see their own bills, receipts and
      payment history. Only the committee's admin functions are limited.
    </p>
  </div>`;
}

function queueDigestHtml(rows) {
  const items = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${r.societyName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${r.daysInState} days</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px">${r.contact || "— no address —"}</td>
      </tr>`,
    )
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px;font-size:18px">${rows.length} society(s) are blocked</h2>
    <p style="margin:0 0 20px;color:#666;font-size:13px">
      Talk to them — renew, or start the offboarding. Neither happens on its own.
    </p>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Society</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Blocked for</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Contact</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
    </table>
    <p style="margin:24px 0">
      <a href="${APP_URL}/superadmin/societies" style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">
        Open the queue
      </a>
    </p>
    <p style="color:#666;font-size:12px;line-height:1.6">
      Nothing is deleted while a society sits here, and nothing will be until someone starts the
      offboarding — which is deliberate. This reminder repeats weekly until the list is empty.
    </p>
  </div>`;
}
