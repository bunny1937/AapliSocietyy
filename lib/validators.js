import { z } from "zod";
export const societyConfigSchema = z.object({
  name: z.string().min(2, "Society name must be at least 2 characters"),
  registrationNo: z.string().optional(),
  address: z.string().optional(),
  config: z.object({
    maintenanceRate: z.number().min(0),
    sinkingFundRate: z.number().min(0),
    repairFundRate: z.number().min(0),
    interestRate: z.number().min(0).max(100),
    serviceTaxRate: z.number().min(0).max(100),
    gracePeriodDays: z.number().min(0).max(90),
    billDueDay: z.number().min(1).max(31).default(10),
    billPayFinalDay: z.number().min(1).max(31).default(25),
    interestCalculationMethod: z.enum(["SIMPLE", "COMPOUND"]).default("SIMPLE"),
    interestBasis: z.enum(["MONTHLY", "DAILY"]).default("MONTHLY"),
    billGenerationDay: z.number().min(1).max(28).default(1),
    billPushDay: z.number().min(1).max(28).default(1),
    fixedCharges: z.object({
      water: z.number().min(0),
      security: z.number().min(0),
      electricity: z.number().min(0),
    }),
  }),
});
export const matrixConfigSchema = z.object({
  L: z.number().min(1).max(50),
  R: z.number().min(1).max(50),
  billingHeads: z.array(
    z.object({
      id: z.string(),
      label: z.string().min(1),
    }),
  ),
});
// FIXED: this used to declare `roomNo`, `areaSqFt` and `contact` — three field
// names that do not exist on models/Member.js (which uses flatNo,
// carpetAreaSqft, contactNumber). Because z.object() strips unknown keys and
// /api/members/update $sets whatever survives, EVERY real field an admin edited
// was silently discarded, and the two required-but-nonexistent names meant the
// only caller got a 400. The names below are the model's own.
//
// Partial by design: this validates a PATCH of an existing member, so any
// subset may be sent and only what is sent is written.
const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  pincode: z.string().max(12).optional(),
  country: z.string().max(80).optional(),
});

const emergencyContactSchema = z.object({
  name: z.string().max(120).optional(),
  relation: z.string().max(60).optional(),
  phoneNumber: z.string().max(20).optional(),
  address: z.string().max(200).optional(),
});

export const familyMemberSchema = z.object({
  name: z.string().trim().min(1, "A family member needs a name.").max(120),
  relation: z.string().max(40).optional().nullable(),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  contactNumber: z.string().max(20).optional().nullable(),
  occupation: z.string().max(80).optional().nullable(),
});

export const parkingSlotSchema = z.object({
  slotNumber: z.string().trim().min(1, "A parking slot needs a number.").max(20),
  type: z.enum(["Stilt", "Open", "Covered"]),
  vehicleType: z.enum(["Two-Wheeler", "Four-Wheeler"]),
  // Stilt parking is not billed; the caller derives this, but an explicit value
  // is honoured so an admin can override for a society that bills differently.
  monthlyBilling: z.boolean().optional(),
});

export const memberSchema = z.object({
  // Flat identity
  flatNo: z.string().trim().min(1).max(20).optional(),
  wing: z.string().trim().max(20).optional().nullable(),
  floor: z.coerce.number().int().min(-3).max(200).optional().nullable(),
  carpetAreaSqft: z.coerce.number().min(1, "Carpet area must be more than 0.").optional(),
  builtUpAreaSqft: z.coerce.number().min(0).optional().nullable(),
  superBuiltUpAreaSqft: z.coerce.number().min(0).optional().nullable(),
  flatType: z.string().max(30).optional().nullable(),
  ownershipType: z
    .enum(["Owner-Occupied", "Rented", "Vacant", "Under-Dispute"])
    .optional(),

  // Owner + contact
  ownerName: z.string().trim().min(2, "Owner name is too short.").max(120).optional(),
  contactNumber: z.string().trim().min(6, "Contact number is too short.").max(20).optional(),
  alternateContact: z.string().max(20).optional().nullable(),
  whatsappNumber: z.string().max(20).optional().nullable(),
  emailPrimary: z.string().max(160).optional().nullable(),
  emailSecondary: z.string().max(160).optional().nullable(),

  // Identity
  panCard: z.string().max(10).optional().nullable(),
  aadhaar: z.string().max(20).optional().nullable(),
  permanentAddress: addressSchema.optional(),
  emergencyContact: emergencyContactSchema.optional(),

  // Status. isActive and membershipStatus are what exclude a flat from a bill
  // run, so they are editable here rather than only settable by an import.
  isActive: z.boolean().optional(),
  membershipStatus: z
    .enum(["Active", "Inactive", "Suspended", "Blocked", "Exited"])
    .optional(),
  membershipNumber: z.string().max(40).optional().nullable(),
  hasVotingRights: z.boolean().optional(),

  // Notes
  internalNotes: z.string().max(2000).optional().nullable(),
  publicRemarks: z.string().max(2000).optional().nullable(),

  // Money. openingBalance stays accepted for backward compatibility but the
  // route always recomputes it from principal + interest.
  openingBalance: z.coerce.number().optional(),
  openingPrincipal: z.coerce.number().min(0).optional(),
  openingInterest: z.coerce.number().min(0).optional(),
});

// Bulk create needs the fields a Member genuinely cannot exist without.
export const bulkMemberSchema = z.array(
  memberSchema.required({
    flatNo: true,
    ownerName: true,
    contactNumber: true,
    carpetAreaSqft: true,
  }),
);
