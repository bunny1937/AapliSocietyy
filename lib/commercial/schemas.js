// Server-authoritative validation for every commercial write. Client-side
// validation in the admin UI and in Flutter exists for UX only.
import { z } from "zod";
import {
  FULFILLMENT_MODES,
  SEARCH_TERM_MAX_LENGTH,
  UNIT_CLASS_VALUES,
} from "./constants";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE = /^[0-9+\-\s()]{6,20}$/;

const intervalSchema = z
  .object({
    opensAt: z.string().regex(TIME, "Use HH:mm (24h)"),
    closesAt: z.string().regex(TIME, "Use HH:mm (24h)"),
  })
  .refine((i) => i.closesAt > i.opensAt, {
    message: "closesAt must be after opensAt (split a cross-midnight shift into two days)",
  });

function noOverlap(intervals) {
  const sorted = [...intervals].sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].opensAt < sorted[i - 1].closesAt) return false;
  }
  return true;
}

const daySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean().optional().default(false),
    intervals: z.array(intervalSchema).max(4).optional().default([]),
  })
  .refine((d) => d.isClosed || noOverlap(d.intervals), {
    message: "Opening intervals overlap",
  });

export const businessHoursSchema = z.object({
  timezone: z.string().min(3).max(64).optional().default("Asia/Kolkata"),
  weeklySchedule: z.array(daySchema).max(7).optional().default([]),
  exceptions: z
    .array(
      z.object({
        date: z.string().regex(DATE, "Use YYYY-MM-DD"),
        label: z.string().max(80).optional(),
        isClosed: z.boolean().optional().default(true),
        intervals: z.array(intervalSchema).max(4).optional().default([]),
      }),
    )
    .max(40)
    .optional()
    .default([]),
});

const profileCore = {
  tradeName: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional().nullable(),
  categoryId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid category"),
  description: z.string().trim().max(2000).optional().nullable(),
  phone: z.string().trim().regex(PHONE).optional().nullable(),
  whatsapp: z.string().trim().regex(PHONE).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable(),
  gstin: z.string().trim().length(15).optional().nullable(),
  licenseNumber: z.string().trim().max(60).optional().nullable(),
  businessHours: businessHoursSchema.optional().nullable(),
  fulfillmentModes: z.array(z.enum(FULFILLMENT_MODES)).max(3).optional(),
  logoKey: z.string().max(300).optional().nullable(),
  coverKey: z.string().max(300).optional().nullable(),
};

// Admin create: memberId is required and is validated against the caller's
// own society before anything is written.
export const businessProfileCreateSchema = z.object({
  memberId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid member"),
  ...profileCore,
});

// Update: all fields optional; `expectedUpdatedAt` gives optimistic
// concurrency so two editors cannot silently overwrite each other.
export const businessProfileUpdateSchema = z.object({
  ...Object.fromEntries(
    Object.entries(profileCore).map(([k, v]) => [k, v.optional()]),
  ),
  expectedUpdatedAt: z.string().datetime().optional(),
  updatedReason: z.string().max(60).optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,80}$/, "Lowercase letters, numbers and hyphens only")
    .optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const directoryQuerySchema = z.object({
  q: z.string().trim().max(SEARCH_TERM_MAX_LENGTH).optional(),
  categoryId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const billingApplicabilitySchema = z.object({
  appliesToUnitClasses: z.array(z.enum(UNIT_CLASS_VALUES)).max(3).optional(),
});

export const commercialBillingHeadCreateSchema = z.object({
  headName: z.string().trim().min(2).max(120),
  categoryScope: z.array(z.enum(["Shop", "Office"])).min(1).max(2),
  calculationType: z.enum(["Fixed", "Per Sq Ft", "Percentage"]),
  rate: z.object({
    Shop: z.number().min(0).nullable().optional(),
    Office: z.number().min(0).nullable().optional(),
  }),
  isServiceCharge: z.boolean().optional(),
  nonOccupancyEligible: z.boolean().optional(),
  // Per-unit applicability. "Quantity" heads bill rate x the count each shop
  // was allotted, so they carry a label for the number box on the shop form.
  applicability: z.enum(["All", "OptIn", "Quantity"]).optional(),
  quantityLabel: z.string().trim().max(60).nullable().optional(),
});

export const commercialBillingHeadUpdateSchema = z.object({
  headName: z.string().trim().min(2).max(120).optional(),
  categoryScope: z.array(z.enum(["Shop", "Office"])).min(1).max(2).optional(),
  calculationType: z.enum(["Fixed", "Per Sq Ft", "Percentage"]).optional(),
  rate: z
    .object({
      Shop: z.number().min(0).nullable().optional(),
      Office: z.number().min(0).nullable().optional(),
    })
    .optional(),
  isServiceCharge: z.boolean().optional(),
  nonOccupancyEligible: z.boolean().optional(),
  // Per-unit applicability. "Quantity" heads bill rate x the count each shop
  // was allotted, so they carry a label for the number box on the shop form.
  applicability: z.enum(["All", "OptIn", "Quantity"]).optional(),
  quantityLabel: z.string().trim().max(60).nullable().optional(),
  isActive: z.boolean().optional(),
  updatedReason: z.string().max(80).optional(),
});

export const commercialHeadReorderSchema = z.object({
  order: z
    .array(
      z.object({
        id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid charge"),
        sortOrder: z.number().int().min(0).max(9999),
      }),
    )
    .min(1)
    .max(100),
});

export const commercialHeadSeedSchema = z.object({
  scope: z.enum(["Shop", "Office"]),
  keys: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
