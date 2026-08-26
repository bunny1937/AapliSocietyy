import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import { sendEmail } from "@/lib/brevo-email";
import { buildSocietyArtifacts, artifactRecords } from "./societyArtifacts";
import { BUNDLE_FORMAT_VERSION } from "./societyBundle";

// Handing a society its own records back, on the way out.
//
// ## Why the email carries nothing
//
// lib/retention/notifyAdmin.js already worked this out for the archive flow
// and reached the right answer, so this follows it rather than re-deciding:
// the email contains no data and no link to data. It links to the society's
// own dashboard, and they log in with the credentials they already have.
//
//   - Nothing is stored. The bundle is built when the button is pressed and
//     streamed straight to the browser.
//   - Access is live. A committee member removed yesterday cannot collect the
//     handover today, retroactively, without anyone revoking a link.
//   - The link does not expire, so a mail read three weeks late still works.
//   - Forwarding the mail leaks nothing.
//
// A presigned link would fail every one of those, and would also mean the
// platform retaining the export — the exact thing this whole flow exists to
// avoid.
//
// ## What is kept
//
// The SocietyHandover row: manifest, salt, roots, per-artifact SHA-256,
// counts, recipients, receipts. Never the payload. Digest, not data.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

export const HANDOVER_PAGE_PATH = "/admin/data-handover";
// Sent to a committee member who is almost certainly signed out. Landing them
// on the login page with the destination attached means they arrive where the
// email said they would, instead of on a dashboard with no clue what to click.
export const HANDOVER_EMAIL_LINK = `/auth/login?next=${encodeURIComponent(HANDOVER_PAGE_PATH)}`;

/**
 * The society's own registered addresses, from the Society document.
 *
 * Deliberately NOT the operator's address and NOT an env fallback: unlike a
 * retention archive — where a platform fallback stops a stale adminEmail
 * silently accumulating archives nobody sees — a handover addressed to us
 * would defeat its purpose. If a society has no reachable address on file,
 * that is a fact the superadmin has to see and fix, not one to paper over.
 */
