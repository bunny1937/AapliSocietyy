import { setting } from "@/lib/platform/settings";
import { sendEmail } from "@/lib/brevo-email";
import { getModule } from "./modules";

// The alert a superadmin gets when a society keeps knocking.
//
// ## It is a sales lead, not a security incident
//
// A society hitting Amenities routes fourteen times in forty minutes almost
// certainly contains a person who wants Amenities. Writing this as an intrusion
// report — red, urgent, "unauthorised access attempt" — would read the signal
// exactly backwards and train whoever receives it to dread opening it.
//
// So it is written as what it is: someone tried to use a thing they cannot use.
// The primary action is granting the module. The security framing is available
// to the reader if the details warrant it, and is never asserted for them.
//
// ## The society is never told
//
// They see a plain 404 and nothing else. Telling them they were detected turns
// idle curiosity into a challenge, and turns a product they might buy into a
// lock they want to pick.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

export function denialAlertHtml({ societyName, societyId, summary, plan, entitled }) {
  const topModule = summary.modules[0];
  const mod = topModule ? getModule(topModule.key) : null;
  const minutes = Math.max(
    1,
    Math.round((new Date(summary.last) - new Date(summary.first)) / 60000),
  );

  const row = (label, value) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#666;font-size:13px">${label}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px">${value}</td>
    </tr>`;

  const users = summary.users
    .map((u) => `${u.name}${u.role ? ` (${u.role})` : ""} × ${u.count}`)
    .join("<br>");
  const paths = summary.paths
    .map((p) => `<code style="font-size:12px">${p.path}</code> × ${p.count}`)
    .join("<br>");
  const modules = summary.modules
    .map((m) => `${getModule(m.key)?.label || m.key} × ${m.count}`)
    .join("<br>");

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px;font-size:18px">
      ${societyName} tried to use ${mod?.label || topModule?.key || "a module they do not have"}
    </h2>
    <p style="margin:0 0 18px;color:#666;font-size:13px">
      ${summary.count} attempt${summary.count === 1 ? "" : "s"} in ${minutes} minute${minutes === 1 ? "" : "s"}
    </p>

    <div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 16px;font-size:13.5px;margin:0 0 20px;line-height:1.6">
      Most likely somebody there wants this module. Worth a call before anything else.
    </div>

    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      ${row("Plan", plan || "—")}
      ${row("Currently has", entitled?.length ? entitled.join(", ") : "base only")}
      ${row("Tried to reach", modules)}
      ${row("Who", users || "—")}
      ${row("Where", paths || "—")}
      ${row("First seen", new Date(summary.first).toLocaleString("en-IN"))}
      ${row("Last seen", new Date(summary.last).toLocaleString("en-IN"))}
      ${row(
        "From",
        summary.surfaces.map((s) => `${s.surface} × ${s.count}`).join(", ") || "—",
      )}
    </table>

    <p style="margin:0 0 20px">
      <a href="${APP_URL}/superadmin/societies/${societyId}"
         style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-size:14px">
        Open ${societyName}
      </a>
    </p>

    <p style="color:#666;font-size:12px;line-height:1.6;margin-top:24px">
      The society sees an ordinary "not found" and has not been told about this. They will keep
      seeing it until the module is granted. You will not get another alert for this society today,
      however many more attempts there are.
    </p>
  </div>`;
}

/**
 * Who hears about it. Platform-side only — this is our operational signal, and
 * a society must never receive an alert about its own denied requests.
 */
export function alertRecipients() {
  return [
    ...new Set(
      [setting("ENTITLEMENT_ALERT_EMAIL"), process.env.SUPER_ADMIN_EMAIL]
        .filter(Boolean)
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => e.includes("@")),
    ),
  ];
}

export async function sendDenialAlert({ societyName, societyId, summary, plan, entitled }) {
  const recipients = alertRecipients();
  if (!recipients.length) return { sent: 0, failed: [], skipped: "no recipients configured" };

  const html = denialAlertHtml({ societyName, societyId, summary, plan, entitled });
  const subject = `${societyName} tried to use ${
    getModule(summary.modules[0]?.key)?.label || "a module they do not have"
  } (${summary.count}×)`;

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
