import { z } from "zod";

/**
 * Controlled vocabularies and structured value shapes for onboarding answers.
 *
 * Onboarding section payloads are free-form JSONB at the storage layer, so the
 * only thing keeping stored answers comparable across organizations is this
 * module. Every operator-facing choice resolves to a slug, an ISO code, an
 * integer, a boolean, or one of the structured shapes below — never prose.
 */

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const weekdaySchema = z.enum(weekdays);
export type Weekday = z.infer<typeof weekdaySchema>;

export const weekdayLabels: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dayHoursSchema = z.object({
  day: weekdaySchema,
  closed: z.boolean().default(false),
  opensAt: z.string().regex(timePattern).nullable().default(null),
  closesAt: z.string().regex(timePattern).nullable().default(null),
});
export type DayHours = z.infer<typeof dayHoursSchema>;

/** A recurring weekly opening pattern, ordered Monday to Sunday. */
export const weeklyHoursSchema = z.array(dayHoursSchema).max(7);
export type WeeklyHours = z.infer<typeof weeklyHoursSchema>;

export function emptyWeeklyHours(): WeeklyHours {
  return weekdays.map((day) => ({ day, closed: false, opensAt: null, closesAt: null }));
}

/** A schedule counts as captured once at least one day has a full open range. */
export function hasOpeningHours(value: unknown): boolean {
  const parsed = weeklyHoursSchema.safeParse(value);
  if (!parsed.success) return false;
  return parsed.data.some((entry) => !entry.closed && Boolean(entry.opensAt && entry.closesAt));
}

/** Half-hour slots used by every time picker so stored times stay aligned. */
export const timeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, "0");
  const minute = index % 2 === 0 ? "00" : "30";
  return `${hour}:${minute}`;
});

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A closed measurement window expressed as inclusive ISO year-months. */
export const measurementPeriodSchema = z
  .object({
    start: z.string().regex(monthPattern),
    end: z.string().regex(monthPattern),
  })
  .refine((period) => period.start <= period.end, {
    message: "The measurement period must end on or after it starts.",
  });
export type MeasurementPeriod = z.infer<typeof measurementPeriodSchema>;

export function hasMeasurementPeriod(value: unknown): boolean {
  return measurementPeriodSchema.safeParse(value).success;
}

export const accountOwnershipSchema = z.enum(["client_owned", "agency_managed", "mixed", "none"]);
export const accountOwnershipOptions = [
  { value: "client_owned", label: "Client owned" },
  { value: "agency_managed", label: "Agency managed" },
  { value: "mixed", label: "Mixed ownership" },
  { value: "none", label: "No accounts yet" },
] as const;

export const conversionTrackingSchema = z.enum(["connected", "partial", "missing", "unknown"]);
export const conversionTrackingOptions = [
  {
    value: "connected",
    label: "Connected and verified",
    description: "Conversions are tracked end to end and the data has been checked.",
  },
  {
    value: "partial",
    label: "Partially connected",
    description: "Some channels report conversions; coverage has known gaps.",
  },
  {
    value: "missing",
    label: "Not connected",
    description: "No conversion tracking is in place today.",
  },
  { value: "unknown", label: "Unknown", description: "Nobody has confirmed this yet." },
] as const;

export const performanceSourceSchema = z.enum([
  "pos_export",
  "analytics_platform",
  "marketplace_report",
  "accounting_system",
  "operator_estimate",
  "client_reported",
]);
export const performanceSourceOptions = [
  { value: "pos_export", label: "POS export" },
  { value: "analytics_platform", label: "Analytics platform" },
  { value: "marketplace_report", label: "Marketplace report" },
  { value: "accounting_system", label: "Accounting system" },
  { value: "operator_estimate", label: "Operator estimate" },
  { value: "client_reported", label: "Client reported" },
] as const;

/**
 * Consent is a legal statement, so the operator records who confirmed it rather
 * than typing prose. Only an explicit confirmation satisfies the readiness rule.
 */
export const consentStatusSchema = z.enum([
  "confirmed_by_client",
  "confirmed_by_operator",
  "not_confirmed",
  "unknown",
]);
export const consentStatusOptions = [
  {
    value: "confirmed_by_client",
    label: "Confirmed by the client",
    description: "The client has stated in writing that contactable consent exists.",
  },
  {
    value: "confirmed_by_operator",
    label: "Confirmed by the operator from evidence",
    description: "Consent records were reviewed and attached as evidence.",
  },
  {
    value: "not_confirmed",
    label: "Not confirmed",
    description: "Consent does not exist or has not been granted.",
  },
  {
    value: "unknown",
    label: "Unknown",
    description: "Record this honestly; the platform will request it instead of assuming it.",
  },
] as const;

export const baselineStatusSchema = z.enum(["known", "estimated", "unknown"]);
export const baselineStatusOptions = [
  {
    value: "known",
    label: "Known",
    description: "A measured baseline exists and can be evidenced.",
  },
  {
    value: "estimated",
    label: "Estimated",
    description: "The baseline is an informed estimate, not a measurement.",
  },
  { value: "unknown", label: "Unknown", description: "No baseline is available yet." },
] as const;

