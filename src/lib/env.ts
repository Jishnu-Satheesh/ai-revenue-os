import "server-only";
import { z } from "zod";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const optionalNonEmptyString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const serverEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "preview", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default("http://localhost:3000"),
  ),
  NEXT_PUBLIC_SUPABASE_URL: z.preprocess(emptyToUndefined, z.string().url()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.preprocess(emptyToUndefined, z.string().min(1)),
  SUPABASE_SERVICE_ROLE_KEY: optionalNonEmptyString,
  OPENAI_API_KEY: optionalNonEmptyString,
  ANTHROPIC_API_KEY: optionalNonEmptyString,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalNonEmptyString,
  AI_DEFAULT_MODEL: optionalNonEmptyString,
  TRIGGER_SECRET_KEY: optionalNonEmptyString,
  TRIGGER_PROJECT_REF: optionalNonEmptyString,
  INTEGRATION_HUB_V1_ORGANIZATION_IDS: optionalNonEmptyString,
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
});

function formatEnvValidationError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
    .join("; ");
  return `Invalid environment configuration: ${details}`;
}

const parsedEnv = serverEnvSchema.safeParse({
  APP_ENV: process.env.APP_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  AI_DEFAULT_MODEL: process.env.AI_DEFAULT_MODEL,
  TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
  TRIGGER_PROJECT_REF: process.env.TRIGGER_PROJECT_REF,
  INTEGRATION_HUB_V1_ORGANIZATION_IDS: process.env.INTEGRATION_HUB_V1_ORGANIZATION_IDS,
  SENTRY_DSN: process.env.SENTRY_DSN,
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
});

if (!parsedEnv.success) {
  throw new Error(formatEnvValidationError(parsedEnv.error));
}

export const env = parsedEnv.data;

export type AppEnv = z.infer<typeof serverEnvSchema>;
