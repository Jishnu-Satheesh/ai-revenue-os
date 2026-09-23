import { z } from "zod";

export const LEAD_INTENTS = ["early-access", "book-walkthrough"] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

/** The anonymous caller never sees a message, only one of these codes. */
export type LeadErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_EMAIL"
  | "INVALID_NAME"
  | "UNKNOWN_INTENT"
  | "ORIGIN_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE";

export class LeadApiError extends Error {
  constructor(
    public readonly code: LeadErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LeadApiError";
  }
}

export type ParsedLeadRequest = {
  intent: LeadIntent;
  /** Trimmed and lowercased; the only email form anything downstream sees. */
  email: string;
  name?: string;
  source: "coming-soon";
};

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;

const emailSchema = z.string().trim().min(1).max(MAX_EMAIL_LENGTH).email();

const nameSchema = z.string().trim().max(MAX_NAME_LENGTH);

function isLeadIntent(value: unknown): value is LeadIntent {
  return typeof value === "string" && (LEAD_INTENTS as readonly string[]).includes(value);
}

function fail(code: LeadErrorCode, status: number, message: string): never {
  throw new LeadApiError(code, status, message);
}

/**
 * Parses the Coming Soon payload. The intent is resolved before the email so
 * an unknown intent reports UNKNOWN_INTENT even when the email is also bad —
 * the client team needs to know which half of their next payload is wrong.
 *
 * Unknown keys are stripped, not refused: the form deploys independently of
 * this repo, and a strict schema would turn their next harmless field into a
 * failed signup for every visitor.
 */
export function parseLeadRequest(body: unknown): ParsedLeadRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    fail("INVALID_REQUEST", 400, "The request body must be a JSON object.");
  }

  const record = body as Record<string, unknown>;

  const rawIntent = record.intent;
  const intent: LeadIntent =
    rawIntent === undefined
      ? "early-access"
      : isLeadIntent(rawIntent)
        ? rawIntent
        : fail("UNKNOWN_INTENT", 400, "The requested intent is not supported.");

  if (typeof record.email !== "string" || !emailSchema.safeParse(record.email).success) {
    fail("INVALID_EMAIL", 400, "A valid email address is required.");
  }
  const email = (record.email as string).trim().toLowerCase();

  let name: string | undefined;
  if (intent === "book-walkthrough" && record.name !== undefined) {
    if (typeof record.name !== "string" || !nameSchema.safeParse(record.name).success) {
      fail("INVALID_NAME", 400, "The walkthrough name must be a short string.");
    }
    const trimmed = (record.name as string).trim();
    name = trimmed === "" ? undefined : trimmed;
  }

  return { intent, email, name, source: "coming-soon" };
}