/** Mirrors `policyInputSchema.mode` so onboarding answers map onto policy rows. */
export const approvalModeSchema = z.enum([
  "recommendation_only",
  "approval_required",
  "bounded_auto_execution",
]);
export const approvalModeOptions = [
  {
    value: "recommendation_only",
    label: "Recommendation only",
    description: "The platform proposes actions; a human executes everything.",
  },
  {
    value: "approval_required",
    label: "Approval required",
    description: "Actions are prepared but wait for explicit human approval.",
  },
  {
    value: "bounded_auto_execution",
    label: "Bounded auto execution",
    description: "Low-risk actions run inside configured policy limits.",
  },
] as const;

export const channelOptions = [
  { value: "website", label: "Website" },
  { value: "online_ordering", label: "Online ordering" },
  { value: "google_business_profile", label: "Google Business Profile" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "talabat", label: "Talabat" },
  { value: "deliveroo", label: "Deliveroo" },
  { value: "careem", label: "Careem" },
  { value: "noon", label: "Noon" },
  { value: "amazon", label: "Amazon" },
  { value: "walk_in", label: "Walk-in / in-store" },
  { value: "phone", label: "Phone" },
  { value: "partner_referral", label: "Partner referral" },
] as const;

export const performanceMetricOptions = [
  { value: "revenue", label: "Revenue" },
  { value: "orders", label: "Orders or transactions" },
  { value: "average_order_value", label: "Average order value" },
  { value: "gross_margin", label: "Gross margin" },
  { value: "new_customers", label: "New customers" },
  { value: "repeat_rate", label: "Repeat purchase rate" },
  { value: "customer_acquisition_cost", label: "Customer acquisition cost" },
  { value: "marketing_spend", label: "Marketing spend" },
  { value: "conversion_rate", label: "Conversion rate" },
  { value: "traffic", label: "Traffic or sessions" },
  { value: "churn", label: "Churn or lapsed customers" },
] as const;

export const customerSegmentOptions = [
  { value: "new", label: "New customers" },
  { value: "repeat", label: "Repeat customers" },
  { value: "high_value", label: "High-value customers" },
  { value: "lapsed", label: "Lapsed customers" },
  { value: "corporate", label: "Corporate or B2B" },
  { value: "delivery", label: "Delivery-first" },
  { value: "walk_in", label: "Walk-in" },
  { value: "subscribers", label: "Subscribers or members" },
] as const;

export const firstPartyDataOptions = [
  { value: "crm", label: "CRM records" },
  { value: "pos", label: "POS history" },
  { value: "ecommerce", label: "E-commerce accounts" },
  { value: "email_list", label: "Email list" },
  { value: "sms_list", label: "SMS list" },
  { value: "whatsapp_list", label: "WhatsApp list" },
  { value: "loyalty", label: "Loyalty programme" },
  { value: "reservations", label: "Reservations or bookings" },
  { value: "none", label: "No first-party data" },
] as const;

export const brandVoiceOptions = [
  { value: "warm", label: "Warm" },
  { value: "direct", label: "Direct" },
  { value: "premium", label: "Premium" },
  { value: "playful", label: "Playful" },
  { value: "authoritative", label: "Authoritative" },
  { value: "minimal", label: "Minimal" },
  { value: "conversational", label: "Conversational" },
  { value: "technical", label: "Technical" },
  { value: "traditional", label: "Traditional" },
  { value: "energetic", label: "Energetic" },
] as const;

export const dataSourceOptions = [
  { value: "pos_export", label: "POS export" },
  { value: "ecommerce_platform", label: "E-commerce platform" },
  { value: "google_business_profile", label: "Google Business Profile" },
  { value: "google_analytics", label: "Google Analytics" },
  { value: "meta_business", label: "Meta Business Suite" },
  { value: "google_ads", label: "Google Ads" },
  { value: "delivery_marketplace", label: "Delivery marketplace dashboard" },
  { value: "crm_export", label: "CRM export" },
  { value: "accounting_export", label: "Accounting export" },
  { value: "spreadsheet_upload", label: "Spreadsheet or CSV upload" },
  { value: "menu_or_catalog_file", label: "Menu or catalog file" },
  { value: "operator_interview", label: "Operator interview notes" },
] as const;

export const productCategoryOptions = [
  { value: "mains", label: "Mains" },
  { value: "starters", label: "Starters" },
  { value: "desserts", label: "Desserts" },
  { value: "beverages", label: "Beverages" },
  { value: "combos", label: "Combos or bundles" },
  { value: "retail_goods", label: "Retail goods" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "services", label: "Services" },
  { value: "consultations", label: "Consultations" },
  { value: "add_ons", label: "Add-ons" },
] as const;

/** True when a payload key holds a non-empty array of values. */
export function hasEntries(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return Array.isArray(value) && value.length > 0;
}
