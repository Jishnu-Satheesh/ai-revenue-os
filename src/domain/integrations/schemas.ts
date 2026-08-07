import { z } from "zod";

export const connectionMaturitySchema = z.enum([
  "manual",
  "imported",
  "read-only",
  "draft-write",
  "governed-write",
  "bounded-autonomous",
]);

export const v1AvailableMaturitySchema = z.enum(["manual", "imported", "read-only"]);

export const connectionStatusSchema = z.enum([
  "pending",
  "active",
  "degraded",
  "disconnected",
  "revoked",
]);

export const operatorHealthStateSchema = z.enum([
  "pending",
  "healthy",
  "degraded",
  "stale",
  "revoked",
]);

export const integrationRecordSourceSchema = z.object({
  kind: z.enum(["connection", "data_source"]),
  id: z.string().trim().min(1),
});

export const integrationRecordEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  organizationId: z.string().trim().min(1),
  source: integrationRecordSourceSchema,
  externalRecordId: z.string().trim().min(1),
  recordType: z.string().trim().min(1),
  observedAt: z.string().datetime().optional(),
  fetchedAt: z.string().datetime(),
  payload: z.unknown(),
});

export const ingestionRunSourceSchema = z
  .object({
    connectionId: z.string().trim().min(1).optional(),
    dataSourceId: z.string().trim().min(1).optional(),
  })
  .refine(
    ({ connectionId, dataSourceId }) => Boolean(connectionId) !== Boolean(dataSourceId),
    "Exactly one source identifier is required.",
  );

export type ConnectionMaturity = z.infer<typeof connectionMaturitySchema>;
export type V1AvailableMaturity = z.infer<typeof v1AvailableMaturitySchema>;
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export type OperatorHealthState = z.infer<typeof operatorHealthStateSchema>;
export type IntegrationRecordEnvelope = z.infer<typeof integrationRecordEnvelopeSchema>;
