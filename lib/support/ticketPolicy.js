// Single source of truth for support-ticket limits and enums — imported by
// both the create route (server-enforced) and the admin submit form
// (client-side pre-check, so a user finds out a file is too big before
// typing a whole report, not after submitting).
export const TICKET_CATEGORIES = [
  "Enquiry",
  "Complaint",
  "Error",
  "Bug",
  "Data Issue",
  "General Issue",
];

export const TICKET_STATUSES = [
  "Received",
  "Acknowledged",
  "Working",
  "Pending",
  "Completed",
  "Reverted",
];

// Terminal-ish forward flow superadmin moves a ticket through. Not enforced
// as a strict state machine server-side (a superadmin can set any status —
// e.g. jumping straight to Reverted, or back from Completed to Working if
// the admin reopens the issue) but this is what the status dropdown in the
// UI offers in order.
export const TICKET_STATUS_FLOW = TICKET_STATUSES;

export const MAX_SCREENSHOTS = 2;
export const MAX_SCREENSHOT_BYTES = 512 * 1024; // 512KB per file
export const ACCEPTED_SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_ERROR_LOG_CHARS = 20000;
export const MAX_TITLE_CHARS = 150;
export const MAX_DESCRIPTION_CHARS = 4000;

export const STATUS_TONE = {
  Received: "info",
  Acknowledged: "info",
  Working: "warning",
  Pending: "warning",
  Completed: "success",
  Reverted: "danger",
};

/**
 * Decodes a "data:<mime>;base64,<payload>" string and validates it against
 * the policy above. Throws a plain Error with a user-facing message on any
 * violation — callers turn that into a 400.
 * @returns {{ data: string, contentType: string, size: number }}
 */
export function parseAndValidateScreenshot(dataUrl, index) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
    throw new Error(`Screenshot ${index + 1} is not a valid image`);
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new Error(`Screenshot ${index + 1} is not a valid image`);
  }
  const [, contentType, base64] = match;
  if (!ACCEPTED_SCREENSHOT_TYPES.includes(contentType)) {
    throw new Error(
      `Screenshot ${index + 1}: unsupported type "${contentType}". Allowed: PNG, JPEG, WebP`,
    );
  }
  // Decoded byte length, not the base64 string length (~33% bigger) — the
  // number that actually matters and the one a client-side pre-check must
  // match, or a file that passes client validation could still be rejected
  // here.
  const sizeBytes = Math.ceil((base64.length * 3) / 4);
  if (sizeBytes > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `Screenshot ${index + 1} is ${Math.round(sizeBytes / 1024)}KB — max is ${MAX_SCREENSHOT_BYTES / 1024}KB`,
    );
  }
  return { data: dataUrl, contentType, size: sizeBytes };
}
