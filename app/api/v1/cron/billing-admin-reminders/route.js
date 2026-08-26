import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import Notification from "@/models/Notification";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import PaymentImport from "@/models/PaymentImport";
import { cronAuthorized } from "@/lib/v1/config";
import { sendFcmToUser } from "@/lib/v1/fcm";
import { sendEmail } from "@/lib/brevo-email";
import { drainDueScheduledBillRuns } from "@/lib/billing/scheduledBillRuns";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function indiaTomorrow() {
  const indiaNow = new Date(Date.now() + 330 * 60 * 1000);
  return new Date(Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate() + 1));
}
function effectiveDay(year, monthIndex, configuredDay) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(Math.max(1, Number(configuredDay) || 1), last);
}
async function allBillsCreated(societyId, monthKey) {
  const [memberCount, billedMembers] = await Promise.all([
    Member.countDocuments({ societyId, isDeleted: { $ne: true } }),
    Bill.distinct("memberId", { societyId, billPeriodId: monthKey, isDeleted: { $ne: true } }),
  ]);
  return memberCount > 0 && billedMembers.length >= memberCount;
}
async function sendReminder({ society, admins, key, title, message, actionUrl }) {
  const reminderKey = `${key}:${society._id}`;
  if (await Notification.exists({ societyId: society._id, "metadata.reminderKey": reminderKey })) return false;
  const recipientIds = admins.map((u) => String(u._id));
  const notification = await Notification.create({ societyId: society._id, createdBy: admins[0]._id, createdByName: "System", type: "ADMIN_MESSAGE", title, message, recipientType: "user", recipientIds, actionUrl, metadata: { reminderKey } });
  await Promise.allSettled(admins.map((admin) => Promise.allSettled([
    sendFcmToUser(String(admin._id), { title, body: message }, { type: "ADMIN_MESSAGE", notificationId: String(notification._id), reminderKey }),
    admin.email
      ? sendEmail({ to: admin.email, subject: `${society.name}: ${title}`, html: `<div style="font-family:Arial,sans-serif"><p>Hello ${esc(admin.name || 'Admin')},</p><p>${esc(message)}</p><p><strong>${esc(society.name)}</strong></p></div>` })
      : Promise.resolve(),
  ])));
  return true;
}
export async function GET(request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await connectDB(); const tomorrow = indiaTomorrow(); const year = tomorrow.getUTCFullYear(); const monthIndex = tomorrow.getUTCMonth(); const day = tomorrow.getUTCDate();
  const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const scheduledRuns = await drainDueScheduledBillRuns();
  const societies = await Society.find({}).select("name config.billGenerationDay config.paymentUploadDay").lean();
  const summary = { checked: societies.length, billCreationReminders: 0, paymentUploadReminders: 0, skippedAlreadyComplete: 0, skippedNoAdmin: 0 };
  for (const society of societies) {
    const creationDue = effectiveDay(year, monthIndex, society.config?.billGenerationDay || 1);
    const uploadDue = effectiveDay(year, monthIndex, society.config?.paymentUploadDay || 30);
    const creationReminderDue = day === creationDue;
    const uploadReminderDue = day === uploadDue;
    if (!creationReminderDue && !uploadReminderDue) continue;

    const [billsAlreadyCreated, paymentsAlreadyUploaded] = await Promise.all([
      creationReminderDue
        ? allBillsCreated(society._id, monthKey)
        : false,
      uploadReminderDue
        ? PaymentImport.exists({ societyId: society._id, importYear: year, importMonth: monthIndex + 1, status: "Completed", failedRows: 0 })
        : false,
    ]);
    if ((creationReminderDue && billsAlreadyCreated) || (uploadReminderDue && paymentsAlreadyUploaded)) {
      summary.skippedAlreadyComplete += Number(Boolean(creationReminderDue && billsAlreadyCreated)) + Number(Boolean(uploadReminderDue && paymentsAlreadyUploaded));
    }
    const shouldRemindCreation = creationReminderDue && !billsAlreadyCreated;
    const shouldRemindUpload = uploadReminderDue && !paymentsAlreadyUploaded;
    if (!shouldRemindCreation && !shouldRemindUpload) continue;

    const admins = await User.find({ societyId: society._id, role: { $in: ["Admin", "Secretary", "Treasurer"] }, isActive: { $ne: false } }).select("_id name email").lean();
    if (!admins.length) { summary.skippedNoAdmin += 1; continue; }
    if (shouldRemindCreation && await sendReminder({ society, admins, key: `BILL_CREATE:${monthKey}`, title: "Create monthly bills tomorrow", message: `Tomorrow is the configured bill creation day (${creationDue}). Please review the billing matrix and create the ${monthKey} bills.`, actionUrl: "/admin/generate-bills" })) summary.billCreationReminders += 1;
    if (shouldRemindUpload && await sendReminder({ society, admins, key: `PAYMENT_UPLOAD:${monthKey}`, title: "Upload payments tomorrow", message: `Tomorrow is the configured payment upload day (${uploadDue}). Please upload and confirm the latest payment Excel.`, actionUrl: "/admin/payments" })) summary.paymentUploadReminders += 1;
  }
  return NextResponse.json({ ok: true, tomorrow: tomorrow.toISOString().slice(0,10), scheduledBillRuns: scheduledRuns, ...summary });
}
