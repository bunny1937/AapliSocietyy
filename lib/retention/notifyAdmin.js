import { sendEmail } from "@/lib/brevo-email";

/**
 * "You have an archive waiting" notifications.
 *
 * ## What changed (no more presigned R2 links)
 *
 * The first version uploaded a zip to R2 and emailed a presigned URL. That
 * meant: bytes stored for everyone whether or not they cared, a link that
 * expires and then generates a support ticket, and a URL that works for anyone
 * who gets forwarded the email — including after that person leaves the
 * managing committee.
 *
 * Now the email carries **no data and no link to data**. It carries a link to
 * the admin's own dashboard. They log in with their existing credentials and
 * download from there. Consequences:
 *
 *  - Nothing is stored anywhere. The bundle is built when the button is
 *    pressed and streamed straight to the browser.
 *  - Access is governed by your existing auth, live. A removed committee
 *    member loses access the moment their account is disabled, retroactively,
 *    for every archive.
 *  - The link never expires, so a two-week-old email still works.
 *  - Forwarding the email leaks nothing.
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  "https://aaplisociety.visync.in";

/**
 * Who gets told. Order of preference:
 *   1. Whatever the society explicitly configured in RetentionSetting
 *   2. The society's own admin/contact addresses
 *   3. The platform-level fallbacks (RETENTION_ARCHIVE_EMAIL / SUPER_ADMIN_EMAIL)
 *
 * The platform fallbacks are a safety net for societies that have configured
 * nothing — without them, a society with a stale adminEmail would silently
 * accumulate archives nobody knows about.
 */
export function retentionRecipients(society, setting) {
  const configured = setting?.notifyEmails ?? [];
  const fromSociety = [
    society?.adminEmail,
    society?.contactEmail,
    society?.email,
  ];
  const platform = [
    process.env.RETENTION_ARCHIVE_EMAIL,
    process.env.SUPER_ADMIN_EMAIL,
  ];

  const chosen = configured.length ? [...configured, ...platform] : [...fromSociety, ...platform];

  return [
    ...new Set(
      chosen
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
}

export function retentionEmailHtml({
  societyName,
  runDate,
  items, // [{ policyLabel, recordCount, purgeEnabled, archiveId }]
  graceDays,
}) {
  const total = items.reduce((s, i) => s + i.recordCount, 0);
  const anyPurgeable = items.some((i) => i.purgeEnabled);

  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${i.policyLabel}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">${i.recordCount.toLocaleString("en-IN")}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${
          i.purgeEnabled
            ? '<span style="color:#b45309">Will be deleted after download</span>'
            : '<span style="color:#047857">Archive only — kept in the system</span>'
        }</td>
      </tr>`,
    )
    .join("");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">Data archive ready — ${societyName}</h2>
    <p style="margin:0 0 20px;color:#666;font-size:13px">Run date ${runDate}</p>

    <p><strong>${total.toLocaleString("en-IN")} records</strong> have reached the end of their retention period.
    You can download a complete copy — Excel, PDF, Word, CSV and JSON — from your dashboard.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:20px 0">
      <thead>
        <tr style="background:#f8f8f8">
          <th style="padding:8px 12px;text-align:left">Data</th>
          <th style="padding:8px 12px;text-align:right">Records</th>
          <th style="padding:8px 12px;text-align:left">After download</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <p style="margin:24px 0">
      <a href="${APP_URL}/admin/data-archive"
         style="background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">
        Open Data Archive
      </a>
    </p>

    ${
      anyPurgeable
        ? `<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:12px 16px;font-size:13px;margin:20px 0">
             <strong>Nothing is deleted until you download it.</strong>
             The records above stay exactly where they are until you take a copy.
             Once downloaded, the ones marked for deletion are removed on the following night's run.
             If you never download, nothing is ever deleted — you will simply get this reminder again.
           </div>`
        : `<div style="background:#ecfdf5;border-left:3px solid #10b981;padding:12px 16px;font-size:13px;margin:20px 0">
             <strong>Nothing here will be deleted.</strong>
             Your society has not enabled automatic deletion for any of these,
             so this is a convenience export only.
           </div>`
    }

    <p style="color:#666;font-size:12px;margin-top:24px">
      This link opens your normal dashboard and requires your usual login — there is no
      data in this email and nothing useful to anyone it is forwarded to.
      ${graceDays ? `We will remind you every ${graceDays} days until you download.` : ""}
    </p>
  </div>`;
}

/**
 * Sends one at a time. Brevo's transactional endpoint takes a `to` array, but
 * sending individually means one bad address cannot suppress delivery to the
 * rest — and with typically 2–3 recipients per society the extra calls are
 * irrelevant.
 */
export async function sendRetentionEmails({ recipients, subject, html }) {
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
  return { sent, failed };
}
