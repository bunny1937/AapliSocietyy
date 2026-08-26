// AUTO-DERIVED registry (regenerate by hand if models are added).
//
// EXCLUDE ON REGENERATION: models/SocietyHandover.js. It carries a societyId
// and so looks like a member of this set, but it must NOT be — everything
// listed here is destroyed by purgeSociety, and a handover record that deleted
// itself at purge time would erase the proof that the handover ever happened.
// It holds no personal data, so it outlives the society by design.
// Every society-scoped model — i.e. every model with a societyId field — that a
// society export must capture. Deliberately exhaustive: the LOOP-05 export is a
// "what would be destroyed" snapshot, so a model missing here is data that
// silently disappears on a permanent delete with no way back.
//
// volatile: true  => still exported, but NOT compared during verify-export.
// These churn on their own (logs, notifications, analytics rollups, upload
// bookkeeping) and would make a clean verify impossible during the window
// between downloading the export and acting on it.

import AdminLog from "@/models/admin/AdminLog.js";
import Export from "@/models/admin/Export.js";
import Amenity from "@/models/amenities/Amenity.js";
import AmenityActivityLog from "@/models/amenities/AmenityActivityLog.js";
import AmenityAnalyticsDaily from "@/models/amenities/AmenityAnalyticsDaily.js";
import AmenityAttendance from "@/models/amenities/AmenityAttendance.js";
import AmenityAvailability from "@/models/amenities/AmenityAvailability.js";
import AmenityCategory from "@/models/amenities/AmenityCategory.js";
import AmenityEvent from "@/models/amenities/AmenityEvent.js";
import AmenityEventRegistration from "@/models/amenities/AmenityEventRegistration.js";
import AmenityIncident from "@/models/amenities/AmenityIncident.js";
import AmenityMaintenance from "@/models/amenities/AmenityMaintenance.js";
import AmenityMemberCard from "@/models/amenities/AmenityMemberCard.js";
import AmenityQrScan from "@/models/amenities/AmenityQrScan.js";
import AmenityQrToken from "@/models/amenities/AmenityQrToken.js";
import AmenityRule from "@/models/amenities/AmenityRule.js";
import AmenitySetting from "@/models/amenities/AmenitySetting.js";
import AmenityTimeSlot from "@/models/amenities/AmenityTimeSlot.js";
import AmenityVisitor from "@/models/amenities/AmenityVisitor.js";
import AmenityWaitlist from "@/models/amenities/AmenityWaitlist.js";
import Archive from "@/models/Archive.js";
import Asset from "@/models/Asset.js";
import AuditEvent from "@/models/AuditEvent.js";
import AuditLog from "@/models/AuditLog.js";
import AuditReport from "@/models/AuditReport.js";
import BankAccount from "@/models/BankAccount.js";
import BankReconciliationMatch from "@/models/BankReconciliationMatch.js";
import BankStatementLine from "@/models/BankStatementLine.js";
import Bill from "@/models/Bill.js";
import BillingHead from "@/models/BillingHead.js";
import Blacklist from "@/models/Blacklist.js";
import BulkImportRun from "@/models/BulkImportRun.js";
import BusinessProfile from "@/models/BusinessProfile.js";
import ChartOfAccount from "@/models/ChartOfAccount.js";
import CommercialBillingHead from "@/models/CommercialBillingHead.js";
import CommercialCategory from "@/models/CommercialCategory.js";
import CommercialNumberSequence from "@/models/CommercialNumberSequence.js";
import CommercialSettings from "@/models/CommercialSettings.js";
import Complaint from "@/models/Complaint.js";
import ComplaintReply from "@/models/ComplaintReply.js";
import DocumentSequence from "@/models/DocumentSequence.js";
import Expense from "@/models/Expense.js";
import FinancialYear from "@/models/FinancialYear.js";
import Fund from "@/models/Fund.js";
import ImportStaging from "@/models/ImportStaging.js";
import JournalAuditTrail from "@/models/JournalAuditTrail.js";
import JournalEntry from "@/models/JournalEntry.js";
import JournalLine from "@/models/JournalLine.js";
import Liability from "@/models/Liability.js";
import Member from "@/models/Member.js";
import Notice from "@/models/Notice.js";
import Notification from "@/models/Notification.js";
import PaymentImport from "@/models/PaymentImport.js";
import PostingRule from "@/models/PostingRule.js";
import ProfileEditRequest from "@/models/ProfileEditRequest.js";
import PushSubscription from "@/models/PushSubscription.js";
import Receipt from "@/models/Receipt.js";
import RentPayment from "@/models/RentPayment.js";
import RetentionArchive from "@/models/RetentionArchive.js";
import RetentionSetting from "@/models/RetentionSetting.js";
import Role from "@/models/Role.js";
import RoleAssignment from "@/models/RoleAssignment.js";
import Schedule from "@/models/Schedule.js";
import ScheduledBillRun from "@/models/ScheduledBillRun.js";
import Shop from "@/models/Shop.js";
import ShopOrder from "@/models/ShopOrder.js";
import ShopProduct from "@/models/ShopProduct.js";
import SocietyEntry from "@/models/SocietyEntry.js";
import TenantRequest from "@/models/TenantRequest.js";
import Transaction from "@/models/Transaction.js";
import UploadedFile from "@/models/UploadedFile.js";
import ValidationRule from "@/models/ValidationRule.js";
import Visitor from "@/models/Visitor.js";
import VisitorPass from "@/models/VisitorPass.js";
import Voucher from "@/models/Voucher.js";

