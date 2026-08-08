import {
  organizationRouteParamsSchema,
  parseRequestBody,
  runIntegrationRoute,
} from "@/modules/integrations/application/api-schemas";
import { z } from "zod";
import { IntegrationError } from "@/domain/integrations/errors";
import { DomainError } from "@/lib/errors";
import {
  buildDataSourceStoragePath,
  parseAndValidateCsv,
  validateColumnMapping,
} from "@/modules/integrations/application/csv";

const manualSourceRequestSchema = z
  .object({
    sourceType: z.literal("manual"),
    name: z.string().trim().min(2).max(160),
    branchId: z.string().uuid().nullable().optional(),
    columnMapping: z.record(z.string(), z.string()).optional(),
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
        const source = await service.createDataSource({ ...context, ...input });
        return { body: { dataSource: source }, status: 201 };
      }

      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new DomainError("VALIDATION_ERROR", "A CSV file is required.");
      }
      const name = z.string().trim().min(2).max(160).parse(form.get("name"));
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
      const pending = await service.createDataSource({
        ...context,
        sourceType: "csv_import",
        name,
        branchId,
        storagePath: null,
        originalFilename: null,
        mediaType: null,
        sizeBytes: null,
        columnMapping,
      });
      const uploadId = crypto.randomUUID();
      const storagePath = buildDataSourceStoragePath(
        context.organizationId,
        pending.id,
        uploadId,
        csv.filename,
      );
      const storage = context.supabase.storage.from("integration-imports");
      const uploaded = await storage.upload(storagePath, bytes, {
        contentType: "text/csv",
        upsert: false,
      });
      if (uploaded.error) {
        await service.updateDataSource({
          ...context,
          dataSourceId: pending.id,
          status: "failed",
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
        return { body: { dataSource: source }, status: 201 };
      } catch (error) {
        await storage.remove([storagePath]).catch(() => undefined);
        throw error;
      }
    },
  });
}
