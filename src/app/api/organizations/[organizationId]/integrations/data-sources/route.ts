import {
  organizationRouteParamsSchema,
  parseRequestBody,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";
import { z } from "zod";
import { IntegrationError } from "@/domain/integrations/errors";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  buildDataSourceStoragePath,
  buildDeterministicUploadId,
  buildOperationSubkey,
  csvContentDigest,
  parseAndValidateCsv,
  validateColumnMapping,
} from "@/modules/integrations/application/csv";

const manualSourceRequestSchema = z
  .object({
    sourceType: z.literal("manual"),
    name: z.string().trim().min(2).max(160),
    branchId: z.string().uuid().nullable().optional(),
    columnMapping: z.record(z.string(), z.string()).optional(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

function parseColumnMapping(value: FormDataEntryValue | null): Record<string, string> {
  if (value === null || typeof value !== "string" || !value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "The CSV column mapping is invalid.");
  }
  return z.record(z.string(), z.string()).parse(parsed);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: organizationRouteParamsSchema,
    handler: async ({ context, service }) => ({
      body: { dataSources: (await service.getSnapshot(context)).dataSources },
    }),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runIntegrationRoute({
    request,
    params,
    paramsSchema: organizationRouteParamsSchema,
    handler: async ({ context, service }) => {
      const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("multipart/form-data")) {
        const input = await parseRequestBody(request, manualSourceRequestSchema);
        const committed = await service.createDataSourceWithIdempotency({ ...context, ...input });
        return {
          body: { dataSource: committed.source, deduplicated: committed.deduplicated },
          status: committed.created ? 201 : 200,
        };
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new DomainError("VALIDATION_ERROR", "A CSV file is required.");
      }
      const name = z.string().trim().min(2).max(160).parse(form.get("name"));
      const idempotencyKey = z.string().trim().min(16).max(200).parse(form.get("idempotencyKey"));
      const branchIdValue = form.get("branchId");
      const branchId = branchIdValue ? z.string().uuid().parse(branchIdValue) : null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const csv = parseAndValidateCsv({
        bytes,
        filename: file.name,
        mediaType: file.type,
      });
      if (csv.errors.length) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "The CSV contains rows with invalid column counts.",
        );
      }
      const mappingInput = parseColumnMapping(form.get("columnMapping"));
      const columnMapping = validateColumnMapping(mappingInput, csv.headers);
      if (!Object.keys(columnMapping).length) {
        throw new DomainError("VALIDATION_ERROR", "Map at least one CSV column before uploading.");
      }
      const committed = await service.createDataSourceWithIdempotency({
        ...context,
        sourceType: "csv_import",
        name,
        branchId,
        storagePath: null,
        originalFilename: csv.filename,
        mediaType: "text/csv",
        sizeBytes: csv.byteSize,
        columnMapping,
        idempotencyKey,
        operationFingerprint: JSON.stringify({
          operation: "data_source.create.csv",
          name,
          branchId,
          filename: csv.filename,
          mediaType: "text/csv",
          sizeBytes: csv.byteSize,
          contentDigest: csvContentDigest(bytes),
          columnMapping,
        }),
      });
      const pending = committed.source;
      if (committed.deduplicated && pending.status === "ready" && pending.storage_path) {
        return { body: { dataSource: pending, deduplicated: true }, status: 200 };
      }
      const uploadId = buildDeterministicUploadId(context.organizationId, idempotencyKey);
      const storagePath = buildDataSourceStoragePath(
        context.organizationId,
        pending.id,
        uploadId,
        csv.filename,
      );
      const storage = context.supabase.storage.from("integration-imports");
      if (committed.deduplicated && pending.status === "pending") {
        try {
          await storage.remove([storagePath]);
        } catch {
          // A missing object is fine; the upload below is the recovery attempt.
        }
      }
      const uploaded = await storage.upload(storagePath, bytes, {
        contentType: "text/csv",
        upsert: false,
      });
      if (uploaded.error) {
        await service.updateDataSource({
          ...context,
          dataSourceId: pending.id,
          status: "failed",
          idempotencyKey: buildOperationSubkey(idempotencyKey, "upload-failure"),
        });
        throw new IntegrationError(
          "UNKNOWN_PROVIDER_ERROR",
          "The private CSV upload failed.",
          true,
        );
      }
      try {
        const source = await service.finalizeDataSourceUpload({
          ...context,
          dataSourceId: pending.id,
          storagePath,
          originalFilename: csv.filename,
          mediaType: "text/csv",
          sizeBytes: csv.byteSize,
          columnMapping,
        });
        return {
          body: { dataSource: source, deduplicated: committed.deduplicated },
          status: committed.created ? 201 : 200,
        };
      } catch (error) {
        let cleanupFailed = false;
        try {
          cleanupFailed = Boolean((await storage.remove([storagePath])).error);
        } catch {
          cleanupFailed = true;
        }
        if (cleanupFailed) {
          logger.warn("integration_data_source.upload_cleanup_failed", {
            organizationId: context.organizationId,
            dataSourceId: pending.id,
            correlationId: context.correlationId,
            errorCode: "STORAGE_CLEANUP_FAILED",
          });
        }
        await service
          .updateDataSource({
            ...context,
            dataSourceId: pending.id,
            status: "failed",
            idempotencyKey: buildOperationSubkey(idempotencyKey, "cleanup"),
          })
          .catch(() => {
            logger.warn("integration_data_source.failure_state_persist_failed", {
              organizationId: context.organizationId,
              dataSourceId: pending.id,
              correlationId: context.correlationId,
              errorCode: "DATA_SOURCE_FAILURE_STATE_UNAVAILABLE",
            });
          });
        throw error;
      }
    },
  });
}