export function handoverRecipients(society) {
  const candidates = [
    society?.credentials?.adminEmail,
    society?.contactEmail,
    society?.email,
    society?.adminEmail,
  ];
  return [
    ...new Set(
      candidates
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
}

export function handoverEmailHtml({ societyName, counts, artifacts, purgeScheduledFor }) {
  const rows = artifacts
    .map(
      (a) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${a.format.toUpperCase()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:ui-monospace,Menlo,monospace;font-size:11px;word-break:break-all">${a.sha256}</td>
      </tr>`,
    )
    .join("");

  const deadline = purgeScheduledFor
    ? new Date(purgeScheduledFor).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">Your society's records are ready — ${societyName}</h2>
    <p style="margin:0 0 20px;color:#666;font-size:13px">Complete copy, prepared for handover</p>

    <p>A complete copy of ${societyName}'s records is ready for you to save — members, bills,
    receipts, payments, notices, complaints and accounts.
    <strong>${(counts?.documents ?? 0).toLocaleString("en-IN")} records</strong> in
    <strong>${counts?.collections ?? 0} sections</strong>.</p>

    <p>Click the button below, sign in as you normally do, and press Download. It takes about a
    minute. We suggest the Excel file — it opens in Excel or Google Sheets, with one tab per
    section.</p>

    <p style="margin:24px 0">
      <a href="${APP_URL}${HANDOVER_EMAIL_LINK}"
         style="background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">
        Save my society's records
      </a>
    </p>

    <p style="font-size:12px;color:#666;margin:0 0 8px">The page checks each file on your own
    computer as it arrives, so you can be sure it downloaded completely. Nothing below needs your
    attention — it is a technical reference, in case your next software provider asks for it.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 20px">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">File</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">Reference code</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    ${
      deadline
        ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;font-size:13px;margin:20px 0">
             <strong>Please save these before ${deadline}.</strong>
             Your society's information will be removed from our systems on that date.
             Nothing has been removed yet.
           </div>`
        : `<div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 16px;font-size:13px;margin:20px 0">
             Nothing has been deleted. This is a copy of your records for your own custody.
           </div>`
    }

    <p style="color:#666;font-size:12px;margin-top:24px">
      For your protection this email contains none of your data. The button opens your usual
      login page, so there is nothing useful to anyone this email is forwarded to. Aadhaar numbers
      are never included and PAN numbers are partly hidden.
    </p>
  </div>`;
}

/**
 * Build the artifacts, record the handover, tell the society.
 *
 * Ordering matters and mirrors the retention download route: the bytes are
 * built and hashed BEFORE anything is written. If the build throws, no
 * handover row is created and no email claiming records are ready goes out.
 *
 * The bundle itself is discarded on return — only `artifacts` (in memory, for
 * the caller to stream if it wants to) and the digests survive.
 *
 * @returns { handover, artifacts, recipients, notify } or null if no society
 */
export async function createHandover({
  societyId,
  actorUserId,
  notify = true,
  overrideRecipients = null,
  overrideReason = "",
}) {
  const society = await Society.findById(societyId).lean();
  if (!society) return null;

  const built = await buildSocietyArtifacts(societyId);
  if (!built) return null;

  const registered = handoverRecipients(society);
  const override = normalizeRecipients(overrideRecipients);

  // The override REPLACES the registered addresses rather than adding to them.
  //
  // It exists for the case the registered ones are the problem — dissolved
  // committee, dead mailbox, a secretary who left and took the address with
  // them. Sending to both would mean a delivery receipt that cannot be read:
  // one address bounced and one did not, and the row says "sent 1 of 2" with
  // no way to know which mattered. It is also refused entirely when the
  // society HAS a reachable address, in the route — this is the exception, and
  // an exception that can be taken casually stops being one.
  const usingOverride = override.length > 0;
  const recipients = usingOverride ? override : registered;
  const records = artifactRecords(built);

  // Only one handover is current per society. Older rows stay for the audit
  // trail but are marked so nothing downstream mistakes a stale manifest for
  // the live one.
  await SocietyHandover.updateMany(
    { societyId, status: { $in: ["built", "notified", "downloaded"] } },
    { $set: { status: "superseded" } },
  );

  const handover = await SocietyHandover.create({
    societyId,
    societyName: society.name,
    societySlug: society.societyCode || society.slug,
    formatVersion: BUNDLE_FORMAT_VERSION,
    manifest: built.manifest,
    salt: built.salt,
    manifestRoot: built.manifest.root,
    artifacts: records,
    counts: built.manifest.counts,
    recipients,
    // Recorded because "who was told" is the question an auditor asks about a
    // handover, and "an address a superadmin typed in" is a materially
    // different answer from "the address on the society's own record".
    recipientSource: usingOverride ? "override" : "registered",
    overrideReason: usingOverride ? String(overrideReason || "").trim() : undefined,
    overrideByUserId: usingOverride ? actorUserId || null : undefined,
    registeredRecipients: usingOverride ? registered : undefined,
    status: "built",
  });

  let notifyResult = { sent: 0, failed: [], skipped: !notify };
  if (notify && recipients.length) {
    notifyResult = await sendHandoverEmails({
      recipients,
      societyName: society.name,
      counts: built.manifest.counts,
      artifacts: records,
      purgeScheduledFor: society.purgeScheduledFor,
    });
    await SocietyHandover.updateOne(
      { _id: handover._id },
      notifyResult.sent
        ? {
            $set: {
              status: "notified",
              notifiedAt: new Date(),
              ...(notifyResult.failed.length
                ? { notifyError: `${notifyResult.failed.length} of ${recipients.length} address(es) failed` }
                : {}),
            },
          }
        : {
            $set: {
              notifyError:
                notifyResult.failed.map((f) => `${f.to}: ${f.error}`).join("; ") || "no recipients",
            },
          },
    );
  } else if (notify && !recipients.length) {
    await SocietyHandover.updateOne(
      { _id: handover._id },
      { $set: { notifyError: "Society has no registered email address on file" } },
    );
  }

  return {
    handover,
    artifacts: built,
    recipients,
    registeredRecipients: registered,
    usingOverride,
    notify: notifyResult,
    actorUserId,
  };
}

/** Trim, lowercase, de-duplicate, and drop anything that is not an address. */
export function normalizeRecipients(input) {
  const list = Array.isArray(input) ? input : input ? [input] : [];
  return [
    ...new Set(
      list
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        // Deliberately the same shallow check as handoverRecipients rather
        // than a stricter regex. A superadmin typing an address they were
        // given on the phone should not be argued with about a plus sign or a
        // long TLD; a genuinely malformed one bounces and shows up in the
        // operations dashboard as a delivery error, which is more informative
        // than a client-side rejection.
        .filter((e) => e.includes("@") && e.length >= 5),
    ),
  ];
}

/**
 * One send per address. Brevo takes a `to` array, but sending individually
 * means one dead address cannot suppress delivery to the rest — and there are
 * typically two of them.
 */
export async function sendHandoverEmails({
  recipients,
  societyName,
  counts,
  artifacts,
  purgeScheduledFor,
}) {
  const html = handoverEmailHtml({ societyName, counts, artifacts, purgeScheduledFor });
  const subject = `Your society's records are ready to collect — ${societyName}`;
  let sent = 0;
  const failed = [];
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject, html });
      sent++;
    } catch (err) {
      failed.push({ to, error: err.message });
    }
  }
  return { sent, failed, skipped: false };
}

/** The handover a society should currently be collecting, if any. */
export function currentHandoverQuery(societyId) {
  return { societyId, status: { $in: ["built", "notified", "downloaded", "confirmed"] } };
}
