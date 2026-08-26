import Member from "@/models/Member";
import { sendEmail } from "@/lib/brevo-email";

// Telling the members, not only the committee.
//
// ## Why this exists
//
// Everything else in the offboarding flow talks to the society's committee:
// the handover mail, the download page, the confirmation. But the personal
// data being erased belongs to the members, and under DPDP a Data Principal is
// entitled to know what happens to it. A committee that decides to leave the
// platform has every right to do so — it does not have the right to have its
// members find out by discovering their payment history has vanished.
//
// So at soft-delete time, once and only once, every member with an address on
// file is told: what is happening, when, and that their society still holds
// the original records (MCS Act s.32 and Bye-law 173 — the society's books
// are the society's, and their inspection rights are unaffected by us).
//
// ## What it deliberately does not do
//
// It does not offer members a download. The Data Fiduciary here is the
// society, not us; we are the processor. Handing a member their own extract
// on the society's behalf, without the society asking, would be us making a
// disclosure decision that is not ours to make. The mail points them at their
// own committee.
//
// Failures never propagate: a soft delete that half-succeeded because a
// mail server was down would be far worse than an unsent notice.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";
const BATCH_DELAY_MS = 50;

export function memberNoticeHtml({ societyName, memberName, erasureDate }) {
  const when = erasureDate
    ? new Date(erasureDate).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 16px">${societyName} is leaving AapliSociety</h2>

    <p>${memberName ? `Dear ${memberName},` : "Dear member,"}</p>

    <p><strong>${societyName}</strong> has asked us to close its account on AapliSociety.
    ${when ? `Your personal information held by us — your flat details, bills, payments and any complaints or bookings — will be permanently erased from our systems on <strong>${when}</strong>.` : "Your personal information held by us will be permanently erased from our systems."}</p>

    <div style="background:#ecfdf5;border-left:3px solid #10b981;padding:12px 16px;font-size:14px;margin:20px 0">
      <strong>Your society keeps its records.</strong>
      A complete copy of everything has been handed to your managing committee, and the society's
      own books remain with the society exactly as before. Your right to inspect them is unchanged.
      For anything you need — a payment receipt, a statement, a dues certificate — please contact
      your committee directly.
    </div>

    <p style="font-size:14px">Until the date above you can still sign in and take copies of anything
    you need for your own records.</p>

    <p style="margin:24px 0">
      <a href="${APP_URL}/member/login"
         style="background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">
        Sign in
      </a>
    </p>

    <p style="color:#666;font-size:12px;margin-top:24px">
      You are receiving this because your society registered this address for you. After the date
      above we will hold no personal information about you, and this address will be erased along
      with everything else — so this is the last message you will receive from us.
    </p>
  </div>`;
}

/**
 * One-time notice to every member of a society being wound down.
 *
 * @returns { attempted, sent, failed, skipped } — never throws
 */
export async function notifyMembersOfErasure({ societyId, societyName, erasureDate }) {
  const summary = { attempted: 0, sent: 0, failed: 0, skipped: 0 };
  try {
    const members = await Member.find({ societyId })
      .select("name emailPrimary emailSecondary")
      .lean();

    const seen = new Set();
    const subject = `${societyName} is closing its AapliSociety account`;

    for (const m of members) {
      const to = (m.emailPrimary || m.emailSecondary || "").trim().toLowerCase();
      if (!to || !to.includes("@") || seen.has(to)) {
        summary.skipped++;
        continue;
      }
      seen.add(to);
      summary.attempted++;
      try {
        await sendEmail({
          to,
          subject,
          html: memberNoticeHtml({ societyName, memberName: m.name, erasureDate }),
        });
        summary.sent++;
      } catch {
        summary.failed++;
      }
      // Brevo rate-limits; a 500-member society sent flat out gets throttled
      // and the tail silently fails.
      if (BATCH_DELAY_MS) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  } catch (err) {
    console.error("member erasure notice error:", err);
  }
  return summary;
}