export const SOCIETY_COLLECTIONS = [
  { key: "adminLogs", label: "Admin Log", Model: AdminLog, volatile: true },
  { key: "exports", label: "Export", Model: Export, volatile: true },
  { key: "amenities", label: "Amenity", Model: Amenity },
  { key: "amenityActivityLogs", label: "Amenity Activity Log", Model: AmenityActivityLog, volatile: true },
  { key: "amenityAnalyticsDaily", label: "Amenity Analytics Daily", Model: AmenityAnalyticsDaily, volatile: true },
  { key: "amenityAttendances", label: "Amenity Attendance", Model: AmenityAttendance },
  { key: "amenityAvailabilities", label: "Amenity Availability", Model: AmenityAvailability },
  { key: "amenityCategories", label: "Amenity Category", Model: AmenityCategory },
  { key: "amenityEvents", label: "Amenity Event", Model: AmenityEvent },
  { key: "amenityEventRegistrations", label: "Amenity Event Registration", Model: AmenityEventRegistration },
  { key: "amenityIncidents", label: "Amenity Incident", Model: AmenityIncident },
  { key: "amenityMaintenances", label: "Amenity Maintenance", Model: AmenityMaintenance },
  { key: "amenityMemberCards", label: "Amenity Member Card", Model: AmenityMemberCard },
  { key: "amenityQrScans", label: "Amenity Qr Scan", Model: AmenityQrScan, volatile: true },
  { key: "amenityQrTokens", label: "Amenity Qr Token", Model: AmenityQrToken, volatile: true },
  { key: "amenityRules", label: "Amenity Rule", Model: AmenityRule },
  { key: "amenitySettings", label: "Amenity Setting", Model: AmenitySetting },
  { key: "amenityTimeSlots", label: "Amenity Time Slot", Model: AmenityTimeSlot },
  { key: "amenityVisitors", label: "Amenity Visitor", Model: AmenityVisitor },
  { key: "amenityWaitlists", label: "Amenity Waitlist", Model: AmenityWaitlist },
  { key: "archives", label: "Archive", Model: Archive, volatile: true },
  { key: "assets", label: "Asset", Model: Asset },
  { key: "auditEvents", label: "Audit Event", Model: AuditEvent, volatile: true },
  { key: "auditLogs", label: "Audit Log", Model: AuditLog, volatile: true },
  { key: "auditReports", label: "Audit Report", Model: AuditReport },
  { key: "bankAccounts", label: "Bank Account", Model: BankAccount },
  { key: "bankReconciliationMatches", label: "Bank Reconciliation Match", Model: BankReconciliationMatch },
  { key: "bankStatementLines", label: "Bank Statement Line", Model: BankStatementLine },
  { key: "bills", label: "Bill", Model: Bill },
  { key: "billingHeads", label: "Billing Head", Model: BillingHead },
  { key: "blacklists", label: "Blacklist", Model: Blacklist },
  { key: "bulkImportRuns", label: "Bulk Import Run", Model: BulkImportRun, volatile: true },
  { key: "businessProfiles", label: "Business Profile", Model: BusinessProfile },
  { key: "chartOfAccounts", label: "Chart Of Account", Model: ChartOfAccount },
  { key: "commercialBillingHeads", label: "Commercial Billing Head", Model: CommercialBillingHead },
  { key: "commercialCategories", label: "Commercial Category", Model: CommercialCategory },
  { key: "commercialNumberSequences", label: "Commercial Number Sequence", Model: CommercialNumberSequence },
  { key: "commercialSettings", label: "Commercial Settings", Model: CommercialSettings },
  { key: "complaints", label: "Complaint", Model: Complaint },
  { key: "complaintReplies", label: "Complaint Reply", Model: ComplaintReply },
  { key: "documentSequences", label: "Document Sequence", Model: DocumentSequence },
  { key: "expenses", label: "Expense", Model: Expense },
  { key: "financialYears", label: "Financial Year", Model: FinancialYear },
  { key: "funds", label: "Fund", Model: Fund },
  { key: "importStagings", label: "Import Staging", Model: ImportStaging, volatile: true },
  { key: "journalAuditTrails", label: "Journal Audit Trail", Model: JournalAuditTrail, volatile: true },
  { key: "journalEntries", label: "Journal Entry", Model: JournalEntry },
  { key: "journalLines", label: "Journal Line", Model: JournalLine },
  { key: "liabilities", label: "Liability", Model: Liability },
  { key: "members", label: "Member", Model: Member },
  { key: "notices", label: "Notice", Model: Notice },
  { key: "notifications", label: "Notification", Model: Notification, volatile: true },
  { key: "paymentImports", label: "Payment Import", Model: PaymentImport },
  { key: "postingRules", label: "Posting Rule", Model: PostingRule },
  { key: "profileEditRequests", label: "Profile Edit Request", Model: ProfileEditRequest },
  { key: "pushSubscriptions", label: "Push Subscription", Model: PushSubscription, volatile: true },
  { key: "receipts", label: "Receipt", Model: Receipt },
  { key: "rentPayments", label: "Rent Payment", Model: RentPayment },
  { key: "retentionArchives", label: "Retention Archive", Model: RetentionArchive, volatile: true },
  { key: "retentionSettings", label: "Retention Setting", Model: RetentionSetting },
  { key: "roles", label: "Role", Model: Role },
  { key: "roleAssignments", label: "Role Assignment", Model: RoleAssignment },
  { key: "schedules", label: "Schedule", Model: Schedule },
  { key: "scheduledBillRuns", label: "Scheduled Bill Run", Model: ScheduledBillRun },
  { key: "shops", label: "Shop", Model: Shop },
  { key: "shopOrders", label: "Shop Order", Model: ShopOrder },
  { key: "shopProducts", label: "Shop Product", Model: ShopProduct },
  { key: "societyEntries", label: "Society Entry", Model: SocietyEntry },
  { key: "tenantRequests", label: "Tenant Request", Model: TenantRequest },
  { key: "transactions", label: "Transaction", Model: Transaction },
  { key: "uploadedFiles", label: "Uploaded File", Model: UploadedFile, volatile: true },
  { key: "validationRules", label: "Validation Rule", Model: ValidationRule },
  { key: "visitors", label: "Visitor", Model: Visitor },
  { key: "visitorPasses", label: "Visitor Pass", Model: VisitorPass },
  { key: "vouchers", label: "Voucher", Model: Voucher },
];

export const VERIFIED_COLLECTIONS = SOCIETY_COLLECTIONS.filter((c) => !c.volatile);
