// lib/commercial/shopStorefrontSchemas.js
//
// Validation for the shop storefront payloads. Kept beside the storefront
// logic (not in lib/v1/schemas.js) because these shapes are only used by the
// admin storefront endpoint and the owner's future edit flow.
import { z } from "zod";
import { OFFLINE_PAYMENT_METHOD_VALUES } from "./shopConstants";

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, for example 09:30");

const interval = z
  .object({ opensAt: hhmm, closesAt: hhmm })
  .refine((v) => v.opensAt !== v.closesAt, {
    message: "Opening and closing time cannot be the same",
  });

// Overlapping intervals on one day would make "open until X" ambiguous, so
// they are rejected at the edge rather than resolved by guesswork later.
function noOverlap(intervals) {
  const sorted = [...intervals].sort((a, b) => a.opensAt.localeCompare(b.opensAt));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].opensAt < sorted[i - 1].closesAt) return false;
  }
  return true;
}

const dayHours = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean().optional().default(false),
    intervals: z.array(interval).max(4).optional().default([]),
  })
  .refine((d) => d.isClosed || d.intervals.length > 0, {
    message: "Add at least one time range, or mark the day closed",
  })
  .refine((d) => noOverlap(d.intervals), { message: "Time ranges overlap" });

const hourOverride = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  label: z.string().trim().max(80).optional().nullable(),
  isClosed: z.boolean().optional().default(true),
  intervals: z.array(interval).max(4).optional().default([]),
});

export const storefrontUpdateSchema = z
  .object({
    tagline: z.string().trim().max(120).optional().nullable(),
    description: z.string().trim().max(2000).optional().nullable(),
    timezone: z.string().trim().max(64).optional(),
    weeklyHours: z
      .array(dayHours)
      .max(7)
      .optional()
      .refine(
        (days) => !days || new Set(days.map((d) => d.dayOfWeek)).size === days.length,
        { message: "Each day may appear only once" },
      ),
    hourOverrides: z.array(hourOverride).max(60).optional(),
    manualClosed: z.boolean().optional(),
    manualClosedNote: z.string().trim().max(160).optional().nullable(),
    pickupEnabled: z.boolean().optional(),
    deliveryEnabled: z.boolean().optional(),
    serviceOnly: z.boolean().optional(),
    deliveryNote: z.string().trim().max(240).optional().nullable(),
    minOrderAmount: z.number().min(0).max(1000000).optional().nullable(),
    offlinePaymentMethods: z
      .array(z.enum(OFFLINE_PAYMENT_METHOD_VALUES))
      .max(OFFLINE_PAYMENT_METHOD_VALUES.length)
      .optional(),
    publicPhone: z.string().trim().max(20).optional().nullable(),
    publicWhatsapp: z.string().trim().max(20).optional().nullable(),
    publicEmail: z.string().trim().email().max(160).optional().nullable().or(z.literal("")),
    logoKey: z.string().trim().max(300).optional().nullable(),
    coverKey: z.string().trim().max(300).optional().nullable(),
  })
  .strict();

export const publishSchema = z
  .object({
    isPublished: z.boolean(),
    reason: z.string().trim().max(200).optional().nullable(),
  })
  .strict();
